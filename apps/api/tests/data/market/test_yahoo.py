from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Mapping

import pytest

from app.data.market.errors import (
    QuoteDataError,
    QuoteNotFoundError,
    QuoteRateLimitError,
    QuoteRequestError,
)
from app.data.market.yahoo import (
    CHART_BASE_URL,
    QUOTE_SOURCE,
    YahooQuoteClient,
    YahooQuoteConfig,
)
from app.data.transport import HttpResponse, ResponseTooLarge, TransportFailure
from tests.fixtures.market.chart_payloads import (
    UNSET,
    chart_error_payload,
    chart_payload,
)


AAPL_URL = f"{CHART_BASE_URL}/AAPL?range=1d&interval=1d"
BROWSER_USER_AGENT = "Mozilla/5.0 (Macintosh) DCFLensTest/1.0"


class FakeClock:
    def __init__(self) -> None:
        self.value = 0.0
        self.sleeps: list[float] = []
        self.wall_start = datetime(2026, 8, 30, 12, 0, tzinfo=timezone.utc)

    def wall(self) -> datetime:
        return self.wall_start + timedelta(seconds=self.value)

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.value += seconds


class QueueTransport:
    def __init__(self) -> None:
        self.responses: dict[str, list[HttpResponse | Exception]] = defaultdict(list)
        self.calls: list[dict[str, Any]] = []

    def queue(self, url: str, *responses: HttpResponse | Exception) -> None:
        self.responses[url].extend(responses)

    def get(
        self,
        url: str,
        *,
        headers: Mapping[str, str],
        timeout_seconds: float,
        max_response_bytes: int,
    ) -> HttpResponse:
        self.calls.append(
            {
                "url": url,
                "headers": dict(headers),
                "timeout_seconds": timeout_seconds,
                "max_response_bytes": max_response_bytes,
            }
        )
        if not self.responses[url]:
            raise AssertionError(f"no queued response for {url}")
        response = self.responses[url].pop(0)
        if isinstance(response, Exception):
            raise response
        return response


def json_response(payload: Mapping[str, Any], status: int = 200) -> HttpResponse:
    return HttpResponse(
        status_code=status,
        headers={"Content-Type": "application/json"},
        body=json.dumps(payload).encode("utf-8"),
    )


def client_with(
    transport: QueueTransport,
    clock: FakeClock,
    **overrides: Any,
) -> YahooQuoteClient:
    values: dict[str, Any] = {
        "user_agent": BROWSER_USER_AGENT,
        "timeout_seconds": 7.5,
        "max_retries": 2,
        "retry_backoff_seconds": 0.2,
        "max_response_bytes": 1_000_000,
    }
    values.update(overrides)
    return YahooQuoteClient(
        YahooQuoteConfig(**values),
        transport=transport,
        wall_clock=clock.wall,
        sleeper=clock.sleep,
    )


def quote_for(payload: Mapping[str, Any], **overrides: Any):
    transport = QueueTransport()
    clock = FakeClock()
    transport.queue(AAPL_URL, json_response(payload))
    return client_with(transport, clock, **overrides).get_quote("AAPL")


def test_happy_path_returns_quote_with_utc_timestamp() -> None:
    quote = quote_for(chart_payload())

    assert quote.symbol == "AAPL"
    assert quote.price == pytest.approx(178.2)
    assert quote.currency == "USD"
    assert quote.exchange_name == "NasdaqGS"
    assert quote.source == QUOTE_SOURCE
    assert quote.source_url == AAPL_URL
    assert quote.quoted_at == datetime(2026, 8, 29, 20, 40, tzinfo=timezone.utc)
    assert quote.quoted_at is not None and quote.quoted_at.tzinfo is timezone.utc
    assert quote.retrieved_at == datetime(2026, 8, 30, 12, 0, tzinfo=timezone.utc)


def test_request_sends_browser_user_agent_and_json_accept() -> None:
    transport = QueueTransport()
    clock = FakeClock()
    transport.queue(AAPL_URL, json_response(chart_payload()))

    client_with(transport, clock).get_quote(" aapl ")

    headers = transport.calls[0]["headers"]
    assert headers["User-Agent"] == BROWSER_USER_AGENT
    assert headers["Accept"] == "application/json"
    assert transport.calls[0]["timeout_seconds"] == 7.5
    assert transport.calls[0]["url"] == AAPL_URL


def test_resolved_symbol_mismatch_is_fatal() -> None:
    with pytest.raises(QuoteDataError, match="different listing"):
        quote_for(chart_payload(symbol="AAPL.MX"))


def test_resolved_symbol_match_is_case_insensitive() -> None:
    assert quote_for(chart_payload(symbol="aapl")).symbol == "AAPL"


def test_missing_resolved_symbol_raises() -> None:
    with pytest.raises(QuoteDataError, match="resolved symbol"):
        quote_for(chart_payload(symbol=UNSET))


def test_missing_price_raises() -> None:
    with pytest.raises(QuoteDataError, match="missing regularMarketPrice"):
        quote_for(chart_payload(price=UNSET))


@pytest.mark.parametrize("price", [0, 0.0, -1.5, float("nan"), float("inf"), "178.2", True])
def test_unusable_price_raises_rather_than_defaulting(price: Any) -> None:
    with pytest.raises(QuoteDataError, match="regularMarketPrice"):
        quote_for(chart_payload(price=price))


@pytest.mark.parametrize("currency", [UNSET, "US", "USDD", "", 840, None, "US1"])
def test_currency_is_never_defaulted_to_usd(currency: Any) -> None:
    with pytest.raises(QuoteDataError, match="three-letter"):
        quote_for(chart_payload(currency=currency))


@pytest.mark.parametrize("market_time", [UNSET, "1788036000", 1.5, None, True])
def test_unusable_market_time_drops_timestamp_but_keeps_price(market_time: Any) -> None:
    quote = quote_for(chart_payload(market_time=market_time))

    assert quote.quoted_at is None
    assert quote.price == pytest.approx(178.2)


def test_missing_meta_raises() -> None:
    payload = chart_payload()
    del payload["chart"]["result"][0]["meta"]

    with pytest.raises(QuoteDataError, match="missing chart meta"):
        quote_for(payload)


@pytest.mark.parametrize("body", [b"not json at all", b"[1, 2, 3]"])
def test_non_object_json_body_raises(body: bytes) -> None:
    transport = QueueTransport()
    clock = FakeClock()
    transport.queue(
        AAPL_URL,
        HttpResponse(status_code=200, headers={}, body=body),
    )

    with pytest.raises(QuoteDataError):
        client_with(transport, clock).get_quote("AAPL")


def test_http_404_is_a_not_found_error() -> None:
    transport = QueueTransport()
    clock = FakeClock()
    transport.queue(AAPL_URL, json_response(chart_error_payload(), status=404))

    with pytest.raises(QuoteNotFoundError):
        client_with(transport, clock).get_quote("AAPL")

    assert len(transport.calls) == 1


def test_chart_error_in_a_200_body_is_a_not_found_error() -> None:
    with pytest.raises(QuoteNotFoundError):
        quote_for(chart_error_payload())


def test_http_429_is_a_rate_limit_error() -> None:
    transport = QueueTransport()
    clock = FakeClock()
    transport.queue(AAPL_URL, json_response({}, status=429))

    with pytest.raises(QuoteRateLimitError):
        client_with(transport, clock).get_quote("AAPL")

    assert len(transport.calls) == 1


def test_server_error_is_retried_then_reported_as_retryable() -> None:
    transport = QueueTransport()
    clock = FakeClock()
    transport.queue(AAPL_URL, json_response({}, status=500), json_response({}, status=500))

    with pytest.raises(QuoteRequestError) as error:
        client_with(transport, clock, max_retries=1).get_quote("AAPL")

    assert error.value.status_code == 500
    assert error.value.retryable is True
    assert error.value.attempts == 2
    assert len(transport.calls) == 2
    assert clock.sleeps == pytest.approx([0.2])


def test_server_error_that_clears_on_retry_returns_a_quote() -> None:
    transport = QueueTransport()
    clock = FakeClock()
    transport.queue(
        AAPL_URL,
        json_response({}, status=503),
        json_response(chart_payload()),
    )

    quote = client_with(transport, clock).get_quote("AAPL")

    assert quote.price == pytest.approx(178.2)
    assert len(transport.calls) == 2


def test_nonretryable_status_fails_after_one_attempt() -> None:
    transport = QueueTransport()
    clock = FakeClock()
    transport.queue(AAPL_URL, json_response({}, status=403))

    with pytest.raises(QuoteRequestError) as error:
        client_with(transport, clock).get_quote("AAPL")

    assert error.value.status_code == 403
    assert error.value.retryable is False
    assert error.value.attempts == 1
    assert len(transport.calls) == 1


def test_transport_failures_stop_at_the_attempt_bound_with_backoff() -> None:
    transport = QueueTransport()
    clock = FakeClock()
    transport.queue(
        AAPL_URL,
        TransportFailure("timeout"),
        TransportFailure("timeout"),
        TransportFailure("timeout"),
    )

    with pytest.raises(QuoteRequestError) as error:
        client_with(transport, clock).get_quote("AAPL")

    assert error.value.attempts == 3
    assert error.value.retryable is True
    assert len(transport.calls) == 3
    assert clock.sleeps == pytest.approx([0.2, 0.4])


def test_oversized_response_is_not_retried() -> None:
    transport = QueueTransport()
    clock = FakeClock()
    transport.queue(AAPL_URL, ResponseTooLarge("response exceeds configured byte limit"))

    with pytest.raises(QuoteRequestError) as error:
        client_with(transport, clock).get_quote("AAPL")

    assert error.value.attempts == 1
    assert error.value.retryable is False
    assert len(transport.calls) == 1
    assert clock.sleeps == []


def test_zero_retries_makes_exactly_one_attempt() -> None:
    transport = QueueTransport()
    clock = FakeClock()
    transport.queue(AAPL_URL, TransportFailure("timeout"))

    with pytest.raises(QuoteRequestError) as error:
        client_with(transport, clock, max_retries=0).get_quote("AAPL")

    assert error.value.attempts == 1
    assert len(transport.calls) == 1
    assert clock.sleeps == []


def test_class_share_symbol_is_requested_verbatim() -> None:
    transport = QueueTransport()
    clock = FakeClock()
    url = f"{CHART_BASE_URL}/BRK-B?range=1d&interval=1d"
    transport.queue(url, json_response(chart_payload(symbol="BRK-B")))

    quote = client_with(transport, clock).get_quote("brk-b")

    assert quote.symbol == "BRK-B"
    assert transport.calls[0]["url"] == url


@pytest.mark.parametrize("symbol", ["", " ", "1AAPL", "AAPL/../ETC", "TOOLONGSYMBOL", 7])
def test_invalid_symbols_never_reach_the_network(symbol: Any) -> None:
    transport = QueueTransport()
    clock = FakeClock()

    with pytest.raises(QuoteDataError):
        client_with(transport, clock).get_quote(symbol)

    assert transport.calls == []
