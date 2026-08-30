"""Deterministic transport regressions. No credentials or live providers used."""
import json
from io import BytesIO
from urllib.error import HTTPError, URLError

import pytest

from app.ai.gemini import GeminiClient, GeminiClientConfig, GeminiTimeoutError
from app.ai.models import ProviderRequest


class Clock:
    def __init__(self):
        self.now = 0.0
        self.delays = []

    def __call__(self):
        return self.now

    def sleep(self, delay):
        self.delays.append(delay)
        self.now += delay


def success():
    return BytesIO(b'{"candidates":[{"content":{"parts":[{"text":"{}"}]}}]}')


def test_configured_45_second_timeout_reaches_http_client():
    timeouts = []

    def opener(request, *, timeout):
        timeouts.append(timeout)
        return success()

    client = GeminiClient(
        GeminiClientConfig(api_key="test-key", timeout_seconds=45),
        opener=opener, clock=Clock(),
    )
    assert client.generate(ProviderRequest("system", "prompt", {})) == "{}"
    assert timeouts == [45]


def test_transient_transport_failure_retries_same_model_before_fallback():
    clock = Clock()
    models = []

    def opener(request, *, timeout):
        models.append(request.full_url)
        if len(models) == 1:
            raise URLError(ConnectionResetError("private transport details"))
        return success()

    client = GeminiClient(
        GeminiClientConfig(api_key="test-key"), opener=opener,
        clock=clock, sleeper=clock.sleep, jitter=lambda: 0,
    )
    assert client.generate(ProviderRequest("system", "prompt", {})) == "{}"
    assert models[0] == models[1]
    assert clock.delays == [1]


@pytest.mark.parametrize("wrapped", [False, True])
def test_slow_primary_timeout_reaches_fallback_with_reserved_budget(wrapped, caplog):
    clock = Clock()
    attempts = []

    def opener(request, *, timeout):
        attempts.append((request.full_url, timeout))
        if len(attempts) == 1:
            clock.now += timeout
            error = TimeoutError("PRIVATE-KEY PRIVATE-PROMPT")
            raise URLError(error) if wrapped else error
        return success()

    client = GeminiClient(
        GeminiClientConfig(api_key="PRIVATE-KEY"), opener=opener,
        clock=clock, sleeper=clock.sleep, jitter=lambda: 0.0,
    )
    with caplog.at_level("INFO", logger="app.ai.gemini"):
        assert client.generate(ProviderRequest("system", "PRIVATE-PROMPT", {})) == "{}"
    assert len(attempts) == 2
    assert attempts[0][0].endswith("/gemini-3.5-flash:generateContent")
    assert attempts[1][0].endswith("/gemini-3.5-flash-lite:generateContent")
    assert [timeout for _, timeout in attempts] == [45.0, 30.0]
    assert not clock.delays
    failure = next(r for r in caplog.records if r.message == "gemini_request_failed")
    assert failure.fallback_reason == "provider_timeout"
    assert failure.http_status is None
    assert failure.phase == "connection_or_headers"
    assert failure.elapsed_ms == failure.request_duration_ms == 45_000
    assert failure.duration_scope == "attempt"
    assert failure.attempt_number == 1
    assert failure.timeout_seconds == 45
    from app.core.logging import JsonFormatter
    logged_json = json.loads(JsonFormatter().format(failure))
    assert logged_json["request_duration_ms"] == 45_000
    assert logged_json["fallback_reason"] == "provider_timeout"
    starts = [r for r in caplog.records if r.message == "gemini_request_started"]
    assert len(starts) == 2
    assert starts[0].gemini_call_id == starts[1].gemini_call_id == failure.gemini_call_id
    assert starts[1].budget_remaining_seconds == 30
    assert "PRIVATE-" not in str([r.__dict__ for r in caplog.records])


@pytest.mark.parametrize("status", [408, 504])
def test_upstream_deadline_errors_are_retried(status):
    clock = Clock()
    attempts = []

    def opener(request, *, timeout):
        attempts.append(request)
        if len(attempts) == 1:
            raise HTTPError(request.full_url, status, "Timeout", {}, BytesIO(
                b'{"error":{"status":"DEADLINE_EXCEEDED"}}'
            ))
        return success()

    client = GeminiClient(
        GeminiClientConfig(api_key="test-key"), opener=opener,
        clock=clock, sleeper=clock.sleep, jitter=lambda: 0.0,
    )
    assert client.generate(ProviderRequest("system", "prompt", {})) == "{}"
    assert len(attempts) == 2
    assert attempts[0].full_url == attempts[1].full_url
    assert clock.delays == [1.0]


def test_configuring_long_timeout_does_not_let_primary_starve_fallback():
    clock = Clock()
    timeouts = []

    def opener(request, *, timeout):
        timeouts.append(timeout)
        if len(timeouts) == 1:
            clock.now += timeout
            raise TimeoutError()
        return success()

    client = GeminiClient(
        GeminiClientConfig(api_key="test-key", timeout_seconds=120),
        opener=opener, clock=clock, sleeper=clock.sleep, jitter=lambda: 0.0,
    )
    assert client.generate(ProviderRequest("system", "prompt", {})) == "{}"
    assert timeouts == [45.0, 30.0]


def test_single_model_short_timeout_can_retry_without_resetting_budget():
    clock = Clock()
    attempts = []

    def opener(request, *, timeout):
        attempts.append(timeout)
        if len(attempts) == 1:
            clock.now += 1
            raise TimeoutError()
        return success()

    client = GeminiClient(
        GeminiClientConfig(api_key="test-key", model="gemini-3.5-flash-lite"),
        opener=opener, clock=clock, sleeper=clock.sleep, jitter=lambda: 0.0,
    )
    assert client.generate(ProviderRequest("system", "prompt", {})) == "{}"
    assert len(attempts) == 2
    assert clock.delays == [1.0]


def test_both_models_timing_out_stop_with_distinct_timeout_reason():
    clock = Clock()
    timeouts = []

    def opener(request, *, timeout):
        timeouts.append(timeout)
        clock.now += timeout
        raise TimeoutError()

    client = GeminiClient(
        GeminiClientConfig(api_key="test-key"), opener=opener,
        clock=clock, sleeper=clock.sleep, jitter=lambda: 0.0,
    )
    with pytest.raises(GeminiTimeoutError) as error:
        client.generate(ProviderRequest("system", "prompt", {}))
    assert error.value.fallback_reason == "provider_timeout"
    assert error.value.http_status is None
    assert timeouts == [45.0, 30.0]
    assert clock.now == 75


def test_timeout_reading_body_is_identified_and_response_is_closed(caplog):
    clock = Clock()
    streams = []

    class TimedOutBody(BytesIO):
        def read(self, size=-1):
            clock.now += 30
            raise TimeoutError("PRIVATE-BODY")

    def opener(request, **kwargs):
        stream = TimedOutBody() if not streams else success()
        streams.append(stream)
        return stream

    client = GeminiClient(
        GeminiClientConfig(api_key="test-key"), opener=opener,
        clock=clock, sleeper=clock.sleep,
    )
    with caplog.at_level("INFO", logger="app.ai.gemini"):
        assert client.generate(ProviderRequest("system", "prompt", {})) == "{}"
    failure = next(r for r in caplog.records if r.message == "gemini_request_failed")
    assert failure.phase == "response_body"
    assert failure.error_type == "TimeoutError"
    assert failure.elapsed_ms == failure.request_duration_ms == 30_000
    assert all(stream.closed for stream in streams)
    assert "PRIVATE-BODY" not in str([r.__dict__ for r in caplog.records])


def test_slow_503_retries_do_not_consume_fallback_time():
    clock = Clock()
    attempts = []

    def opener(request, *, timeout):
        attempts.append((request.full_url, timeout))
        if "gemini-3.5-flash:" in request.full_url:
            clock.now += min(20, timeout)
            raise HTTPError(request.full_url, 503, "Unavailable", {}, BytesIO(b"{}"))
        return success()

    client = GeminiClient(
        GeminiClientConfig(api_key="test-key", timeout_seconds=30, total_timeout_seconds=60), opener=opener,
        clock=clock, sleeper=clock.sleep, jitter=lambda: 0.0,
    )
    assert client.generate(ProviderRequest("system", "prompt", {})) == "{}"
    assert [timeout for _, timeout in attempts] == [30, 9, 30]
    assert attempts[-1][0].endswith("/gemini-3.5-flash-lite:generateContent")
    assert clock.now == 30


def test_generation_deadline_rejects_late_response_without_more_calls(caplog):
    clock = Clock()
    attempts = []

    def opener(request, *, timeout):
        attempts.append(request)
        clock.now += 76
        return success()

    client = GeminiClient(
        GeminiClientConfig(api_key="test-key"), opener=opener,
        clock=clock, sleeper=clock.sleep,
    )
    with caplog.at_level("INFO", logger="app.ai.gemini"):
        with pytest.raises(GeminiTimeoutError):
            client.generate(ProviderRequest("system", "prompt", {}))
    assert len(attempts) == 1
    assert caplog.records[-1].phase == "generation_deadline"
    assert caplog.records[-1].request_duration_ms == 76_000
    assert caplog.records[-1].duration_scope == "generation"
    assert not any(r.message == "gemini_request_succeeded" for r in caplog.records)


def test_call_ids_and_budgets_are_per_generation_not_client_global(caplog):
    clock = Clock()
    client = GeminiClient(
        GeminiClientConfig(api_key="test-key"), opener=lambda *a, **kw: success(),
        clock=clock, sleeper=clock.sleep,
    )
    with caplog.at_level("INFO", logger="app.ai.gemini"):
        for _ in range(2):
            assert client.generate(ProviderRequest("system", "prompt", {})) == "{}"
            clock.now += 100
    starts = [r for r in caplog.records if r.message == "gemini_request_started"]
    assert len(starts) == 2
    assert starts[0].gemini_call_id != starts[1].gemini_call_id
    assert all(r.attempt_number == 1 and r.budget_remaining_seconds == 75 for r in starts)


@pytest.mark.parametrize("wrapped", [False, True])
def test_timeout_retries_use_configured_backoff_jitter_and_duration(wrapped, caplog):
    clock = Clock()
    timeouts = []

    def opener(request, *, timeout):
        timeouts.append(timeout)
        clock.now += 0.5
        if len(timeouts) <= 2:
            error = TimeoutError("PRIVATE")
            raise URLError(error) if wrapped else error
        return success()

    client = GeminiClient(
        GeminiClientConfig(api_key="test-key", backoff_seconds=2.5),
        opener=opener, clock=clock, sleeper=clock.sleep, jitter=lambda: 0.8,
    )
    with caplog.at_level("INFO", logger="app.ai.gemini"):
        assert client.generate(ProviderRequest("system", "prompt", {})) == "{}"
    assert clock.delays == pytest.approx([2.7, 5.2])
    assert timeouts == pytest.approx([45, 41.8, 36.1])
    failures = [r for r in caplog.records if r.message == "gemini_request_failed"]
    assert len(failures) == 2
    assert all(r.request_duration_ms == 500 and r.fallback_reason == "provider_timeout" for r in failures)
    assert caplog.records[-1].request_duration_ms == 500
    assert "PRIVATE" not in str([r.__dict__ for r in caplog.records])


@pytest.mark.parametrize("budget", [1, 20, 60, 75, 120])
def test_configured_total_budget_caps_all_attempts(budget):
    clock = Clock()
    timeouts = []

    def opener(request, *, timeout):
        timeouts.append(timeout)
        clock.now += timeout
        raise TimeoutError()

    client = GeminiClient(
        GeminiClientConfig(api_key="test-key", timeout_seconds=120, total_timeout_seconds=budget),
        opener=opener, clock=clock, sleeper=clock.sleep, jitter=lambda: 0,
    )
    with pytest.raises(GeminiTimeoutError):
        client.generate(ProviderRequest("system", "prompt", {}))
    reserve = min(30, budget / 2)
    assert timeouts == [budget - reserve, reserve]
    assert clock.now == budget
    assert not clock.delays


def test_retry_is_not_scheduled_if_backoff_would_consume_model_window():
    clock = Clock()
    attempts = []

    def opener(request, *, timeout):
        attempts.append(request.full_url)
        if len(attempts) == 1:
            clock.now += 44
            raise TimeoutError()
        return success()

    client = GeminiClient(
        GeminiClientConfig(api_key="test-key", backoff_seconds=1),
        opener=opener, clock=clock, sleeper=clock.sleep, jitter=lambda: 0,
    )
    assert client.generate(ProviderRequest("system", "prompt", {})) == "{}"
    assert len(attempts) == 2
    assert attempts[-1].endswith("/gemini-3.5-flash-lite:generateContent")
    assert not clock.delays


@pytest.mark.parametrize("model", ["gemini-3.5-flash", "gemini-3.5-flash-lite"])
def test_gemini_3_uses_default_sampling_without_weakening_schema(model):
    requests = []

    def opener(request, **kwargs):
        requests.append(json.loads(request.data))
        return success()

    schema = {"type": "object", "additionalProperties": False}
    client = GeminiClient(GeminiClientConfig(api_key="test-key", model=model), opener=opener)
    assert client.generate(ProviderRequest("system", "prompt", schema)) == "{}"
    config = requests[0]["generationConfig"]
    assert "temperature" not in config
    assert config["responseJsonSchema"] == schema
    assert config["responseMimeType"] == "application/json"
    assert config["maxOutputTokens"] == 4_096
    assert config["thinkingConfig"] == {"thinkingLevel": "MINIMAL", "includeThoughts": False}


@pytest.mark.parametrize("outcome", ["valid", "fabricated_evidence", "timeout"])
def test_recovery_still_obeys_domain_validation_and_preserves_baseline(outcome):
    from app.ai.service import run_qualitative_analysis
    from tests.ai.test_service import _analysis_input, _valid_payload

    clock = Clock()
    calls = []
    payload = _valid_payload()
    if outcome == "fabricated_evidence":
        payload["adjustments"][0]["evidence_ids"] = ["invented-evidence"]

    def opener(request, *, timeout):
        calls.append(request)
        if len(calls) == 1 or outcome == "timeout":
            clock.now += timeout
            raise TimeoutError()
        return BytesIO(json.dumps({"candidates": [{"content": {
            "parts": [{"text": json.dumps(payload)}]
        }}]}).encode())

    client = GeminiClient(
        GeminiClientConfig(api_key="test-key"), opener=opener,
        clock=clock, sleeper=clock.sleep,
    )
    result = run_qualitative_analysis(_analysis_input(), client)
    assert len(calls) == 2
    if outcome == "valid":
        assert result.status.value == "APPLIED"
        assert result.adjustments[0].evidence_references
    else:
        assert result.status.value == "DETERMINISTIC_FALLBACK"
        assert result.final_valuation == result.baseline_valuation
        assert all(item.ai_adjustment == 0 for item in result.adjustments)
        if outcome == "timeout":
            assert result.fallback_reason == "provider_timeout"
        else:
            assert result.fallback_reason.startswith("invalid_ai_response:")
