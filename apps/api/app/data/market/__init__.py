"""Market-quote ingestion.

Nothing constructs this yet; it lands as a self-contained provider so the
analysis lane can wire it up separately.
"""

from app.data.market.errors import (
    QuoteConfigurationError,
    QuoteDataError,
    QuoteError,
    QuoteNotFoundError,
    QuoteRateLimitError,
    QuoteRequestError,
)
from app.data.market.models import (
    MarketPrice,
    MarketQuote,
    QuoteStatus,
    QuoteUnavailableReason,
)
from app.data.market.yahoo import YahooQuoteClient, YahooQuoteConfig

__all__ = [
    "MarketPrice",
    "MarketQuote",
    "QuoteConfigurationError",
    "QuoteDataError",
    "QuoteError",
    "QuoteNotFoundError",
    "QuoteRateLimitError",
    "QuoteRequestError",
    "QuoteStatus",
    "QuoteUnavailableReason",
    "YahooQuoteClient",
    "YahooQuoteConfig",
]
