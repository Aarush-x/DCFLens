from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Mapping, cast

import pytest

from app.data.sec.client import (
    ARCHIVES_BASE_URL,
    DATA_BASE_URL,
    TICKER_MAP_URL,
    SecClient,
    SecClientConfig,
)
from app.data.sec.errors import (
    SecConfigurationError,
    SecDataError,
    SecRequestError,
)
from app.data.sec.transport import (
    HttpResponse,
    ResponseTooLarge,
    TransportFailure,
)
from tests.fixtures.sec.client_payloads import submissions_payload, ticker_mapping


class FakeClock:
    def __init__(self) -> None:
        self.value = 0.0
        self.sleeps: list[float] = []
        self.wall_start = datetime(2026, 8, 29, 12, 0, tzinfo=timezone.utc)

    def monotonic(self) -> float:
        return self.value

    def wall(self) -> datetime:
        return self.wall_start + timedelta(seconds=self.value)

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.value += seconds

    def advance(self, seconds: float) -> None:
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
) -> SecClient:
    values = {
        "user_agent": "DCFLens Research ops@example.com",
        "timeout_seconds": 7.5,
        "max_retries": 2,
        "retry_backoff_seconds": 0.2,
        "min_request_interval_seconds": 0.1,
        "max_response_bytes": 1_000_000,
        "cache_ttl_seconds": 10.0,
        "cache_max_entries": 8,
    }
    values.update(overrides)
    return SecClient(
        SecClientConfig(**values),
        transport=transport,
        monotonic_clock=clock.monotonic,
        wall_clock=clock.wall,
        sleeper=clock.sleep,
    )


@pytest.mark.parametrize(
    "identity",
    ["", "DCFLens", "ops@example.com", "x ops@example.com", None],
)
def test_user_agent_requires_application_identity_and_contact(identity: object) -> None:
    with pytest.raises(SecConfigurationError):
        SecClientConfig(user_agent=cast(str, identity))


def test_ticker_resolution_normalizes_class_share_symbol_and_sends_contract() -> None:
    transport = QueueTransport()
    clock = FakeClock()
    transport.queue(TICKER_MAP_URL, json_response(ticker_mapping()))
    client = client_with(transport, clock)

    result = client.resolve_ticker(" brk.b ")

    assert result.ticker == "BRK-B"
    assert result.cik == "0001067983"
    assert result.company_name == "Berkshire Hathaway"
    assert transport.calls[0]["headers"]["User-Agent"] == (
        "DCFLens Research ops@example.com"
    )
    assert transport.calls[0]["timeout_seconds"] == 7.5


def test_company_facts_uses_direct_cik_url_and_ttl_cache() -> None:
    transport = QueueTransport()
    clock = FakeClock()
    url = f"{DATA_BASE_URL}/api/xbrl/companyfacts/CIK0000320193.json"
    payload = {"cik": 320193, "facts": {}}
    transport.queue(url, json_response(payload), json_response(payload))
    client = client_with(transport, clock, cache_ttl_seconds=1.0)

    first = client.get_company_facts(320193)
    second = client.get_company_facts("0000320193")
    assert first is second
    assert len(transport.calls) == 1

    clock.advance(1.01)
    third = client.get_company_facts(320193)
    assert third is not first
    assert len(transport.calls) == 2
    assert third.source_url == url


def test_cache_is_bounded_and_evicts_least_recently_used_response() -> None:
    transport = QueueTransport()
    clock = FakeClock()
    first_url = f"{DATA_BASE_URL}/api/xbrl/companyfacts/CIK0000000001.json"
    second_url = f"{DATA_BASE_URL}/api/xbrl/companyfacts/CIK0000000002.json"
    transport.queue(
        first_url,
        json_response({"cik": 1, "facts": {}}),
        json_response({"cik": 1, "facts": {}}),
    )
    transport.queue(second_url, json_response({"cik": 2, "facts": {}}))
    client = client_with(transport, clock, cache_max_entries=1)

    client.get_company_facts(1)
    client.get_company_facts(2)
    client.get_company_facts(1)

    assert [call["url"] for call in transport.calls] == [
        first_url,
        second_url,
        first_url,
    ]


def test_request_pacing_applies_between_uncached_requests() -> None:
    transport = QueueTransport()
    clock = FakeClock()
    first_url = f"{DATA_BASE_URL}/api/xbrl/companyfacts/CIK0000000001.json"
    second_url = f"{DATA_BASE_URL}/api/xbrl/companyfacts/CIK0000000002.json"
    transport.queue(first_url, json_response({"cik": 1, "facts": {}}))
    transport.queue(second_url, json_response({"cik": 2, "facts": {}}))
    client = client_with(transport, clock)

    client.get_company_facts(1)
    client.get_company_facts(2)

    assert clock.sleeps == pytest.approx([0.1])


def test_retry_is_bounded_for_retryable_statuses() -> None:
    transport = QueueTransport()
    clock = FakeClock()
    url = f"{DATA_BASE_URL}/api/xbrl/companyfacts/CIK0000320193.json"
    transport.queue(
        url,
        json_response({}, status=429),
        json_response({}, status=503),
        json_response({"cik": 320193, "facts": {}}),
    )
    client = client_with(transport, clock)

    result = client.get_company_facts(320193)

    assert result.payload["cik"] == 320193
    assert len(transport.calls) == 3
    assert 0.2 in clock.sleeps
    assert 0.4 in clock.sleeps


def test_nonretryable_sec_error_fails_after_one_attempt() -> None:
    transport = QueueTransport()
    clock = FakeClock()
    url = f"{DATA_BASE_URL}/api/xbrl/companyfacts/CIK0000320193.json"
    transport.queue(url, json_response({}, status=404))
    client = client_with(transport, clock)

    with pytest.raises(SecRequestError) as error:
        client.get_company_facts(320193)

    assert error.value.status_code == 404
    assert error.value.retryable is False
    assert error.value.attempts == 1


def test_transport_errors_stop_at_configured_attempt_bound() -> None:
    transport = QueueTransport()
    clock = FakeClock()
    url = f"{DATA_BASE_URL}/api/xbrl/companyfacts/CIK0000320193.json"
    transport.queue(
        url,
        TransportFailure("timeout"),
        TransportFailure("timeout"),
        TransportFailure("timeout"),
    )
    client = client_with(transport, clock)

    with pytest.raises(SecRequestError) as error:
        client.get_company_facts(320193)

    assert error.value.attempts == 3
    assert error.value.retryable is True
    assert len(transport.calls) == 3


def test_oversized_response_is_not_retried() -> None:
    transport = QueueTransport()
    clock = FakeClock()
    url = f"{DATA_BASE_URL}/api/xbrl/companyfacts/CIK0000320193.json"
    transport.queue(url, ResponseTooLarge("too large"))
    client = client_with(transport, clock)

    with pytest.raises(SecRequestError) as error:
        client.get_company_facts(320193)

    assert error.value.attempts == 1
    assert error.value.retryable is False


def test_latest_10k_prefers_amendment_for_latest_report_period() -> None:
    transport = QueueTransport()
    clock = FakeClock()
    submissions_url = f"{DATA_BASE_URL}/submissions/CIK0000320193.json"
    transport.queue(submissions_url, json_response(submissions_payload()))
    client = client_with(transport, clock)

    filings = client.get_10k_filings(320193)

    assert len(filings) == 3
    assert filings[0].filing_form == "10-K/A"
    assert filings[0].is_amendment is True
    assert filings[0].fiscal_year_end == "0928"
    assert filings[0].filing_url == (
        f"{ARCHIVES_BASE_URL}/320193/000032019325000003/"
        "aapl-20241231x10ka.htm"
    )


def test_submission_profile_preserves_sector_metadata() -> None:
    transport = QueueTransport()
    clock = FakeClock()
    submissions_url = f"{DATA_BASE_URL}/submissions/CIK0000320193.json"
    transport.queue(submissions_url, json_response(submissions_payload()))
    client = client_with(transport, clock)

    profile = client.get_submission_profile(320193)

    assert profile.company_name == "Apple Inc."
    assert profile.sic_code == 3571
    assert profile.sic_description == "Electronic Computers"
    assert profile.filings[0].filing_form == "10-K/A"


def test_latest_10k_retrieves_accession_specific_document() -> None:
    transport = QueueTransport()
    clock = FakeClock()
    submissions_url = f"{DATA_BASE_URL}/submissions/CIK0000320193.json"
    filing_url = (
        f"{ARCHIVES_BASE_URL}/320193/000032019325000003/"
        "aapl-20241231x10ka.htm"
    )
    transport.queue(submissions_url, json_response(submissions_payload()))
    transport.queue(
        filing_url,
        HttpResponse(
            status_code=200,
            headers={"Content-Type": "text/html; charset=utf-8"},
            body=b"<html><body>amended filing</body></html>",
        ),
    )
    client = client_with(transport, clock)

    document = client.get_latest_10k_for_cik(320193)

    assert document.metadata.accession_number == "0000320193-25-000003"
    assert document.metadata.filing_url == filing_url
    assert "amended filing" in document.content
    assert document.content_type.startswith("text/html")


def test_malformed_submissions_arrays_fail_safely() -> None:
    transport = QueueTransport()
    clock = FakeClock()
    payload = submissions_payload()
    payload["filings"]["recent"]["filingDate"] = []
    url = f"{DATA_BASE_URL}/submissions/CIK0000320193.json"
    transport.queue(url, json_response(payload))
    client = client_with(transport, clock)

    with pytest.raises(SecDataError, match="inconsistent lengths"):
        client.get_10k_filings(320193)


def test_unknown_ticker_is_a_typed_data_error() -> None:
    transport = QueueTransport()
    clock = FakeClock()
    transport.queue(TICKER_MAP_URL, json_response(ticker_mapping()))
    client = client_with(transport, clock)

    with pytest.raises(SecDataError, match="ticker not found"):
        client.resolve_ticker("NOPE")
