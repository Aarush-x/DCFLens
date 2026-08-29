from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass, replace
from datetime import date
from typing import Any, Callable, Mapping

from app.data.sec.errors import SecDataError
from app.data.sec.models import (
    EvidenceReference,
    NormalizationResult,
    NormalizationWarning,
    NormalizedFact,
    RejectedFact,
    SecJsonDocument,
)


ANNUAL_FORMS = {"10-K", "10-K/A"}
MIN_ANNUAL_DURATION_DAYS = 250
MAX_ANNUAL_DURATION_DAYS = 450
PROVIDER = "SEC EDGAR"


@dataclass(frozen=True, slots=True)
class _Concept:
    taxonomy: str
    name: str


@dataclass(frozen=True, slots=True)
class _MetricSpec:
    metric: str
    concepts: tuple[_Concept, ...]
    unit: str
    period_kind: str
    transformation: str = "reported_value"


@dataclass(frozen=True, slots=True)
class _Candidate:
    metric: str
    concept: _Concept
    concept_priority: int
    unit: str
    raw_value: float
    normalized_value: float
    transformation: str
    period_start: str | None
    period_end: str
    fiscal_year: int
    fiscal_period: str
    filing_form: str
    filing_date: str
    accession_number: str | None


def _concepts(taxonomy: str, *names: str) -> tuple[_Concept, ...]:
    return tuple(_Concept(taxonomy=taxonomy, name=name) for name in names)


REPORTED_METRICS = (
    _MetricSpec(
        "revenue",
        _concepts(
            "us-gaap",
            "RevenueFromContractWithCustomerExcludingAssessedTax",
            "Revenues",
            "SalesRevenueNet",
            "SalesRevenueGoodsNet",
        ),
        "USD",
        "duration",
    ),
    _MetricSpec(
        "gross_profit",
        _concepts("us-gaap", "GrossProfit"),
        "USD",
        "duration",
    ),
    _MetricSpec(
        "net_income",
        _concepts("us-gaap", "NetIncomeLoss", "ProfitLoss"),
        "USD",
        "duration",
    ),
    _MetricSpec(
        "diluted_eps",
        _concepts("us-gaap", "EarningsPerShareDiluted"),
        "USD/shares",
        "duration",
    ),
    _MetricSpec(
        "diluted_average_shares",
        _concepts("us-gaap", "WeightedAverageNumberOfDilutedSharesOutstanding"),
        "shares",
        "duration",
    ),
    _MetricSpec(
        "current_shares_outstanding",
        _concepts("dei", "EntityCommonStockSharesOutstanding"),
        "shares",
        "instant",
    ),
    _MetricSpec(
        "operating_cash_flow",
        _concepts("us-gaap", "NetCashProvidedByUsedInOperatingActivities"),
        "USD",
        "duration",
    ),
    _MetricSpec(
        "capital_expenditure",
        _concepts(
            "us-gaap",
            "PaymentsToAcquirePropertyPlantAndEquipment",
            "PaymentsToAcquireProductiveAssets",
        ),
        "USD",
        "duration",
        "absolute_value(reported_value)",
    ),
    _MetricSpec(
        "total_debt",
        _concepts(
            "us-gaap",
            "LongTermDebtAndFinanceLeaseObligations",
            "LongTermDebtAndCapitalLeaseObligations",
            "LongTermDebt",
        ),
        "USD",
        "instant",
    ),
    _MetricSpec(
        "cash_and_short_term_investments",
        _concepts(
            "us-gaap",
            "CashCashEquivalentsAndShortTermInvestments",
            "CashAndShortTermInvestments",
        ),
        "USD",
        "instant",
    ),
    _MetricSpec(
        "inventory",
        _concepts("us-gaap", "InventoryNet", "InventoryFinishedGoodsNetOfAllowances"),
        "USD",
        "instant",
    ),
    _MetricSpec(
        "receivables",
        _concepts(
            "us-gaap",
            "AccountsReceivableNetCurrent",
            "AccountsNotesAndLoansReceivableNetCurrent",
        ),
        "USD",
        "instant",
    ),
    _MetricSpec(
        "stockholders_equity",
        _concepts(
            "us-gaap",
            "StockholdersEquity",
            "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
        ),
        "USD",
        "instant",
    ),
    _MetricSpec(
        "total_assets",
        _concepts("us-gaap", "Assets"),
        "USD",
        "instant",
    ),
)

INTERNAL_METRICS = (
    _MetricSpec(
        "_debt_current",
        _concepts(
            "us-gaap",
            "LongTermDebtAndFinanceLeaseObligationsCurrent",
            "LongTermDebtCurrent",
        ),
        "USD",
        "instant",
    ),
    _MetricSpec(
        "_debt_noncurrent",
        _concepts(
            "us-gaap",
            "LongTermDebtAndFinanceLeaseObligationsNoncurrent",
            "LongTermDebtNoncurrent",
        ),
        "USD",
        "instant",
    ),
    _MetricSpec(
        "_cash",
        _concepts("us-gaap", "CashAndCashEquivalentsAtCarryingValue"),
        "USD",
        "instant",
    ),
    _MetricSpec(
        "_short_term_investments",
        _concepts(
            "us-gaap",
            "ShortTermInvestments",
            "MarketableSecuritiesCurrent",
        ),
        "USD",
        "instant",
    ),
)

OUTPUT_METRICS = tuple(spec.metric for spec in REPORTED_METRICS) + ("free_cash_flow",)


def normalize_company_facts(document: SecJsonDocument) -> NormalizationResult:
    """Normalize annual SEC Company Facts without discarding source-level evidence."""
    cik = _normalize_cik(document.payload.get("cik"))
    expected_url = f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json"
    if document.source_url != expected_url:
        raise SecDataError("Company Facts source_url must be the direct SEC CIK endpoint")
    if document.retrieved_at.tzinfo is None:
        raise SecDataError("Company Facts retrieval timestamp must be timezone-aware")

    raw_facts = document.payload.get("facts")
    if raw_facts is None:
        raw_facts = {}
    if not isinstance(raw_facts, Mapping):
        raise SecDataError("Company Facts payload field facts must be an object")

    warnings: list[NormalizationWarning] = []
    rejected: list[RejectedFact] = []
    normalized: dict[str, tuple[NormalizedFact, ...]] = {}

    for spec in (*REPORTED_METRICS, *INTERNAL_METRICS):
        candidates = _collect_candidates(
            spec,
            raw_facts,
            rejected,
            warnings,
        )
        normalized[spec.metric] = _select_candidates(
            spec,
            candidates,
            cik,
            document,
            warnings,
        )

    normalized["total_debt"] = _merge_reported_and_derived(
        normalized["total_debt"],
        _derive_sum(
            metric="total_debt",
            formula="total_debt = current_debt + noncurrent_debt",
            left=normalized["_debt_current"],
            right=normalized["_debt_noncurrent"],
        ),
    )
    normalized["cash_and_short_term_investments"] = _merge_reported_and_derived(
        normalized["cash_and_short_term_investments"],
        _derive_sum(
            metric="cash_and_short_term_investments",
            formula=(
                "cash_and_short_term_investments = cash_and_cash_equivalents "
                "+ short_term_investments"
            ),
            left=normalized["_cash"],
            right=normalized["_short_term_investments"],
        ),
    )
    normalized["free_cash_flow"] = _derive_free_cash_flow(
        normalized["operating_cash_flow"],
        normalized["capital_expenditure"],
    )

    for metric, required_parts in (
        ("free_cash_flow", ("operating_cash_flow", "capital_expenditure")),
        ("total_debt", ("_debt_current", "_debt_noncurrent")),
        (
            "cash_and_short_term_investments",
            ("_cash", "_short_term_investments"),
        ),
    ):
        if normalized[metric]:
            continue
        present_parts = [part for part in required_parts if normalized[part]]
        if present_parts:
            warnings.append(
                NormalizationWarning(
                    code="incomplete_calculation",
                    metric=metric,
                    fiscal_year=None,
                    message=(
                        f"{metric} was not calculated because only some required "
                        "source facts were available"
                    ),
                )
            )

    output_facts = {
        metric: normalized.get(metric, ())
        for metric in OUTPUT_METRICS
    }
    missing = tuple(metric for metric in OUTPUT_METRICS if not output_facts[metric])
    for metric in missing:
        warnings.append(
            NormalizationWarning(
                code="missing_metric",
                metric=metric,
                fiscal_year=None,
                message=f"No valid annual SEC fact was available for {metric}",
            )
        )

    return NormalizationResult(
        cik=cik,
        source_url=document.source_url,
        retrieved_at=document.retrieved_at,
        facts=output_facts,
        missing_metrics=missing,
        warnings=tuple(_deduplicate_warnings(warnings)),
        rejected_facts=tuple(rejected),
    )


def _collect_candidates(
    spec: _MetricSpec,
    raw_facts: Mapping[str, Any],
    rejected: list[RejectedFact],
    warnings: list[NormalizationWarning],
) -> list[_Candidate]:
    candidates: list[_Candidate] = []
    seen: set[tuple[Any, ...]] = set()
    for priority, concept in enumerate(spec.concepts):
        taxonomy_facts = raw_facts.get(concept.taxonomy)
        if not isinstance(taxonomy_facts, Mapping):
            continue
        concept_payload = taxonomy_facts.get(concept.name)
        if not isinstance(concept_payload, Mapping):
            continue
        units = concept_payload.get("units")
        if not isinstance(units, Mapping):
            continue

        for unit, unit_facts in units.items():
            if not isinstance(unit, str) or not isinstance(unit_facts, list):
                continue
            if unit != spec.unit:
                for raw_fact in unit_facts:
                    raw_value = raw_fact.get("val") if isinstance(raw_fact, Mapping) else None
                    rejected.append(
                        RejectedFact(
                            metric=spec.metric,
                            xbrl_concept=f"{concept.taxonomy}:{concept.name}",
                            unit=unit,
                            reason=f"expected unit {spec.unit}",
                            raw_value=raw_value,
                        )
                    )
                warnings.append(
                    NormalizationWarning(
                        code="conflicting_unit_rejected",
                        metric=spec.metric,
                        fiscal_year=None,
                        message=(
                            f"Rejected {concept.taxonomy}:{concept.name} facts in "
                            f"unit {unit}; expected {spec.unit}"
                        ),
                    )
                )
                continue

            for raw_fact in unit_facts:
                candidate = _candidate_from_raw(spec, concept, priority, unit, raw_fact)
                if candidate is None:
                    continue
                duplicate_key = (
                    candidate.concept,
                    candidate.unit,
                    candidate.raw_value,
                    candidate.period_start,
                    candidate.period_end,
                    candidate.filing_form,
                    candidate.filing_date,
                    candidate.accession_number,
                )
                if duplicate_key in seen:
                    continue
                seen.add(duplicate_key)
                candidates.append(candidate)
    return candidates


def _candidate_from_raw(
    spec: _MetricSpec,
    concept: _Concept,
    priority: int,
    unit: str,
    raw_fact: object,
) -> _Candidate | None:
    if not isinstance(raw_fact, Mapping):
        return None
    form = raw_fact.get("form")
    fiscal_period = raw_fact.get("fp")
    if form not in ANNUAL_FORMS or fiscal_period != "FY":
        return None

    period_end = raw_fact.get("end")
    filing_date = raw_fact.get("filed")
    if not isinstance(period_end, str) or not isinstance(filing_date, str):
        return None
    try:
        parsed_end = date.fromisoformat(period_end)
        date.fromisoformat(filing_date)
    except ValueError:
        return None

    period_start = raw_fact.get("start")
    if spec.period_kind == "duration":
        if not isinstance(period_start, str):
            return None
        try:
            parsed_start = date.fromisoformat(period_start)
        except ValueError:
            return None
        duration_days = (parsed_end - parsed_start).days
        if not MIN_ANNUAL_DURATION_DAYS <= duration_days <= MAX_ANNUAL_DURATION_DAYS:
            return None
    else:
        period_start = None

    value = raw_fact.get("val")
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    raw_value = float(value)
    if not math.isfinite(raw_value):
        return None
    normalized_value = (
        abs(raw_value)
        if spec.transformation == "absolute_value(reported_value)"
        else raw_value
    )
    accession = raw_fact.get("accn")
    if accession is not None and not isinstance(accession, str):
        accession = None

    return _Candidate(
        metric=spec.metric,
        concept=concept,
        concept_priority=priority,
        unit=unit,
        raw_value=raw_value,
        normalized_value=normalized_value,
        transformation=spec.transformation,
        period_start=period_start,
        period_end=period_end,
        fiscal_year=parsed_end.year,
        fiscal_period=fiscal_period,
        filing_form=form,
        filing_date=filing_date,
        accession_number=accession,
    )


def _select_candidates(
    spec: _MetricSpec,
    candidates: list[_Candidate],
    cik: str,
    document: SecJsonDocument,
    warnings: list[NormalizationWarning],
) -> tuple[NormalizedFact, ...]:
    by_period: dict[str, list[_Candidate]] = {}
    for candidate in candidates:
        by_period.setdefault(candidate.period_end, []).append(candidate)

    selected: list[NormalizedFact] = []
    for period_end, period_candidates in by_period.items():
        ordered = sorted(
            period_candidates,
            key=lambda candidate: (
                candidate.concept_priority,
                -int(candidate.filing_date.replace("-", "")),
                0 if candidate.filing_form == "10-K/A" else 1,
                candidate.accession_number or "",
            ),
        )
        chosen = ordered[0]
        same_concept = [
            candidate
            for candidate in period_candidates
            if candidate.concept == chosen.concept
        ]
        if len({candidate.normalized_value for candidate in same_concept}) > 1:
            warnings.append(
                NormalizationWarning(
                    code="restated_fact_selected",
                    metric=spec.metric,
                    fiscal_year=chosen.fiscal_year,
                    message=(
                        "Selected the latest-filed value for a period with differing "
                        "reported values"
                    ),
                )
            )
        other_concepts = [
            candidate
            for candidate in period_candidates
            if candidate.concept != chosen.concept
            and candidate.normalized_value != chosen.normalized_value
        ]
        if other_concepts:
            warnings.append(
                NormalizationWarning(
                    code="alternative_concept_conflict",
                    metric=spec.metric,
                    fiscal_year=chosen.fiscal_year,
                    message=(
                        "Multiple XBRL concepts reported different values; selected "
                        "the configured higher-priority concept"
                    ),
                )
            )
        if chosen.filing_form == "10-K/A":
            warnings.append(
                NormalizationWarning(
                    code="amended_filing_selected",
                    metric=spec.metric,
                    fiscal_year=chosen.fiscal_year,
                    message="Selected the latest annual fact from a 10-K amendment",
                )
            )

        evidence = _evidence_reference(chosen, cik, document)
        selected.append(
            NormalizedFact(
                metric=spec.metric,
                fiscal_year=chosen.fiscal_year,
                fiscal_period=chosen.fiscal_period,
                period_start=chosen.period_start,
                period_end=period_end,
                unit=chosen.unit,
                value=chosen.normalized_value,
                quality="reported",
                evidence=(evidence,),
            )
        )

    return tuple(sorted(selected, key=lambda fact: fact.period_end, reverse=True))


def _evidence_reference(
    candidate: _Candidate,
    cik: str,
    document: SecJsonDocument,
) -> EvidenceReference:
    qualified_concept = f"{candidate.concept.taxonomy}:{candidate.concept.name}"
    fingerprint = "|".join(
        (
            cik,
            candidate.accession_number or "",
            qualified_concept,
            candidate.unit,
            candidate.period_end,
            repr(candidate.raw_value),
            repr(candidate.normalized_value),
        )
    )
    evidence_id = "sec_" + hashlib.sha256(fingerprint.encode("utf-8")).hexdigest()[:24]
    return EvidenceReference(
        evidence_id=evidence_id,
        provider=PROVIDER,
        cik=cik,
        accession_number=candidate.accession_number,
        filing_form=candidate.filing_form,
        filing_date=candidate.filing_date,
        fiscal_period=candidate.fiscal_period,
        xbrl_concept=qualified_concept,
        unit=candidate.unit,
        raw_value=candidate.raw_value,
        normalized_value=candidate.normalized_value,
        transformation=candidate.transformation,
        source_url=document.source_url,
        retrieved_at=document.retrieved_at,
    )


def _derive_sum(
    *,
    metric: str,
    formula: str,
    left: tuple[NormalizedFact, ...],
    right: tuple[NormalizedFact, ...],
) -> tuple[NormalizedFact, ...]:
    return _derive_binary(metric, formula, left, right, lambda a, b: a + b)


def _derive_free_cash_flow(
    operating_cash_flow: tuple[NormalizedFact, ...],
    capital_expenditure: tuple[NormalizedFact, ...],
) -> tuple[NormalizedFact, ...]:
    return _derive_binary(
        "free_cash_flow",
        "free_cash_flow = operating_cash_flow - abs(capital_expenditure)",
        operating_cash_flow,
        capital_expenditure,
        lambda operating, capex: operating - abs(capex),
    )


def _derive_binary(
    metric: str,
    formula: str,
    left: tuple[NormalizedFact, ...],
    right: tuple[NormalizedFact, ...],
    operation: Callable[[float, float], float],
) -> tuple[NormalizedFact, ...]:
    left_by_end = {fact.period_end: fact for fact in left}
    right_by_end = {fact.period_end: fact for fact in right}
    results: list[NormalizedFact] = []
    for period_end in sorted(left_by_end.keys() & right_by_end.keys(), reverse=True):
        left_fact = left_by_end[period_end]
        right_fact = right_by_end[period_end]
        if left_fact.unit != right_fact.unit:
            continue
        if (
            left_fact.period_start is not None
            and right_fact.period_start is not None
            and left_fact.period_start != right_fact.period_start
        ):
            continue
        value = float(operation(left_fact.value, right_fact.value))
        if not math.isfinite(value):
            continue
        evidence = tuple(
            replace(
                reference,
                transformation=(
                    f"{formula}; source transformation: {reference.transformation}"
                ),
            )
            for reference in (*left_fact.evidence, *right_fact.evidence)
        )
        results.append(
            NormalizedFact(
                metric=metric,
                fiscal_year=date.fromisoformat(period_end).year,
                fiscal_period="FY",
                period_start=left_fact.period_start or right_fact.period_start,
                period_end=period_end,
                unit=left_fact.unit,
                value=value,
                quality="calculated",
                evidence=evidence,
            )
        )
    return tuple(results)


def _merge_reported_and_derived(
    reported: tuple[NormalizedFact, ...],
    derived: tuple[NormalizedFact, ...],
) -> tuple[NormalizedFact, ...]:
    by_end = {fact.period_end: fact for fact in derived}
    by_end.update({fact.period_end: fact for fact in reported})
    return tuple(sorted(by_end.values(), key=lambda fact: fact.period_end, reverse=True))


def _deduplicate_warnings(
    warnings: list[NormalizationWarning],
) -> list[NormalizationWarning]:
    result: list[NormalizationWarning] = []
    seen: set[tuple[str, str, int | None, str]] = set()
    for warning in warnings:
        key = (warning.code, warning.metric, warning.fiscal_year, warning.message)
        if key not in seen:
            seen.add(key)
            result.append(warning)
    return result


def _normalize_cik(value: object) -> str:
    if isinstance(value, bool):
        raise SecDataError("Company Facts CIK must be numeric")
    text = str(value).strip()
    if not text.isdigit() or len(text) > 10:
        raise SecDataError("Company Facts CIK must contain at most 10 digits")
    return text.zfill(10)
