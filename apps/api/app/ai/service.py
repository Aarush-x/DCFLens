from __future__ import annotations

import math
from dataclasses import replace
from urllib.parse import urlparse

from app.ai.gemini import GeminiProviderError, GeminiTimeoutError
from app.ai.models import (
    AiAnalysisInput,
    AiAnalysisResult,
    AiAnalysisStatus,
    AnalysisEvidence,
    AppliedAdjustment,
    ChecklistDisagreement,
    ChecklistQualitativeFinding,
    ConfidenceAssessment,
    ConfidenceFactor,
    ConfidenceLevel,
    DisagreementSummary,
    EvidenceAssessment,
    EvidenceSupport,
    QualitativeProvider,
    ValuationImpact,
    ValidatedAiResponse,
)
from app.ai.prompt import build_provider_request
from app.ai.schema import (
    AI_ADJUSTMENT_BOUNDS,
    AiResponseValidationError,
    parse_and_validate_ai_response,
)
from app.checklist import ORIGINAL_CHECKLIST, evaluate_checklist
from app.checklist.models import ChecklistEvaluation, ChecklistEvidence
from app.valuation import calculate_dcf, derive_adaptive_baseline
from app.valuation.adaptive import AdaptiveBaseline
from app.valuation.models import DcfAssumptions, DcfResult, DcfValidationError


MAX_EVIDENCE_ITEMS = 64
MAX_EVIDENCE_CONTENT_CHARS = 4_000
_ASSUMPTION_NAMES = tuple(AI_ADJUSTMENT_BOUNDS)


class AiAnalysisInputError(ValueError):
    """Raised before provider access when evidence input is invalid."""


def run_qualitative_analysis(
    analysis_input: AiAnalysisInput,
    provider: QualitativeProvider,
) -> AiAnalysisResult:
    """Calculate deterministic results first, then optionally apply validated AI output."""
    baseline = derive_adaptive_baseline(
        analysis_input.company_profile,
        analysis_input.checklist_input.normalized_facts,
    )
    baseline_valuation = calculate_dcf(
        analysis_input.dcf_input,
        baseline.assumptions,
        analysis_input.sensitivity,
    )
    deterministic_checklist = evaluate_checklist(analysis_input.checklist_input)
    evidence_by_id = _validate_evidence(analysis_input.evidence)

    if not evidence_by_id:
        return _fallback_result(
            "insufficient_evidence",
            baseline,
            baseline_valuation,
            deterministic_checklist,
        )

    provider_request = build_provider_request(
        baseline,
        baseline_valuation,
        deterministic_checklist,
        analysis_input.evidence,
    )
    try:
        response_text = provider.generate(provider_request)
    except GeminiTimeoutError:
        return _fallback_result(
            "provider_timeout",
            baseline,
            baseline_valuation,
            deterministic_checklist,
        )
    except GeminiProviderError:
        return _fallback_result(
            "provider_failure",
            baseline,
            baseline_valuation,
            deterministic_checklist,
        )
    except Exception:
        return _fallback_result(
            "provider_failure",
            baseline,
            baseline_valuation,
            deterministic_checklist,
        )

    try:
        validated = parse_and_validate_ai_response(
            response_text, frozenset(evidence_by_id)
        )
        return _apply_validated_response(
            analysis_input,
            baseline,
            baseline_valuation,
            deterministic_checklist,
            evidence_by_id,
            validated,
        )
    except AiResponseValidationError as exc:
        return _fallback_result(
            f"invalid_ai_response:{exc.code}",
            baseline,
            baseline_valuation,
            deterministic_checklist,
        )
    except DcfValidationError as exc:
        return _fallback_result(
            f"invalid_ai_valuation:{exc.code}",
            baseline,
            baseline_valuation,
            deterministic_checklist,
        )


def _validate_evidence(
    evidence: tuple[AnalysisEvidence, ...],
) -> dict[str, AnalysisEvidence]:
    if not isinstance(evidence, tuple):
        raise AiAnalysisInputError("evidence must be an immutable tuple")
    if len(evidence) > MAX_EVIDENCE_ITEMS:
        raise AiAnalysisInputError(
            f"evidence must contain at most {MAX_EVIDENCE_ITEMS} items"
        )
    result: dict[str, AnalysisEvidence] = {}
    for index, item in enumerate(evidence):
        if not item.evidence_id.strip() or len(item.evidence_id) > 128:
            raise AiAnalysisInputError(f"evidence[{index}] has an invalid evidence_id")
        if item.evidence_id in result:
            raise AiAnalysisInputError("evidence IDs must be unique")
        if item.reference.evidence_id != item.evidence_id:
            raise AiAnalysisInputError(
                f"evidence[{index}] ID does not match its immutable reference"
            )
        content = item.content.strip()
        if not content or len(content) > MAX_EVIDENCE_CONTENT_CHARS:
            raise AiAnalysisInputError(
                f"evidence[{index}] content must contain 1 through {MAX_EVIDENCE_CONTENT_CHARS} characters"
            )
        if item.source_url != item.reference.source_url:
            raise AiAnalysisInputError(
                f"evidence[{index}] source URL does not match its immutable reference"
            )
        source = urlparse(item.source_url)
        hostname = (source.hostname or "").lower()
        if source.scheme != "https" or not (
            hostname == "sec.gov" or hostname.endswith(".sec.gov")
        ):
            raise AiAnalysisInputError(
                f"evidence[{index}] must use a direct HTTPS SEC URL"
            )
        if item.source_type in {"sec_filing_section", "sec_exhibit"} and not item.is_untrusted_text:
            raise AiAnalysisInputError(
                f"evidence[{index}] annual-report text must be marked untrusted"
            )
        result[item.evidence_id] = item
    return result


def _apply_validated_response(
    analysis_input: AiAnalysisInput,
    baseline: AdaptiveBaseline,
    baseline_valuation: DcfResult,
    deterministic_checklist: ChecklistEvaluation,
    evidence_by_id: dict[str, AnalysisEvidence],
    validated: ValidatedAiResponse,
) -> AiAnalysisResult:
    adjustment_map = {
        item.assumption: item.adjustment for item in validated.adjustments
    }
    final_assumptions = DcfAssumptions(
        stage_one_years=baseline.assumptions.stage_one_years,
        stage_two_years=baseline.assumptions.stage_two_years,
        stage_one_growth_rate=(
            baseline.assumptions.stage_one_growth_rate
            + adjustment_map["stage_one_growth_rate"]
        ),
        stage_two_growth_rate=(
            baseline.assumptions.stage_two_growth_rate
            + adjustment_map["stage_two_growth_rate"]
        ),
        terminal_growth_rate=baseline.assumptions.terminal_growth_rate,
        discount_rate=(
            baseline.assumptions.discount_rate + adjustment_map["discount_rate"]
        ),
    )
    final_valuation = calculate_dcf(
        analysis_input.dcf_input,
        final_assumptions,
        analysis_input.sensitivity,
    )

    applied_adjustments: list[AppliedAdjustment] = []
    for item in validated.adjustments:
        baseline_value = float(getattr(baseline.assumptions, item.assumption))
        isolated_assumptions = replace(
            baseline.assumptions,
            **{item.assumption: baseline_value + item.adjustment},
        )
        isolated = calculate_dcf(
            analysis_input.dcf_input,
            isolated_assumptions,
            analysis_input.sensitivity,
        )
        lower, upper = AI_ADJUSTMENT_BOUNDS[item.assumption]
        applied_adjustments.append(
            AppliedAdjustment(
                assumption=item.assumption,
                baseline_assumption=baseline_value,
                ai_adjustment=item.adjustment,
                final_assumption=float(getattr(final_assumptions, item.assumption)),
                minimum_adjustment=lower,
                maximum_adjustment=upper,
                rationale=item.rationale,
                evidence_references=_resolve_evidence(
                    item.evidence_ids, evidence_by_id
                ),
                isolated_intrinsic_value_per_share=isolated.intrinsic_value_per_share,
                isolated_valuation_impact_per_share=(
                    isolated.intrinsic_value_per_share
                    - baseline_valuation.intrinsic_value_per_share
                ),
            )
        )

    assessments = tuple(
        EvidenceAssessment(
            statement=item.statement,
            claim_type=item.claim_type,
            support=item.support,
            evidence_references=_resolve_evidence(
                item.evidence_ids, evidence_by_id
            ),
        )
        for item in validated.evidence_assessment
    )
    findings = tuple(
        ChecklistQualitativeFinding(
            checklist_number=item.checklist_number,
            checklist_text=ORIGINAL_CHECKLIST[item.checklist_number - 1].text,
            status=item.status,
            explanation=item.explanation,
            evidence_references=_resolve_evidence(
                item.evidence_ids, evidence_by_id
            ),
            claim_type=item.claim_type,
        )
        for item in validated.checklist_findings
    )
    disagreements = tuple(
        ChecklistDisagreement(
            checklist_number=finding.checklist_number,
            checklist_text=finding.checklist_text,
            deterministic_status=deterministic_checklist.results[
                finding.checklist_number - 1
            ].status,
            ai_status=finding.status,
            evidence_references=finding.evidence_references,
        )
        for finding in findings
        if deterministic_checklist.results[finding.checklist_number - 1].status
        != finding.status
    )
    disagreement_evidence = _resolve_evidence(
        validated.disagreement_evidence_ids, evidence_by_id
    )
    summary = (
        f"{validated.disagreement_summary} Deterministic comparison found "
        f"{len(disagreements)} checklist status disagreement(s)."
    )
    impact = _valuation_impact(baseline_valuation, final_valuation)
    confidence = _confidence(
        baseline,
        final_valuation,
        validated,
        disagreements,
        fallback=False,
    )
    return AiAnalysisResult(
        status=AiAnalysisStatus.APPLIED,
        fallback_reason=None,
        deterministic_baseline=baseline,
        baseline_valuation=baseline_valuation,
        deterministic_checklist=deterministic_checklist,
        adjustments=tuple(applied_adjustments),
        final_assumptions=final_assumptions,
        final_valuation=final_valuation,
        valuation_impact=impact,
        evidence_assessment=assessments,
        confidence=confidence,
        checklist_qualitative_findings=findings,
        disagreement=DisagreementSummary(
            summary=summary,
            checklist_disagreements=disagreements,
            evidence_references=disagreement_evidence,
        ),
    )


def _fallback_result(
    reason: str,
    baseline: AdaptiveBaseline,
    baseline_valuation: DcfResult,
    deterministic_checklist: ChecklistEvaluation,
) -> AiAnalysisResult:
    adjustments = tuple(
        AppliedAdjustment(
            assumption=name,
            baseline_assumption=float(getattr(baseline.assumptions, name)),
            ai_adjustment=0.0,
            final_assumption=float(getattr(baseline.assumptions, name)),
            minimum_adjustment=AI_ADJUSTMENT_BOUNDS[name][0],
            maximum_adjustment=AI_ADJUSTMENT_BOUNDS[name][1],
            rationale="AI output was unavailable or invalid; deterministic baseline preserved.",
            evidence_references=(),
            isolated_intrinsic_value_per_share=baseline_valuation.intrinsic_value_per_share,
            isolated_valuation_impact_per_share=0.0,
        )
        for name in _ASSUMPTION_NAMES
    )
    confidence = _confidence(
        baseline,
        baseline_valuation,
        None,
        (),
        fallback=True,
    )
    return AiAnalysisResult(
        status=AiAnalysisStatus.DETERMINISTIC_FALLBACK,
        fallback_reason=reason,
        deterministic_baseline=baseline,
        baseline_valuation=baseline_valuation,
        deterministic_checklist=deterministic_checklist,
        adjustments=adjustments,
        final_assumptions=baseline.assumptions,
        final_valuation=baseline_valuation,
        valuation_impact=_valuation_impact(baseline_valuation, baseline_valuation),
        evidence_assessment=(),
        confidence=confidence,
        checklist_qualitative_findings=(),
        disagreement=DisagreementSummary(
            summary=(
                f"AI qualitative analysis was not applied ({reason}); deterministic "
                "valuation and checklist results were preserved."
            ),
            checklist_disagreements=(),
            evidence_references=(),
        ),
    )


def _resolve_evidence(
    evidence_ids: tuple[str, ...],
    evidence_by_id: dict[str, AnalysisEvidence],
) -> tuple[ChecklistEvidence, ...]:
    return tuple(evidence_by_id[item].reference for item in evidence_ids)


def _valuation_impact(
    baseline: DcfResult, final: DcfResult
) -> ValuationImpact:
    absolute = final.intrinsic_value_per_share - baseline.intrinsic_value_per_share
    relative = (
        absolute / abs(baseline.intrinsic_value_per_share)
        if baseline.intrinsic_value_per_share != 0
        else None
    )
    return ValuationImpact(
        baseline_intrinsic_value_per_share=baseline.intrinsic_value_per_share,
        final_intrinsic_value_per_share=final.intrinsic_value_per_share,
        absolute_change_per_share=absolute,
        relative_change=relative,
    )


def _confidence(
    baseline: AdaptiveBaseline,
    valuation: DcfResult,
    response: ValidatedAiResponse | None,
    disagreements: tuple[ChecklistDisagreement, ...],
    *,
    fallback: bool,
) -> ConfidenceAssessment:
    stage_trace = baseline.trace_for("stage_one_growth_rate")
    discount_trace = baseline.trace_for("discount_rate")
    data_coverage = _clamp(
        (stage_trace.data_coverage_confidence + discount_trace.data_coverage_confidence)
        / 2.0
    )
    stability = _clamp(stage_trace.stability_confidence)
    interval = valuation.sensitivity_interval
    interval_width = interval.upper_bound_per_share - interval.lower_bound_per_share
    denominator = max(abs(interval.central_value_per_share), 1e-9)
    sensitivity_score = _clamp(1.0 - interval_width / denominator)
    terminal_score = _clamp(1.0 - valuation.terminal_value.concentration)

    if response is None:
        evidence_support = 0.0
        disagreement_score = 1.0
    else:
        support_values = {
            EvidenceSupport.SUPPORTED: 1.0,
            EvidenceSupport.PARTIALLY_SUPPORTED: 0.5,
            EvidenceSupport.UNSUPPORTED: 0.0,
            EvidenceSupport.CONTRADICTED: 0.0,
        }
        evidence_support = sum(
            support_values[item.support] for item in response.evidence_assessment
        ) / len(response.evidence_assessment)
        adjustment_ratio = sum(
            abs(item.adjustment)
            / max(abs(AI_ADJUSTMENT_BOUNDS[item.assumption][0]), AI_ADJUSTMENT_BOUNDS[item.assumption][1])
            for item in response.adjustments
        ) / len(response.adjustments)
        finding_denominator = max(1, len(response.checklist_findings))
        checklist_disagreement_ratio = len(disagreements) / finding_denominator
        disagreement_score = _clamp(
            1.0 - 0.70 * adjustment_ratio - 0.30 * checklist_disagreement_ratio
        )

    factors = (
        ConfidenceFactor("data_coverage", data_coverage, "Coverage of normalized inputs used by the deterministic baseline."),
        ConfidenceFactor("cash_flow_stability", stability, "Stability score from normalized historical free cash flow."),
        ConfidenceFactor("sensitivity", sensitivity_score, "Narrower non-probabilistic valuation sensitivity receives a higher score."),
        ConfidenceFactor("terminal_value_concentration", terminal_score, "Lower terminal-value concentration receives a higher score."),
        ConfidenceFactor("evidence_support", evidence_support, "Support quality of validated AI claims and cited evidence."),
        ConfidenceFactor("ai_deterministic_disagreement", disagreement_score, "Smaller bounded adjustments and fewer checklist disagreements receive a higher score."),
    )
    score = sum(item.score for item in factors) / len(factors)
    if fallback:
        level = ConfidenceLevel.LOW
    elif score >= 0.75:
        level = ConfidenceLevel.HIGH
    elif score >= 0.50:
        level = ConfidenceLevel.MEDIUM
    else:
        level = ConfidenceLevel.LOW
    return ConfidenceAssessment(
        level=level,
        score=score,
        is_probability=False,
        factors=factors,
        explanation=(
            "Confidence summarizes data quality, model sensitivity, evidence support, "
            "and disagreement. It is not the probability that the intrinsic value will be reached."
        ),
    )


def _clamp(value: float) -> float:
    if not math.isfinite(value):
        return 0.0
    return min(max(value, 0.0), 1.0)
