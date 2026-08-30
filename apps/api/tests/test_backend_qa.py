"""Backend QA regressions: operational behavior, not frontend behavior."""
import json
import logging
import sys

import anyio
import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.logging import JsonFormatter
from app.core.settings import Settings
from app.main import create_app


def production_values():
    return {
        "APP_ENV": "production",
        "SEC_IDENTITY": "DCFLens qa@example.com",
        "CORS_ALLOWED_ORIGINS": "https://dcflens.vercel.app",
    }


def test_health_does_not_wait_for_analysis_thread_capacity():
    async def exercise():
        application = create_app(Settings.from_env({}))
        limiter = anyio.to_thread.current_default_thread_limiter()
        original = limiter.total_tokens
        limiter.total_tokens = 1
        try:
            async with limiter:
                async with httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=application),
                    base_url="http://qa.local",
                ) as client:
                    with anyio.fail_after(0.5):
                        response = await client.get("/health")
                    assert response.status_code == 200
                    assert not hasattr(application.state, "analysis_service")
        finally:
            limiter.total_tokens = original

    anyio.run(exercise)


@pytest.mark.parametrize("origin, allowed", [
    ("https://dcflens.vercel.app", True),
    ("https://unrelated.example", False),
])
def test_internal_error_preserves_request_id_and_cors(origin, allowed):
    application = create_app(Settings.from_env(production_values()))

    class BrokenService:
        def analyze(self, ticker):
            raise RuntimeError("SECRET-PROVIDER-PROMPT")

    application.state.analysis_service = BrokenService()
    with TestClient(application, raise_server_exceptions=False) as client:
        response = client.get("/api/analyze/AAPL", headers={
            "Origin": origin, "X-Request-ID": "qa-error-123",
        })
    assert response.status_code == 500
    assert response.json()["error"]["code"] == "internal_error"
    assert "SECRET-PROVIDER-PROMPT" not in response.text
    assert response.headers.get("X-Request-ID") == "qa-error-123"
    assert response.json()["error"]["request_id"] == "qa-error-123"
    assert response.headers.get("access-control-allow-origin") == (
        origin if allowed else None
    )


def test_exception_logs_keep_stack_locations_without_exception_payloads():
    try:
        try:
            raise ValueError("SECRET-KEY-AND-PROMPT")
        except ValueError as exc:
            raise RuntimeError("SECRET-OUTER") from exc
    except RuntimeError:
        record = logging.LogRecord(
            "qa", logging.ERROR, __file__, 1, "safe_event", (), sys.exc_info()
        )
    formatted = JsonFormatter().format(record)
    assert "SECRET-" not in formatted
    payload = json.loads(formatted)
    assert "RuntimeError" in formatted
    assert "test_exception_logs_keep_stack_locations" in formatted
    assert payload["message"] == "safe_event"


@pytest.mark.parametrize("override", [
    {"SEC_IDENTITY": "email@example.com"},
    {"SEC_IDENTITY": "DCFLens invalid@"},
    {"SEC_IDENTITY": "DCFLens qa@example.com\nInjected: header"},
    {"CACHE_TTL_SECONDS": "86401"},
    {"GEMINI_TIMEOUT_SECONDS": "121"},
    {"GEMINI_MODEL": "../../invalid"},
    {"CORS_ALLOWED_ORIGINS": "https://example.com:invalid"},
    {"CORS_ALLOWED_ORIGINS": "https://example.com:70000"},
    {"CORS_ALLOWED_ORIGINS": "https://*.vercel.app"},
])
def test_invalid_production_config_fails_at_startup(override):
    with pytest.raises(RuntimeError):
        Settings.from_env({**production_values(), **override})


def test_invalid_ticker_rejected_before_provider_initialization(monkeypatch):
    def forbidden(*args):
        raise AssertionError("malformed tickers must not initialize providers")
    monkeypatch.setattr("app.main.build_analysis_service", forbidden)
    with TestClient(create_app(Settings.from_env({})), raise_server_exceptions=False) as client:
        response = client.get("/api/analyze/123INVALID")
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_ticker"
