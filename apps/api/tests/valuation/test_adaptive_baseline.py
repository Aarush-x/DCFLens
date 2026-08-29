from __future__ import annotations

from datetime import datetime, timezone

import pytest

from app.data.sec.models import (
    EvidenceReference,
    NormalizationResult,
    NormalizedFact,
)
from app.valuation import (
    CompanyProfile,
    DcfInput,
    SensitivityConfig,
    calculate_dcf,
    derive_adaptive_baseline,
)
from app.valuation.priors import load_prior_config


RETRIEVED_AT = datetime(2026, 8, 29, tzinfo=timezone.utc)
SOURCE_URL = "https://data.sec.gov/api/xbrl/companyfacts/CIK0000000001.json"


def _evidence(metric: str, year: int, value: float) -> EvidenceReference:
    return EvidenceReference(
        evidence_id=f"sec_{metric}_{year}",
        provider="SEC EDGAR",
        cik="0000000001",
        accession_number=f"0000000001-{year % 100:02d}-000001",
        filing_form="10-K",
        filing_date=f"{year + 1}-02-15",
        fiscal_period="FY",
        xbrl_concept=f"test:{metric}",
        unit="USD",
        raw_value=value,
        normalized_value=value,
        transformation="reported_value",
        source_url=SOURCE_URL,
        retrieved_at=RETRIEVED_AT,
    )


def _series(metric: str, values: list[float]) -> tuple[NormalizedFact, ...]:
    facts = []
    for offset, value in enumerate(values):
        year = 2020 + offset
        facts.append(
            NormalizedFact(
                metric=metric,
                fiscal_year=year,
                fiscal_period="FY",
                period_start=f"{year}-01-01",
                period_end=f"{year}-12-31",
                unit="USD",
                value=value,
                quality="calculated" if metric == "free_cash_flow" else "reported",
                evidence=(_evidence(metric, year, value),),
            )
        )
    return tuple(reversed(facts))


def _normalized(
    *,
    fcf: list[float] | None,
    revenue: list[float] | None,
    debt: float | None = 200.0,
    cash: float | None = 50.0,
) -> NormalizationResult:
    facts: dict[str, tuple[NormalizedFact, ...]] = {}
    if fcf is not None:
        facts["free_cash_flow"] = _series("free_cash_flow", fcf)
    if revenue is not None:
        facts["revenue"] = _series("revenue", revenue)
    if debt is not None:
        facts["total_debt"] = _series("total_debt", [debt])
    if cash is not None:
        facts["cash_and_short_term_investments"] = _series(
            "cash_and_short_term_investments", [cash]
        )
    missing = tuple(
        metric
        for metric in ("free_cash_flow", "revenue")
        if metric not in facts
    )
    return NormalizationResult(
        cik="0000000001",
        source_url=SOURCE_URL,
        retrieved_at=RETRIEVED_AT,
        facts=facts,
        missing_metrics=missing,
        warnings=(),
        rejected_facts=(),
    )


def test_mature_business_gets_traced_maturity_adjustment() -> None:
    result = derive_adaptive_baseline(
        CompanyProfile(sic_code=3550, years_public=42),
        _normalized(fcf=[80.0, 86.0, 91.0, 96.0], revenue=[800.0, 830.0, 860.0, 900.0]),
    )

    trace = result.trace_for("stage_one_growth_rate")
    maturity = next(item for item in trace.company_modifiers if item.name == "company_maturity")
    assert result.classification.sector == "industrials"
    assert maturity.value < 0.0
    assert trace.final_baseline == result.assumptions.stage_one_growth_rate
    assert trace.raw_observations
    assert trace.weights
    assert trace.bounds_applied
    assert trace.evidence_references
    assert 0.0 <= trace.data_coverage_confidence <= 1.0
    assert 0.0 <= trace.stability_confidence <= 1.0
    assert trace.plain_english_explanation
    assert "weighted_blend=" in trace.technical_explanation


def test_high_growth_technology_company_uses_bounded_adaptive_growth() -> None:
    result = derive_adaptive_baseline(
        CompanyProfile(sic_code=7372, years_public=5),
        _normalized(fcf=[20.0, 32.0, 50.0, 78.0], revenue=[100.0, 140.0, 195.0, 270.0]),
    )

    assert result.classification.sector == "technology"
    assert result.assumptions.stage_one_growth_rate > 0.15
    assert result.assumptions.stage_one_growth_rate <= 0.30
    assert result.assumptions.terminal_growth_rate < result.assumptions.stage_two_growth_rate
    assert result.assumptions.stage_two_growth_rate < result.assumptions.stage_one_growth_rate


@pytest.mark.parametrize(
    ("sic_code", "sector", "business_type"),
    [
        (5411, "retail", "retailer"),
        (6021, "financials", "financial institution"),
        (4911, "utilities", "regulated or infrastructure utility"),
    ],
)
def test_sector_and_business_type_classification(
    sic_code: int, sector: str, business_type: str
) -> None:
    result = derive_adaptive_baseline(
        CompanyProfile(sic_code=sic_code, years_public=25),
        _normalized(fcf=[100.0, 104.0, 108.0], revenue=[1000.0, 1030.0, 1060.0]),
    )

    assert result.classification.sector == sector
    assert result.classification.business_type == business_type
    assert result.classification.method == "sic_code"
    if sector == "utilities":
        assert result.assumptions.stage_one_growth_rate <= 0.10


def test_extreme_historical_growth_is_capped_and_recorded() -> None:
    result = derive_adaptive_baseline(
        CompanyProfile(sic_code=7372, years_public=4),
        _normalized(fcf=[1.0, 10_000.0], revenue=[10.0, 2_000.0]),
    )

    trace = result.trace_for("stage_one_growth_rate")
    assert result.assumptions.stage_one_growth_rate <= 0.30
    assert any(bound.was_applied for bound in trace.bounds_applied)
    assert any(bound.name == "historical_fcf_growth_cap" for bound in trace.bounds_applied)


def test_missing_fcf_uses_explicit_fallback_and_lower_coverage() -> None:
    result = derive_adaptive_baseline(
        CompanyProfile(sic_description="Retail Stores", years_public=18),
        _normalized(fcf=None, revenue=[500.0, 525.0, 550.0]),
    )

    stage_one = result.trace_for("stage_one_growth_rate")
    discount = result.trace_for("discount_rate")
    assert result.classification.sector == "retail"
    assert any("historical FCF growth omitted" in item for item in stage_one.fallbacks)
    assert stage_one.data_coverage_confidence < 1.0
    assert stage_one.stability_confidence == pytest.approx(0.25)
    assert any(item.name == "fcf_state" and item.value > 0 for item in discount.company_modifiers)


def test_volatile_fcf_reduces_weight_and_increases_discount_rate() -> None:
    facts = _normalized(
        fcf=[100.0, -60.0, 180.0, 25.0, 190.0],
        revenue=[700.0, 735.0, 760.0, 800.0, 835.0],
    )
    result = derive_adaptive_baseline(
        CompanyProfile(sic_code=3550, years_public=15), facts
    )

    stage_one = result.trace_for("stage_one_growth_rate")
    discount = result.trace_for("discount_rate")
    fcf_weight = next(item for item in stage_one.weights if item.signal == "historical_fcf_growth")
    stability_premium = next(
        item for item in discount.company_modifiers if item.name == "cash_flow_stability_premium"
    )
    assert stage_one.stability_confidence < 0.5
    assert fcf_weight.effective_weight < fcf_weight.target_weight
    assert stability_premium.value > 0.0


@pytest.mark.parametrize(
    ("fcf_values", "expected_state"),
    [([-30.0, -10.0, -5.0], "negative"), ([-30.0, -5.0, 12.0], "newly_positive")],
)
def test_non_positive_fcf_states_do_not_infer_percentage_growth(
    fcf_values: list[float], expected_state: str
) -> None:
    result = derive_adaptive_baseline(
        CompanyProfile(sic_code=7372, years_public=8),
        _normalized(fcf=fcf_values, revenue=[100.0, 115.0, 130.0]),
    )

    observation = result.trace_for("stage_one_growth_rate").raw_observations[0]
    assert observation.status == expected_state
    assert observation.value is None


def test_recovered_fcf_uses_latest_contiguous_positive_run() -> None:
    result = derive_adaptive_baseline(
        CompanyProfile(sic_code=7372, years_public=11),
        _normalized(
            fcf=[-30.0, -5.0, 12.0, 18.0],
            revenue=[100.0, 115.0, 130.0, 145.0],
        ),
    )

    observation = result.trace_for("stage_one_growth_rate").raw_observations[0]
    assert observation.status == "available"
    assert observation.value == pytest.approx(0.5)


def test_all_rates_have_assumption_traces_and_discount_spread() -> None:
    result = derive_adaptive_baseline(
        CompanyProfile(business_description="cloud software platform", years_public=12),
        _normalized(fcf=[70.0, 82.0, 95.0], revenue=[600.0, 690.0, 790.0]),
    )

    assert tuple(trace.assumption for trace in result.traces) == (
        "stage_one_growth_rate",
        "stage_two_growth_rate",
        "terminal_growth_rate",
        "discount_rate",
    )
    assert result.assumptions.discount_rate - result.assumptions.terminal_growth_rate >= 0.02
    for trace in result.traces:
        assert trace.sector_prior.version == result.prior_version
        assert trace.plain_english_explanation
        assert trace.technical_explanation
        assert 0.0 <= trace.data_coverage_confidence <= 1.0
        assert 0.0 <= trace.stability_confidence <= 1.0


def test_adaptive_baseline_is_deterministic() -> None:
    profile = CompanyProfile(sic_code=4911, years_public=30)
    normalized = _normalized(
        fcf=[200.0, 210.0, 219.0],
        revenue=[1800.0, 1840.0, 1890.0],
        debt=900.0,
        cash=150.0,
    )

    first = derive_adaptive_baseline(profile, normalized)
    second = derive_adaptive_baseline(profile, normalized)

    assert first == second
    assert first.to_dict() == second.to_dict()
    assert load_prior_config().version == "sector-priors-1.0.0"


def test_adaptive_assumptions_feed_the_pure_dcf_engine() -> None:
    baseline = derive_adaptive_baseline(
        CompanyProfile(sic_code=4911, years_public=30),
        _normalized(
            fcf=[200.0, 210.0, 219.0],
            revenue=[1800.0, 1840.0, 1890.0],
            debt=900.0,
            cash=150.0,
        ),
    )

    valuation = calculate_dcf(
        DcfInput(
            starting_free_cash_flow=219.0,
            net_debt=750.0,
            diluted_shares=100.0,
            currency="USD",
            historical_free_cash_flows=(200.0, 210.0, 219.0),
        ),
        baseline.assumptions,
        SensitivityConfig(growth_rate_delta=0.005, discount_rate_delta=0.005),
    )

    assert valuation.assumptions == baseline.assumptions
    assert valuation.sensitivity_interval.is_probability_interval is False
