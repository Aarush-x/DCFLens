"""SEC EDGAR ingestion and financial-fact normalization."""

from app.data.sec.client import SecClient, SecClientConfig
from app.data.sec.errors import (
    SecConfigurationError,
    SecDataError,
    SecError,
    SecRequestError,
)
from app.data.sec.models import (
    CompanySubmissionProfile,
    EvidenceReference,
    FilingDocument,
    FilingMetadata,
    NormalizationResult,
    NormalizedFact,
    TickerResolution,
)
from app.data.sec.normalization import normalize_company_facts

__all__ = [
    "CompanySubmissionProfile",
    "EvidenceReference",
    "FilingDocument",
    "FilingMetadata",
    "NormalizationResult",
    "NormalizedFact",
    "SecClient",
    "SecClientConfig",
    "SecConfigurationError",
    "SecDataError",
    "SecError",
    "SecRequestError",
    "TickerResolution",
    "normalize_company_facts",
]
