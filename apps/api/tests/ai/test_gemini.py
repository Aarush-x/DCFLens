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
            model="gemini-2.5-flash",
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
