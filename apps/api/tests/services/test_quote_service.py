from __future__ import annotations

import socket
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from urllib.error import URLError

import pytest

from app.data.market.errors import (
    QuoteDataError,
    QuoteNotFoundError,
    QuoteRateLimitError,
    QuoteRequestError,
)
from app.data.market.models import (
    MarketPrice,
    MarketQuote,
    QuoteStatus,
    QuoteUnavailableReason,
)
from app.data.transport import TransportFailure
from app.services.cache import MemoryCache, SingleFlight
from app.services.quote import MarketPriceService, UNAVAILABLE_MESSAGES


class FakeClock:
    def __init__(self) -> None:
        self.now = 1_000.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


class RecordingProvider:
    """A quote gateway that counts calls and replays a scripted outcome."""

    def __init__(self, outcome: object | Exception = None) -> None:
        self.outcome = outcome
        self.calls: list[str] = []

    def get_quote(self, ticker: str) -> MarketQuote:
        self.calls.append(ticker)
        if isinstance(self.outcome, BaseException):
            raise self.outcome
        if self.outcome is None:
            return build_quote(ticker)
        return self.outcome  # type: ignore[return-value]


def build_quote(symbol: str = "AAPL", price: float = 178.20) -> MarketQuote:
    return MarketQuote(
        symbol=symbol,
        price=price,
        currency="USD",
        quoted_at=datetime(2026, 8, 28, 20, 0, tzinfo=timezone.utc),
        retrieved_at=datetime(2026, 8, 30, 14, 7, 11, tzinfo=timezone.utc),
        source="yahoo_finance_chart",
        source_url="https://query1.finance.yahoo.com/v8/finance/chart/AAPL",
        exchange_name="NasdaqGS",
    )


def build_service(
    provider: RecordingProvider | None,
    *,
    clock: FakeClock | None = None,
    success_ttl: float = 60.0,
    failure_ttl: float = 30.0,
    singleflight: SingleFlight[str, MarketPrice] | None = None,
) -> tuple[MarketPriceService, MemoryCache, MemoryCache]:
    tick = clock or FakeClock()
    success_cache: MemoryCache[str, MarketQuote] = MemoryCache(
        max_entries=8, ttl_seconds=success_ttl, clock=tick
    )
    failure_cache: MemoryCache[str, MarketPrice] = MemoryCache(
        max_entries=8, ttl_seconds=failure_ttl, clock=tick
    )
    service = MarketPriceService(
        provider=provider,
        success_cache=success_cache,
        failure_cache=failure_cache,
        singleflight=singleflight,
    )
    return service, success_cache, failure_cache


def test_a_missing_provider_is_disabled_and_never_calls_out() -> None:
    service, success_cache, failure_cache = build_service(None)

    price = service.price_for("AAPL")

    assert price.status is QuoteStatus.UNAVAILABLE
    assert price.unavailable_reason is QuoteUnavailableReason.PROVIDER_DISABLED
    assert price.quote is None
    assert price.message == "We aren't showing a market price right now."
    # A deployment state, not a failure: nothing is cached and nothing is fetched.
    assert len(success_cache) == 0
    assert len(failure_cache) == 0


def test_a_successful_quote_is_cached_for_its_ttl() -> None:
    provider = RecordingProvider()
    service, success_cache, _ = build_service(provider)

    first = service.price_for("AAPL")
    second = service.price_for("AAPL")

    assert first.status is QuoteStatus.AVAILABLE
    assert first.quote is not None
    assert first.quote.price == pytest.approx(178.20)
    assert first.message is None
    assert second.quote == first.quote
    assert provider.calls == ["AAPL"]
    assert len(success_cache) == 1


def test_a_successful_quote_is_refetched_once_its_ttl_expires() -> None:
    clock = FakeClock()
    provider = RecordingProvider()
    service, _, _ = build_service(provider, clock=clock, success_ttl=60.0)

    service.price_for("AAPL")
    clock.advance(59.0)
    service.price_for("AAPL")
    assert provider.calls == ["AAPL"]

    clock.advance(2.0)
    service.price_for("AAPL")
    assert provider.calls == ["AAPL", "AAPL"]


@pytest.mark.parametrize(
    ("error", "reason"),
    [
        (
            QuoteNotFoundError("no listing for symbol NOPE"),
            QuoteUnavailableReason.SYMBOL_NOT_FOUND,
        ),
        (
            QuoteRateLimitError("quote provider rate limit reached"),
            QuoteUnavailableReason.PROVIDER_RATE_LIMITED,
        ),
        (
            QuoteDataError("regularMarketPrice must be greater than zero"),
            QuoteUnavailableReason.PROVIDER_INVALID_RESPONSE,
        ),
        (
            QuoteRequestError(
                url="https://query1.finance.yahoo.com/v8/finance/chart/AAPL",
                message="quote provider returned HTTP 503",
                attempts=3,
                status_code=503,
                retryable=True,
            ),
            QuoteUnavailableReason.PROVIDER_UNAVAILABLE,
        ),
    ],
)
def test_each_provider_error_maps_to_its_reason(
    error: Exception, reason: QuoteUnavailableReason
) -> None:
    service, _, _ = build_service(RecordingProvider(error))

    price = service.price_for("AAPL")

    assert price.status is QuoteStatus.UNAVAILABLE
    assert price.unavailable_reason is reason
    assert price.quote is None
    assert price.message == UNAVAILABLE_MESSAGES[reason]


def _request_error_caused_by(cause: BaseException) -> QuoteRequestError:
    """Rebuild the real chain: the cause sits two wrappers below the surface."""
    error = QuoteRequestError(
        url="https://query1.finance.yahoo.com/v8/finance/chart/AAPL",
        message="quote request failed before receiving a response",
        attempts=3,
        retryable=True,
    )
    transport_failure = TransportFailure("HTTP transport failed")
    transport_failure.__cause__ = cause
    error.__cause__ = transport_failure
    return error


@pytest.mark.parametrize(
    "cause",
    [
        TimeoutError("timed out"),
        socket.timeout("timed out"),
        URLError(socket.timeout("timed out")),
    ],
)
def test_a_request_error_caused_by_a_timeout_is_a_timeout(cause: BaseException) -> None:
    service, _, _ = build_service(
        RecordingProvider(_request_error_caused_by(cause))
    )

    price = service.price_for("AAPL")

    assert price.unavailable_reason is QuoteUnavailableReason.PROVIDER_TIMEOUT


def test_a_request_error_from_a_reset_connection_is_not_a_timeout() -> None:
    service, _, _ = build_service(
        RecordingProvider(_request_error_caused_by(ConnectionResetError("reset")))
    )

    price = service.price_for("AAPL")

    assert price.unavailable_reason is QuoteUnavailableReason.PROVIDER_UNAVAILABLE


def test_a_failure_is_cached_in_the_failure_cache_and_not_refetched() -> None:
    clock = FakeClock()
    provider = RecordingProvider(QuoteNotFoundError("no listing for symbol NOPE"))
    service, success_cache, failure_cache = build_service(
        provider, clock=clock, failure_ttl=30.0
    )

    first = service.price_for("NOPE")
    assert provider.calls == ["NOPE"]
    assert len(failure_cache) == 1
    assert len(success_cache) == 0

    clock.advance(29.0)
    second = service.price_for("NOPE")
    assert second == first
    assert provider.calls == ["NOPE"], "a cached failure must not cost a round trip"

    clock.advance(2.0)
    service.price_for("NOPE")
    assert provider.calls == ["NOPE", "NOPE"], "the failure TTL must expire"


def test_the_two_caches_expire_independently() -> None:
    clock = FakeClock()
    provider = RecordingProvider()
    service, _, _ = build_service(
        provider, clock=clock, success_ttl=60.0, failure_ttl=30.0
    )

    service.price_for("AAPL")
    # Past the 30s failure TTL but inside the 60s success TTL: still cached.
    clock.advance(31.0)
    price = service.price_for("AAPL")

    assert price.status is QuoteStatus.AVAILABLE
    assert provider.calls == ["AAPL"]


def test_a_provider_raising_a_bare_runtime_error_does_not_propagate() -> None:
    provider = RecordingProvider(RuntimeError("a bug in the quote path"))
    service, _, failure_cache = build_service(provider)

    price = service.price_for("AAPL")

    assert price.status is QuoteStatus.UNAVAILABLE
    assert price.unavailable_reason is QuoteUnavailableReason.PROVIDER_UNAVAILABLE
    assert price.message == "The price service is unavailable right now."
    assert len(failure_cache) == 1


@pytest.mark.parametrize(
    "error",
    [
        RuntimeError("boom"),
        ValueError("boom"),
        TypeError("boom"),
        KeyError("boom"),
        AttributeError("boom"),
        ZeroDivisionError("boom"),
        MemoryError("boom"),
        RecursionError("boom"),
        UnicodeDecodeError("utf-8", b"\xff", 0, 1, "invalid start byte"),
    ],
)
def test_price_for_never_raises(error: Exception) -> None:
    # BaseException-level signals (KeyboardInterrupt, SystemExit) are deliberately
    # left to propagate; everything an ordinary bug can raise becomes a value.
    service, _, _ = build_service(RecordingProvider(error))

    price = service.price_for("AAPL")

    assert price.status is QuoteStatus.UNAVAILABLE
    assert price.unavailable_reason is QuoteUnavailableReason.PROVIDER_UNAVAILABLE


def test_a_throwing_success_cache_degrades_instead_of_raising() -> None:
    class ThrowingCache:
        def get(self, key: str) -> None:
            raise RuntimeError("cache backend is down")

        def set(self, key: str, value: object) -> None:
            raise RuntimeError("cache backend is down")

    service = MarketPriceService(
        provider=RecordingProvider(),
        success_cache=ThrowingCache(),  # type: ignore[arg-type]
        failure_cache=ThrowingCache(),  # type: ignore[arg-type]
    )

    price = service.price_for("AAPL")

    assert price.status is QuoteStatus.UNAVAILABLE
    assert price.unavailable_reason is QuoteUnavailableReason.PROVIDER_UNAVAILABLE


def test_singleflight_coalesces_concurrent_identical_tickers() -> None:
    entered = threading.Event()
    release = threading.Event()
    calls: list[str] = []
    lock = threading.Lock()

    class SlowProvider:
        def get_quote(self, ticker: str) -> MarketQuote:
            with lock:
                calls.append(ticker)
            entered.set()
            release.wait(timeout=2.0)
            return build_quote(ticker)

    service = MarketPriceService(
        provider=SlowProvider(),
        success_cache=MemoryCache(max_entries=8, ttl_seconds=60.0),
        failure_cache=MemoryCache(max_entries=8, ttl_seconds=30.0),
    )

    with ThreadPoolExecutor(max_workers=8) as executor:
        futures = [executor.submit(service.price_for, "AAPL") for _ in range(8)]
        assert entered.wait(timeout=1.0)
        time.sleep(0.05)
        release.set()
        prices = [future.result(timeout=2.0) for future in futures]

    assert calls == ["AAPL"], "eight concurrent callers must cost one round trip"
    assert all(price.status is QuoteStatus.AVAILABLE for price in prices)
    assert all(price.quote is not None for price in prices)


def test_singleflight_does_not_coalesce_distinct_tickers() -> None:
    entered = threading.Barrier(3, timeout=5.0)
    calls: list[str] = []
    lock = threading.Lock()

    class SlowProvider:
        def get_quote(self, ticker: str) -> MarketQuote:
            with lock:
                calls.append(ticker)
            # Every distinct ticker must be in flight at once for this to clear.
            entered.wait()
            return build_quote(ticker)

    service = MarketPriceService(
        provider=SlowProvider(),
        success_cache=MemoryCache(max_entries=8, ttl_seconds=60.0),
        failure_cache=MemoryCache(max_entries=8, ttl_seconds=30.0),
    )

    with ThreadPoolExecutor(max_workers=3) as executor:
        prices = [
            future.result(timeout=5.0)
            for future in [
                executor.submit(service.price_for, ticker)
                for ticker in ("AAPL", "MSFT", "NVDA")
            ]
        ]

    assert sorted(calls) == ["AAPL", "MSFT", "NVDA"]
    assert all(price.status is QuoteStatus.AVAILABLE for price in prices)
