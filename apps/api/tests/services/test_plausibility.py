from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from app.ai.models import AiAnalysisStatus, ConfidenceLevel
from app.data.market.models import (
    MarketPrice,
    MarketQuote,
    QuoteUnavailableReason,
)
from app.services.plausibility import (
    PlausibilityLevel,
    PlausibilitySeverity,
    PlausibilitySignal,
    PricePosition,
    assess_plausibility,
)


def _analysis(
    *,
    warnings: tuple[str, ...] = (),
    concentration: float = 0.60,
    central: float = 100.0,
    lower: float = 90.0,
    upper: float = 110.0,
    intrinsic: float = 100.0,
    unstable: bool = False,
    confidence: ConfidenceLevel = ConfidenceLevel.HIGH,
    status: AiAnalysisStatus = AiAnalysisStatus.APPLIED,
):
    """A structurally minimal stand-in for AiAnalysisResult.

    assess_plausibility reads eight fields off the final valuation and two off
    the analysis; a full AiAnalysisResult would bury the case under a hundred
    irrelevant ones. Defaults are deliberately a clean SOUND analysis, so every
    case below states exactly the one thing it is testing.
    """
    return SimpleNamespace(
        status=status,
        confidence=SimpleNamespace(level=confidence),
        final_valuation=SimpleNamespace(
            warnings=warnings,
            terminal_value=SimpleNamespace(concentration=concentration),
            sensitivity_interval=SimpleNamespace(
                central_value_per_share=central,
                lower_bound_per_share=lower,
                upper_bound_per_share=upper,
            ),
            intrinsic_value_per_share=intrinsic,
            fcf_stability=SimpleNamespace(is_unstable=unstable),
        ),
    )


def _price(value: float = 100.0) -> MarketPrice:
    return MarketPrice.available(
        MarketQuote(
            symbol="AAPL",
            price=value,
            currency="USD",
            quoted_at=datetime(2026, 8, 28, 20, tzinfo=timezone.utc),
            retrieved_at=datetime(2026, 8, 30, 14, tzinfo=timezone.utc),
            source="Yahoo Finance",
            source_url="https://finance.yahoo.com/quote/AAPL",
            exchange_name="NasdaqGS",
        )
    )


NO_PRICE = MarketPrice.unavailable(
    QuoteUnavailableReason.PROVIDER_DISABLED,
    "We aren't showing a market price right now.",
)


def _signals(assessment) -> set[PlausibilitySignal]:
    return {reason.signal for reason in assessment.reasons}


# Each entry is one disqualifying signal in isolation: the analysis is otherwise
# clean, so anything but UNRELIABLE means that signal stopped disqualifying.
DISQUALIFYING_CASES = [
    (
        PlausibilitySignal.NON_POSITIVE_EQUITY_VALUE,
        {"warnings": ("non_positive_equity_value",)},
        100.0,
    ),
    (
        PlausibilitySignal.NEGATIVE_STARTING_FREE_CASH_FLOW,
        {"warnings": ("negative_starting_free_cash_flow",)},
        100.0,
    ),
    (
        PlausibilitySignal.EXTREME_TERMINAL_VALUE_CONCENTRATION,
        {"concentration": 0.90},
        100.0,
    ),
    (
        PlausibilitySignal.WIDE_SENSITIVITY_INTERVAL,
        {"lower": 40.0, "upper": 160.0},
        100.0,
    ),
    (PlausibilitySignal.PRICE_FAR_OUTSIDE_VALUATION_RANGE, {}, 500.0),
]


@pytest.mark.parametrize(
    ("signal", "overrides", "quoted"),
    DISQUALIFYING_CASES,
    ids=[case[0].value for case in DISQUALIFYING_CASES],
)
def test_any_single_disqualifying_signal_closes_the_gate(
    signal: PlausibilitySignal, overrides: dict, quoted: float
) -> None:
    assessment = assess_plausibility(_analysis(**overrides), _price(quoted))

    assert assessment.level is PlausibilityLevel.UNRELIABLE
    assert assessment.can_state_verdict is False
    assert signal in _signals(assessment)
    assert assessment.reasons[0].severity is PlausibilitySeverity.DISQUALIFYING
    assert assessment.summary


def test_a_clean_analysis_with_a_price_is_sound_and_states_a_verdict() -> None:
    assessment = assess_plausibility(_analysis(), _price(96.4))

    assert assessment.level is PlausibilityLevel.SOUND
    assert assessment.can_state_verdict is True
    assert assessment.reasons == ()
    assert assessment.price_position is PricePosition.IN_RANGE
    assert assessment.price_to_midpoint_ratio == pytest.approx(0.964)
    assert assessment.summary


QUALIFYING_CASES = [
    (PlausibilitySignal.UNSTABLE_HISTORICAL_FREE_CASH_FLOW, {"unstable": True}),
    (PlausibilitySignal.HIGH_TERMINAL_VALUE_CONCENTRATION, {"concentration": 0.80}),
    (PlausibilitySignal.LOW_CONFIDENCE, {"confidence": ConfidenceLevel.LOW}),
    (
        PlausibilitySignal.AI_DETERMINISTIC_FALLBACK,
        {"status": AiAnalysisStatus.DETERMINISTIC_FALLBACK},
    ),
]


@pytest.mark.parametrize(
    ("signal", "overrides"),
    QUALIFYING_CASES,
    ids=[case[0].value for case in QUALIFYING_CASES],
)
def test_exactly_one_qualifying_signal_still_states_a_verdict(
    signal: PlausibilitySignal, overrides: dict
) -> None:
    assessment = assess_plausibility(_analysis(**overrides), _price())

    assert assessment.level is PlausibilityLevel.QUALIFIED
    assert assessment.can_state_verdict is True
    assert _signals(assessment) == {signal}
    assert assessment.reasons[0].severity is PlausibilitySeverity.QUALIFYING


def test_three_qualifying_signals_stack_into_a_refusal() -> None:
    assessment = assess_plausibility(
        _analysis(unstable=True, concentration=0.80, confidence=ConfidenceLevel.LOW),
        _price(),
    )

    assert assessment.level is PlausibilityLevel.UNRELIABLE
    assert assessment.can_state_verdict is False
    assert len(assessment.reasons) == 3
    assert all(
        reason.severity is PlausibilitySeverity.QUALIFYING
        for reason in assessment.reasons
    )


def test_two_qualifying_signals_are_still_only_qualified() -> None:
    assessment = assess_plausibility(
        _analysis(unstable=True, confidence=ConfidenceLevel.LOW), _price()
    )

    assert assessment.level is PlausibilityLevel.QUALIFIED
    assert assessment.can_state_verdict is True


def test_a_missing_price_closes_the_gate_without_blaming_the_analysis() -> None:
    """level still describes the model; only can_state_verdict reacts.

    Saying UNRELIABLE here would blame the company for our missing provider.
    """
    assessment = assess_plausibility(_analysis(), NO_PRICE)

    assert assessment.level is PlausibilityLevel.SOUND
    assert assessment.can_state_verdict is False
    assert _signals(assessment) == {PlausibilitySignal.NO_MARKET_PRICE}
    assert assessment.price_to_midpoint_ratio is None
    assert assessment.price_position is None
    assert assessment.summary


def test_a_missing_price_still_reports_the_models_own_qualifying_signals() -> None:
    assessment = assess_plausibility(_analysis(unstable=True), NO_PRICE)

    assert assessment.level is PlausibilityLevel.QUALIFIED
    assert assessment.can_state_verdict is False
    assert _signals(assessment) == {
        PlausibilitySignal.NO_MARKET_PRICE,
        PlausibilitySignal.UNSTABLE_HISTORICAL_FREE_CASH_FLOW,
    }


@pytest.mark.parametrize(
    ("quoted", "disqualifies"),
    [
        (500.0, True),   # ratio exactly 5.0
        (499.0, False),  # 4.99, just inside
        (20.0, True),    # ratio exactly 0.20
        (21.0, False),   # 0.21, just inside
    ],
)
def test_price_ratio_boundaries_are_inclusive(quoted: float, disqualifies: bool) -> None:
    # Bounds widened so only the ratio rule can fire in these cases.
    assessment = assess_plausibility(
        _analysis(lower=1.0, upper=1000.0, central=100.0), _price(quoted)
    )

    fired = PlausibilitySignal.PRICE_FAR_OUTSIDE_VALUATION_RANGE in _signals(assessment)
    assert fired is disqualifies


@pytest.mark.parametrize(
    ("quoted", "expected"),
    [
        (89.99, PricePosition.BELOW_RANGE),
        (90.0, PricePosition.IN_RANGE),   # lower bound is inclusive
        (110.0, PricePosition.IN_RANGE),  # upper bound is inclusive
        (110.01, PricePosition.ABOVE_RANGE),
    ],
)
def test_price_position_bounds_are_inclusive(
    quoted: float, expected: PricePosition
) -> None:
    assessment = assess_plausibility(_analysis(), _price(quoted))

    assert assessment.price_position is expected


@pytest.mark.parametrize(
    ("concentration", "expected"),
    [
        (0.7499, PlausibilityLevel.SOUND),
        (0.75, PlausibilityLevel.QUALIFIED),
        (0.8999, PlausibilityLevel.QUALIFIED),
        (0.90, PlausibilityLevel.UNRELIABLE),
    ],
)
def test_terminal_concentration_boundaries(
    concentration: float, expected: PlausibilityLevel
) -> None:
    assessment = assess_plausibility(
        _analysis(concentration=concentration), _price()
    )

    assert assessment.level is expected


@pytest.mark.parametrize(
    ("lower", "upper", "disqualifies"),
    [
        (50.0, 150.0, True),   # width exactly 1.00 of a 100.0 central
        (51.0, 150.0, False),  # 0.99, just inside
    ],
)
def test_sensitivity_width_boundary_is_inclusive(
    lower: float, upper: float, disqualifies: bool
) -> None:
    assessment = assess_plausibility(
        _analysis(lower=lower, upper=upper), _price()
    )

    fired = PlausibilitySignal.WIDE_SENSITIVITY_INTERVAL in _signals(assessment)
    assert fired is disqualifies


@pytest.mark.parametrize("midpoint", [0.0, float("nan"), float("inf"), float("-inf")])
def test_a_degenerate_midpoint_does_not_raise(midpoint: float) -> None:
    assessment = assess_plausibility(_analysis(intrinsic=midpoint), _price())

    # Invariant 7: both price-relative fields are null together, never 0.
    assert assessment.price_to_midpoint_ratio is None
    assert assessment.price_position is None
    assert assessment.summary


@pytest.mark.parametrize("central", [0.0, float("nan")])
def test_a_degenerate_interval_centre_refuses_rather_than_raising(
    central: float,
) -> None:
    assessment = assess_plausibility(_analysis(central=central), _price())

    assert assessment.level is PlausibilityLevel.UNRELIABLE
    assert PlausibilitySignal.WIDE_SENSITIVITY_INTERVAL in _signals(assessment)


def test_reasons_are_ordered_most_severe_first() -> None:
    assessment = assess_plausibility(
        _analysis(warnings=("non_positive_equity_value",), unstable=True), _price()
    )

    severities = [reason.severity for reason in assessment.reasons]
    assert severities == [
        PlausibilitySeverity.DISQUALIFYING,
        PlausibilitySeverity.QUALIFYING,
    ]


def test_a_missing_fcf_stability_analysis_is_not_a_signal() -> None:
    analysis = _analysis()
    analysis.final_valuation.fcf_stability = None

    assessment = assess_plausibility(analysis, _price())

    assert assessment.level is PlausibilityLevel.SOUND
