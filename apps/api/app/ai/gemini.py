from __future__ import annotations

import json
import re
import socket
from dataclasses import dataclass
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from app.ai.models import ProviderRequest


GEMINI_API_ROOT = "https://generativelanguage.googleapis.com/v1beta/models"
MODEL_PATTERN = re.compile(r"^gemini-[a-z0-9.-]+$")


class GeminiProviderError(RuntimeError):
    """Safe provider failure that excludes response bodies and credentials."""


class GeminiTimeoutError(GeminiProviderError):
    """Gemini did not complete within the configured timeout."""


class GeminiRateLimitError(GeminiProviderError):
    """Gemini rejected the request because its quota or rate limit was reached."""


@dataclass(frozen=True, slots=True)
class GeminiClientConfig:
    api_key: str
    model: str = "gemini-2.5-flash"
    timeout_seconds: float = 30.0
    max_response_bytes: int = 65_536


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
        self._opener = opener

    def generate(self, request: ProviderRequest) -> str:
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
                "generationConfig": {
                    "responseMimeType": "application/json",
                    "responseSchema": request.response_schema,
                    "temperature": 0.1,
                    "maxOutputTokens": 4096,
                },
            },
            separators=(",", ":"),
        ).encode("utf-8")
        http_request = Request(
            f"{GEMINI_API_ROOT}/{self._config.model}:generateContent",
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
            raise GeminiTimeoutError("Gemini request timed out") from exc
        except HTTPError as exc:
            if exc.code == 429:
                raise GeminiRateLimitError("Gemini request was rate limited") from exc
            raise GeminiProviderError(
                f"Gemini request failed with HTTP status {exc.code}"
            ) from exc
        except URLError as exc:
            if isinstance(exc.reason, (TimeoutError, socket.timeout)):
                raise GeminiTimeoutError("Gemini request timed out") from exc
            raise GeminiProviderError("Gemini request failed") from exc
        except OSError as exc:
            raise GeminiProviderError("Gemini request failed") from exc

        if len(payload_bytes) > self._config.max_response_bytes:
            raise GeminiProviderError("Gemini response exceeded the configured size limit")
        try:
            payload = json.loads(payload_bytes)
            text = payload["candidates"][0]["content"]["parts"][0]["text"]
        except (json.JSONDecodeError, KeyError, IndexError, TypeError) as exc:
            raise GeminiProviderError("Gemini returned an invalid response envelope") from exc
        if not isinstance(text, str) or not text.strip():
            raise GeminiProviderError("Gemini returned no structured response text")
        return text
