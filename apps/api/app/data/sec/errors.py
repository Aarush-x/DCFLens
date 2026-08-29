from __future__ import annotations

from typing import Any


class SecError(Exception):
    """Base class for typed SEC ingestion failures."""


class SecConfigurationError(SecError, ValueError):
    """Raised when the client would violate its explicit access contract."""


class SecDataError(SecError, ValueError):
    """Raised when an SEC response does not satisfy the expected data shape."""


class SecRequestError(SecError):
    """Bounded request failure with safe machine-readable context."""

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
