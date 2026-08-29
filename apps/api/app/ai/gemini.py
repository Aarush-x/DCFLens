from __future__ import annotations

import json
import logging
import re
import socket
from dataclasses import dataclass
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from app.ai.models import ProviderRequest


GEMINI_API_ROOT = "https://generativelanguage.googleapis.com/v1beta/models"
MODEL_PATTERN = re.compile(r"^gemini-[a-z0-9.-]+$")
SAFE_PROVIDER_TOKEN_PATTERN = re.compile(r"^[A-Z][A-Z0-9_]{0,63}$")
GOOGLE_API_KEY_PATTERN = re.compile(r"\bAIza[0-9A-Za-z_-]{20,}\b")
MAX_PROVIDER_ERROR_BYTES = 16_384
MAX_PROVIDER_MESSAGE_CHARS = 500
MAX_OUTPUT_TOKENS = 16_384
REVIEWED_FALLBACK_MODELS = ("gemini-2.5-flash",)
logger = logging.getLogger(__name__)


class GeminiProviderError(RuntimeError):
    """Safe provider failure that excludes response bodies and credentials."""

    def __init__(
        self,
        message: str,
        *,
        fallback_reason: str = "provider_failure",
        http_status: int | None = None,
        provider_status: str | None = None,
        provider_reason: str | None = None,
    ) -> None:
        super().__init__(message)
        self.fallback_reason = fallback_reason
        self.http_status = http_status
        self.provider_status = provider_status
        self.provider_reason = provider_reason


class GeminiTimeoutError(GeminiProviderError):
    """Gemini did not complete within the configured timeout."""

    def __init__(self, message: str, **diagnostics: object) -> None:
        super().__init__(message, fallback_reason="provider_timeout", **diagnostics)


class GeminiRateLimitError(GeminiProviderError):
    """Gemini rejected the request because its quota or rate limit was reached."""

    def __init__(self, message: str, **diagnostics: object) -> None:
        super().__init__(message, fallback_reason="provider_rate_limit", **diagnostics)


@dataclass(frozen=True, slots=True)
class GeminiClientConfig:
    api_key: str
    model: str = "gemini-2.5-flash"
    timeout_seconds: float = 30.0
    max_response_bytes: int = 65_536


@dataclass(frozen=True, slots=True)
class _GeminiOutput:
    text: str
    finish_reason: str | None
    candidate_token_count: int | None
    thought_token_count: int | None


class GeminiClient:
    """Minimal synchronous Gemini REST client for one-shot structured analysis."""

    def __init__(
        self,
        config: GeminiClientConfig,
        *,
        opener: Callable[..., Any] = urlopen,
    ) -> None:
        api_key = config.api_key.strip()
        model = config.model.strip()
        if not api_key:
            raise ValueError("Gemini API key must be non-empty")
        if not MODEL_PATTERN.fullmatch(model):
            raise ValueError("Gemini model must be a safe gemini-* identifier")
        if not 0 < config.timeout_seconds <= 120:
            raise ValueError("Gemini timeout must be greater than 0 and at most 120 seconds")
        if not 1_024 <= config.max_response_bytes <= 1_048_576:
            raise ValueError("Gemini response limit must be between 1024 and 1048576 bytes")
        self._config = GeminiClientConfig(
            api_key=api_key,
            model=model,
            timeout_seconds=float(config.timeout_seconds),
            max_response_bytes=config.max_response_bytes,
        )
        self._models = tuple(dict.fromkeys((model, *REVIEWED_FALLBACK_MODELS)))
        self._opener = opener

    def generate(self, request: ProviderRequest) -> str:
        last_malformed_text: str | None = None
        for index, model in enumerate(self._models):
            has_fallback = index + 1 < len(self._models)
            try:
                output = self._generate(
                    request,
                    model=model,
                    include_response_schema=True,
                )
            except GeminiProviderError as exc:
                if has_fallback and exc.fallback_reason in {
                    "provider_invalid_request",
                    "provider_model_unavailable",
                    "provider_rate_limit",
                }:
                    self._log_model_fallback(model, exc.fallback_reason)
                    continue
                raise

            try:
                json.loads(output.text)
            except json.JSONDecodeError:
                last_malformed_text = output.text
                logger.warning(
                    "gemini_invalid_json_response",
                    extra={
                        "gemini_model": model,
                        "finish_reason": output.finish_reason,
                        "candidate_token_count": output.candidate_token_count,
                        "thought_token_count": output.thought_token_count,
                        "response_chars": len(output.text),
                    },
                )
                if has_fallback:
                    self._log_model_fallback(model, "malformed_json")
                    continue
            else:
                if index > 0:
                    logger.info(
                        "gemini_fallback_model_succeeded",
                        extra={"gemini_model": model},
                    )
                return output.text

        if last_malformed_text is not None:
            return last_malformed_text
        raise GeminiProviderError("All reviewed Gemini models failed")

    def _generate(
        self,
        request: ProviderRequest,
        *,
        model: str,
        include_response_schema: bool,
    ) -> _GeminiOutput:
        generation_config: dict[str, Any] = {
            "responseMimeType": "application/json",
            "temperature": 0.1,
            "maxOutputTokens": MAX_OUTPUT_TOKENS,
        }
        if include_response_schema:
            generation_config["responseJsonSchema"] = request.response_schema
        body = json.dumps(
            {
                "systemInstruction": {
                    "parts": [{"text": request.system_instruction}]
                },
                "contents": [
                    {
                        "role": "user",
                        "parts": [{"text": request.prompt}],
                    }
                ],
                "generationConfig": generation_config,
            },
            separators=(",", ":"),
        ).encode("utf-8")
        http_request = Request(
            f"{GEMINI_API_ROOT}/{model}:generateContent",
            data=body,
            headers={
                "Content-Type": "application/json",
                "x-goog-api-key": self._config.api_key,
            },
            method="POST",
        )
        try:
            with self._opener(
                http_request, timeout=self._config.timeout_seconds
            ) as response:
                payload_bytes = response.read(self._config.max_response_bytes + 1)
        except (TimeoutError, socket.timeout) as exc:
            self._log_failure("provider_timeout", model=model)
            raise GeminiTimeoutError("Gemini request timed out") from exc
        except HTTPError as exc:
            provider_status, provider_reason, provider_message = (
                _provider_error_details(exc, self._config.api_key)
            )
            fallback_reason = _classify_http_failure(
                exc.code, provider_status, provider_reason
            )
            self._log_failure(
                fallback_reason,
                model=model,
                http_status=exc.code,
                provider_status=provider_status,
                provider_reason=provider_reason,
                provider_message=provider_message,
            )
            if (
                fallback_reason == "provider_invalid_request"
                and include_response_schema
            ):
                logger.warning(
                    "gemini_schema_rejected_retrying_json_mode",
                    extra={
                        "http_status": exc.code,
                        "provider_status": provider_status,
                        "gemini_model": model,
                    },
                )
                return self._generate(
                    request,
                    model=model,
                    include_response_schema=False,
                )
            diagnostics = {
                "http_status": exc.code,
                "provider_status": provider_status,
                "provider_reason": provider_reason,
            }
            if fallback_reason == "provider_rate_limit":
                raise GeminiRateLimitError(
                    "Gemini request was rate limited", **diagnostics
                ) from exc
            if fallback_reason == "provider_timeout":
                raise GeminiTimeoutError(
                    "Gemini request timed out", **diagnostics
                ) from exc
            raise GeminiProviderError(
                f"Gemini request failed with HTTP status {exc.code}",
                fallback_reason=fallback_reason,
                **diagnostics,
            ) from exc
        except URLError as exc:
            if isinstance(exc.reason, (TimeoutError, socket.timeout)):
                self._log_failure("provider_timeout", model=model)
                raise GeminiTimeoutError("Gemini request timed out") from exc
            self._log_failure("provider_unavailable", model=model)
            raise GeminiProviderError(
                "Gemini request failed",
                fallback_reason="provider_unavailable",
            ) from exc
        except OSError as exc:
            self._log_failure("provider_unavailable", model=model)
            raise GeminiProviderError(
                "Gemini request failed",
                fallback_reason="provider_unavailable",
            ) from exc

        if len(payload_bytes) > self._config.max_response_bytes:
            raise GeminiProviderError("Gemini response exceeded the configured size limit")
        try:
            payload = json.loads(payload_bytes)
            candidate = payload["candidates"][0]
            text = candidate["content"]["parts"][0]["text"]
        except (json.JSONDecodeError, KeyError, IndexError, TypeError) as exc:
            raise GeminiProviderError("Gemini returned an invalid response envelope") from exc
        if not isinstance(text, str) or not text.strip():
            raise GeminiProviderError("Gemini returned no structured response text")
        usage = payload.get("usageMetadata", {})
        return _GeminiOutput(
            text=text,
            finish_reason=_safe_provider_token(candidate.get("finishReason")),
            candidate_token_count=_safe_nonnegative_int(
                usage.get("candidatesTokenCount")
            ),
            thought_token_count=_safe_nonnegative_int(
                usage.get("thoughtsTokenCount")
            ),
        )

    def _log_model_fallback(self, model: str, reason: str) -> None:
        logger.warning(
            "gemini_trying_reviewed_fallback_model",
            extra={
                "failed_gemini_model": model,
                "fallback_reason": reason,
                "fallback_gemini_model": "gemini-2.5-flash",
            },
        )

    def _log_failure(
        self,
        fallback_reason: str,
        *,
        model: str,
        http_status: int | None = None,
        provider_status: str | None = None,
        provider_reason: str | None = None,
        provider_message: str | None = None,
    ) -> None:
        logger.warning(
            "gemini_request_failed",
            extra={
                "fallback_reason": fallback_reason,
                "http_status": http_status,
                "provider_status": provider_status,
                "provider_reason": provider_reason,
                "provider_message": provider_message,
                "gemini_model": model,
            },
        )


def _provider_error_details(
    error: HTTPError,
    api_key: str,
) -> tuple[str | None, str | None, str | None]:
    try:
        raw = error.read(MAX_PROVIDER_ERROR_BYTES + 1)
        if len(raw) > MAX_PROVIDER_ERROR_BYTES:
            return None, None, None
        payload = json.loads(raw)
        error_payload = payload.get("error", {})
        status = _safe_provider_token(error_payload.get("status"))
        message = _sanitize_provider_message(error_payload.get("message"), api_key)
        details = error_payload.get("details", [])
        reason = None
        if isinstance(details, list):
            for detail in details:
                if isinstance(detail, dict):
                    reason = _safe_provider_token(detail.get("reason"))
                    if reason:
                        break
        return status, reason, message
    except (AttributeError, json.JSONDecodeError, OSError, TypeError, ValueError):
        return None, None, None


def _safe_provider_token(value: object) -> str | None:
    if isinstance(value, str) and SAFE_PROVIDER_TOKEN_PATTERN.fullmatch(value):
        return value
    return None


def _safe_nonnegative_int(value: object) -> int | None:
    if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
        return value
    return None


def _sanitize_provider_message(value: object, api_key: str) -> str | None:
    if not isinstance(value, str):
        return None
    message = " ".join(value.split())
    if api_key:
        message = message.replace(api_key, "[REDACTED]")
    message = GOOGLE_API_KEY_PATTERN.sub("[REDACTED]", message)
    if not message:
        return None
    return message[:MAX_PROVIDER_MESSAGE_CHARS]


def _classify_http_failure(
    status_code: int,
    provider_status: str | None,
    provider_reason: str | None,
) -> str:
    if provider_reason in {"API_KEY_INVALID", "API_KEY_SERVICE_BLOCKED"}:
        return "provider_authentication"
    if status_code == 429 or provider_status == "RESOURCE_EXHAUSTED":
        return "provider_rate_limit"
    if status_code in {408, 504} or provider_status == "DEADLINE_EXCEEDED":
        return "provider_timeout"
    if status_code == 400 or provider_status == "INVALID_ARGUMENT":
        return "provider_invalid_request"
    if status_code in {401, 403} or provider_status in {
        "PERMISSION_DENIED",
        "UNAUTHENTICATED",
    }:
        return "provider_authentication"
    if status_code == 404 or provider_status == "NOT_FOUND":
        return "provider_model_unavailable"
    if status_code >= 500 or provider_status == "UNAVAILABLE":
        return "provider_unavailable"
    return "provider_failure"
