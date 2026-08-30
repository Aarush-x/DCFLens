from __future__ import annotations

import logging
import socket
from typing import Protocol
from urllib.error import URLError

from app.data.market.errors import (
    QuoteDataError,
    QuoteNotFoundError,
    QuoteRateLimitError,
    QuoteRequestError,
)
from app.data.market.models import MarketPrice, MarketQuote, QuoteUnavailableReason
from app.services.cache import CacheBackend, SingleFlight


logger = logging.getLogger(__name__)


# One plain-English sentence per reason, frozen in docs/API.md. They are rendered
# to the user verbatim, so none of them names a provider, a library, an HTTP
# status or an exception.
UNAVAILABLE_MESSAGES: dict[QuoteUnavailableReason, str] = {
    QuoteUnavailableReason.PROVIDER_DISABLED: (
        "We aren't showing a market price right now."
    ),
    QuoteUnavailableReason.SYMBOL_NOT_FOUND: (
        "We couldn't find a market price for this ticker."
    ),
    QuoteUnavailableReason.PROVIDER_RATE_LIMITED: (
        "The price service is busy. Try again in a moment."
    ),
    QuoteUnavailableReason.PROVIDER_TIMEOUT: (
        "The price service didn't answer in time."
    ),
    QuoteUnavailableReason.PROVIDER_UNAVAILABLE: (
        "The price service is unavailable right now."
    ),
    QuoteUnavailableReason.PROVIDER_INVALID_RESPONSE: (
        "We got a price back that we don't trust, so we're not showing one."
    ),
}


class QuoteGateway(Protocol):
    """The one thing this service needs from a quote provider."""

    def get_quote(self, ticker: str) -> MarketQuote: ...


def _unavailable(reason: QuoteUnavailableReason) -> MarketPrice:
    return MarketPrice.unavailable(reason, UNAVAILABLE_MESSAGES[reason])


def _caused_by_timeout(error: BaseException) -> bool:
    """Walk the cause chain for a timeout, the way app/ai/gemini.py detects one.

    The provider wraps a timeout twice over -- socket timeout inside a
    TransportFailure inside a QuoteRequestError -- so the answer is never on the
    exception we actually caught.
    """
    seen: set[int] = set()
    current: BaseException | None = error
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        if isinstance(current, (TimeoutError, socket.timeout)):
            return True
        if isinstance(current, URLError) and isinstance(
            current.reason, (TimeoutError, socket.timeout)
        ):
            return True
        current = current.__cause__ or current.__context__
    return False


class MarketPriceService:
    """Turns a quote provider into a price that is always safe to render.

    Two caches, not one, because BoundedTtlCache carries a single TTL per
    instance rather than per entry. Without the failure cache an unlisted ticker
    or a provider outage would cost a live round trip on every request --
    including requests otherwise served entirely from the warm analysis cache.
    """

    def __init__(
        self,
        *,
        provider: QuoteGateway | None,
        success_cache: CacheBackend[str, MarketQuote],
        failure_cache: CacheBackend[str, MarketPrice],
        singleflight: SingleFlight[str, MarketPrice] | None = None,
    ) -> None:
        self._provider = provider
        self._success_cache = success_cache
        self._failure_cache = failure_cache
        self._singleflight = singleflight or SingleFlight()

    def price_for(self, ticker: str) -> MarketPrice:
        """Never raises. A quote problem is a value, not an exception."""
        if self._provider is None:
            return _unavailable(QuoteUnavailableReason.PROVIDER_DISABLED)
        try:
            return self._resolve(ticker)
        except Exception:
            # The backstop for everything outside the provider call itself -- a
            # throwing cache, a singleflight failure. Deliberately bare for the
            # same reason as the one in _fetch.
            logger.exception("market_quote_failed", extra={"ticker": ticker})
            return _unavailable(QuoteUnavailableReason.PROVIDER_UNAVAILABLE)

    def _resolve(self, ticker: str) -> MarketPrice:
        cached_quote = self._success_cache.get(ticker)
        if cached_quote is not None:
            return MarketPrice.available(cached_quote)

        cached_failure = self._failure_cache.get(ticker)
        if cached_failure is not None:
            return cached_failure

        return self._singleflight.run(ticker, lambda: self._fetch(ticker))

    def _fetch(self, ticker: str) -> MarketPrice:
        provider = self._provider
        if provider is None:  # pragma: no cover - price_for returns before here
            return _unavailable(QuoteUnavailableReason.PROVIDER_DISABLED)
        try:
            quote = provider.get_quote(ticker)
            self._success_cache.set(ticker, quote)
            return MarketPrice.available(quote)
        except QuoteNotFoundError:
            return self._record_failure(ticker, QuoteUnavailableReason.SYMBOL_NOT_FOUND)
        except QuoteRateLimitError:
            return self._record_failure(
                ticker, QuoteUnavailableReason.PROVIDER_RATE_LIMITED
            )
        except QuoteDataError:
            return self._record_failure(
                ticker, QuoteUnavailableReason.PROVIDER_INVALID_RESPONSE
            )
        except QuoteRequestError as exc:
            reason = (
                QuoteUnavailableReason.PROVIDER_TIMEOUT
                if _caused_by_timeout(exc)
                else QuoteUnavailableReason.PROVIDER_UNAVAILABLE
            )
            return self._record_failure(ticker, reason)
        except Exception:
            # Deliberate and load-bearing. This is the structural guarantee that a
            # bug in the quote path cannot turn a working 200 into a 500, and it
            # mirrors the identical bare except protecting the Gemini path in
            # app/ai/service.py. Do not narrow it.
            logger.exception("market_quote_failed", extra={"ticker": ticker})
            return self._record_failure(
                ticker, QuoteUnavailableReason.PROVIDER_UNAVAILABLE
            )

    def _record_failure(
        self,
        ticker: str,
        reason: QuoteUnavailableReason,
    ) -> MarketPrice:
        # Ticker and reason only -- never a body, never a URL with a query string.
        logger.warning(
            "market_quote_unavailable",
            extra={"ticker": ticker, "reason": reason.value},
        )
        price = _unavailable(reason)
        self._failure_cache.set(ticker, price)
        return price
