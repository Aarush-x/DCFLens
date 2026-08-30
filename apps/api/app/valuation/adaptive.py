from __future__ import annotations

import math
from dataclasses import asdict, dataclass
from typing import Any, Iterable, Mapping

from app.data.sec.models import EvidenceReference, NormalizationResult, NormalizedFact
from app.valuation.models import DcfAssumptions
from app.valuation.priors import PriorConfig, SectorPrior, load_prior_config


@dataclass(frozen=True, slots=True)
class CompanyProfile:
    sic_code: int | None = None
    sic_description: str = ""
    business_description: str = ""
    years_public: int | None = None
    evidence_references: tuple[EvidenceReference, ...] = ()


@dataclass(frozen=True, slots=True)
class CompanyClassification:
    sector: str
    sector_display_name: str
    business_type: str
    method: str
    matched_observation: str
    confidence: float


@dataclass(frozen=True, slots=True)
class RawObservation:
    name: str
    value: float | None
    unit: str
    status: str
    calculation: str
    evidence_ids: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class PriorReference:
    version: str
    sector: str
    parameter: str
    value: float


@dataclass(frozen=True, slots=True)
class CompanyModifier:
    name: str
    value: float
    rationale: str


@dataclass(frozen=True, slots=True)
class WeightRecord:
    signal: str
    target_weight: float
    effective_weight: float
    normalized_weight: float
    rationale: str


@dataclass(frozen=True, slots=True)
class BoundRecord:
    name: str
    lower: float
    upper: float
    input_value: float
    output_value: float
    was_applied: bool


@dataclass(frozen=True, slots=True)
class AssumptionTrace:
    assumption: str
    raw_observations: tuple[RawObservation, ...]
    sector_prior: PriorReference
    company_modifiers: tuple[CompanyModifier, ...]
    weights: tuple[WeightRecord, ...]
    fallbacks: tuple[str, ...]
    bounds_applied: tuple[BoundRecord, ...]
    final_baseline: float
    evidence_references: tuple[EvidenceReference, ...]
    data_coverage_confidence: float
    stability_confidence: float
    plain_english_explanation: str
    technical_explanation: str


@dataclass(frozen=True, slots=True)
class AdaptiveBaseline:
    prior_version: str
    classification: CompanyClassification
    assumptions: DcfAssumptions
    traces: tuple[AssumptionTrace, ...]

    def trace_for(self, assumption: str) -> AssumptionTrace:
        for trace in self.traces:
            if trace.assumption == assumption:
                return trace
        raise KeyError(assumption)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class AdaptiveBaselineError(ValueError):
    """Structured input or configuration error for baseline derivation."""


@dataclass(frozen=True, slots=True)
class _GrowthSignal:
    observation: RawObservation
    value: float | None
    state: str
    evidence: tuple[EvidenceReference, ...]
    bounds: tuple[BoundRecord, ...]


@dataclass(frozen=True, slots=True)
class _Stability:
    confidence: float
    observation: RawObservation


_SIC_RULES: tuple[tuple[str, tuple[tuple[int, int], ...]], ...] = (
    ("real_estate", ((6500, 6599),)),
    ("financials", ((6000, 6499), (6700, 6799))),
    ("utilities", ((4900, 4999),)),
    ("retail", ((5200, 5999),)),
    ("technology", ((3570, 3579), (3660, 3699), (7370, 7379))),
    ("healthcare", ((2830, 2839), (8000, 8099))),
    ("energy", ((1300, 1399), (2900, 2999))),
    ("industrials", ((3400, 3569), (3580, 3659), (3700, 3999))),
)

_KEYWORD_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("utilities", ("utility", "electric power", "natural gas distribution", "water utility")),
    ("financials", ("bank", "lending", "insurance", "financial institution", "asset management")),
    ("retail", ("retail", "e-commerce", "ecommerce", "stores", "merchant")),
    ("technology", ("software", "semiconductor", "cloud", "technology", "computer")),
    ("healthcare", ("healthcare", "pharmaceutical", "biotechnology", "medical device")),
    ("energy", ("oil", "natural gas", "energy producer", "drilling")),
    ("real_estate", ("real estate", "reit", "property owner")),
    ("industrials", ("industrial", "manufacturing", "aerospace", "machinery")),
    ("consumer", ("consumer products", "restaurant", "beverage", "apparel")),
)


def derive_adaptive_baseline(
    profile: CompanyProfile,
    normalized: NormalizationResult,
    *,
    prior_config: PriorConfig | None = None,
    stage_one_years: int | None = None,
    stage_two_years: int | None = None,
) -> AdaptiveBaseline:
    """Derive deterministic DCF rates from normalized facts and versioned priors."""
    config = prior_config or load_prior_config()
    _validate_inputs(profile, normalized, config)
    classification = classify_company(profile, config.sectors)
    prior = config.sectors[classification.sector]

    fcf_facts = _facts_oldest_first(normalized, "free_cash_flow")
    revenue_facts = _facts_oldest_first(normalized, "revenue")
    fcf_signal = _growth_signal(
        "historical_fcf_growth", fcf_facts, _rate_bounds(config, "fcf_growth_signal"), is_fcf=True
    )
    revenue_signal = _growth_signal(
        "revenue_growth", revenue_facts, _rate_bounds(config, "revenue_growth_signal"), is_fcf=False
    )
    stability = _stability(fcf_facts)
    maturity = _maturity(profile.years_public, config)

    stage_one = _stage_one_trace(
        profile,
        classification,
        prior,
        config,
        fcf_signal,
        revenue_signal,
        stability,
        maturity,
    )
    terminal = _terminal_trace(profile, classification, prior, config, stability)
    stage_two = _stage_two_trace(
        classification, prior, config, stage_one, terminal, stability
    )
    discount = _discount_trace(
        profile,
        normalized,
        classification,
        prior,
        config,
        fcf_signal,
        revenue_signal,
        stability,
        maturity,
        terminal,
    )

    first_years = config.stage_one_years if stage_one_years is None else stage_one_years
    second_years = config.stage_two_years if stage_two_years is None else stage_two_years
    if (
        not isinstance(first_years, int)
        or isinstance(first_years, bool)
        or not 1 <= first_years <= 50
    ):
        raise AdaptiveBaselineError("stage_one_years must be an integer from 1 through 50")
    if (
        not isinstance(second_years, int)
        or isinstance(second_years, bool)
        or not 1 <= second_years <= 50
    ):
        raise AdaptiveBaselineError("stage_two_years must be an integer from 1 through 50")
    if first_years + second_years > 100:
        raise AdaptiveBaselineError("combined projection duration cannot exceed 100 years")

    return AdaptiveBaseline(
        prior_version=config.version,
        classification=classification,
        assumptions=DcfAssumptions(
            stage_one_years=first_years,
            stage_two_years=second_years,
            stage_one_growth_rate=stage_one.final_baseline,
            stage_two_growth_rate=stage_two.final_baseline,
            terminal_growth_rate=terminal.final_baseline,
            discount_rate=discount.final_baseline,
        ),
        traces=(stage_one, stage_two, terminal, discount),
    )


def classify_company(
    profile: CompanyProfile, sectors: Mapping[str, SectorPrior] | None = None
) -> CompanyClassification:
    """Classify with ordered SIC rules, then deterministic text keywords."""
    available_sectors = sectors or load_prior_config().sectors
    if profile.sic_code is not None:
        for sector, ranges in _SIC_RULES:
            if sector in available_sectors and any(
                lower <= profile.sic_code <= upper for lower, upper in ranges
            ):
                return _classification(
                    sector,
                    available_sectors,
                    "sic_code",
                    str(profile.sic_code),
                    1.0,
                )

    combined = f"{profile.sic_description} {profile.business_description}".lower()
    for sector, keywords in _KEYWORD_RULES:
        for keyword in keywords:
            if keyword in combined and sector in available_sectors:
                return _classification(
                    sector,
                    available_sectors,
                    "description_keyword",
                    keyword,
                    0.75,
                )

    return _classification(
        "other",
        available_sectors,
        "fallback",
        "no SIC or keyword match",
        0.40,
    )


def _classification(
    sector: str,
    sectors: Mapping[str, SectorPrior],
    method: str,
    matched: str,
    confidence: float,
) -> CompanyClassification:
    prior = sectors[sector]
    return CompanyClassification(
        sector=sector,
        sector_display_name=prior.display_name,
        business_type=prior.business_type,
        method=method,
        matched_observation=matched,
        confidence=confidence,
    )


def _validate_inputs(
    profile: CompanyProfile, normalized: NormalizationResult, config: PriorConfig
) -> None:
    if profile.sic_code is not None and (
        isinstance(profile.sic_code, bool)
        or not isinstance(profile.sic_code, int)
        or not 0 <= profile.sic_code <= 9999
    ):
        raise AdaptiveBaselineError("sic_code must be an integer from 0 through 9999")
    if profile.years_public is not None and (
        isinstance(profile.years_public, bool)
        or not isinstance(profile.years_public, int)
        or profile.years_public < 0
    ):
        raise AdaptiveBaselineError("years_public must be a non-negative integer")
    if not config.version.strip():
        raise AdaptiveBaselineError("prior configuration must have a version")
    for metric, facts in normalized.facts.items():
        for fact in facts:
            if not math.isfinite(fact.value):
                raise AdaptiveBaselineError(f"{metric} contains a non-finite normalized value")


def _facts_oldest_first(
    normalized: NormalizationResult, metric: str
) -> tuple[NormalizedFact, ...]:
    return tuple(sorted(normalized.facts.get(metric, ()), key=lambda fact: fact.period_end))


def _growth_signal(
    name: str,
    facts: tuple[NormalizedFact, ...],
    bounds: tuple[float, float],
    *,
    is_fcf: bool,
) -> _GrowthSignal:
    evidence = _evidence_from_facts(facts)
    evidence_ids = tuple(reference.evidence_id for reference in evidence)
    if len(facts) < 2:
        return _GrowthSignal(
            RawObservation(name, None, "decimal_rate", "missing", "At least two annual observations are required", evidence_ids),
            None,
            "missing",
            evidence,
            (),
        )

    latest = facts[-1]
    previous = facts[-2]
    if is_fcf and latest.value <= 0:
        return _GrowthSignal(
            RawObservation(name, None, "decimal_rate", "negative", "Growth is not inferred while latest normalized FCF is non-positive", evidence_ids),
            None,
            "negative",
            evidence,
            (),
        )
    if is_fcf and previous.value <= 0 < latest.value:
        return _GrowthSignal(
            RawObservation(name, None, "decimal_rate", "newly_positive", "Percentage growth is suppressed because FCF crossed from non-positive to positive", evidence_ids),
            None,
            "newly_positive",
            evidence,
            (),
        )

    calculation_facts = facts
    if is_fcf:
        positive_start = len(facts) - 1
        while positive_start > 0 and facts[positive_start - 1].value > 0:
            positive_start -= 1
        calculation_facts = facts[positive_start:]

    first = calculation_facts[0]
    if first.value <= 0 or latest.value <= 0:
        status = "negative" if is_fcf else "unusable"
        return _GrowthSignal(
            RawObservation(name, None, "decimal_rate", status, "CAGR requires positive first and latest observations", evidence_ids),
            None,
            status,
            evidence,
            (),
        )

    elapsed_years = max(1, latest.fiscal_year - first.fiscal_year)
    raw_growth = (latest.value / first.value) ** (1.0 / elapsed_years) - 1.0
    if not math.isfinite(raw_growth):
        raise AdaptiveBaselineError("Historical growth exceeds the finite numeric range")
    bounded, bound = _apply_bound(f"{name}_cap", raw_growth, bounds)
    return _GrowthSignal(
        RawObservation(
            name,
            raw_growth,
            "decimal_rate",
            "available",
            f"CAGR = ({latest.value} / {first.value})^(1 / {elapsed_years}) - 1",
            evidence_ids,
        ),
        bounded,
        "positive" if is_fcf else "available",
        evidence,
        (bound,),
    )


def _stability(facts: tuple[NormalizedFact, ...]) -> _Stability:
    evidence_ids = tuple(
        reference.evidence_id for reference in _evidence_from_facts(facts)
    )
    if len(facts) < 2:
        return _Stability(
            0.25,
            RawObservation(
                "cash_flow_stability",
                0.25,
                "score_0_to_1",
                "insufficient_history",
                "Default stability confidence when fewer than two annual FCF observations exist",
                evidence_ids,
            ),
        )
    values = tuple(fact.value for fact in facts)
    scale = max(abs(value) for value in values)
    scaled_mean = sum(abs(value) / scale for value in values) / len(values) if scale else 0.0
    normalized_range = (max(values) / scale - min(values) / scale) / scaled_mean if scale else 0.0
    sign_changes = sum(
        1 for left, right in zip(values, values[1:])
        if (left < 0 < right) or (right < 0 < left)
    )
    confidence = _clamp(1.0 / (1.0 + normalized_range) - 0.15 * sign_changes, 0.0, 1.0)
    return _Stability(
        confidence,
        RawObservation(
            "cash_flow_stability",
            confidence,
            "score_0_to_1",
            "available",
            f"1 / (1 + normalized_range {normalized_range}) - 0.15 * sign_changes {sign_changes}",
            evidence_ids,
        ),
    )


def _maturity(years_public: int | None, config: PriorConfig) -> str:
    if years_public is None:
        return "unknown"
    emerging_max = int(config.maturity_modifiers["emerging"]["maximum_years_public"] or 0)
    established_max = int(config.maturity_modifiers["established"]["maximum_years_public"] or 0)
    if years_public <= emerging_max:
        return "emerging"
    if years_public <= established_max:
        return "established"
    return "mature"


def _stage_one_trace(
    profile: CompanyProfile,
    classification: CompanyClassification,
    prior: SectorPrior,
    config: PriorConfig,
    fcf: _GrowthSignal,
    revenue: _GrowthSignal,
    stability: _Stability,
    maturity: str,
) -> AssumptionTrace:
    values = {
        "sector_prior": prior.stage_one_growth,
        "historical_fcf_growth": fcf.value,
        "revenue_growth": revenue.value,
    }
    target = config.signal_weights
    effective = {
        "sector_prior": target["sector_prior"],
        "historical_fcf_growth": target["historical_fcf_growth"] * stability.confidence if fcf.value is not None else 0.0,
        "revenue_growth": target["revenue_growth"] if revenue.value is not None else 0.0,
    }
    total = sum(effective.values())
    normalized_weights = {name: value / total for name, value in effective.items()}
    blended = sum(
        float(values[name]) * normalized_weights[name]
        for name in values
        if values[name] is not None
    )

    maturity_value = float(config.maturity_modifiers[maturity]["stage_one"] or 0.0)
    fcf_modifier = float(config.fcf_state_modifiers[fcf.state]["stage_one"])
    threshold = config.risk_modifiers["stability_penalty_threshold"]
    maximum_penalty = config.risk_modifiers["maximum_stage_one_stability_penalty"]
    stability_modifier = (
        -maximum_penalty * (threshold - stability.confidence) / threshold
        if stability.confidence < threshold
        else 0.0
    )
    modifiers = (
        CompanyModifier("company_maturity", maturity_value, f"{maturity} company based on years_public={profile.years_public}"),
        CompanyModifier("fcf_state", fcf_modifier, f"normalized FCF state is {fcf.state}"),
        CompanyModifier("cash_flow_stability", stability_modifier, "low stability shrinks the growth baseline"),
    )
    raw_final = blended + sum(item.value for item in modifiers)
    lower = max(_rate_bounds(config, "stage_one_growth")[0], prior.stage_one_bounds[0])
    upper = min(_rate_bounds(config, "stage_one_growth")[1], prior.stage_one_bounds[1])
    final, final_bound = _apply_bound("stage_one_sector_and_global_cap", raw_final, (lower, upper))

    fallbacks: list[str] = []
    if fcf.value is None:
        fallbacks.append(f"historical FCF growth omitted because its state is {fcf.state}; remaining weights were renormalized")
    elif stability.confidence < 1.0:
        fallbacks.append("historical FCF growth weight was reduced in proportion to cash-flow stability")
    if revenue.value is None:
        fallbacks.append("revenue growth was unavailable; remaining weights were renormalized")
    if maturity == "unknown":
        fallbacks.append("company maturity was unavailable; no stage-one maturity adjustment was applied")

    coverage = _clamp(
        target["sector_prior"] * classification.confidence
        + (target["historical_fcf_growth"] if fcf.value is not None else 0.0)
        + (target["revenue_growth"] if revenue.value is not None else 0.0),
        0.0,
        1.0,
    )
    weights = tuple(
        WeightRecord(
            name,
            target[name],
            effective[name],
            normalized_weights[name],
            "FCF weight is stability-adjusted" if name == "historical_fcf_growth" else "available signals are renormalized",
        )
        for name in ("sector_prior", "historical_fcf_growth", "revenue_growth")
    )
    evidence = _deduplicate_evidence((*profile.evidence_references, *fcf.evidence, *revenue.evidence))
    technical = (
        f"weighted_blend={blended:.10f}; modifiers={sum(item.value for item in modifiers):.10f}; "
        f"pre_bound={raw_final:.10f}; bounds=[{lower:.10f}, {upper:.10f}]; final={final:.10f}"
    )
    plain = (
        f"Stage-one growth is {final:.1%}. It blends the {prior.display_name} prior with "
        f"available FCF and revenue growth, reduces reliance on unstable cash flow, and applies a {maturity} maturity adjustment."
    )
    return AssumptionTrace(
        "stage_one_growth_rate",
        (fcf.observation, revenue.observation, stability.observation),
        PriorReference(config.version, classification.sector, "stage_one_growth", prior.stage_one_growth),
        modifiers,
        weights,
        tuple(fallbacks),
        (*fcf.bounds, *revenue.bounds, final_bound),
        final,
        evidence,
        coverage,
        stability.confidence,
        plain,
        technical,
    )


def _terminal_trace(
    profile: CompanyProfile,
    classification: CompanyClassification,
    prior: SectorPrior,
    config: PriorConfig,
    stability: _Stability,
) -> AssumptionTrace:
    final, bound = _apply_bound(
        "terminal_growth_global_cap", prior.terminal_growth, _rate_bounds(config, "terminal_growth")
    )
    return AssumptionTrace(
        "terminal_growth_rate",
        (RawObservation("sector_classification_confidence", classification.confidence, "score_0_to_1", classification.method, classification.matched_observation, tuple(reference.evidence_id for reference in profile.evidence_references)),),
        PriorReference(config.version, classification.sector, "terminal_growth", prior.terminal_growth),
        (),
        (WeightRecord("sector_terminal_prior", 1.0, 1.0, 1.0, "terminal growth is the bounded sector prior"),),
        () if classification.method != "fallback" else ("unclassified company uses the transparent other-sector terminal prior",),
        (bound,),
        final,
        _deduplicate_evidence(profile.evidence_references),
        classification.confidence,
        stability.confidence,
        f"Terminal growth is {final:.1%}, the bounded long-run prior for {prior.display_name}.",
        f"sector_terminal_prior={prior.terminal_growth:.10f}; final={final:.10f}",
    )


def _stage_two_trace(
    classification: CompanyClassification,
    prior: SectorPrior,
    config: PriorConfig,
    stage_one: AssumptionTrace,
    terminal: AssumptionTrace,
    stability: _Stability,
) -> AssumptionTrace:
    fade = prior.stage_two_fade_fraction
    raw = terminal.final_baseline + fade * (stage_one.final_baseline - terminal.final_baseline)
    global_lower, global_upper = _rate_bounds(config, "stage_two_growth")
    endpoint_lower = min(stage_one.final_baseline, terminal.final_baseline)
    endpoint_upper = max(stage_one.final_baseline, terminal.final_baseline)
    lower = max(global_lower, endpoint_lower)
    upper = min(global_upper, endpoint_upper)
    final, bound = _apply_bound("stage_two_fade_and_global_cap", raw, (lower, upper))
    evidence = _deduplicate_evidence((*stage_one.evidence_references, *terminal.evidence_references))
    return AssumptionTrace(
        "stage_two_growth_rate",
        (
            RawObservation("stage_one_baseline", stage_one.final_baseline, "decimal_rate", "derived", "output of stage-one adaptive baseline", tuple(reference.evidence_id for reference in stage_one.evidence_references)),
            RawObservation("terminal_growth_baseline", terminal.final_baseline, "decimal_rate", "derived", "bounded sector terminal-growth prior", tuple(reference.evidence_id for reference in terminal.evidence_references)),
        ),
        PriorReference(config.version, classification.sector, "stage_two_fade_fraction", fade),
        (),
        (
            WeightRecord("stage_one_growth", fade, fade, fade, "sector fade fraction retains this share of stage-one growth"),
            WeightRecord("terminal_growth", 1.0 - fade, 1.0 - fade, 1.0 - fade, "remaining weight moves growth toward the terminal rate"),
        ),
        (),
        (bound,),
        final,
        evidence,
        min(stage_one.data_coverage_confidence, terminal.data_coverage_confidence),
        stability.confidence,
        f"Stage-two growth is {final:.1%}, fading {prior.display_name} growth toward the {terminal.final_baseline:.1%} terminal rate.",
        f"{terminal.final_baseline:.10f} + {fade:.10f} * ({stage_one.final_baseline:.10f} - {terminal.final_baseline:.10f}) = {final:.10f}",
    )


def _discount_trace(
    profile: CompanyProfile,
    normalized: NormalizationResult,
    classification: CompanyClassification,
    prior: SectorPrior,
    config: PriorConfig,
    fcf: _GrowthSignal,
    revenue: _GrowthSignal,
    stability: _Stability,
    maturity: str,
    terminal: AssumptionTrace,
) -> AssumptionTrace:
    coverage = _discount_coverage(profile, normalized, classification, fcf)
    stability_premium = (1.0 - stability.confidence) * config.risk_modifiers["maximum_discount_stability_premium"]
    coverage_premium = (1.0 - coverage) * config.risk_modifiers["maximum_discount_coverage_premium"]
    maturity_modifier = float(config.maturity_modifiers[maturity]["discount_rate"] or 0.0)
    state_modifier = float(config.fcf_state_modifiers[fcf.state]["discount_rate"])
    leverage_modifier, leverage_observation, leverage_fallback, leverage_evidence = _leverage(normalized, config)
    modifiers = (
        CompanyModifier("cash_flow_stability_premium", stability_premium, "lower stability increases the discount rate"),
        CompanyModifier("data_coverage_premium", coverage_premium, "lower data coverage increases the discount rate"),
        CompanyModifier("company_maturity", maturity_modifier, f"{maturity} company based on years_public={profile.years_public}"),
        CompanyModifier("fcf_state", state_modifier, f"normalized FCF state is {fcf.state}"),
        CompanyModifier("net_leverage", leverage_modifier, leverage_observation.calculation),
    )
    raw = prior.discount_rate + sum(item.value for item in modifiers)
    sector_lower, sector_upper = prior.discount_rate_bounds
    global_lower, global_upper = _rate_bounds(config, "discount_rate")
    lower = max(sector_lower, global_lower)
    upper = min(sector_upper, global_upper)
    bounded, range_bound = _apply_bound("discount_sector_and_global_cap", raw, (lower, upper))
    minimum_spread = float(config.global_bounds["minimum_terminal_spread"])
    spread_floor = terminal.final_baseline + minimum_spread
    final = max(bounded, spread_floor)
    spread_bound = BoundRecord(
        "minimum_terminal_spread",
        spread_floor,
        upper,
        bounded,
        final,
        final != bounded,
    )
    if final > upper:
        raise AdaptiveBaselineError("Configured discount-rate bounds cannot preserve the minimum terminal spread")

    fallbacks: list[str] = []
    if maturity == "unknown":
        fallbacks.append("years public was unavailable; the configured unknown-maturity premium was applied")
    if leverage_fallback:
        fallbacks.append(leverage_fallback)
    if revenue.value is None:
        fallbacks.append("revenue history was unavailable and lowered discount-rate data coverage")
    evidence = _deduplicate_evidence(
        (*profile.evidence_references, *fcf.evidence, *revenue.evidence, *leverage_evidence)
    )
    observations = (
        stability.observation,
        RawObservation("data_coverage", coverage, "score_0_to_1", "derived", "weighted availability of classification, FCF, leverage, revenue, and maturity inputs", tuple(reference.evidence_id for reference in evidence)),
        leverage_observation,
    )
    return AssumptionTrace(
        "discount_rate",
        observations,
        PriorReference(config.version, classification.sector, "discount_rate", prior.discount_rate),
        modifiers,
        (WeightRecord("sector_discount_prior", 1.0, 1.0, 1.0, "company-risk modifiers are added to the sector discount prior"),),
        tuple(fallbacks),
        (range_bound, spread_bound),
        final,
        evidence,
        coverage,
        stability.confidence,
        f"The discount rate is {final:.1%}: the {prior.display_name} prior plus explicit stability, coverage, maturity, FCF-state, and leverage adjustments.",
        f"sector_prior={prior.discount_rate:.10f}; modifiers={sum(item.value for item in modifiers):.10f}; pre_bound={raw:.10f}; final={final:.10f}",
    )


def _discount_coverage(
    profile: CompanyProfile,
    normalized: NormalizationResult,
    classification: CompanyClassification,
    fcf: _GrowthSignal,
) -> float:
    score = 0.25 * classification.confidence
    score += 0.20 if fcf.state != "missing" else 0.0
    score += 0.20 if normalized.facts.get("revenue") else 0.0
    score += 0.20 if normalized.facts.get("total_debt") and normalized.facts.get("cash_and_short_term_investments") else 0.0
    score += 0.15 if profile.years_public is not None else 0.0
    return _clamp(score, 0.0, 1.0)


def _leverage(
    normalized: NormalizationResult, config: PriorConfig
) -> tuple[float, RawObservation, str | None, tuple[EvidenceReference, ...]]:
    debt = normalized.latest("total_debt")
    cash = normalized.latest("cash_and_short_term_investments")
    fcf = normalized.latest("free_cash_flow")
    facts = tuple(fact for fact in (debt, cash, fcf) if fact is not None)
    evidence = _evidence_from_facts(facts)
    evidence_ids = tuple(reference.evidence_id for reference in evidence)
    if debt is None or cash is None:
        observation = RawObservation("net_debt_to_fcf", None, "multiple", "missing", "Debt and cash are both required for a leverage modifier", evidence_ids)
        return 0.0, observation, "debt or cash was unavailable; no leverage modifier was applied", evidence
    net_debt = debt.value - cash.value
    if net_debt < 0:
        value = config.risk_modifiers["net_cash_discount_modifier"]
        observation = RawObservation("net_debt_to_fcf", None, "multiple", "net_cash", f"net_debt={debt.value}-{cash.value}={net_debt}; applied net-cash modifier", evidence_ids)
        return value, observation, None, evidence
    if fcf is None or fcf.value <= 0:
        observation = RawObservation("net_debt_to_fcf", None, "multiple", "unavailable", "Positive latest FCF is required for the leverage multiple", evidence_ids)
        return 0.0, observation, "positive latest FCF was unavailable; no leverage-ratio modifier was applied", evidence
    ratio = net_debt / fcf.value
    if ratio > config.risk_modifiers["high_leverage_threshold"]:
        modifier = config.risk_modifiers["high_leverage_discount_modifier"]
    elif ratio > config.risk_modifiers["moderate_leverage_threshold"]:
        modifier = config.risk_modifiers["moderate_leverage_discount_modifier"]
    else:
        modifier = 0.0
    observation = RawObservation("net_debt_to_fcf", ratio, "multiple", "available", f"(total_debt {debt.value} - cash {cash.value}) / latest_fcf {fcf.value}", evidence_ids)
    return modifier, observation, None, evidence


def _rate_bounds(config: PriorConfig, name: str) -> tuple[float, float]:
    value = config.global_bounds[name]
    if not isinstance(value, tuple):
        raise AdaptiveBaselineError(f"{name} must be configured as bounds")
    return value


def _apply_bound(
    name: str, value: float, bounds: tuple[float, float]
) -> tuple[float, BoundRecord]:
    output = _clamp(value, bounds[0], bounds[1])
    return output, BoundRecord(name, bounds[0], bounds[1], value, output, output != value)


def _clamp(value: float, lower: float, upper: float) -> float:
    return min(max(value, lower), upper)


def _evidence_from_facts(
    facts: Iterable[NormalizedFact],
) -> tuple[EvidenceReference, ...]:
    return _deduplicate_evidence(
        reference for fact in facts for reference in fact.evidence
    )


def _deduplicate_evidence(
    references: Iterable[EvidenceReference],
) -> tuple[EvidenceReference, ...]:
    result: list[EvidenceReference] = []
    seen: set[str] = set()
    for reference in references:
        if reference.evidence_id not in seen:
            seen.add(reference.evidence_id)
            result.append(reference)
    return tuple(result)
