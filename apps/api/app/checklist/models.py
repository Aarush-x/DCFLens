from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime
from enum import StrEnum
from typing import Any, TypeAlias

from app.data.sec.models import EvidenceReference, NormalizationResult


class ChecklistStatus(StrEnum):
    SUPPORTS = "SUPPORTS"
    WEAKENS = "WEAKENS"
    MONITOR = "MONITOR"
    UNKNOWN = "UNKNOWN"
    NOT_APPLICABLE = "NOT_APPLICABLE"


@dataclass(frozen=True, slots=True)
class ChecklistItem:
    number: int
    text: str


@dataclass(frozen=True, slots=True)
class FilingEvidenceReference:
    evidence_id: str
    provider: str
    cik: str
    accession_number: str
    filing_form: str
    filing_date: str
    source_url: str
    locator: str
    description: str
    retrieved_at: datetime


ChecklistEvidence: TypeAlias = EvidenceReference | FilingEvidenceReference


@dataclass(frozen=True, slots=True)
class QualitativeChecklistFacts:
    business_line_count: int | None = None
    business_lines: tuple[str, ...] = ()
    business_diversity_evidence: tuple[FilingEvidenceReference, ...] = ()
    subsidiary_count: int | None = None
    subsidiaries_evidence: tuple[FilingEvidenceReference, ...] = ()


@dataclass(frozen=True, slots=True)
class ChecklistInput:
    normalized_facts: NormalizationResult
    sector: str
    business_type: str
    qualitative: QualitativeChecklistFacts = QualitativeChecklistFacts()


@dataclass(frozen=True, slots=True)
class SupportingMetric:
    name: str
    value: float
    unit: str
    fiscal_periods: tuple[str, ...]
    calculation: str
    evidence_ids: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class ChecklistResult:
    checklist_number: int
    checklist_text: str
    status: ChecklistStatus
    plain_english_explanation: str
    technical_explanation: str
    applicability_reason: str
    metrics_used: tuple[SupportingMetric, ...]
    evidence_references: tuple[ChecklistEvidence, ...]
    missing_information: tuple[str, ...]
    sector_context: str
    potential_valuation_relevance: str


@dataclass(frozen=True, slots=True)
class ChecklistEvaluation:
    results: tuple[ChecklistResult, ...]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
