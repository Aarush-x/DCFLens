from __future__ import annotations

import math
from dataclasses import dataclass
from enum import StrEnum

from app.ai.models import AiAnalysisResult, AiAnalysisStatus, ConfidenceLevel
from app.data.market.models import MarketPrice, QuoteStatus


# Thresholds are deliberately private to this module. docs/API.md v3 freezes the
# shape of the assessment but not the numbers behind it, so these may be tuned
# without a contract change -- that is the whole point of the gate being a field
# rather than a rule the frontend copies (D-027).
EXTREME_TERMINAL_CONCENTRATION = 0.90
HIGH_TERMINAL_CONCENTRATION = 0.75
WIDE_SENSITIVITY_INTERVAL = 1.00
PRICE_RATIO_CEILING = 5.0
PRICE_RATIO_FLOOR = 0.20
QUALIFYING_SIGNALS_THAT_DISQUALIFY = 3


class PlausibilityLevel(StrEnum):
    SOUND = "SOUND"
    QUALIFIED = "QUALIFIED"
    UNRELIABLE = "UNRELIABLE"


class PlausibilitySeverity(StrEnum):
    DISQUALIFYING = "DISQUALIFYING"
    QUALIFYING = "QUALIFYING"


class PlausibilitySignal(StrEnum):
    NON_POSITIVE_EQUITY_VALUE = "non_positive_equity_value"
    NEGATIVE_STARTING_FREE_CASH_FLOW = "negative_starting_free_cash_flow"
    EXTREME_TERMINAL_VALUE_CONCENTRATION = "extreme_terminal_value_concentration"
    WIDE_SENSITIVITY_INTERVAL = "wide_sensitivity_interval"
    PRICE_FAR_OUTSIDE_VALUATION_RANGE = "price_far_outside_valuation_range"
    UNSTABLE_HISTORICAL_FREE_CASH_FLOW = "unstable_historical_free_cash_flow"
    HIGH_TERMINAL_VALUE_CONCENTRATION = "high_terminal_value_concentration"
    LOW_CONFIDENCE = "low_confidence"
    AI_DETERMINISTIC_FALLBACK = "ai_deterministic_fallback"
    NO_MARKET_PRICE = "no_market_price"


class PricePosition(StrEnum):
    BELOW_RANGE = "below_range"
    IN_RANGE = "in_range"
    ABOVE_RANGE = "above_range"


# Written for a beginner and rendered verbatim, so none of them names a model, a
# field, a library or a threshold.
EXPLANATIONS: dict[PlausibilitySignal, str] = {
    PlausibilitySignal.NON_POSITIVE_EQUITY_VALUE: (
        "After subtracting what this company owes, our method values the shares at "
        "nothing at all, which is not something you can act on."
    ),
    PlausibilitySignal.NEGATIVE_STARTING_FREE_CASH_FLOW: (
        "This company spent more cash than it produced last year, so projecting that "
        "figure forward is arithmetic rather than a valuation."
    ),
    PlausibilitySignal.EXTREME_TERMINAL_VALUE_CONCENTRATION: (
        "Almost all of the value here comes from a guess about the distant future, so "
        "any answer would be about that guess rather than about the company."
    ),
    PlausibilitySignal.WIDE_SENSITIVITY_INTERVAL: (
        "Small changes to our assumptions swing the estimate by more than the estimate "
        "itself, so the range is too wide to mean anything."
    ),
    PlausibilitySignal.PRICE_FAR_OUTSIDE_VALUATION_RANGE: (
        "Today's price and our estimate are several times apart. A gap that large "
        "usually means our estimate is wrong, not that the market is."
    ),
    PlausibilitySignal.UNSTABLE_HISTORICAL_FREE_CASH_FLOW: (
        "The spare cash this company produced swung widely from year to year, so "
        "projecting it forward is less certain than usual."
    ),
    PlausibilitySignal.HIGH_TERMINAL_VALUE_CONCENTRATION: (
        "Most of the value comes from years ten and beyond, which is the part of any "
        "estimate we can be least sure about."
    ),
    PlausibilitySignal.LOW_CONFIDENCE: (
        "Our own confidence check on this analysis came back low."
    ),
    PlausibilitySignal.AI_DETERMINISTIC_FALLBACK: (
        "The written explanation of this analysis was unavailable, so you are seeing "
        "the numbers on their own."
    ),
    PlausibilitySignal.NO_MARKET_PRICE: (
        "We don't have today's market price, so there's nothing to compare our "
        "estimate against."
    ),
}


@dataclass(frozen=True, slots=True)
class PlausibilityReason:
    signal: PlausibilitySignal
    severity: PlausibilitySeverity
    explanation: str


@dataclass(frozen=True, slots=True)
class PlausibilityAssessment:
    level: PlausibilityLevel
    can_state_verdict: bool
    reasons: tuple[PlausibilityReason, ...]
    price_to_midpoint_ratio: float | None
    price_position: PricePosition | None
    summary: str


def _reason(
    signal: PlausibilitySignal, severity: PlausibilitySeverity
) -> PlausibilityReason:
    return PlausibilityReason(
        signal=signal,
        severity=severity,
        explanation=EXPLANATIONS[signal],
    )


def _usable(value: float | None) -> bool:
    return value is not None and math.isfinite(value)


def _quoted_price(price: MarketPrice) -> float | None:
    if price.status is not QuoteStatus.AVAILABLE or price.quote is None:
        return None
    return price.quote.price if _usable(price.quote.price) else None


def _ratio(midpoint: float, quoted: float) -> float | None:
    # A zero or non-finite midpoint has no ratio to report; it must not raise and
    # it must not be reported as 0, which invariant 7 forbids.
    if not _usable(midpoint) or midpoint == 0:
        return None
    ratio = quoted / midpoint
    return ratio if math.isfinite(ratio) else None


def _position(valuation, quoted: float) -> PricePosition | None:
    interval = valuation.sensitivity_interval
    lower = interval.lower_bound_per_share
    upper = interval.upper_bound_per_share
    if not _usable(lower) or not _usable(upper):
        return None
    if quoted < lower:
        return PricePosition.BELOW_RANGE
    if quoted > upper:
        return PricePosition.ABOVE_RANGE
    return PricePosition.IN_RANGE


def _interval_is_wide(valuation) -> bool:
    interval = valuation.sensitivity_interval
    central = interval.central_value_per_share
    lower = interval.lower_bound_per_share
    upper = interval.upper_bound_per_share
    if not _usable(lower) or not _usable(upper):
        return True
    if not _usable(central) or central == 0:
        # No denominator means we cannot establish that the range is tight, and
        # "refuse rather than guess" resolves that against us, not the reader.
        return True
    return (upper - lower) / abs(central) >= WIDE_SENSITIVITY_INTERVAL


def _count_words(count: int) -> str:
    return {1: "one thing makes", 2: "two things make"}.get(
        count, f"{count} things make"
    )


def assess_plausibility(
    analysis: AiAnalysisResult, price: MarketPrice
) -> PlausibilityAssessment:
    """Does this analysis hold up well enough to say a verdict word out loud?

    Every signal reads off ``final_valuation`` -- the numbers the user is shown --
    never the baseline, so the gate describes the answer on screen rather than an
    intermediate one nobody sees.
    """
    valuation = analysis.final_valuation
    warnings = valuation.warnings
    concentration = valuation.terminal_value.concentration
    quoted = _quoted_price(price)

    ratio = None
    position = None
    if quoted is not None:
        ratio = _ratio(valuation.intrinsic_value_per_share, quoted)
        position = _position(valuation, quoted)
        if ratio is None or position is None:
            # Invariant 7: the two are null together or set together. A degenerate
            # midpoint with usable bounds would otherwise report a position for a
            # valuation we just admitted we cannot divide by.
            ratio = position = None

    disqualifying: list[PlausibilityReason] = []
    if "non_positive_equity_value" in warnings:
        disqualifying.append(
            _reason(
                PlausibilitySignal.NON_POSITIVE_EQUITY_VALUE,
                PlausibilitySeverity.DISQUALIFYING,
            )
        )
    if "negative_starting_free_cash_flow" in warnings:
        disqualifying.append(
            _reason(
                PlausibilitySignal.NEGATIVE_STARTING_FREE_CASH_FLOW,
                PlausibilitySeverity.DISQUALIFYING,
            )
        )
    if _usable(concentration) and concentration >= EXTREME_TERMINAL_CONCENTRATION:
        disqualifying.append(
            _reason(
                PlausibilitySignal.EXTREME_TERMINAL_VALUE_CONCENTRATION,
                PlausibilitySeverity.DISQUALIFYING,
            )
        )
    if _interval_is_wide(valuation):
        disqualifying.append(
            _reason(
                PlausibilitySignal.WIDE_SENSITIVITY_INTERVAL,
                PlausibilitySeverity.DISQUALIFYING,
            )
        )
    price_gap_is_extreme = ratio is not None and (
        ratio >= PRICE_RATIO_CEILING or ratio <= PRICE_RATIO_FLOOR
    )
    if price_gap_is_extreme:
        # The honest use of price-vs-range: an extreme mismatch is evidence about
        # the model, not a verdict about the stock. This service cannot say which
        # of the two is wrong, so it declines to say either.
        disqualifying.append(
            _reason(
                PlausibilitySignal.PRICE_FAR_OUTSIDE_VALUATION_RANGE,
                PlausibilitySeverity.DISQUALIFYING,
            )
        )

    qualifying: list[PlausibilityReason] = []
    stability = valuation.fcf_stability
    if stability is not None and stability.is_unstable:
        qualifying.append(
            _reason(
                PlausibilitySignal.UNSTABLE_HISTORICAL_FREE_CASH_FLOW,
                PlausibilitySeverity.QUALIFYING,
            )
        )
    if (
        _usable(concentration)
        and HIGH_TERMINAL_CONCENTRATION <= concentration < EXTREME_TERMINAL_CONCENTRATION
    ):
        qualifying.append(
            _reason(
                PlausibilitySignal.HIGH_TERMINAL_VALUE_CONCENTRATION,
                PlausibilitySeverity.QUALIFYING,
            )
        )
    if analysis.confidence.level is ConfidenceLevel.LOW:
        qualifying.append(
            _reason(
                PlausibilitySignal.LOW_CONFIDENCE,
                PlausibilitySeverity.QUALIFYING,
            )
        )
    if analysis.status is AiAnalysisStatus.DETERMINISTIC_FALLBACK:
        qualifying.append(
            _reason(
                PlausibilitySignal.AI_DETERMINISTIC_FALLBACK,
                PlausibilitySeverity.QUALIFYING,
            )
        )

    if disqualifying or len(qualifying) >= QUALIFYING_SIGNALS_THAT_DISQUALIFY:
        level = PlausibilityLevel.UNRELIABLE
    elif qualifying:
        level = PlausibilityLevel.QUALIFIED
    else:
        level = PlausibilityLevel.SOUND

    reasons = [*disqualifying]
    if quoted is None:
        # Appended after the level is settled, deliberately. A missing quote is our
        # failure, not the company's, and blaming the analysis for it would be a
        # lie about the company -- so this closes the gate without moving `level`.
        reasons.append(
            _reason(
                PlausibilitySignal.NO_MARKET_PRICE,
                PlausibilitySeverity.DISQUALIFYING,
            )
        )
    reasons.extend(qualifying)

    can_state_verdict = (
        level is not PlausibilityLevel.UNRELIABLE
        and price.status is QuoteStatus.AVAILABLE
        and quoted is not None
    )

    return PlausibilityAssessment(
        level=level,
        can_state_verdict=can_state_verdict,
        reasons=tuple(reasons),
        price_to_midpoint_ratio=ratio,
        price_position=position,
        summary=_summary(level, quoted, price_gap_is_extreme, len(qualifying)),
    )


def _summary(
    level: PlausibilityLevel,
    quoted: float | None,
    price_gap_is_extreme: bool,
    qualifying_count: int,
) -> str:
    if quoted is None:
        if level is PlausibilityLevel.UNRELIABLE:
            return (
                "We can't rely on this estimate, and we don't have a market price to "
                "compare it against either."
            )
        return (
            "The analysis holds up, but without a market price we can't say whether "
            "the stock is cheap or expensive."
        )
    if level is PlausibilityLevel.UNRELIABLE:
        if price_gap_is_extreme:
            return (
                "Our estimate is too far from the market price for us to call this one."
            )
        return (
            "This estimate doesn't hold up well enough for us to say whether the stock "
            "is cheap or expensive."
        )
    if level is PlausibilityLevel.QUALIFIED:
        return (
            f"We can still give an answer, but {_count_words(qualifying_count)} this "
            "estimate shakier than usual."
        )
    return (
        "We have today's price to compare against and nothing in the analysis looks "
        "out of place."
    )
