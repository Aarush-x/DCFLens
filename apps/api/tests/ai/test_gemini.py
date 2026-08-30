from __future__ import annotations

import json
import socket
from io import BytesIO
from urllib.error import HTTPError, URLError

import pytest

from app.ai.gemini import (
    GeminiClient,
    GeminiClientConfig,
    GeminiProviderError,
    GeminiRateLimitError,
    GeminiTimeoutError,
)
from app.ai.models import ProviderRequest


class FakeResponse:
    def __init__(self, payload: bytes) -> None:
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def read(self, _: int) -> bytes:
        return self.payload


def test_gemini_client_sends_structured_output_schema_and_header() -> None:
    captured: dict[str, object] = {}

    def opener(request, *, timeout: float):
        captured["request"] = request
        captured["timeout"] = timeout
        response_text = json.dumps({"example": "valid"})
        envelope = {
            "candidates": [
                {"content": {"parts": [{"text": response_text}]}}
            ]
        }
        return FakeResponse(json.dumps(envelope).encode())

    client = GeminiClient(
        GeminiClientConfig(
            api_key="secret-placeholder",
            model="gemini-3.5-flash",
            timeout_seconds=17,
        ),
        opener=opener,
    )
    request = ProviderRequest(
        system_instruction="system",
        prompt="prompt",
        response_schema={"type": "object", "properties": {}},
    )

    text = client.generate(request)

    http_request = captured["request"]
    body = json.loads(http_request.data)
    assert text == '{"example": "valid"}'
    assert captured["timeout"] == 17.0
    assert http_request.get_header("X-goog-api-key") == "secret-placeholder"
    assert body["generationConfig"]["responseMimeType"] == "application/json"
    assert body["generationConfig"]["maxOutputTokens"] == 16_384
    assert body["generationConfig"]["responseJsonSchema"] == request.response_schema
    assert "responseSchema" not in body["generationConfig"]
    assert request.response_schema["type"] == "object"
    assert body["systemInstruction"]["parts"][0]["text"] == "system"


def test_gemini_client_maps_socket_timeout_to_safe_error() -> None:
    def opener(*args: object, **kwargs: object):
        raise socket.timeout("secret provider details")

    client = GeminiClient(
        GeminiClientConfig(api_key="secret-placeholder"), opener=opener
    )

    with pytest.raises(GeminiTimeoutError, match="timed out") as error:
        client.generate(ProviderRequest("system", "prompt", {"type": "OBJECT"}))

    assert "secret provider details" not in str(error.value)


def test_gemini_client_classifies_network_failure_as_unavailable() -> None:
    def opener(*args: object, **kwargs: object):
        raise URLError("sensitive network detail")

    client = GeminiClient(
        GeminiClientConfig(api_key="secret-placeholder"), opener=opener
    )

    with pytest.raises(GeminiProviderError) as error:
        client.generate(ProviderRequest("system", "prompt", {"type": "OBJECT"}))

    assert error.value.fallback_reason == "provider_unavailable"
    assert "sensitive network detail" not in str(error.value)


def test_gemini_client_preserves_rate_limit_as_a_distinct_safe_error() -> None:
    def opener(*args: object, **kwargs: object):
        raise HTTPError(
            "https://generativelanguage.googleapis.com/redacted",
            429,
            "quota detail that must not escape",
            hdrs=None,
            fp=None,
        )

    client = GeminiClient(
        GeminiClientConfig(api_key="secret-placeholder"), opener=opener
    )

    with pytest.raises(GeminiRateLimitError, match="rate limited") as error:
        client.generate(ProviderRequest("system", "prompt", {"type": "OBJECT"}))

    assert "quota detail" not in str(error.value)


@pytest.mark.parametrize(
    ("status_code", "provider_status", "expected_reason"),
    [
        (400, "INVALID_ARGUMENT", "provider_invalid_request"),
        (403, "PERMISSION_DENIED", "provider_authentication"),
        (404, "NOT_FOUND", "provider_model_unavailable"),
        (503, "UNAVAILABLE", "provider_unavailable"),
    ],
)
def test_gemini_client_logs_safe_http_diagnostics_without_response_message(
    status_code: int,
    provider_status: str,
    expected_reason: str,
    caplog: pytest.LogCaptureFixture,
) -> None:
    provider_body = json.dumps(
        {
            "error": {
                "code": status_code,
                "status": provider_status,
                "message": "Request schema was rejected at generationConfig.responseSchema",
            }
        }
    ).encode()

    def opener(*args: object, **kwargs: object):
        raise HTTPError(
            "https://generativelanguage.googleapis.com/redacted",
            status_code,
            "sensitive HTTP reason",
            hdrs=None,
            fp=BytesIO(provider_body),
        )

    client = GeminiClient(
        GeminiClientConfig(api_key="secret-placeholder"), opener=opener
    )

    with caplog.at_level("WARNING", logger="app.ai.gemini"):
        with pytest.raises(GeminiProviderError) as error:
            client.generate(ProviderRequest("system", "prompt", {"type": "OBJECT"}))

    assert error.value.fallback_reason == expected_reason
    assert error.value.http_status == status_code
    assert error.value.provider_status == provider_status
    assert caplog.records[-1].message == "gemini_request_failed"
    assert caplog.records[-1].http_status == status_code
    assert caplog.records[-1].provider_status == provider_status
    assert caplog.records[-1].fallback_reason == expected_reason
    assert "Request schema was rejected" in caplog.records[-1].provider_message
    assert "secret-placeholder" not in caplog.text


def test_gemini_client_prioritizes_safe_api_key_reason_over_http_400() -> None:
    provider_body = json.dumps(
        {
            "error": {
                "code": 400,
                "status": "INVALID_ARGUMENT",
                "message": "API key detail must not be logged",
                "details": [
                    {
                        "reason": "API_KEY_INVALID",
                        "metadata": {"key": "must-not-be-logged"},
                    }
                ],
            }
        }
    ).encode()

    def opener(*args: object, **kwargs: object):
        raise HTTPError(
            "https://generativelanguage.googleapis.com/redacted",
            400,
            "bad request",
            hdrs=None,
            fp=BytesIO(provider_body),
        )

    client = GeminiClient(
        GeminiClientConfig(api_key="secret-placeholder"), opener=opener
    )

    with pytest.raises(GeminiProviderError) as error:
        client.generate(ProviderRequest("system", "prompt", {"type": "OBJECT"}))

    assert error.value.fallback_reason == "provider_authentication"
    assert error.value.provider_reason == "API_KEY_INVALID"


def test_gemini_client_redacts_api_key_from_logged_provider_message(
    caplog: pytest.LogCaptureFixture,
) -> None:
    api_key = "secret-placeholder"
    provider_body = json.dumps(
        {
            "error": {
                "code": 400,
                "status": "INVALID_ARGUMENT",
                "message": f"Invalid API key: {api_key}",
            }
        }
    ).encode()

    def opener(*args: object, **kwargs: object):
        raise HTTPError(
            "https://generativelanguage.googleapis.com/redacted",
            400,
            "bad request",
            hdrs=None,
            fp=BytesIO(provider_body),
        )

    client = GeminiClient(GeminiClientConfig(api_key=api_key), opener=opener)

    with caplog.at_level("WARNING", logger="app.ai.gemini"):
        with pytest.raises(GeminiProviderError):
            client.generate(ProviderRequest("system", "prompt", {"type": "object"}))

    assert api_key not in caplog.text
    assert "[REDACTED]" in caplog.records[-1].provider_message


def test_gemini_client_retries_schema_rejection_once_in_json_mode(
    caplog: pytest.LogCaptureFixture,
) -> None:
    requests: list[object] = []
    error_body = json.dumps(
        {
            "error": {
                "code": 400,
                "status": "INVALID_ARGUMENT",
                "message": "The response schema is too complex.",
            }
        }
    ).encode()
    response_text = json.dumps({"example": "valid"})
    success_body = json.dumps(
        {"candidates": [{"content": {"parts": [{"text": response_text}]}}]}
    ).encode()

    def opener(request, *, timeout: float):
        requests.append(request)
        if len(requests) == 1:
            raise HTTPError(
                "https://generativelanguage.googleapis.com/redacted",
                400,
                "bad request",
                hdrs=None,
                fp=BytesIO(error_body),
            )
        return FakeResponse(success_body)

    client = GeminiClient(
        GeminiClientConfig(api_key="secret-placeholder"), opener=opener
    )
    provider_request = ProviderRequest(
        "system",
        "prompt",
        {"type": "object", "properties": {"example": {"type": "string"}}},
    )

    with caplog.at_level("WARNING", logger="app.ai.gemini"):
        result = client.generate(provider_request)

    assert result == response_text
    assert len(requests) == 2
    first_body = json.loads(requests[0].data)
    retry_body = json.loads(requests[1].data)
    assert "responseJsonSchema" in first_body["generationConfig"]
    assert "responseJsonSchema" not in retry_body["generationConfig"]
    assert retry_body["generationConfig"]["responseMimeType"] == "application/json"
    retry_system = retry_body["systemInstruction"]["parts"][0]["text"]
    schema_text = retry_system.split("BEGIN_DCFLENS_OUTPUT_SCHEMA\n")[1].split(
        "\nEND_DCFLENS_OUTPUT_SCHEMA"
    )[0]
    assert json.loads(schema_text) == provider_request.response_schema
    assert retry_body["contents"] == first_body["contents"]
    assert provider_request.system_instruction == "system"
    assert any(
        record.message == "gemini_schema_rejected_retrying_json_mode"
        for record in caplog.records
    )


def test_gemini_client_uses_reviewed_fallback_after_malformed_primary_output(
    caplog: pytest.LogCaptureFixture,
) -> None:
    requests: list[object] = []
    schema_error = json.dumps(
        {
            "error": {
                "code": 400,
                "status": "INVALID_ARGUMENT",
                "message": "Request contains an invalid argument.",
            }
        }
    ).encode()
    malformed_envelope = json.dumps(
        {
            "candidates": [
                {
                    "finishReason": "MAX_TOKENS",
                    "content": {"parts": [{"text": '{"adjustments":'}]},
                }
            ],
            "usageMetadata": {
                "promptTokenCount": 1000,
                "candidatesTokenCount": 4096,
                "thoughtsTokenCount": 3000,
                "totalTokenCount": 8096,
            },
        }
    ).encode()
    valid_text = json.dumps({"example": "valid"})
    valid_envelope = json.dumps(
        {
            "candidates": [
                {
                    "finishReason": "STOP",
                    "content": {"parts": [{"text": valid_text}]},
                }
            ]
        }
    ).encode()

    def opener(request, *, timeout: float):
        requests.append(request)
        if len(requests) == 1:
            raise HTTPError(
                "https://generativelanguage.googleapis.com/redacted",
                400,
                "bad request",
                hdrs=None,
                fp=BytesIO(schema_error),
            )
        if len(requests) == 2:
            return FakeResponse(malformed_envelope)
        return FakeResponse(valid_envelope)

    client = GeminiClient(
        GeminiClientConfig(
            api_key="secret-placeholder",
            model="gemini-3.5-flash",
        ),
        opener=opener,
    )
    provider_request = ProviderRequest(
        "system",
        "prompt",
        {"type": "object", "properties": {"example": {"type": "string"}}},
    )

    with caplog.at_level("INFO", logger="app.ai.gemini"):
        result = client.generate(provider_request)

    assert result == valid_text
    assert len(requests) == 3
    assert requests[0].full_url.endswith(
        "/gemini-3.5-flash:generateContent"
    )
    assert requests[1].full_url.endswith(
        "/gemini-3.5-flash:generateContent"
    )
    assert requests[2].full_url.endswith(
        "/gemini-3.5-flash-lite:generateContent"
    )
    malformed_record = next(
        record
        for record in caplog.records
        if record.message == "gemini_invalid_json_response"
    )
    assert malformed_record.gemini_model == "gemini-3.5-flash"
    assert malformed_record.finish_reason == "MAX_TOKENS"
    assert malformed_record.candidate_token_count == 4096
    assert malformed_record.thought_token_count == 3000
    assert "adjustments" not in caplog.text


def test_gemini_recovers_from_temporary_overload() -> None:
    requests: list[object] = []

    def opener(request, *, timeout: float):
        requests.append(request)
        if len(requests) == 1:
            raise HTTPError(
                request.full_url, 503, "Unavailable", None,
                BytesIO(b'{"error":{"status":"UNAVAILABLE"}}'),
            )
        return FakeResponse(
            b'{"candidates":[{"content":{"parts":[{"text":"{}"}]}}]}'
        )

    client = GeminiClient(
        GeminiClientConfig(api_key="test-key", model="gemini-3.5-flash"),
        opener=opener,
        sleeper=lambda _: None,
    )
    assert client.generate(ProviderRequest("system", "prompt", {})) == "{}"
    assert len(requests) == 2
    assert requests[0].full_url == requests[1].full_url


class FakeClock:
    def __init__(self) -> None:
        self.now = 0.0
        self.delays: list[float] = []

    def __call__(self) -> float:
        return self.now

    def sleep(self, delay: float) -> None:
        self.delays.append(delay)
        self.now += delay


def _overloaded(request, status: int = 503) -> HTTPError:
    return HTTPError(
        request.full_url, status, "Unavailable", None,
        BytesIO(json.dumps({"error": {"code": status}}).encode()),
    )


def _success() -> FakeResponse:
    return FakeResponse(
        b'{"candidates":[{"content":{"parts":[{"text":"{}"}]}}]}'
    )


@pytest.mark.parametrize("status", [429, 500, 502, 503])
def test_transient_retries_use_bounded_exponential_backoff_and_jitter(status) -> None:
    clock = FakeClock()
    requests = []

    def opener(request, *, timeout):
        requests.append(request)
        if len(requests) <= 2:
            raise _overloaded(request, status)
        return _success()

    client = GeminiClient(
        GeminiClientConfig(api_key="test-key"), opener=opener,
        sleeper=clock.sleep, clock=clock, jitter=lambda: 0.5,
    )
    assert client.generate(ProviderRequest("system", "prompt", {})) == "{}"
    assert len(requests) == 3
    assert clock.delays == [1.125, 2.125]


def test_persistent_primary_503_uses_reviewed_fallback(caplog) -> None:
    clock = FakeClock()
    models = []

    def opener(request, *, timeout):
        models.append(request.full_url.rsplit("/", 1)[-1])
        if "gemini-3.5-flash:" in request.full_url:
            raise _overloaded(request)
        return _success()

    client = GeminiClient(
        GeminiClientConfig(api_key="test-key", model="gemini-3.5-flash"),
        opener=opener, sleeper=clock.sleep, clock=clock, jitter=lambda: 0.0,
    )
    with caplog.at_level("INFO", logger="app.ai.gemini"):
        assert client.generate(ProviderRequest("system", "private-prompt", {})) == "{}"
    assert models == ["gemini-3.5-flash:generateContent"] * 3 + [
        "gemini-3.5-flash-lite:generateContent"
    ]
    assert clock.delays == [1.0, 2.0]
    assert any(r.message == "gemini_transient_retry_scheduled" for r in caplog.records)
    assert caplog.records[-1].message == "gemini_fallback_model_succeeded"
    assert "private-prompt" not in caplog.text
    assert "test-key" not in caplog.text


@pytest.mark.parametrize("model, expected_calls", [
    ("gemini-3.5-flash", 6), ("gemini-3.5-flash-lite", 3),
])
def test_all_models_overloaded_stops_without_infinite_retries(model, expected_calls) -> None:
    clock = FakeClock()
    requests = []

    def opener(request, *, timeout):
        requests.append(request)
        raise _overloaded(request)

    client = GeminiClient(
        GeminiClientConfig(api_key="test-key", model=model),
        opener=opener, sleeper=clock.sleep, clock=clock, jitter=lambda: 0.0,
    )
    with pytest.raises(GeminiProviderError) as error:
        client.generate(ProviderRequest("system", "prompt", {}))
    assert error.value.fallback_reason == "provider_unavailable"
    assert error.value.http_status == 503
    assert len(requests) == expected_calls
    assert len(clock.delays) == expected_calls // 3 * 2


def test_retry_deadline_is_shared_across_models_and_reduces_socket_timeout() -> None:
    clock = FakeClock()
    timeouts = []

    def opener(request, *, timeout):
        timeouts.append(timeout)
        clock.now += 29.0 if len(timeouts) <= 2 else 1.0
        raise _overloaded(request)

    client = GeminiClient(
        GeminiClientConfig(api_key="test-key", model="gemini-3.5-flash"),
        opener=opener, sleeper=clock.sleep, clock=clock, jitter=lambda: 0.0,
    )
    with pytest.raises(GeminiProviderError):
        client.generate(ProviderRequest("system", "prompt", {}))
    assert timeouts == [30.0, 30.0, 1.0]
    assert clock.delays == [1.0]
    assert clock.now == 60.0


def test_deadline_expiring_during_backoff_prevents_another_request() -> None:
    clock = FakeClock()
    requests = []

    def opener(request, *, timeout):
        requests.append(request)
        raise _overloaded(request)

    def slow_sleep(delay):
        clock.now += 61.0

    client = GeminiClient(
        GeminiClientConfig(api_key="test-key", model="gemini-3.5-flash"),
        opener=opener, sleeper=slow_sleep, clock=clock, jitter=lambda: 0.0,
    )
    with pytest.raises(GeminiTimeoutError):
        client.generate(ProviderRequest("system", "prompt", {}))
    assert len(requests) == 1


def test_schema_switch_does_not_reset_transient_retry_budget() -> None:
    clock = FakeClock()
    statuses = iter([503, 503, 400, 503] * 2)
    requests = []

    def opener(request, *, timeout):
        requests.append(request)
        raise _overloaded(request, next(statuses))

    client = GeminiClient(
        GeminiClientConfig(api_key="test-key", model="gemini-3.5-flash"),
        opener=opener, sleeper=clock.sleep, clock=clock, jitter=lambda: 0.0,
    )
    with pytest.raises(GeminiProviderError):
        client.generate(ProviderRequest("system", "prompt", {}))
    assert len(requests) == 8
    assert clock.delays == [1.0, 2.0, 1.0, 2.0]


@pytest.mark.parametrize("status", [400, 401, 403])
def test_authentication_errors_do_not_retry_or_switch_models(status) -> None:
    clock = FakeClock()
    requests = []

    def opener(request, *, timeout):
        requests.append(request)
        raise HTTPError(
            request.full_url, status, "Authentication", None,
            BytesIO(b'{"error":{"details":[{"reason":"API_KEY_INVALID"}]}}'),
        )

    client = GeminiClient(
        GeminiClientConfig(api_key="test-key", model="gemini-3.5-flash"),
        opener=opener, sleeper=clock.sleep, clock=clock,
    )
    with pytest.raises(GeminiProviderError) as error:
        client.generate(ProviderRequest("system", "prompt", {}))
    assert error.value.fallback_reason == "provider_authentication"
    assert len(requests) == 1
    assert clock.delays == []
