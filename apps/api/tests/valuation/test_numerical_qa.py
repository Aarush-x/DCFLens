"""Numerical robustness and deterministic property probes."""
import json
import random
from dataclasses import replace

import pytest

from app.valuation import calculate_dcf, DcfInput, DcfAssumptions, SensitivityConfig
from app.valuation.adaptive import CompanyProfile, derive_adaptive_baseline, AdaptiveBaselineError
from tests.ai.test_service import _normalized


def test_extreme_finite_history_produces_finite_stability_statistics():
    result = calculate_dcf(
        DcfInput(100, 0, 10, "USD", (-1e308, 1e308)),
        DcfAssumptions(5, 5, .1, .05, .02, .1), SensitivityConfig(.005, .005),
    )
    json.dumps(result.to_dict(), allow_nan=False)
    assert result.fcf_stability.mean_absolute_free_cash_flow == pytest.approx(1e308)
    assert result.fcf_stability.normalized_range == pytest.approx(2)


def test_extreme_adaptive_history_is_finite_or_explicitly_rejected():
    normalized = _normalized()
    facts = dict(normalized.facts)
    facts["free_cash_flow"] = tuple(
        replace(fact, value=value)
        for fact, value in zip(facts["free_cash_flow"], (1e308, 1e-308))
    )
    try:
        result = derive_adaptive_baseline(CompanyProfile(sic_code=3571), replace(normalized, facts=facts))
    except AdaptiveBaselineError:
        return
    json.dumps(result.to_dict(), allow_nan=False)


def test_seeded_dcf_invariants_across_100_cases():
    rng = random.Random(20260830)
    for _ in range(100):
        inputs = DcfInput(rng.uniform(-1e6, 1e6), rng.uniform(-1e6, 1e6), rng.uniform(1, 1e5), "USD")
        assumptions = DcfAssumptions(rng.randint(1, 10), rng.randint(1, 10), rng.uniform(-.2, .3), rng.uniform(-.1, .1), .02, rng.uniform(.07, .2))
        result = calculate_dcf(inputs, assumptions, SensitivityConfig(.005, .005))
        assert result == calculate_dcf(inputs, assumptions, SensitivityConfig(.005, .005))
        d = result.decomposition
        assert d.enterprise_value == pytest.approx(d.present_value_projected_cash_flows + d.present_value_terminal_value)
        assert d.equity_value == pytest.approx(d.enterprise_value - inputs.net_debt)
        assert result.intrinsic_value_per_share == pytest.approx(d.equity_value / inputs.diluted_shares)
        assert result.sensitivity_interval.lower_bound_per_share <= result.intrinsic_value_per_share <= result.sensitivity_interval.upper_bound_per_share
        assert not result.sensitivity_interval.is_probability_interval
        json.dumps(result.to_dict(), allow_nan=False)
