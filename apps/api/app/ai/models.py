from __future__ import annotations

from dataclasses import asdict, dataclass
from enum import StrEnum
from typing import Any, Protocol

from app.checklist.models import (
    ChecklistEvaluation,
    ChecklistEvidence,
    ChecklistInput,
    ChecklistStatus,
)
from app.valuation.adaptive import AdaptiveBaseline, CompanyProfile
from app.valuation.models import (
    DcfAssumptions,
    DcfInput,
    DcfResult,
    SensitivityConfig,
)


class AiAnalysisStatus(StrEnum):
    APPLIED = "APPLIED"
    DETERMINISTIC_FALLBACK = "DETERMINISTIC_FALLBACK"


class ClaimType(StrEnum):
    FACT = "FACT"
    INTERPRETATION = "INTERPRETATION"
    ASSUMPTION = "ASSUMPTION"


class EvidenceSupport(StrEnum):
    SUPPORTED = "SUPPORTED"
    PARTIALLY_SUPPORTED = "PARTIALLY_SUPPORTED"
    UNSUPPORTED = "UNSUPPORTED"
    CONTRADICTED = "CONTRADICTED"


class ConfidenceLevel(StrEnum):
    HIGH = "High"
    MEDIUM = "Medium"
    LOW = "Low"


@dataclass(frozen=True, slots=True)
class AnalysisEvidence:
    evidence_id: str
    source_type: str
    content: str
    source_url: str
    reference: ChecklistEvidence
    is_untrusted_text: bool


@dataclass(frozen=True, slots=True)
class AiAnalysisInput:
    company_profile: CompanyProfile
    dcf_input: DcfInput
    sensitivity: SensitivityConfig
    checklist_input: ChecklistInput
    evidence: tuple[AnalysisEvidence, ...]


@dataclass(frozen=True, slots=True)
class ProviderRequest:
    system_instruction: str
    prompt: str
    response_schema: dict[str, Any]


class QualitativeProvider(Protocol):
    def generate(self, request: ProviderRequest) -> str:
        """Return only the provider's structured JSON text."""


@dataclass(frozen=True, slots=True)
class RequestedAdjustment:
    assumption: str
    adjustment: float
    rationale: str
    evidence_ids: tuple[str, ...]
    claim_type: ClaimType


@dataclass(frozen=True, slots=True)
class RequestedEvidenceAssessment:
    statement: str
    claim_type: ClaimType
    support: EvidenceSupport
    evidence_ids: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class RequestedChecklistFinding:
    checklist_number: int
    status: ChecklistStatus
    explanation: str
    evidence_ids: tuple[str, ...]
    claim_type: ClaimType


@dataclass(frozen=True, slots=True)
class ValidatedAiResponse:
    adjustments: tuple[RequestedAdjustment, ...]
    evidence_assessment: tuple[RequestedEvidenceAssessment, ...]
    checklist_findings: tuple[RequestedChecklistFinding, ...]
    disagreement_summary: str
    disagreement_evidence_ids: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class AppliedAdjustment:
    assumption: str
    baseline_assumption: float
    ai_adjustment: float
    final_assumption: float
    minimum_adjustment: float
    maximum_adjustment: float
    rationale: str
    evidence_references: tuple[ChecklistEvidence, ...]
    isolated_intrinsic_value_per_share: float
    isolated_valuation_impact_per_share: float


@dataclass(frozen=True, slots=True)
class ChecklistQualitativeFinding:
    checklist_number: int
    checklist_text: str
    status: ChecklistStatus
    explanation: str
    evidence_references: tuple[ChecklistEvidence, ...]
    claim_type: ClaimType


@dataclass(frozen=True, slots=True)
class EvidenceAssessment:
    statement: str
    claim_type: ClaimType
    support: EvidenceSupport
    evidence_references: tuple[ChecklistEvidence, ...]


@dataclass(frozen=True, slots=True)
class ChecklistDisagreement:
    checklist_number: int
    checklist_text: str
    deterministic_status: ChecklistStatus
    ai_status: ChecklistStatus
    evidence_references: tuple[ChecklistEvidence, ...]


@dataclass(frozen=True, slots=True)
class ValuationImpact:
    baseline_intrinsic_value_per_share: float
    final_intrinsic_value_per_share: float
    absolute_change_per_share: float
    relative_change: float | None


@dataclass(frozen=True, slots=True)
class ConfidenceFactor:
    name: str
    score: float
    explanation: str


@dataclass(frozen=True, slots=True)
class ConfidenceAssessment:
    level: ConfidenceLevel
    score: float
    is_probability: bool
    factors: tuple[ConfidenceFactor, ...]
    explanation: str


@dataclass(frozen=True, slots=True)
class DisagreementSummary:
    summary: str
    checklist_disagreements: tuple[ChecklistDisagreement, ...]
    evidence_references: tuple[ChecklistEvidence, ...]


@dataclass(frozen=True, slots=True)
class AiAnalysisResult:
    status: AiAnalysisStatus
    fallback_reason: str | None
    deterministic_baseline: AdaptiveBaseline
    baseline_valuation: DcfResult
    deterministic_checklist: ChecklistEvaluation
    adjustments: tuple[AppliedAdjustment, ...]
    final_assumptions: DcfAssumptions
    final_valuation: DcfResult
    valuation_impact: ValuationImpact
    evidence_assessment: tuple[EvidenceAssessment, ...]
    confidence: ConfidenceAssessment
    checklist_qualitative_findings: tuple[ChecklistQualitativeFinding, ...]
    disagreement: DisagreementSummary

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
