from __future__ import annotations

import json
import logging
import math
import re
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Mapping
from urllib.parse import urlencode

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


logger = logging.getLogger(__name__)

QUERY_BASE_URL = "https://www.alphavantage.co/query"
QUOTE_FUNCTION = "GLOBAL_QUOTE"
QUOTE_SOURCE = "alpha_vantage_global_quote"
RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}
SYMBOL_PATTERN = re.compile(r"^[A-Z][A-Z0-9.-]{0,9}$")

# GLOBAL_QUOTE does not carry a currency, and this client will not guess one per
# response. It declares USD because the product is locked to the US market
# (CLAUDE.md) and _normalize_symbol admits only a plain US ticker -- so the unit
# is fixed by the request, not inferred from the answer. If a non-US market is
# ever added, this constant is the thing that must change first: quoting a
# London price as USD would be a lie about the number, not merely its label.
QUOTE_CURRENCY = "USD"

# Alpha Vantage answers almost everything with HTTP 200 and puts the real outcome
# in the body, so these three keys -- not the status line -- are where a failure
# is actually found.
NOTE_KEY = "Note"
INFORMATION_KEY = "Information"
ERROR_KEY = "Error Message"
QUOTE_KEY = "Global Quote"

# Wording Alpha Vantage uses when it is refusing on quota rather than on data.
# Matched case-insensitively against the Note/Information text.
_THROTTLE_MARKERS = (
    "rate limit",
    "requests per day",
    "requests per minute",
    "higher api call volume",
    "premium",
)


@dataclass(frozen=True, slots=True)
class AlphaVantageQuoteConfig:
    api_key: str
    timeout_seconds: float = 8.0
    max_retries: int = 2
    retry_backoff_seconds: float = 0.5
    max_response_bytes: int = 1_000_000

    def __post_init__(self) -> None:
        if not isinstance(self.api_key, str):
            raise QuoteConfigurationError("api_key must be a string")
        key = self.api_key.strip()
        if not key:
            raise QuoteConfigurationError("api_key must not be empty")
        # The key is placed in a query string, so anything that could terminate or
        # extend that parameter is rejected outright rather than escaped.
        # Alphanumeric only, so nothing here can terminate or extend the query
        # parameter it is placed in. The floor is 4 rather than 8 so Alpha
        # Vantage's own published "demo" key stays usable for a smoke test.
        if not re.fullmatch(r"[A-Za-z0-9]{4,64}", key):
            raise QuoteConfigurationError(
                "api_key must be 4-64 alphanumeric characters"
            )
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


class AlphaVantageQuoteClient:
    """Bounded client for Alpha Vantage's GLOBAL_QUOTE endpoint.

    Satisfies the same QuoteGateway protocol as YahooQuoteClient, so
    MarketPriceService is unchanged: every failure below leaves as one of the
    typed QuoteErrors the service already maps to a named unavailable reason.

    THE API KEY NEVER LEAVES THIS CLASS. Two URLs are built for every call: the
    signed one that is actually requested, and a public one carrying only the
    function and the symbol. Only the public form is stored on the quote or put
    into a QuoteRequestError -- MarketQuote.source_url is rendered to the user in
    the sources list, and an error's url reaches the logs.
    """

    def __init__(
        self,
        config: AlphaVantageQuoteConfig,
        *,
        transport: HttpTransport | None = None,
        wall_clock: Callable[[], datetime] | None = None,
        sleeper: Callable[[float], None] = time.sleep,
    ) -> None:
        self.config = config
        self._transport = transport or UrllibHttpTransport()
        self._wall_clock = wall_clock or (lambda: datetime.now(timezone.utc))
        self._sleeper = sleeper

    def get_quote(self, symbol: str) -> MarketQuote:
        requested_symbol = self._normalize_symbol(symbol)
        public_url, signed_url = self._build_urls(requested_symbol)
        body, retrieved_at = self._request(signed_url, public_url, requested_symbol)
        payload = self._decode(body, public_url)
        quote = self._extract_quote(payload, public_url, requested_symbol)
        return self._build_quote(quote, public_url, requested_symbol, retrieved_at)

    def _build_urls(self, symbol: str) -> tuple[str, str]:
        """(public, signed). The public one is safe to log and to render."""
        visible = {"function": QUOTE_FUNCTION, "symbol": symbol}
        public_url = f"{QUERY_BASE_URL}?{urlencode(visible)}"
        signed_url = f"{QUERY_BASE_URL}?{urlencode({**visible, 'apikey': self.config.api_key.strip()})}"
        return public_url, signed_url

    def _request(
        self,
        signed_url: str,
        public_url: str,
        symbol: str,
    ) -> tuple[bytes, datetime]:
        attempts = self.config.max_retries + 1
        for attempt_index in range(attempts):
            try:
                response = self._transport.get(
                    signed_url,
                    headers={
                        "User-Agent": "DCFLens/1.0",
                        "Accept": "application/json",
                    },
                    timeout_seconds=self.config.timeout_seconds,
                    max_response_bytes=self.config.max_response_bytes,
                )
            except ResponseTooLarge as exc:
                raise QuoteRequestError(
                    url=public_url,
                    message=str(exc),
                    attempts=attempt_index + 1,
                    retryable=False,
                ) from exc
            except TransportFailure as exc:
                if attempt_index < self.config.max_retries:
                    self._sleep_before_retry(attempt_index)
                    continue
                raise QuoteRequestError(
                    url=public_url,
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
                url=public_url,
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

    @classmethod
    def _extract_quote(
        cls,
        payload: Mapping[str, Any],
        url: str,
        symbol: str,
    ) -> Mapping[str, Any]:
        """Read the outcome out of a 200 body.

        Order matters: the throttle and error keys are checked BEFORE the quote
        key, because Alpha Vantage returns them instead of a quote, not alongside
        one, and an unchecked body would fall through to "missing price".
        """
        for key in (NOTE_KEY, INFORMATION_KEY):
            text = payload.get(key)
            if isinstance(text, str) and text.strip():
                if cls._is_throttle(text):
                    raise QuoteRateLimitError("quote provider rate limit reached")
                # Some other refusal -- an unentitled key, a symbol the plan does
                # not cover, maintenance. UNAVAILABLE rather than INVALID_RESPONSE
                # because no quote came back at all: "we got a price we don't
                # trust" would be a false statement about a body with no price in
                # it. Not retryable; asking again gets the same refusal.
                raise QuoteRequestError(
                    url=url,
                    message="quote provider declined the request",
                    attempts=1,
                    retryable=False,
                )

        error_text = payload.get(ERROR_KEY)
        if isinstance(error_text, str) and error_text.strip():
            # Overwhelmingly this is a bad or missing key. Say so once, loudly and
            # without the key itself, or "I added the key and still see no price"
            # is an hour of guessing.
            logger.warning(
                "alphavantage_request_rejected",
                extra={"symbol": symbol, "hint": "check ALPHAVANTAGE_API_KEY"},
            )
            raise QuoteDataError(f"quote provider rejected the request for {url}")

        quote = payload.get(QUOTE_KEY)
        if not isinstance(quote, Mapping):
            raise QuoteDataError(f"quote response is missing {QUOTE_KEY!r} for {url}")
        if not quote:
            # A well-formed answer meaning "no such listing" -- Alpha Vantage's
            # only way of saying it.
            raise QuoteNotFoundError(f"no listing for symbol {symbol}")
        return quote

    @staticmethod
    def _is_throttle(text: str) -> bool:
        lowered = text.lower()
        return any(marker in lowered for marker in _THROTTLE_MARKERS)

    @classmethod
    def _build_quote(
        cls,
        quote: Mapping[str, Any],
        url: str,
        symbol: str,
        retrieved_at: datetime,
    ) -> MarketQuote:
        # Same guard as the Yahoo client: printing another company's price under
        # this ticker is the worst available violation of D-017, so a mismatch is
        # fatal rather than coerced.
        resolved = quote.get("01. symbol")
        if not isinstance(resolved, str) or not resolved.strip():
            raise QuoteDataError("quote response does not name the resolved symbol")
        if resolved.strip().upper() != symbol:
            raise QuoteDataError(
                f"quote provider resolved {symbol} to a different listing: "
                f"{resolved.strip().upper()}"
            )

        return MarketQuote(
            symbol=symbol,
            price=cls._read_price(quote),
            currency=QUOTE_CURRENCY,
            quoted_at=cls._read_quoted_at(quote),
            retrieved_at=retrieved_at,
            source=QUOTE_SOURCE,
            source_url=url,
            # GLOBAL_QUOTE names no exchange. None is the honest answer; the
            # frontend already renders the absence rather than a placeholder.
            exchange_name=None,
        )

    @staticmethod
    def _read_price(quote: Mapping[str, Any]) -> float:
        # Alpha Vantage sends every number as a STRING ("05. price": "430.1600"),
        # so this parses rather than type-checks -- but it still refuses anything
        # that is not a finite positive number.
        raw_price = quote.get("05. price")
        if not isinstance(raw_price, str) or not raw_price.strip():
            raise QuoteDataError("quote response is missing a price")
        try:
            price = float(raw_price.strip())
        except ValueError as exc:
            raise QuoteDataError("price must be a decimal number") from exc
        if not math.isfinite(price):
            raise QuoteDataError("price must be finite")
        if price <= 0.0:
            raise QuoteDataError("price must be greater than zero")
        return price

    @staticmethod
    def _read_quoted_at(quote: Mapping[str, Any]) -> datetime | None:
        # "07. latest trading day" is a DATE, not a timestamp: this endpoint does
        # not say what time the price was struck. Midnight UTC of that day is the
        # date carried in the field's type -- it is not a claim about the hour.
        # retrieved_at, which is a real instant, is what the frontend pairs it
        # with to judge staleness.
        raw_day = quote.get("07. latest trading day")
        if not isinstance(raw_day, str) or not raw_day.strip():
            return None
        try:
            day = datetime.strptime(raw_day.strip(), "%Y-%m-%d")
        except ValueError:
            return None
        return day.replace(tzinfo=timezone.utc)
