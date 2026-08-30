"""Gemini envelope regressions; all responses are simulated."""
import json
from http.client import IncompleteRead
from io import BytesIO
from urllib.error import HTTPError

import pytest

from app.ai.gemini import GeminiClient, GeminiClientConfig, GeminiProviderError
from app.ai.models import ProviderRequest


def client_for(payload):
    return GeminiClient(
        GeminiClientConfig(api_key="qa-placeholder"),
        opener=lambda *a, **kw: BytesIO(json.dumps(payload).encode()),
    )


def test_gemini_combines_answer_parts_and_never_returns_thought_text(caplog):
    client = client_for({"candidates": [{"content": {"parts": [
        {"thought": True, "text": "PRIVATE-THOUGHT"},
        {"text": '{"answer":'}, {"text": '42}'},
    ]}, "finishReason": "STOP"}], "usageMetadata": None})
    result = client.generate(ProviderRequest("system", "prompt", {}))
    assert result == '{"answer":42}'
    assert "PRIVATE-THOUGHT" not in caplog.text


@pytest.mark.parametrize("payload", [
    {}, {"candidates": None}, {"candidates": [None]},
    {"candidates": [{"content": {"parts": [{"text": ""}]}}]},
    {"promptFeedback": {"blockReason": "SAFETY"}},
])
def test_invalid_gemini_envelopes_are_logged_safely(payload, caplog):
    with caplog.at_level("WARNING", logger="app.ai.gemini"):
        with pytest.raises(GeminiProviderError):
            client_for(payload).generate(ProviderRequest("system", "PRIVATE-PROMPT", {}))
    assert any(r.message == "gemini_request_failed" for r in caplog.records)
    assert "PRIVATE-PROMPT" not in caplog.text


def test_null_usage_metadata_does_not_discard_valid_answer():
    client = client_for({"candidates": [{"content": {"parts": [{"text": "{}"}]}}], "usageMetadata": None})
    assert client.generate(ProviderRequest("system", "prompt", {})) == "{}"


@pytest.mark.parametrize("status", [None, 503])
def test_interrupted_success_or_error_body_stays_a_logged_provider_failure(status, caplog):
    class BrokenStream(BytesIO):
        def read(self, size=-1):
            raise IncompleteRead(b"PRIVATE-RESPONSE", 100)
    streams = []
    def opener(request, **kwargs):
        stream = BrokenStream()
        streams.append(stream)
        if status:
            raise HTTPError(request.full_url, status, "Unavailable", {}, stream)
        return stream
    client = GeminiClient(
        GeminiClientConfig(api_key="qa-placeholder"), opener=opener,
        sleeper=lambda _: None,
    )
    with caplog.at_level("WARNING", logger="app.ai.gemini"):
        with pytest.raises(GeminiProviderError) as error:
            client.generate(ProviderRequest("system", "PRIVATE-PROMPT", {}))
    assert error.value.fallback_reason == "provider_unavailable"
    assert any(r.message == "gemini_request_failed" for r in caplog.records)
    assert "PRIVATE-" not in caplog.text
    assert all(stream.closed for stream in streams)


def test_oversized_gemini_response_is_logged_without_contents(caplog):
    client = GeminiClient(
        GeminiClientConfig(api_key="qa-placeholder", max_response_bytes=1024),
        opener=lambda *a, **kw: BytesIO(b"x" * 2048),
    )
    with caplog.at_level("WARNING", logger="app.ai.gemini"):
        with pytest.raises(GeminiProviderError):
            client.generate(ProviderRequest("system", "PRIVATE-PROMPT", {}))
    assert caplog.records[-1].fallback_reason == "provider_response_too_large"
