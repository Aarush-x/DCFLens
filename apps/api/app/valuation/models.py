from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any


@dataclass(frozen=True, slots=True)
class DcfInput:
    starting_free_cash_flow: float
    net_debt: float
    diluted_shares: float | None
    currency: str
    historical_free_cash_flows: tuple[float, ...] = ()


@dataclass(frozen=True, slots=True)
class DcfAssumptions:
    stage_one_years: int
    stage_two_years: int
    stage_one_growth_rate: float
    stage_two_growth_rate: float
    terminal_growth_rate: float
    discount_rate: float


@dataclass(frozen=True, slots=True)
class SensitivityConfig:
    growth_rate_delta: float
    discount_rate_delta: float


@dataclass(frozen=True, slots=True)
class ProjectedCashFlow:
    year: int
    stage: int
    growth_rate: float
    free_cash_flow: float
    discount_factor: float
    present_value: float


@dataclass(frozen=True, slots=True)
class TerminalValueCalculation:
    final_projected_free_cash_flow: float
    terminal_year_free_cash_flow: float
    capitalization_spread: float
    undiscounted_terminal_value: float
    discount_factor: float
    present_value: float
    concentration: float


@dataclass(frozen=True, slots=True)
class ValuationDecomposition:
    present_value_stage_one: float
    present_value_stage_two: float
    present_value_projected_cash_flows: float
    present_value_terminal_value: float
    enterprise_value: float
    net_debt: float
    net_debt_adjustment: float
    equity_value: float


@dataclass(frozen=True, slots=True)
class FcfStabilityAnalysis:
    observation_count: int
    minimum_free_cash_flow: float
    maximum_free_cash_flow: float
    mean_absolute_free_cash_flow: float
    normalized_range: float
    sign_change_count: int
    is_unstable: bool


@dataclass(frozen=True, slots=True)
class SensitivityPoint:
    assumptions: DcfAssumptions
    intrinsic_value_per_share: float


@dataclass(frozen=True, slots=True)
class SensitivityInterval:
    method: str
    is_probability_interval: bool
    growth_rate_delta: float
    discount_rate_delta: float
    central_value_per_share: float
    lower_bound_per_share: float
    upper_bound_per_share: float
    evaluated_points: tuple[SensitivityPoint, SensitivityPoint]


@dataclass(frozen=True, slots=True)
class UnitMetadata:
    monetary_values: str
    share_count: str
    per_share_value: str
    rates: str
    durations: str
    discount_factors: str
    concentration: str


@dataclass(frozen=True, slots=True)
class DcfResult:
    inputs: DcfInput
    assumptions: DcfAssumptions
    projected_cash_flows: tuple[ProjectedCashFlow, ...]
    terminal_value: TerminalValueCalculation
    decomposition: ValuationDecomposition
    intrinsic_value_per_share: float
    sensitivity_interval: SensitivityInterval
    fcf_stability: FcfStabilityAnalysis | None
    warnings: tuple[str, ...]
    units: UnitMetadata

    def to_dict(self) -> dict[str, Any]:
        """Return a recursively expanded representation with primitive values."""
        return asdict(self)


class DcfValidationError(ValueError):
    """Structured invalid-input error raised before any valuation is returned."""

    def __init__(self, field: str, code: str, message: str) -> None:
        self.field = field
        self.code = code
        self.message = message
        super().__init__(message)

    def to_dict(self) -> dict[str, str]:
        return {"field": self.field, "code": self.code, "message": self.message}
