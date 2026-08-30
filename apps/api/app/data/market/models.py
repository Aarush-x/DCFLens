from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum

from app.data.market.errors import QuoteDataError


class QuoteStatus(StrEnum):
    AVAILABLE = "AVAILABLE"
    UNAVAILABLE = "UNAVAILABLE"


class QuoteUnavailableReason(StrEnum):
    PROVIDER_DISABLED = "quote_provider_disabled"
    SYMBOL_NOT_FOUND = "quote_symbol_not_found"
    PROVIDER_RATE_LIMITED = "quote_provider_rate_limited"
    PROVIDER_TIMEOUT = "quote_provider_timeout"
    PROVIDER_UNAVAILABLE = "quote_provider_unavailable"
    PROVIDER_INVALID_RESPONSE = "quote_provider_invalid_response"


@dataclass(frozen=True, slots=True)
class MarketQuote:
    symbol: str
    price: float
    currency: str
    quoted_at: datetime | None
    retrieved_at: datetime
    source: str
    source_url: str
    exchange_name: str | None


@dataclass(frozen=True, slots=True)
class MarketPrice:
    """A quote, or a named reason there isn't one. Never both, never neither.

    D-017 says the product must never invent a price. Enforcing that here makes
    it a type invariant rather than a convention every call site has to keep:
    after ``__post_init__`` there is no representable ``MarketPrice`` that
    reports a number without a real quote behind it.
    """

    status: QuoteStatus
    quote: MarketQuote | None
    unavailable_reason: QuoteUnavailableReason | None
    message: str | None

    def __post_init__(self) -> None:
        if not isinstance(self.status, QuoteStatus):
            raise QuoteDataError("status must be a QuoteStatus member")
        if self.unavailable_reason is not None and not isinstance(
            self.unavailable_reason, QuoteUnavailableReason
        ):
            raise QuoteDataError(
                "unavailable_reason must be a QuoteUnavailableReason member"
            )
        if self.status is QuoteStatus.AVAILABLE:
            if self.quote is None:
                raise QuoteDataError("an AVAILABLE market price must carry a quote")
            if self.unavailable_reason is not None:
                raise QuoteDataError(
                    "an AVAILABLE market price must not carry an unavailable reason"
                )
        elif self.status is QuoteStatus.UNAVAILABLE:
            if self.quote is not None:
                raise QuoteDataError("an UNAVAILABLE market price must not carry a quote")
            if self.unavailable_reason is None:
                raise QuoteDataError(
                    "an UNAVAILABLE market price must name an unavailable reason"
                )

    @classmethod
    def available(cls, quote: MarketQuote) -> MarketPrice:
        return cls(
            status=QuoteStatus.AVAILABLE,
            quote=quote,
            unavailable_reason=None,
            message=None,
        )

    @classmethod
    def unavailable(
        cls,
        reason: QuoteUnavailableReason,
        message: str | None = None,
    ) -> MarketPrice:
        return cls(
            status=QuoteStatus.UNAVAILABLE,
            quote=None,
            unavailable_reason=reason,
            message=message,
        )
