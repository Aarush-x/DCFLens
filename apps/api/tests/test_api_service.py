from __future__ import annotations

from dataclasses import dataclass

import pytest
from fastapi.testclient import TestClient

from app.core.settings import Settings
from app.main import create_app
from app.services.errors import (
    CalculationError,
    InvalidTickerError,
    MissingSecDataError,
    ProviderRateLimitError,
    SecProviderError,
    UnsupportedTickerError,
)


@dataclass
class _Response:
    body: dict[str, object]

    def to_dict(self) -> dict[str, object]:
        return self.body


class _FakeService:
    def __init__(self, result: _Response | Exception) -> None:
        self.result = result
        self.calls: list[str] = []

    def analyze(self, ticker: str) -> _Response:
        self.calls.append(ticker)
        if isinstance(self.result, Exception):
            raise self.result
        return self.result

    def market_context(self, ticker: str) -> _Response:
        self.calls.append(ticker)
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


def _client(service: _FakeService, *, production: bool = False) -> TestClient:
    values = {}
    if production:
        values = {
            "APP_ENV": "production",
            "SEC_IDENTITY": "DCFLens ops@example.com",
            "CORS_ALLOWED_ORIGINS": "https://dcflens.vercel.app",
            "CORS_VERCEL_PREVIEW_PROJECT": "dcflens",
            "CORS_VERCEL_PREVIEW_TEAM": "aarush-x",
        }
    application = create_app(Settings.from_env(values))
    application.state.analysis_service = service
    return TestClient(application, raise_server_exceptions=False)


def test_analyze_returns_service_payload_and_request_id() -> None:
    service = _FakeService(
        _Response(
            {
                "ticker": "AAPL",
                "analysis": {"status": "APPLIED"},
                "market_price": {"status": "AVAILABLE", "quote": {"price": 178.2}},
                "plausibility": {"level": "SOUND", "can_state_verdict": True},
            }
        )
    )
    client = _client(service)

    response = client.get("/api/analyze/aapl", headers={"X-Request-ID": "test-123"})
    body = response.json()

    assert response.status_code == 200
    assert body["ticker"] == "AAPL"
    assert response.headers["X-Request-ID"] == "test-123"
    assert service.calls == ["aapl"]
    # The handler returns service.analyze(ticker).to_dict() verbatim, so the two
    # v3 keys reach the body with no handler change at all. That absence of a
    # change is the assertion worth making.
    assert body["market_price"]["status"] == "AVAILABLE"
    assert body["plausibility"]["can_state_verdict"] is True


def test_market_context_returns_only_the_live_price_lane() -> None:
    service = _FakeService(
        _Response(
            {
                "ticker": "AAPL",
                "market_price": {"status": "AVAILABLE", "quote": {"price": 181.2}},
                "plausibility": {"level": "SOUND", "can_state_verdict": True},
            }
        )
    )

    response = _client(service).get("/api/market-context/AAPL")

    assert response.status_code == 200
    assert response.json()["market_price"]["quote"]["price"] == 181.2
    assert "analysis" not in response.json()


@pytest.mark.parametrize(
    ("error", "status", "code"),
    [
        (InvalidTickerError("bad ticker"), 400, "invalid_ticker"),
        (UnsupportedTickerError("not found"), 404, "unsupported_ticker"),
        (MissingSecDataError("missing facts"), 422, "missing_sec_data"),
        (CalculationError("invalid valuation"), 422, "calculation_error"),
        (ProviderRateLimitError("rate limited"), 429, "provider_rate_limit"),
        (SecProviderError("temporarily unavailable"), 503, "sec_provider_unavailable"),
    ],
)
def test_service_errors_have_distinct_sanitized_http_mappings(
    error: Exception, status: int, code: str
) -> None:
    response = _client(_FakeService(error)).get("/api/analyze/AAPL")

    assert response.status_code == status
    assert response.json()["error"]["code"] == code
    assert "traceback" not in response.text.lower()
    assert "request_id" in response.json()["error"]
    if status == 429:
        assert response.headers["Retry-After"] == "60"


def test_unknown_errors_are_sanitized_but_available_to_backend_logging() -> None:
    response = _client(_FakeService(RuntimeError("secret provider detail"))).get(
        "/api/analyze/AAPL"
    )

    assert response.status_code == 500
    assert response.json()["error"]["code"] == "internal_error"
    assert "secret provider detail" not in response.text


def test_production_cors_allows_exact_and_project_scoped_preview_origins() -> None:
    client = _client(_FakeService(_Response({})), production=True)
    headers = {
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "content-type",
    }

    exact = client.options(
        "/api/analyze/AAPL",
        headers={**headers, "Origin": "https://dcflens.vercel.app"},
    )
    preview = client.options(
        "/api/analyze/AAPL",
        headers={
            **headers,
            "Origin": "https://dcflens-git-feature-aarush-x.vercel.app",
        },
    )
    unrelated = client.options(
        "/api/analyze/AAPL",
        headers={**headers, "Origin": "https://other-project.vercel.app"},
    )

    assert exact.status_code == 200
    assert exact.headers["access-control-allow-origin"] == "https://dcflens.vercel.app"
    assert preview.status_code == 200
    assert preview.headers["access-control-allow-origin"].startswith("https://dcflens-")
    assert unrelated.status_code == 400
