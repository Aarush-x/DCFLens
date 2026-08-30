"""Dashboard-triggered Render Workflow; no changes to the public API.

Only ticker symbols cross the task-input boundary. Secrets come from the
workflow service environment. Provider/configuration imports are deferred so
Render can register this task without invoking SEC, Gemini, or API startup.
"""

import json
import logging
import re
from time import monotonic

from render import Retry, TaskContext, Workflows

from app.core.logging import configure_logging


logger = logging.getLogger(__name__)
app = Workflows()


class WorkflowAnalysisError(RuntimeError):
    """Only a safe error code is allowed into Render's task failure record."""


def _build_service():
    from app.core.settings import Settings
    from app.services.analysis import build_analysis_service

    return build_analysis_service(Settings.from_env())


def run_analysis(ticker: str) -> dict:
    # Validate before importing configuration or logging untrusted input.
    if not isinstance(ticker, str) or len(ticker) > 32:
        raise WorkflowAnalysisError("invalid_ticker")
    ticker = ticker.strip().upper().replace(".", "-")
    if not re.fullmatch(r"[A-Z][A-Z0-9-]{0,9}", ticker):
        raise WorkflowAnalysisError("invalid_ticker")

    started = monotonic()
    logger.info("workflow_analysis_started", extra={"ticker": ticker})
    try:
        # Keep startup validation inside the sanitized error boundary too.
        from fastapi.encoders import jsonable_encoder
        service = _build_service()
        envelope = service.analyze(ticker)
        result = jsonable_encoder(envelope.to_dict())
        # Do not silently turn non-finite calculations into nonstandard JSON.
        json.dumps(result, allow_nan=False)
        # The service stores analysis in its cached core; to_dict() keeps the
        # public result.analysis shape flat. Read metadata inside this boundary
        # so a future contract mismatch cannot leak an SDK exception payload.
        analysis = envelope.core.analysis
        status = str(analysis.status)
        fallback_reason = analysis.fallback_reason
    except Exception as exc:
        # Never log exception text, credentials, prompts, or provider bodies.
        # Explicit allowlist also protects the SDK's own exception reporting.
        code = getattr(exc, "code", None)
        safe_codes = {
            "invalid_ticker", "unsupported_ticker", "missing_sec_data",
            "provider_rate_limit", "sec_provider_unavailable", "calculation_error",
        }
        reason = code if code in safe_codes else "workflow_configuration_or_internal_error"
        logger.error(
            "workflow_analysis_failed",
            extra={"ticker": ticker, "error_code": reason, "error_type": type(exc).__name__},
        )
        raise WorkflowAnalysisError(reason) from None

    duration = round(monotonic() - started, 3)
    logger.info(
        "workflow_analysis_completed",
        extra={
            "ticker": ticker, "ai_status": status,
            "fallback_reason": fallback_reason,
            "duration_seconds": duration,
        },
    )
    return {
        "workflow": "dcflens-analysis-v1",
        "data_mode": "live",
        "ai_status": status,
        "fallback_reason": fallback_reason,
        "duration_seconds": duration,
        "result": result,
    }


@app.task(
    name="analyze_company",
    plan="standard",
    timeout_seconds=300,
    retry=Retry(max_retries=0, wait_duration_ms=1000),
)
def analyze_company(ctx: TaskContext, ticker: str) -> dict:
    return run_analysis(ticker)


if __name__ == "__main__":
    # INFO keeps prompts and SDK wire/debug payloads out of workflow logs.
    configure_logging("INFO")
    app.start()
