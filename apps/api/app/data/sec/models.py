from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime
from typing import Any, Mapping


@dataclass(frozen=True, slots=True)
class TickerResolution:
    ticker: str
    cik: str
    company_name: str


@dataclass(frozen=True, slots=True)
class SecJsonDocument:
    source_url: str
    retrieved_at: datetime
    payload: Mapping[str, Any]


@dataclass(frozen=True, slots=True)
class FilingMetadata:
    cik: str
    accession_number: str
    filing_form: str
    filing_date: str
    report_date: str
    fiscal_year_end: str | None
    primary_document: str
    is_amendment: bool
    filing_url: str


@dataclass(frozen=True, slots=True)
class CompanySubmissionProfile:
    cik: str
    company_name: str
    sic_code: int | None
    sic_description: str
    fiscal_year_end: str | None
    filings: tuple[FilingMetadata, ...]


@dataclass(frozen=True, slots=True)
class FilingDocument:
    metadata: FilingMetadata
    content: str
    content_type: str
    retrieved_at: datetime


@dataclass(frozen=True, slots=True)
class EvidenceReference:
    evidence_id: str
    provider: str
    cik: str
    accession_number: str | None
    filing_form: str
    filing_date: str
    fiscal_period: str
    xbrl_concept: str
    unit: str
    raw_value: float
    normalized_value: float
    transformation: str
    source_url: str
    retrieved_at: datetime


@dataclass(frozen=True, slots=True)
class NormalizedFact:
    metric: str
    fiscal_year: int
    fiscal_period: str
    period_start: str | None
    period_end: str
    unit: str
    value: float
    quality: str
    evidence: tuple[EvidenceReference, ...]


@dataclass(frozen=True, slots=True)
class NormalizationWarning:
    code: str
    metric: str
    fiscal_year: int | None
    message: str
    evidence_ids: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class RejectedFact:
    metric: str
    xbrl_concept: str
    unit: str
    reason: str
    raw_value: Any


@dataclass(frozen=True, slots=True)
class NormalizationResult:
    cik: str
    source_url: str
    retrieved_at: datetime
    facts: Mapping[str, tuple[NormalizedFact, ...]]
    missing_metrics: tuple[str, ...]
    warnings: tuple[NormalizationWarning, ...]
    rejected_facts: tuple[RejectedFact, ...]

    def latest(self, metric: str) -> NormalizedFact | None:
        values = self.facts.get(metric, ())
        return values[0] if values else None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
