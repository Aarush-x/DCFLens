from __future__ import annotations

from dataclasses import FrozenInstanceError, replace
from datetime import datetime, timezone

import pytest

from app.checklist import (
    ORIGINAL_CHECKLIST,
    ChecklistInput,
    ChecklistInputError,
    ChecklistStatus,
    FilingEvidenceReference,
    QualitativeChecklistFacts,
    evaluate_checklist,
)
from app.data.sec.models import (
    EvidenceReference,
    NormalizationResult,
    NormalizedFact,
)


RETRIEVED_AT = datetime(2026, 8, 29, tzinfo=timezone.utc)
SOURCE_URL = "https://data.sec.gov/api/xbrl/companyfacts/CIK0000000001.json"
EXPECTED_CHECKLIST = (
    "Gross Profit Margin > 20%: Higher the margin, higher is the evidence of a sustainable moat",
    "Revenue Growth: In line with the gross profit growth",
    "EPS: Consistent with Net Profits (check for dilution)",
    "Debt Level: Company should not be highly leveraged",
    "Inventory: Check for growing inventory along with PAT margin (manufacturing)",
    "Sales vs Receivables: Revenue should be backed by cash collections, not just receivables",
    "Cash flow from operations: Must be positive",
    "Return on Equity > 25%",
    "Business Diversity: Prefer 1 or 2 simple business lines",
    "Subsidiaries: Not too many (check for siphoning risk)",
)


def _evidence(metric: str, year: int, value: float) -> EvidenceReference:
    unit = "USD"
    if metric == "diluted_eps":
        unit = "USD/shares"
    elif metric == "diluted_average_shares":
        unit = "shares"
    return EvidenceReference(
        evidence_id=f"sec_{metric}_{year}",
        provider="SEC EDGAR",
        cik="0000000001",
        accession_number=f"0000000001-{year % 100:02d}-000001",
        filing_form="10-K",
        filing_date=f"{year + 1}-02-15",
        fiscal_period="FY",
        xbrl_concept=f"test:{metric}",
        unit=unit,
        raw_value=value,
        normalized_value=value,
        transformation="reported_value",
        source_url=SOURCE_URL,
        retrieved_at=RETRIEVED_AT,
    )


def _series(metric: str, values: list[float]) -> tuple[NormalizedFact, ...]:
    facts = []
    for offset, value in enumerate(values):
        year = 2023 + offset
        evidence = _evidence(metric, year, value)
        facts.append(
            NormalizedFact(
                metric=metric,
                fiscal_year=year,
                fiscal_period="FY",
                period_start=f"{year}-01-01",
                period_end=f"{year}-12-31",
                unit=evidence.unit,
                value=value,
                quality="reported",
                evidence=(evidence,),
            )
        )
    return tuple(reversed(facts))


def _normalized(
    overrides: dict[str, list[float] | None] | None = None,
) -> NormalizationResult:
    values: dict[str, list[float] | None] = {
        "revenue": [1000.0, 1100.0],
        "gross_profit": [400.0, 450.0],
        "net_income": [100.0, 115.0],
        "diluted_eps": [2.0, 2.25],
        "diluted_average_shares": [50.0, 51.0],
        "total_debt": [200.0, 200.0],
        "cash_and_short_term_investments": [90.0, 100.0],
        "free_cash_flow": [90.0, 100.0],
        "total_assets": [1000.0, 1100.0],
        "inventory": [80.0, 86.0],
        "receivables": [100.0, 108.0],
        "operating_cash_flow": [130.0, 145.0],
        "stockholders_equity": [350.0, 380.0],
    }
    values.update(overrides or {})
    facts = {
        metric: _series(metric, observations)
        for metric, observations in values.items()
        if observations is not None
    }
    missing = tuple(metric for metric, observations in values.items() if observations is None)
    return NormalizationResult(
        cik="0000000001",
        source_url=SOURCE_URL,
        retrieved_at=RETRIEVED_AT,
        facts=facts,
        missing_metrics=missing,
        warnings=(),
        rejected_facts=(),
    )


def _filing_evidence(name: str, locator: str) -> FilingEvidenceReference:
    return FilingEvidenceReference(
        evidence_id=f"filing_{name}",
        provider="SEC EDGAR",
        cik="0000000001",
        accession_number="0000000001-25-000001",
        filing_form="10-K",
        filing_date="2025-02-15",
        source_url="https://www.sec.gov/Archives/edgar/data/1/filing.htm",
        locator=locator,
        description=name,
        retrieved_at=RETRIEVED_AT,
    )


def _qualitative(
    *, business_lines: tuple[str, ...] = ("Products", "Services"), subsidiaries: int = 5
) -> QualitativeChecklistFacts:
    return QualitativeChecklistFacts(
        business_line_count=len(business_lines),
        business_lines=business_lines,
        business_diversity_evidence=(_filing_evidence("business_lines", "Item 1"),),
        subsidiary_count=subsidiaries,
        subsidiaries_evidence=(_filing_evidence("subsidiaries", "Exhibit 21"),),
    )


def _evaluate(
    sector: str,
    business_type: str,
    *,
    overrides: dict[str, list[float] | None] | None = None,
    qualitative: QualitativeChecklistFacts | None = None,
):
    return evaluate_checklist(
        ChecklistInput(
            normalized_facts=_normalized(overrides),
            sector=sector,
            business_type=business_type,
            qualitative=qualitative or _qualitative(),
        )
    )


def test_original_ten_items_and_order_are_locked() -> None:
    assert len(ORIGINAL_CHECKLIST) == 10
    assert tuple(item.number for item in ORIGINAL_CHECKLIST) == tuple(range(1, 11))
    assert tuple(item.text for item in ORIGINAL_CHECKLIST) == EXPECTED_CHECKLIST

    with pytest.raises(FrozenInstanceError):
        ORIGINAL_CHECKLIST[0].text = "renamed"  # type: ignore[misc]


def test_evaluation_preserves_contract_and_has_no_aggregate_score() -> None:
    evaluation = _evaluate("technology", "software platform")

    assert tuple(result.checklist_number for result in evaluation.results) == tuple(
        range(1, 11)
    )
    assert tuple(result.checklist_text for result in evaluation.results) == EXPECTED_CHECKLIST
    assert not hasattr(evaluation, "score")
    assert not hasattr(evaluation, "recommendation")
    assert set(ChecklistStatus) == {
        ChecklistStatus.SUPPORTS,
        ChecklistStatus.WEAKENS,
        ChecklistStatus.MONITOR,
        ChecklistStatus.UNKNOWN,
        ChecklistStatus.NOT_APPLICABLE,
    }
    for result in evaluation.results:
        assert result.plain_english_explanation
        assert result.technical_explanation
        assert result.applicability_reason
        assert result.sector_context
        assert result.potential_valuation_relevance


def test_technology_example_keeps_margin_and_roe_but_excludes_inventory() -> None:
    evaluation = _evaluate(
        "technology",
        "software platform",
        overrides={"inventory": None},
    )

    assert evaluation.results[0].status == ChecklistStatus.SUPPORTS
    assert evaluation.results[4].status == ChecklistStatus.NOT_APPLICABLE
    assert evaluation.results[7].status == ChecklistStatus.SUPPORTS
    assert evaluation.results[0].metrics_used[0].name == "gross_profit_margin"
    assert evaluation.results[0].evidence_references


def test_retail_example_evaluates_inventory_and_cash_collection() -> None:
    evaluation = _evaluate("retail", "multi-store retailer")

    assert evaluation.results[4].status == ChecklistStatus.SUPPORTS
    assert evaluation.results[5].status == ChecklistStatus.SUPPORTS
    assert {metric.name for metric in evaluation.results[4].metrics_used} >= {
        "inventory_growth",
        "latest_pat_margin",
    }


def test_banking_example_adapts_only_applicability_and_context() -> None:
    evaluation = _evaluate(
        "banking",
        "deposit-taking bank",
        overrides={"gross_profit": None, "inventory": None, "receivables": None},
    )

    assert len(evaluation.results) == 10
    assert evaluation.results[0].status == ChecklistStatus.UNKNOWN
    assert evaluation.results[3].status == ChecklistStatus.NOT_APPLICABLE
    assert evaluation.results[4].status == ChecklistStatus.NOT_APPLICABLE
    assert evaluation.results[5].status == ChecklistStatus.NOT_APPLICABLE
    assert evaluation.results[6].status == ChecklistStatus.SUPPORTS
    assert evaluation.results[7].status == ChecklistStatus.SUPPORTS
    assert "regulatory-capital" in evaluation.results[3].plain_english_explanation
    assert "Bank ROE" in evaluation.results[7].sector_context


def test_healthcare_example_treats_inventory_as_applicable() -> None:
    evaluation = _evaluate("healthcare", "medical products manufacturer")

    assert evaluation.results[4].status != ChecklistStatus.NOT_APPLICABLE
    assert "material operating" in evaluation.results[4].sector_context


def test_industrial_example_flags_inventory_growth_with_falling_pat_margin() -> None:
    evaluation = _evaluate(
        "industrials",
        "industrial manufacturer",
        overrides={
            "revenue": [500.0, 525.0],
            "inventory": [100.0, 160.0],
            "net_income": [50.0, 40.0],
        },
    )

    result = evaluation.results[4]
    assert result.status == ChecklistStatus.WEAKENS
    assert result.evidence_references
    assert "working capital" in result.potential_valuation_relevance


def test_utility_example_excludes_absent_inventory_but_not_other_items() -> None:
    evaluation = _evaluate(
        "utilities",
        "regulated electric utility",
        overrides={"inventory": None},
    )

    assert evaluation.results[4].status == ChecklistStatus.NOT_APPLICABLE
    assert evaluation.results[3].status in {
        ChecklistStatus.SUPPORTS,
        ChecklistStatus.MONITOR,
        ChecklistStatus.WEAKENS,
    }
    assert "Regulated returns" in evaluation.results[3].sector_context


def test_missing_numeric_facts_are_unknown_not_zero_or_not_applicable() -> None:
    evaluation = _evaluate(
        "retail",
        "retailer",
        overrides={"gross_profit": None, "operating_cash_flow": None},
    )

    assert evaluation.results[0].status == ChecklistStatus.UNKNOWN
    assert evaluation.results[6].status == ChecklistStatus.UNKNOWN
    assert evaluation.results[6].metrics_used == ()
    assert "latest annual operating cash flow" in evaluation.results[6].missing_information


def test_roe_discloses_negative_equity_distortion() -> None:
    evaluation = _evaluate(
        "healthcare",
        "healthcare services company",
        overrides={"stockholders_equity": [-50.0, -70.0]},
    )

    result = evaluation.results[7]
    assert result.status == ChecklistStatus.MONITOR
    assert "not positive" in result.plain_english_explanation
    assert "misleading ROE" in result.technical_explanation


def test_single_period_roe_monitors_instead_of_claiming_support_or_weakness() -> None:
    evaluation = _evaluate(
        "retail",
        "retailer",
        overrides={
            "net_income": [40.0],
            "stockholders_equity": [400.0],
        },
    )

    result = evaluation.results[7]
    assert result.status == ChecklistStatus.MONITOR
    assert "prior stockholders' equity" in result.missing_information[0]


def test_inconsistent_qualitative_count_is_rejected() -> None:
    with pytest.raises(ChecklistInputError, match="must match"):
        _evaluate(
            "technology",
            "software platform",
            qualitative=QualitativeChecklistFacts(
                business_line_count=3,
                business_lines=("Products", "Services"),
                business_diversity_evidence=(
                    _filing_evidence("business_lines", "Item 1"),
                ),
            ),
        )


def test_qualitative_evidence_rejects_non_sec_url() -> None:
    invalid_evidence = replace(
        _filing_evidence("business_lines", "Item 1"),
        source_url="https://example.com/report",
    )
    with pytest.raises(ChecklistInputError, match="direct HTTPS SEC URL"):
        _evaluate(
            "technology",
            "software platform",
            qualitative=QualitativeChecklistFacts(
                business_line_count=2,
                business_lines=("Products", "Services"),
                business_diversity_evidence=(invalid_evidence,),
            ),
        )


def test_many_subsidiaries_monitor_without_accusing_misconduct() -> None:
    evaluation = _evaluate(
        "industrials",
        "industrial manufacturer",
        qualitative=_qualitative(subsidiaries=75),
    )

    result = evaluation.results[9]
    assert result.status == ChecklistStatus.MONITOR
    assert "not evidence of siphoning or misconduct" in result.plain_english_explanation
    assert result.evidence_references[0].locator == "Exhibit 21"


def test_qualitative_count_without_evidence_is_unknown() -> None:
    evaluation = _evaluate(
        "technology",
        "software platform",
        qualitative=QualitativeChecklistFacts(
            business_line_count=2,
            subsidiary_count=4,
        ),
    )

    assert evaluation.results[8].status == ChecklistStatus.UNKNOWN
    assert evaluation.results[9].status == ChecklistStatus.UNKNOWN
    assert "Item 1 or segment-disclosure evidence" in evaluation.results[8].missing_information
    assert "Exhibit 21" in evaluation.results[9].missing_information[0]
