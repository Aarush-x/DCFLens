from __future__ import annotations

import logging
import re
import threading
import time
import uuid
from typing import Any

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.logging import configure_logging
from app.core.settings import Settings, settings
from app.services import AnalysisService, build_analysis_service
from app.services.analysis import normalize_ticker
from app.services.errors import (
    AnalysisServiceError,
    CalculationError,
    InvalidTickerError,
    MissingSecDataError,
    ProviderRateLimitError,
    SecProviderError,
    UnsupportedTickerError,
)


REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
logger = logging.getLogger(__name__)


def create_app(config: Settings = settings) -> FastAPI:
    configure_logging(config.log_level)
    application = FastAPI(
        title="DCFLens API",
        version="0.2.0",
        docs_url=None if config.is_production else "/docs",
        redoc_url=None if config.is_production else "/redoc",
    )
    application.state.settings = config
    application.state.service_lock = threading.Lock()

    @application.middleware("http")
    async def request_context(request: Request, call_next: Any) -> Any:
        supplied = request.headers.get("X-Request-ID", "")
        request_id = (
            supplied if REQUEST_ID_PATTERN.fullmatch(supplied) else uuid.uuid4().hex
        )
        request.state.request_id = request_id
        started = time.monotonic()
        try:
            response = await call_next(request)
        except Exception as exc:
            # Handle failures inside the CORS/request-ID boundary, before the
            # framework's outer server-error middleware bypasses those headers.
            response = await internal_error_handler(request, exc)
        response.headers["X-Request-ID"] = request_id
        logger.info(
            "request_completed",
            extra={
                "request_id": request_id,
                "method": request.method,
                "path": request.url.path,
                "status_code": response.status_code,
                "duration_ms": round((time.monotonic() - started) * 1000, 2),
            },
        )
        return response

    @application.exception_handler(AnalysisServiceError)
    async def analysis_error_handler(
        request: Request, exc: AnalysisServiceError
    ) -> JSONResponse:
        status_code = _service_error_status(exc)
        request_id = getattr(request.state, "request_id", "unavailable")
        log_method = logger.warning if status_code < 500 else logger.error
        log_method(
            "analysis_request_failed",
            extra={
                "request_id": request_id,
                "error_code": exc.code,
                "status_code": status_code,
            },
        )
        headers = {"Retry-After": "60"} if status_code == 429 else None
        return _error_response(
            request_id=request_id,
            status_code=status_code,
            code=exc.code,
            message=str(exc),
            headers=headers,
        )

    @application.exception_handler(Exception)
    async def internal_error_handler(request: Request, exc: Exception) -> JSONResponse:
        request_id = getattr(request.state, "request_id", "unavailable")
        logger.exception(
            "unhandled_application_error",
            extra={
                "request_id": request_id,
                "error_type": type(exc).__name__,
            },
        )
        return _error_response(
            request_id=request_id,
            status_code=500,
            code="internal_error",
            message="The analysis service encountered an internal error",
        )

    @application.get("/health", include_in_schema=False)
    async def health() -> dict[str, str]:
        """Return process liveness without touching service dependencies."""
        return {"status": "ok", "service": "dcflens-api"}

    @application.get("/api/analyze/{ticker}")
    def analyze(
        ticker: str,
        service: AnalysisService = Depends(get_analysis_service),
    ) -> dict[str, Any]:
        return service.analyze(ticker).to_dict()

    @application.get("/api/market-context/{ticker}")
    def market_context(
        ticker: str,
        service: AnalysisService = Depends(get_analysis_service),
    ) -> dict[str, Any]:
        """Return the independently refreshed quote and price-relative checks."""
        return service.market_context(ticker).to_dict()

    # Added last so CORS wraps request_context, including sanitized 500s.
    application.add_middleware(
        CORSMiddleware,
        allow_origins=list(config.cors_allowed_origins),
        allow_origin_regex=config.cors_allowed_origin_regex,
        allow_credentials=False,
        allow_methods=["GET"],
        allow_headers=["Accept", "Content-Type", "X-Request-ID"],
        expose_headers=["X-Request-ID", "Retry-After"],
    )
    return application


def get_analysis_service(request: Request) -> AnalysisService:
    normalize_ticker(request.path_params["ticker"])
    existing = getattr(request.app.state, "analysis_service", None)
    if existing is not None:
        return existing
    with request.app.state.service_lock:
        existing = getattr(request.app.state, "analysis_service", None)
        if existing is None:
            existing = build_analysis_service(request.app.state.settings)
            request.app.state.analysis_service = existing
    return existing


def _service_error_status(exc: AnalysisServiceError) -> int:
    if isinstance(exc, InvalidTickerError):
        return 400
    if isinstance(exc, UnsupportedTickerError):
        return 404
    if isinstance(exc, MissingSecDataError):
        return 422
    if isinstance(exc, ProviderRateLimitError):
        return 429
    if isinstance(exc, SecProviderError):
        return 503
    if isinstance(exc, CalculationError):
        return 422
    return 500


def _error_response(
    *,
    request_id: str,
    status_code: int,
    code: str,
    message: str,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        headers=headers,
        content={
            "error": {
                "code": code,
                "message": message,
                "request_id": request_id,
            }
        },
    )


app = create_app()
