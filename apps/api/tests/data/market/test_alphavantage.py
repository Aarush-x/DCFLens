from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Mapping

import pytest

from app.data.market.alphavantage import (
    QUERY_BASE_URL,
    QUOTE_SOURCE,
    AlphaVantageQuoteClient,
    AlphaVantageQuoteConfig,
)
from app.data.market.errors import (
    QuoteConfigurationError,
    QuoteDataError,
    QuoteNotFoundError,
    QuoteRateLimitError,
    QuoteRequestError,
)
from app.data.transport import HttpResponse, ResponseTooLarge, TransportFailure


API_KEY = "TESTKEY1234"
PUBLIC_URL = f"{QUERY_BASE_URL}?function=GLOBAL_QUOTE&symbol=AAPL"
SIGNED_URL = f"{PUBLIC_URL}&apikey={API_KEY}"


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
        self.calls.append({"url": url, "headers": dict(headers)})
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


def global_quote(**overrides: Any) -> dict[str, Any]:
    quote = {
        "01. symbol": "AAPL",
        "05. price": "232.1400",
        "07. latest trading day": "2026-08-28",
    }
    quote.update(overrides)
    return {"Global Quote": quote}


def client_with(transport: QueueTransport, clock: FakeClock, **overrides: Any):
    values: dict[str, Any] = {
        "api_key": API_KEY,
        "timeout_seconds": 7.5,
        "max_retries": 2,
        "retry_backoff_seconds": 0.2,
    }
    values.update(overrides)
    return AlphaVantageQuoteClient(
        AlphaVantageQuoteConfig(**values),
        transport=transport,
        wall_clock=clock.wall,
        sleeper=clock.sleep,
    )


def fetch(payload: Mapping[str, Any] | HttpResponse, **overrides: Any):
    transport = QueueTransport()
    clock = FakeClock()
    response = payload if isinstance(payload, HttpResponse) else json_response(payload)
    transport.queue(SIGNED_URL, response)
    return client_with(transport, clock, **overrides).get_quote("AAPL")


# ── the happy path ──────────────────────────────────────────────────────────

def test_reads_price_and_trading_day() -> None:
    quote = fetch(global_quote())
    assert quote.symbol == "AAPL"
    assert quote.price == pytest.approx(232.14)
    assert quote.currency == "USD"
    assert quote.source == QUOTE_SOURCE
    assert quote.exchange_name is None
    assert quote.quoted_at == datetime(2026, 8, 28, tzinfo=timezone.utc)
    assert quote.retrieved_at == datetime(2026, 8, 30, 12, 0, tzinfo=timezone.utc)


def test_price_string_is_parsed_not_type_checked() -> None:
    # Alpha Vantage sends every number as a string; a float would be the anomaly.
    assert fetch(global_quote(**{"05. price": "  99.5  "})).price == pytest.approx(99.5)


def test_missing_trading_day_leaves_quoted_at_unset() -> None:
    payload = global_quote()
    del payload["Global Quote"]["07. latest trading day"]
    assert fetch(payload).quoted_at is None


def test_unparseable_trading_day_leaves_quoted_at_unset() -> None:
    assert fetch(global_quote(**{"07. latest trading day": "28/08/2026"})).quoted_at is None


# ── the API key must never escape ───────────────────────────────────────────

def test_request_is_signed_with_the_key() -> None:
    transport = QueueTransport()
    transport.queue(SIGNED_URL, json_response(global_quote()))
    client_with(transport, FakeClock()).get_quote("AAPL")
    assert f"apikey={API_KEY}" in transport.calls[0]["url"]


def test_source_url_carries_no_api_key() -> None:
    # source_url is rendered to the user in the sources list (adapter.js), so a
    # key here would be published on every analysis.
    quote = fetch(global_quote())
    assert "apikey" not in quote.source_url
    assert API_KEY not in quote.source_url
    assert quote.source_url == PUBLIC_URL


def test_request_error_url_carries_no_api_key() -> None:
    transport = QueueTransport()
    transport.queue(SIGNED_URL, json_response({}, status=418))
    with pytest.raises(QuoteRequestError) as excinfo:
        client_with(transport, FakeClock()).get_quote("AAPL")
    assert API_KEY not in excinfo.value.url
    assert API_KEY not in json.dumps(excinfo.value.to_dict())


def test_transport_failure_url_carries_no_api_key() -> None:
    transport = QueueTransport()
    for _ in range(3):
        transport.queue(SIGNED_URL, TransportFailure("boom"))
    with pytest.raises(QuoteRequestError) as excinfo:
        client_with(transport, FakeClock()).get_quote("AAPL")
    assert API_KEY not in excinfo.value.url


# ── a 200 body that is really a failure ─────────────────────────────────────

def test_note_throttle_is_a_rate_limit() -> None:
    with pytest.raises(QuoteRateLimitError):
        fetch({"Note": "Thank you for using Alpha Vantage! Our standard API rate limit is 25 requests per day."})


def test_information_daily_limit_is_a_rate_limit() -> None:
    with pytest.raises(QuoteRateLimitError):
        fetch({"Information": "We have detected your API key ... 25 requests per day."})


def test_information_premium_gate_is_a_rate_limit() -> None:
    with pytest.raises(QuoteRateLimitError):
        fetch({"Information": "This is a premium endpoint."})


def test_unrecognised_information_is_unavailable_not_untrusted_data() -> None:
    # No quote came back, so this must not land on the "price we don't trust"
    # reason -- that sentence would be false about a body with no price in it.
    with pytest.raises(QuoteRequestError) as excinfo:
        fetch({"Information": "Scheduled maintenance."})
    assert excinfo.value.retryable is False


def test_demo_key_entitlement_refusal_is_unavailable() -> None:
    # Alpha Vantage's live answer for a symbol the demo key does not cover.
    with pytest.raises(QuoteRequestError):
        fetch({"Information": "The **demo** API key is for demo purposes only."})


def test_error_message_is_a_data_error() -> None:
    with pytest.raises(QuoteDataError):
        fetch({"Error Message": "the parameter apikey is invalid or missing"})


def test_empty_global_quote_means_no_such_listing() -> None:
    with pytest.raises(QuoteNotFoundError):
        fetch({"Global Quote": {}})


def test_missing_global_quote_is_a_data_error() -> None:
    with pytest.raises(QuoteDataError):
        fetch({"something else": 1})


def test_non_object_payload_is_a_data_error() -> None:
    with pytest.raises(QuoteDataError):
        fetch(HttpResponse(status_code=200, headers={}, body=b"[1, 2]"))


def test_invalid_json_is_a_data_error() -> None:
    with pytest.raises(QuoteDataError):
        fetch(HttpResponse(status_code=200, headers={}, body=b"<html>nope</html>"))


# ── never another company's price ───────────────────────────────────────────

def test_symbol_mismatch_is_fatal() -> None:
    with pytest.raises(QuoteDataError):
        fetch(global_quote(**{"01. symbol": "AAPL.L"}))


def test_missing_resolved_symbol_is_fatal() -> None:
    payload = global_quote()
    del payload["Global Quote"]["01. symbol"]
    with pytest.raises(QuoteDataError):
        fetch(payload)


# ── a price we would not trust ──────────────────────────────────────────────

@pytest.mark.parametrize("raw", ["0", "-1.5", "abc", "", "   ", "NaN", "Infinity"])
def test_untrustworthy_price_is_refused(raw: str) -> None:
    with pytest.raises(QuoteDataError):
        fetch(global_quote(**{"05. price": raw}))


def test_missing_price_is_refused() -> None:
    payload = global_quote()
    del payload["Global Quote"]["05. price"]
    with pytest.raises(QuoteDataError):
        fetch(payload)


# ── transport-level outcomes ────────────────────────────────────────────────

def test_http_429_is_a_rate_limit() -> None:
    with pytest.raises(QuoteRateLimitError):
        fetch(json_response({}, status=429))


def test_http_404_is_not_found() -> None:
    with pytest.raises(QuoteNotFoundError):
        fetch(json_response({}, status=404))


def test_retries_a_server_error_then_succeeds() -> None:
    transport = QueueTransport()
    clock = FakeClock()
    transport.queue(
        SIGNED_URL,
        json_response({}, status=503),
        json_response(global_quote()),
    )
    quote = client_with(transport, clock).get_quote("AAPL")
    assert quote.price == pytest.approx(232.14)
    assert clock.sleeps == [0.2]


def test_oversized_response_is_not_retried() -> None:
    transport = QueueTransport()
    transport.queue(SIGNED_URL, ResponseTooLarge("too big"))
    with pytest.raises(QuoteRequestError) as excinfo:
        client_with(transport, FakeClock()).get_quote("AAPL")
    assert excinfo.value.retryable is False


# ── configuration ───────────────────────────────────────────────────────────

@pytest.mark.parametrize("key", ["", "   ", "abc", "has space", "has&amp=x", None, 123])
def test_unusable_api_key_is_refused(key: Any) -> None:
    with pytest.raises(QuoteConfigurationError):
        AlphaVantageQuoteConfig(api_key=key)


def test_alpha_vantage_demo_key_is_accepted() -> None:
    # Their published smoke-test key. Rejecting it would make the one zero-setup
    # way to prove this path end to end impossible.
    assert AlphaVantageQuoteConfig(api_key="demo").api_key == "demo"


def test_symbol_is_validated_before_any_request() -> None:
    transport = QueueTransport()
    with pytest.raises(QuoteDataError):
        client_with(transport, FakeClock()).get_quote("not a ticker")
    assert transport.calls == []
