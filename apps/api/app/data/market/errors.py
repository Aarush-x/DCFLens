from __future__ import annotations

from typing import Any


class QuoteError(Exception):
    """Base class for typed market-quote failures."""


class QuoteConfigurationError(QuoteError, ValueError):
    """Raised when the provider would violate its explicit access contract."""


class QuoteDataError(QuoteError, ValueError):
    """Raised when a quote response does not satisfy the expected data shape."""


class QuoteNotFoundError(QuoteError):
    """Raised when the provider has no listing for the requested symbol."""


class QuoteRateLimitError(QuoteError):
    """Raised when the provider rejected the request for exceeding its rate limit."""


class QuoteRequestError(QuoteError):
    """Bounded request failure with safe machine-readable context.

    Carries no response body: a quote provider's error payloads may echo request
    detail, and app/ai/gemini.py already holds that line for its own provider.
    """

    def __init__(
        self,
        *,
        url: str,
        message: str,
        attempts: int,
        status_code: int | None = None,
        retryable: bool = False,
    ) -> None:
        self.url = url
        self.message = message
        self.attempts = attempts
        self.status_code = status_code
        self.retryable = retryable
        super().__init__(message)

    def to_dict(self) -> dict[str, Any]:
        return {
            "url": self.url,
            "message": self.message,
            "attempts": self.attempts,
            "status_code": self.status_code,
            "retryable": self.retryable,
        }
