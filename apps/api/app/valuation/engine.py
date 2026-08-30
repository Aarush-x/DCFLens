from __future__ import annotations

import math
from dataclasses import dataclass
from numbers import Real

from app.valuation.models import (
    DcfAssumptions,
    DcfInput,
    DcfResult,
    DcfValidationError,
    FcfStabilityAnalysis,
    ProjectedCashFlow,
    SensitivityConfig,
    SensitivityInterval,
    SensitivityPoint,
    TerminalValueCalculation,
    UnitMetadata,
    ValuationDecomposition,
)


MAX_STAGE_YEARS = 50
MAX_TOTAL_PROJECTION_YEARS = 100
MAX_ABSOLUTE_RATE = 1.0
MAX_SENSITIVITY_DELTA = 0.25
UNSTABLE_FCF_NORMALIZED_RANGE = 1.0
HIGH_TERMINAL_CONCENTRATION = 0.75


@dataclass(frozen=True, slots=True)
class _CaseCalculation:
    projected_cash_flows: tuple[ProjectedCashFlow, ...]
    terminal_value: TerminalValueCalculation
    decomposition: ValuationDecomposition
    intrinsic_value_per_share: float


def _validation_error(field: str, code: str, message: str) -> DcfValidationError:
    return DcfValidationError(field=field, code=code, message=message)


def _finite_number(field: str, value: object) -> float:
    if isinstance(value, bool) or not isinstance(value, Real):
        raise _validation_error(field, "required_number", f"{field} must be a number")
    normalized = float(value)
    if not math.isfinite(normalized):
        raise _validation_error(field, "not_finite", f"{field} must be finite")
    return normalized


def _duration(field: str, value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise _validation_error(field, "invalid_duration", f"{field} must be an integer")
    if value <= 0 or value > MAX_STAGE_YEARS:
        raise _validation_error(
            field,
            "out_of_range",
            f"{field} must be between 1 and {MAX_STAGE_YEARS} years",
        )
    return value


def _growth_rate(field: str, value: object) -> float:
    rate = _finite_number(field, value)
    if rate <= -MAX_ABSOLUTE_RATE or rate > MAX_ABSOLUTE_RATE:
        raise _validation_error(
            field,
            "out_of_range",
            f"{field} must be greater than -1.0 and no greater than 1.0",
        )
    return rate


def _discount_rate(value: object) -> float:
    rate = _finite_number("discount_rate", value)
    if rate <= 0.0 or rate > MAX_ABSOLUTE_RATE:
        raise _validation_error(
            "discount_rate",
            "out_of_range",
            "discount_rate must be greater than 0.0 and no greater than 1.0",
        )
    return rate


def _validate_inputs(inputs: DcfInput) -> DcfInput:
    starting_fcf = _finite_number(
        "starting_free_cash_flow", inputs.starting_free_cash_flow
    )
    net_debt = _finite_number("net_debt", inputs.net_debt)
    diluted_shares = _finite_number("diluted_shares", inputs.diluted_shares)
    if diluted_shares <= 0.0:
        raise _validation_error(
            "diluted_shares",
            "must_be_positive",
            "diluted_shares must be greater than zero",
        )

    if not isinstance(inputs.currency, str):
        raise _validation_error(
            "currency",
            "invalid_currency",
            "currency must be a three-letter uppercase code",
        )
    currency = inputs.currency.strip()
    if len(currency) != 3 or not currency.isalpha() or not currency.isupper():
        raise _validation_error(
            "currency",
            "invalid_currency",
            "currency must be a three-letter uppercase code",
        )

    history = inputs.historical_free_cash_flows
    if not isinstance(history, tuple):
        raise _validation_error(
            "historical_free_cash_flows",
            "invalid_sequence",
            "historical_free_cash_flows must be an immutable tuple",
        )
    if history and len(history) < 2:
        raise _validation_error(
            "historical_free_cash_flows",
            "insufficient_history",
            "historical_free_cash_flows must contain at least two observations",
        )
    normalized_history = tuple(
        _finite_number(f"historical_free_cash_flows[{index}]", value)
        for index, value in enumerate(history)
    )

    return DcfInput(
        starting_free_cash_flow=starting_fcf,
        net_debt=net_debt,
        diluted_shares=diluted_shares,
        currency=currency,
        historical_free_cash_flows=normalized_history,
    )


def _validate_assumptions(assumptions: DcfAssumptions) -> DcfAssumptions:
    stage_one_years = _duration("stage_one_years", assumptions.stage_one_years)
    stage_two_years = _duration("stage_two_years", assumptions.stage_two_years)
    if stage_one_years + stage_two_years > MAX_TOTAL_PROJECTION_YEARS:
        raise _validation_error(
            "projection_years",
            "out_of_range",
            f"combined projection duration must not exceed {MAX_TOTAL_PROJECTION_YEARS}",
        )

    stage_one_growth = _growth_rate(
        "stage_one_growth_rate", assumptions.stage_one_growth_rate
    )
    stage_two_growth = _growth_rate(
        "stage_two_growth_rate", assumptions.stage_two_growth_rate
    )
    terminal_growth = _growth_rate(
        "terminal_growth_rate", assumptions.terminal_growth_rate
    )
    discount_rate = _discount_rate(assumptions.discount_rate)
    if discount_rate <= terminal_growth:
        raise _validation_error(
            "discount_rate",
            "invalid_rate_relationship",
            "discount_rate must be greater than terminal_growth_rate",
        )

    return DcfAssumptions(
        stage_one_years=stage_one_years,
        stage_two_years=stage_two_years,
        stage_one_growth_rate=stage_one_growth,
        stage_two_growth_rate=stage_two_growth,
        terminal_growth_rate=terminal_growth,
        discount_rate=discount_rate,
    )


def _validate_sensitivity(config: SensitivityConfig) -> SensitivityConfig:
    growth_delta = _finite_number("growth_rate_delta", config.growth_rate_delta)
    discount_delta = _finite_number(
        "discount_rate_delta", config.discount_rate_delta
    )
    for field, value in (
        ("growth_rate_delta", growth_delta),
        ("discount_rate_delta", discount_delta),
    ):
        if value <= 0.0 or value > MAX_SENSITIVITY_DELTA:
            raise _validation_error(
                field,
                "out_of_range",
                f"{field} must be greater than 0.0 and no greater than "
                f"{MAX_SENSITIVITY_DELTA}",
            )
    return SensitivityConfig(
        growth_rate_delta=growth_delta,
        discount_rate_delta=discount_delta,
    )


def _calculate_case(
    inputs: DcfInput,
    assumptions: DcfAssumptions,
) -> _CaseCalculation:
    projections: list[ProjectedCashFlow] = []
    current_fcf = inputs.starting_free_cash_flow
    total_years = assumptions.stage_one_years + assumptions.stage_two_years

    for year in range(1, total_years + 1):
        in_stage_one = year <= assumptions.stage_one_years
        stage = 1 if in_stage_one else 2
        growth_rate = (
            assumptions.stage_one_growth_rate
            if in_stage_one
            else assumptions.stage_two_growth_rate
        )
        current_fcf *= 1.0 + growth_rate
        discount_factor = (1.0 + assumptions.discount_rate) ** year
        present_value = current_fcf / discount_factor
        if not all(math.isfinite(value) for value in (current_fcf, present_value)):
            raise _validation_error(
                "calculation",
                "non_finite_result",
                "projected cash flow calculation produced a non-finite result",
            )
        projections.append(
            ProjectedCashFlow(
                year=year,
                stage=stage,
                growth_rate=growth_rate,
                free_cash_flow=current_fcf,
                discount_factor=discount_factor,
                present_value=present_value,
            )
        )

    terminal_year_fcf = current_fcf * (1.0 + assumptions.terminal_growth_rate)
    capitalization_spread = (
        assumptions.discount_rate - assumptions.terminal_growth_rate
    )
    undiscounted_terminal_value = terminal_year_fcf / capitalization_spread
    terminal_discount_factor = (1.0 + assumptions.discount_rate) ** total_years
    present_value_terminal = undiscounted_terminal_value / terminal_discount_factor

    present_value_stage_one = sum(
        projection.present_value
        for projection in projections
        if projection.stage == 1
    )
    present_value_stage_two = sum(
        projection.present_value
        for projection in projections
        if projection.stage == 2
    )
    present_value_projected = present_value_stage_one + present_value_stage_two
    enterprise_value = present_value_projected + present_value_terminal
    net_debt_adjustment = -inputs.net_debt
    equity_value = enterprise_value + net_debt_adjustment
    intrinsic_value_per_share = equity_value / inputs.diluted_shares

    calculated_values = (
        terminal_year_fcf,
        undiscounted_terminal_value,
        present_value_terminal,
        present_value_stage_one,
        present_value_stage_two,
        enterprise_value,
        equity_value,
        intrinsic_value_per_share,
    )
    if not all(math.isfinite(value) for value in calculated_values):
        raise _validation_error(
            "calculation",
            "non_finite_result",
            "DCF calculation produced a non-finite result",
        )

    absolute_contributions = abs(present_value_projected) + abs(
        present_value_terminal
    )
    terminal_concentration = (
        abs(present_value_terminal) / absolute_contributions
        if absolute_contributions
        else 0.0
    )

    terminal_value = TerminalValueCalculation(
        final_projected_free_cash_flow=current_fcf,
        terminal_year_free_cash_flow=terminal_year_fcf,
        capitalization_spread=capitalization_spread,
        undiscounted_terminal_value=undiscounted_terminal_value,
        discount_factor=terminal_discount_factor,
        present_value=present_value_terminal,
        concentration=terminal_concentration,
    )
    decomposition = ValuationDecomposition(
        present_value_stage_one=present_value_stage_one,
        present_value_stage_two=present_value_stage_two,
        present_value_projected_cash_flows=present_value_projected,
        present_value_terminal_value=present_value_terminal,
        enterprise_value=enterprise_value,
        net_debt=inputs.net_debt,
        net_debt_adjustment=net_debt_adjustment,
        equity_value=equity_value,
    )
    return _CaseCalculation(
        projected_cash_flows=tuple(projections),
        terminal_value=terminal_value,
        decomposition=decomposition,
        intrinsic_value_per_share=intrinsic_value_per_share,
    )


def _analyze_stability(history: tuple[float, ...]) -> FcfStabilityAnalysis | None:
    if not history:
        return None

    minimum = min(history)
    maximum = max(history)
    # Scale before summing/subtracting so finite input observations cannot
    # overflow the stability statistics. This is the same range/mean formula.
    scale = max(abs(value) for value in history)
    scaled_mean = sum(abs(value) / scale for value in history) / len(history) if scale else 0.0
    mean_absolute = scaled_mean * scale
    normalized_range = (maximum / scale - minimum / scale) / scaled_mean if scale else 0.0
    sign_change_count = sum(
        1
        for previous, current in zip(history, history[1:])
        if (previous < 0 < current) or (current < 0 < previous)
    )
    is_unstable = (
        normalized_range >= UNSTABLE_FCF_NORMALIZED_RANGE
        or sign_change_count > 0
    )
    return FcfStabilityAnalysis(
        observation_count=len(history),
        minimum_free_cash_flow=minimum,
        maximum_free_cash_flow=maximum,
        mean_absolute_free_cash_flow=mean_absolute,
        normalized_range=normalized_range,
        sign_change_count=sign_change_count,
        is_unstable=is_unstable,
    )


def _sensitivity_assumptions(
    assumptions: DcfAssumptions,
    config: SensitivityConfig,
) -> tuple[DcfAssumptions, DcfAssumptions]:
    candidates = (
        DcfAssumptions(
            stage_one_years=assumptions.stage_one_years,
            stage_two_years=assumptions.stage_two_years,
            stage_one_growth_rate=(
                assumptions.stage_one_growth_rate - config.growth_rate_delta
            ),
            stage_two_growth_rate=(
                assumptions.stage_two_growth_rate - config.growth_rate_delta
            ),
            terminal_growth_rate=(
                assumptions.terminal_growth_rate - config.growth_rate_delta
            ),
            discount_rate=assumptions.discount_rate + config.discount_rate_delta,
        ),
        DcfAssumptions(
            stage_one_years=assumptions.stage_one_years,
            stage_two_years=assumptions.stage_two_years,
            stage_one_growth_rate=(
                assumptions.stage_one_growth_rate + config.growth_rate_delta
            ),
            stage_two_growth_rate=(
                assumptions.stage_two_growth_rate + config.growth_rate_delta
            ),
            terminal_growth_rate=(
                assumptions.terminal_growth_rate + config.growth_rate_delta
            ),
            discount_rate=assumptions.discount_rate - config.discount_rate_delta,
        ),
    )
    try:
        first = _validate_assumptions(candidates[0])
        second = _validate_assumptions(candidates[1])
        return first, second
    except DcfValidationError as exc:
        raise _validation_error(
            "sensitivity",
            "invalid_interval",
            f"sensitivity perturbations produce invalid assumptions: {exc.message}",
        ) from exc


def calculate_dcf(
    inputs: DcfInput,
    assumptions: DcfAssumptions,
    sensitivity: SensitivityConfig,
) -> DcfResult:
    """Calculate one deterministic DCF and its non-probabilistic sensitivity range."""
    validated_inputs = _validate_inputs(inputs)
    validated_assumptions = _validate_assumptions(assumptions)
    validated_sensitivity = _validate_sensitivity(sensitivity)

    central_case = _calculate_case(validated_inputs, validated_assumptions)
    sensitivity_assumptions = _sensitivity_assumptions(
        validated_assumptions, validated_sensitivity
    )
    first_sensitivity_assumptions, second_sensitivity_assumptions = (
        sensitivity_assumptions
    )
    sensitivity_points = (
        SensitivityPoint(
            assumptions=first_sensitivity_assumptions,
            intrinsic_value_per_share=_calculate_case(
                validated_inputs, first_sensitivity_assumptions
            ).intrinsic_value_per_share,
        ),
        SensitivityPoint(
            assumptions=second_sensitivity_assumptions,
            intrinsic_value_per_share=_calculate_case(
                validated_inputs, second_sensitivity_assumptions
            ).intrinsic_value_per_share,
        ),
    )
    sensitivity_values = (
        central_case.intrinsic_value_per_share,
        *(point.intrinsic_value_per_share for point in sensitivity_points),
    )
    sensitivity_interval = SensitivityInterval(
        method="symmetric_assumption_perturbation",
        is_probability_interval=False,
        growth_rate_delta=validated_sensitivity.growth_rate_delta,
        discount_rate_delta=validated_sensitivity.discount_rate_delta,
        central_value_per_share=central_case.intrinsic_value_per_share,
        lower_bound_per_share=min(sensitivity_values),
        upper_bound_per_share=max(sensitivity_values),
        evaluated_points=sensitivity_points,
    )

    stability = _analyze_stability(validated_inputs.historical_free_cash_flows)
    warnings: list[str] = []
    if validated_inputs.starting_free_cash_flow < 0.0:
        warnings.append("negative_starting_free_cash_flow")
    if stability is not None and stability.is_unstable:
        warnings.append("unstable_historical_free_cash_flow")
    if central_case.terminal_value.concentration >= HIGH_TERMINAL_CONCENTRATION:
        warnings.append("high_terminal_value_concentration")
    if central_case.decomposition.equity_value <= 0.0:
        warnings.append("non_positive_equity_value")

    return DcfResult(
        inputs=validated_inputs,
        assumptions=validated_assumptions,
        projected_cash_flows=central_case.projected_cash_flows,
        terminal_value=central_case.terminal_value,
        decomposition=central_case.decomposition,
        intrinsic_value_per_share=central_case.intrinsic_value_per_share,
        sensitivity_interval=sensitivity_interval,
        fcf_stability=stability,
        warnings=tuple(warnings),
        units=UnitMetadata(
            monetary_values=validated_inputs.currency,
            share_count="shares",
            per_share_value=f"{validated_inputs.currency}/share",
            rates="decimal_fraction",
            durations="years",
            discount_factors="dimensionless_divisor",
            concentration="decimal_fraction",
        ),
    )
