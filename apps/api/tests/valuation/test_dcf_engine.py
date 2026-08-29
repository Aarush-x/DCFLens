import json
import math
from typing import cast

import pytest

from app.valuation import (
    DcfAssumptions,
    DcfInput,
    DcfValidationError,
    SensitivityConfig,
    calculate_dcf,
)


REFERENCE_ASSUMPTIONS = DcfAssumptions(
    stage_one_years=5,
    stage_two_years=5,
    stage_one_growth_rate=0.18,
    stage_two_growth_rate=0.10,
    terminal_growth_rate=0.03,
    discount_rate=0.09,
)
SENSITIVITY = SensitivityConfig(
    growth_rate_delta=0.005,
    discount_rate_delta=0.005,
)


def test_standard_positive_fcf_business_has_complete_decomposition() -> None:
    result = calculate_dcf(
        DcfInput(
            starting_free_cash_flow=100.0,
            net_debt=250.0,
            diluted_shares=50.0,
            currency="USD",
            historical_free_cash_flows=(80.0, 90.0, 100.0),
        ),
        REFERENCE_ASSUMPTIONS,
        SENSITIVITY,
    )

    assert len(result.projected_cash_flows) == 10
    assert [item.stage for item in result.projected_cash_flows] == [1] * 5 + [2] * 5
    assert result.projected_cash_flows[0].free_cash_flow == pytest.approx(118.0)
    assert result.projected_cash_flows[0].discount_factor == pytest.approx(1.09)
    assert result.projected_cash_flows[0].present_value == pytest.approx(118.0 / 1.09)
    assert result.decomposition.present_value_stage_one > 0.0
    assert result.decomposition.present_value_stage_two > 0.0
    assert result.decomposition.present_value_projected_cash_flows == pytest.approx(
        result.decomposition.present_value_stage_one
        + result.decomposition.present_value_stage_two
    )
    assert result.decomposition.enterprise_value == pytest.approx(
        result.decomposition.present_value_projected_cash_flows
        + result.decomposition.present_value_terminal_value
    )
    assert result.decomposition.equity_value == pytest.approx(
        result.decomposition.enterprise_value - 250.0
    )
    assert result.intrinsic_value_per_share == pytest.approx(
        result.decomposition.equity_value / 50.0
    )
    assert result.units.per_share_value == "USD/share"
    json.dumps(result.to_dict())


def test_identical_inputs_produce_identical_machine_output() -> None:
    inputs = DcfInput(100.0, 50.0, 25.0, "USD", (80.0, 90.0, 100.0))

    first = calculate_dcf(inputs, REFERENCE_ASSUMPTIONS, SENSITIVITY)
    second = calculate_dcf(inputs, REFERENCE_ASSUMPTIONS, SENSITIVITY)

    assert first == second
    assert first.to_dict() == second.to_dict()


def test_configurable_stage_durations_control_projection_boundaries() -> None:
    assumptions = DcfAssumptions(
        stage_one_years=2,
        stage_two_years=3,
        stage_one_growth_rate=0.12,
        stage_two_growth_rate=0.04,
        terminal_growth_rate=0.02,
        discount_rate=0.09,
    )
    result = calculate_dcf(
        DcfInput(100.0, 0.0, 10.0, "USD"),
        assumptions,
        SENSITIVITY,
    )

    assert [item.year for item in result.projected_cash_flows] == [1, 2, 3, 4, 5]
    assert [item.stage for item in result.projected_cash_flows] == [1, 1, 2, 2, 2]
    assert result.projected_cash_flows[2].growth_rate == pytest.approx(0.04)


def test_negative_net_debt_adds_net_cash_to_equity_value() -> None:
    no_debt = calculate_dcf(
        DcfInput(100.0, 0.0, 10.0, "USD"),
        REFERENCE_ASSUMPTIONS,
        SENSITIVITY,
    )
    net_cash = calculate_dcf(
        DcfInput(100.0, -300.0, 10.0, "USD"),
        REFERENCE_ASSUMPTIONS,
        SENSITIVITY,
    )

    assert net_cash.decomposition.net_debt_adjustment == pytest.approx(300.0)
    assert net_cash.decomposition.equity_value == pytest.approx(
        no_debt.decomposition.equity_value + 300.0
    )
    assert net_cash.intrinsic_value_per_share == pytest.approx(
        no_debt.intrinsic_value_per_share + 30.0
    )


@pytest.mark.parametrize("shares", [None, 0.0, -1.0])
def test_missing_zero_or_negative_shares_are_rejected(shares: float | None) -> None:
    with pytest.raises(DcfValidationError) as error:
        calculate_dcf(
            DcfInput(100.0, 0.0, shares, "USD"),
            REFERENCE_ASSUMPTIONS,
            SENSITIVITY,
        )

    assert error.value.field == "diluted_shares"
    assert error.value.code in {"required_number", "must_be_positive"}


def test_negative_fcf_is_calculated_and_warned_without_coercion() -> None:
    result = calculate_dcf(
        DcfInput(-100.0, 0.0, 10.0, "USD"),
        REFERENCE_ASSUMPTIONS,
        SENSITIVITY,
    )

    assert result.projected_cash_flows[0].free_cash_flow == pytest.approx(-118.0)
    assert result.decomposition.enterprise_value < 0.0
    assert result.intrinsic_value_per_share < 0.0
    assert "negative_starting_free_cash_flow" in result.warnings
    assert "non_positive_equity_value" in result.warnings


def test_unstable_fcf_history_is_machine_readable_and_warned() -> None:
    result = calculate_dcf(
        DcfInput(
            100.0,
            0.0,
            10.0,
            "USD",
            historical_free_cash_flows=(100.0, 15.0, 140.0, -20.0),
        ),
        REFERENCE_ASSUMPTIONS,
        SENSITIVITY,
    )

    assert result.fcf_stability is not None
    assert result.fcf_stability.is_unstable is True
    assert result.fcf_stability.sign_change_count == 1
    assert result.fcf_stability.normalized_range >= 1.0
    assert "unstable_historical_free_cash_flow" in result.warnings


@pytest.mark.parametrize("discount_rate", [0.03, 0.02])
def test_discount_rate_below_or_equal_to_terminal_growth_is_rejected(
    discount_rate: float,
) -> None:
    assumptions = DcfAssumptions(5, 5, 0.18, 0.10, 0.03, discount_rate)

    with pytest.raises(DcfValidationError) as error:
        calculate_dcf(
            DcfInput(100.0, 0.0, 10.0, "USD"),
            assumptions,
            SENSITIVITY,
        )

    assert error.value.code == "invalid_rate_relationship"


@pytest.mark.parametrize("growth_rate", [1.000001, 5.0, -1.0, -2.0])
def test_extreme_stage_growth_is_rejected(growth_rate: float) -> None:
    assumptions = DcfAssumptions(5, 5, growth_rate, 0.10, 0.03, 0.09)

    with pytest.raises(DcfValidationError) as error:
        calculate_dcf(
            DcfInput(100.0, 0.0, 10.0, "USD"),
            assumptions,
            SENSITIVITY,
        )

    assert error.value.field == "stage_one_growth_rate"
    assert error.value.code == "out_of_range"


def test_terminal_value_concentration_is_calculated_and_warned() -> None:
    assumptions = DcfAssumptions(1, 1, 0.03, 0.03, 0.06, 0.08)
    sensitivity = SensitivityConfig(0.0025, 0.0025)
    result = calculate_dcf(
        DcfInput(100.0, 0.0, 10.0, "USD"),
        assumptions,
        sensitivity,
    )

    assert 0.0 <= result.terminal_value.concentration <= 1.0
    assert result.terminal_value.concentration >= 0.75
    assert "high_terminal_value_concentration" in result.warnings


def test_sensitivity_is_an_assumption_range_not_a_probability_interval() -> None:
    result = calculate_dcf(
        DcfInput(100.0, 0.0, 10.0, "USD"),
        REFERENCE_ASSUMPTIONS,
        SENSITIVITY,
    )
    interval = result.sensitivity_interval

    assert interval.method == "symmetric_assumption_perturbation"
    assert interval.is_probability_interval is False
    assert interval.lower_bound_per_share < interval.central_value_per_share
    assert interval.central_value_per_share < interval.upper_bound_per_share
    assert len(interval.evaluated_points) == 2
    assert interval.evaluated_points[0].assumptions.discount_rate == pytest.approx(
        0.095
    )
    assert interval.evaluated_points[1].assumptions.discount_rate == pytest.approx(
        0.085
    )


def test_sensitivity_that_breaks_rate_relationship_is_rejected() -> None:
    assumptions = DcfAssumptions(5, 5, 0.10, 0.05, 0.03, 0.04)

    with pytest.raises(DcfValidationError) as error:
        calculate_dcf(
            DcfInput(100.0, 0.0, 10.0, "USD"),
            assumptions,
            SensitivityConfig(0.01, 0.01),
        )

    assert error.value.field == "sensitivity"
    assert error.value.code == "invalid_interval"


@pytest.mark.parametrize(
    ("field_value", "expected_field"),
    [
        (math.nan, "starting_free_cash_flow"),
        (math.inf, "starting_free_cash_flow"),
        (-math.inf, "starting_free_cash_flow"),
    ],
)
def test_non_finite_inputs_are_rejected(
    field_value: float,
    expected_field: str,
) -> None:
    with pytest.raises(DcfValidationError) as error:
        calculate_dcf(
            DcfInput(field_value, 0.0, 10.0, "USD"),
            REFERENCE_ASSUMPTIONS,
            SENSITIVITY,
        )

    assert error.value.field == expected_field
    assert error.value.code == "not_finite"


def test_empty_stage_is_rejected() -> None:
    with pytest.raises(DcfValidationError) as error:
        calculate_dcf(
            DcfInput(100.0, 0.0, 10.0, "USD"),
            DcfAssumptions(0, 5, 0.18, 0.10, 0.03, 0.09),
            SENSITIVITY,
        )

    assert error.value.field == "stage_one_years"


@pytest.mark.parametrize("currency", ["usd", "US", "USDD", "", cast(str, None)])
def test_invalid_currency_is_rejected_with_structured_error(currency: str) -> None:
    with pytest.raises(DcfValidationError) as error:
        calculate_dcf(
            DcfInput(100.0, 0.0, 10.0, currency),
            REFERENCE_ASSUMPTIONS,
            SENSITIVITY,
        )

    assert error.value.to_dict()["field"] == "currency"
    assert error.value.to_dict()["code"] == "invalid_currency"


def test_delta_dcf_reference_regression() -> None:
    result = calculate_dcf(
        DcfInput(100.0, 0.0, 1.0, "USD"),
        REFERENCE_ASSUMPTIONS,
        SENSITIVITY,
    )

    assert result.decomposition.enterprise_value == pytest.approx(
        4074.259247636977,
        rel=1e-12,
    )
    assert result.intrinsic_value_per_share == pytest.approx(
        4074.259247636977,
        rel=1e-12,
    )


def test_zero_growth_two_year_regression_has_exact_economic_value() -> None:
    assumptions = DcfAssumptions(1, 1, 0.0, 0.0, 0.0, 0.10)
    result = calculate_dcf(
        DcfInput(100.0, 0.0, 10.0, "USD"),
        assumptions,
        SensitivityConfig(0.005, 0.005),
    )

    assert result.decomposition.enterprise_value == pytest.approx(1000.0)
    assert result.intrinsic_value_per_share == pytest.approx(100.0)
