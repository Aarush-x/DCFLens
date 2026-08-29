from __future__ import annotations

import json
import socket

import pytest

from app.ai.gemini import GeminiClient, GeminiClientConfig, GeminiTimeoutError
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
        response_schema={"type": "OBJECT", "properties": {}},
    )

    text = client.generate(request)

    http_request = captured["request"]
    body = json.loads(http_request.data)
    assert text == '{"example": "valid"}'
    assert captured["timeout"] == 17.0
    assert http_request.get_header("X-goog-api-key") == "secret-placeholder"
    assert body["generationConfig"]["responseMimeType"] == "application/json"
    assert body["generationConfig"]["responseSchema"] == request.response_schema
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
