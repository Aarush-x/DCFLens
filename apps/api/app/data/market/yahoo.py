from __future__ import annotations

import json
import math
import numbers
import re
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Mapping
from urllib.parse import quote

from app.data.market.errors import (
    QuoteConfigurationError,
    QuoteDataError,
    QuoteNotFoundError,
    QuoteRateLimitError,
    QuoteRequestError,
)
from app.data.market.models import MarketQuote
from app.data.transport import (
    HttpTransport,
    ResponseTooLarge,
    TransportFailure,
    UrllibHttpTransport,
)


CHART_BASE_URL = "https://query1.finance.yahoo.com/v8/finance/chart"
QUOTE_SOURCE = "yahoo_finance_chart"
RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}
SYMBOL_PATTERN = re.compile(r"^[A-Z][A-Z0-9.-]{0,9}$")
CURRENCY_PATTERN = re.compile(r"^[A-Za-z]{3}$")
# Yahoo answers an unidentified client with an immediate 429. Verified: without
# a browser User-Agent this endpoint never returns a quote at all.
DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)


@dataclass(frozen=True, slots=True)
class YahooQuoteConfig:
    user_agent: str = DEFAULT_USER_AGENT
    timeout_seconds: float = 8.0
    max_retries: int = 2
    retry_backoff_seconds: float = 0.5
    max_response_bytes: int = 2_000_000

    def __post_init__(self) -> None:
        if not isinstance(self.user_agent, str):
            raise QuoteConfigurationError("user_agent must be a string")
        identity = self.user_agent.strip()
        if len(identity) < 2:
            raise QuoteConfigurationError("user_agent must be a non-empty identity")
        if any(ord(character) < 32 or ord(character) == 127 for character in identity):
            raise QuoteConfigurationError("user_agent must not contain control characters")
        try:
            identity.encode("latin-1")
        except UnicodeEncodeError as exc:
            raise QuoteConfigurationError("user_agent must be HTTP header encodable") from exc
        if not self._finite_number(self.timeout_seconds) or not (
            0.0 < self.timeout_seconds <= 120.0
        ):
            raise QuoteConfigurationError("timeout_seconds must be in (0, 120]")
        if (
            isinstance(self.max_retries, bool)
            or not isinstance(self.max_retries, int)
            or not 0 <= self.max_retries <= 5
        ):
            raise QuoteConfigurationError("max_retries must be an integer from 0 through 5")
        if not self._finite_number(self.retry_backoff_seconds) or not (
            0.0 <= self.retry_backoff_seconds <= 30.0
        ):
            raise QuoteConfigurationError("retry_backoff_seconds must be in [0, 30]")
        if (
            isinstance(self.max_response_bytes, bool)
            or not isinstance(self.max_response_bytes, int)
            or not 1_024 <= self.max_response_bytes <= 100_000_000
        ):
            raise QuoteConfigurationError(
                "max_response_bytes must be between 1024 and 100000000"
            )

    @staticmethod
    def _finite_number(value: object) -> bool:
        return (
            not isinstance(value, bool)
            and isinstance(value, (int, float))
            and math.isfinite(float(value))
        )


class YahooQuoteClient:
    """Bounded client for Yahoo Finance's public chart endpoint.

    Unlike SecClient this keeps no request-pacing lock: the caller's quote cache
    already bounds traffic to roughly one request per ticker per minute, and
    Yahoo publishes no interval policy to pace against.
    """

    def __init__(
        self,
        config: YahooQuoteConfig | None = None,
        *,
        transport: HttpTransport | None = None,
        wall_clock: Callable[[], datetime] | None = None,
        sleeper: Callable[[float], None] = time.sleep,
    ) -> None:
        self.config = config or YahooQuoteConfig()
        self._transport = transport or UrllibHttpTransport()
        self._wall_clock = wall_clock or (lambda: datetime.now(timezone.utc))
        self._sleeper = sleeper

    def get_quote(self, symbol: str) -> MarketQuote:
        requested_symbol = self._normalize_symbol(symbol)
        url = (
            f"{CHART_BASE_URL}/{quote(requested_symbol, safe='')}"
            "?range=1d&interval=1d"
        )
        body, retrieved_at = self._request(url, requested_symbol)
        payload = self._decode(body, url)
        meta = self._extract_meta(payload, url, requested_symbol)
        return self._build_quote(meta, url, requested_symbol, retrieved_at)

    def _request(self, url: str, symbol: str) -> tuple[bytes, datetime]:
        attempts = self.config.max_retries + 1
        for attempt_index in range(attempts):
            try:
                response = self._transport.get(
                    url,
                    headers={
                        "User-Agent": self.config.user_agent.strip(),
                        "Accept": "application/json",
                    },
                    timeout_seconds=self.config.timeout_seconds,
                    max_response_bytes=self.config.max_response_bytes,
                )
            except ResponseTooLarge as exc:
                raise QuoteRequestError(
                    url=url,
                    message=str(exc),
                    attempts=attempt_index + 1,
                    retryable=False,
                ) from exc
            except TransportFailure as exc:
                if attempt_index < self.config.max_retries:
                    self._sleep_before_retry(attempt_index)
                    continue
                raise QuoteRequestError(
                    url=url,
                    message="quote request failed before receiving a response",
                    attempts=attempt_index + 1,
                    retryable=True,
                ) from exc

            status = response.status_code
            if 200 <= status < 300:
                return response.body, self._wall_clock()
            if status == 404:
                raise QuoteNotFoundError(f"no listing for symbol {symbol}")
            if status == 429:
                raise QuoteRateLimitError("quote provider rate limit reached")
            retryable = status in RETRYABLE_STATUS_CODES
            if retryable and attempt_index < self.config.max_retries:
                self._sleep_before_retry(attempt_index)
                continue
            raise QuoteRequestError(
                url=url,
                message=f"quote provider returned HTTP {status}",
                attempts=attempt_index + 1,
                status_code=status,
                retryable=retryable,
            )
        raise AssertionError("bounded quote retry loop exited unexpectedly")

    def _sleep_before_retry(self, attempt_index: int) -> None:
        delay = self.config.retry_backoff_seconds * (2**attempt_index)
        if delay > 0.0:
            self._sleeper(delay)

    @staticmethod
    def _normalize_symbol(symbol: object) -> str:
        if not isinstance(symbol, str):
            raise QuoteDataError("symbol must be a string")
        candidate = symbol.strip().upper()
        if not SYMBOL_PATTERN.fullmatch(candidate):
            raise QuoteDataError(f"invalid quote symbol: {symbol!r}")
        return candidate

    @staticmethod
    def _decode(body: bytes, url: str) -> Mapping[str, Any]:
        try:
            payload = json.loads(body)
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise QuoteDataError(f"quote provider returned invalid JSON for {url}") from exc
        if not isinstance(payload, Mapping):
            raise QuoteDataError(
                f"quote provider returned a non-object JSON payload for {url}"
            )
        return payload

    @staticmethod
    def _extract_meta(
        payload: Mapping[str, Any],
        url: str,
        symbol: str,
    ) -> Mapping[str, Any]:
        chart = payload.get("chart")
        if not isinstance(chart, Mapping):
            raise QuoteDataError(f"quote response is missing chart for {url}")
        if chart.get("error") is not None:
            raise QuoteNotFoundError(f"no listing for symbol {symbol}")
        results = chart.get("result")
        if not isinstance(results, list) or not results:
            raise QuoteDataError(f"quote response carries no chart result for {url}")
        first = results[0]
        if not isinstance(first, Mapping):
            raise QuoteDataError(f"quote response chart result is not an object for {url}")
        meta = first.get("meta")
        if not isinstance(meta, Mapping):
            raise QuoteDataError(f"quote response is missing chart meta for {url}")
        return meta

    @classmethod
    def _build_quote(
        cls,
        meta: Mapping[str, Any],
        url: str,
        symbol: str,
        retrieved_at: datetime,
    ) -> MarketQuote:
        # Yahoo sometimes resolves a near-miss ticker to a different listing.
        # Printing another company's price under this ticker would be the worst
        # possible violation of D-017, so a mismatch is fatal, never coerced.
        resolved = meta.get("symbol")
        if not isinstance(resolved, str) or not resolved.strip():
            raise QuoteDataError("quote response does not name the resolved symbol")
        if resolved.strip().upper() != symbol:
            raise QuoteDataError(
                f"quote provider resolved {symbol} to a different listing: "
                f"{resolved.strip().upper()}"
            )

        exchange_name = meta.get("fullExchangeName")
        if isinstance(exchange_name, str) and exchange_name.strip():
            exchange_name = exchange_name.strip()
        else:
            exchange_name = None

        return MarketQuote(
            symbol=symbol,
            price=cls._read_price(meta),
            currency=cls._read_currency(meta),
            quoted_at=cls._read_quoted_at(meta),
            retrieved_at=retrieved_at,
            source=QUOTE_SOURCE,
            source_url=url,
            exchange_name=exchange_name,
        )

    @staticmethod
    def _read_price(meta: Mapping[str, Any]) -> float:
        raw_price = meta.get("regularMarketPrice")
        if raw_price is None:
            raise QuoteDataError("quote response is missing regularMarketPrice")
        if isinstance(raw_price, bool) or not isinstance(raw_price, numbers.Real):
            raise QuoteDataError("regularMarketPrice must be a real number")
        price = float(raw_price)
        if not math.isfinite(price):
            raise QuoteDataError("regularMarketPrice must be finite")
        if price <= 0.0:
            raise QuoteDataError("regularMarketPrice must be greater than zero")
        return price

    @staticmethod
    def _read_currency(meta: Mapping[str, Any]) -> str:
        # No default. A price whose unit we had to guess is not a price.
        raw_currency = meta.get("currency")
        if not isinstance(raw_currency, str) or not CURRENCY_PATTERN.fullmatch(
            raw_currency.strip()
        ):
            raise QuoteDataError("currency must be a three-letter alphabetic code")
        return raw_currency.strip().upper()

    @staticmethod
    def _read_quoted_at(meta: Mapping[str, Any]) -> datetime | None:
        raw_time = meta.get("regularMarketTime")
        if isinstance(raw_time, bool) or not isinstance(raw_time, int):
            return None
        try:
            return datetime.fromtimestamp(raw_time, tz=timezone.utc)
        except (OverflowError, OSError, ValueError):
            return None
