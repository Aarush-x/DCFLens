from __future__ import annotations

import json
from dataclasses import dataclass
from importlib.resources import files
from pathlib import Path
from typing import Any, Mapping


@dataclass(frozen=True, slots=True)
class SectorPrior:
    key: str
    display_name: str
    business_type: str
    stage_one_growth: float
    terminal_growth: float
    discount_rate: float
    stage_one_bounds: tuple[float, float]
    discount_rate_bounds: tuple[float, float]
    stage_two_fade_fraction: float


@dataclass(frozen=True, slots=True)
class PriorConfig:
    version: str
    stage_one_years: int
    stage_two_years: int
    signal_weights: Mapping[str, float]
    global_bounds: Mapping[str, tuple[float, float] | float]
    maturity_modifiers: Mapping[str, Mapping[str, float | int | None]]
    fcf_state_modifiers: Mapping[str, Mapping[str, float]]
    risk_modifiers: Mapping[str, float]
    sectors: Mapping[str, SectorPrior]


class PriorConfigurationError(ValueError):
    """Raised when the checked-in sector-prior configuration is malformed."""


def load_prior_config(path: Path | None = None) -> PriorConfig:
    """Load a versioned prior file without caching or mutable global state."""
    config_path = path or Path(
        str(files("app.valuation.config").joinpath("sector_priors.v1.json"))
    )
    try:
        payload = json.loads(config_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise PriorConfigurationError(f"Unable to load sector priors: {exc}") from exc
    if not isinstance(payload, dict):
        raise PriorConfigurationError("Sector-prior configuration must be an object")

    sectors_payload = _mapping(payload, "sectors")
    sectors = {
        key: _sector_prior(key, value)
        for key, value in sectors_payload.items()
        if isinstance(key, str)
    }
    if "other" not in sectors:
        raise PriorConfigurationError("Sector-prior configuration requires an other sector")

    durations = _mapping(payload, "stage_durations")
    weights = _numeric_mapping(payload, "signal_weights")
    if abs(sum(weights.values()) - 1.0) > 1e-9:
        raise PriorConfigurationError("Signal weights must sum to 1.0")

    return PriorConfig(
        version=_string(payload, "version"),
        stage_one_years=_positive_int(durations, "stage_one_years"),
        stage_two_years=_positive_int(durations, "stage_two_years"),
        signal_weights=weights,
        global_bounds=_bounds_mapping(payload, "global_bounds"),
        maturity_modifiers=_nested_numeric_mapping(
            payload, "maturity_modifiers", allow_none=True
        ),
        fcf_state_modifiers=_nested_numeric_mapping(payload, "fcf_state_modifiers"),
        risk_modifiers=_numeric_mapping(payload, "risk_modifiers"),
        sectors=sectors,
    )


def _sector_prior(key: str, raw: object) -> SectorPrior:
    if not isinstance(raw, dict):
        raise PriorConfigurationError(f"Sector {key} must be an object")
    return SectorPrior(
        key=key,
        display_name=_string(raw, "display_name"),
        business_type=_string(raw, "business_type"),
        stage_one_growth=_number(raw, "stage_one_growth"),
        terminal_growth=_number(raw, "terminal_growth"),
        discount_rate=_number(raw, "discount_rate"),
        stage_one_bounds=_bounds(raw, "stage_one_bounds"),
        discount_rate_bounds=_bounds(raw, "discount_rate_bounds"),
        stage_two_fade_fraction=_number(raw, "stage_two_fade_fraction"),
    )


def _mapping(raw: Mapping[str, Any], key: str) -> Mapping[str, Any]:
    value = raw.get(key)
    if not isinstance(value, dict):
        raise PriorConfigurationError(f"{key} must be an object")
    return value


def _string(raw: Mapping[str, Any], key: str) -> str:
    value = raw.get(key)
    if not isinstance(value, str) or not value.strip():
        raise PriorConfigurationError(f"{key} must be a non-empty string")
    return value


def _number(raw: Mapping[str, Any], key: str) -> float:
    value = raw.get(key)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise PriorConfigurationError(f"{key} must be numeric")
    return float(value)


def _positive_int(raw: Mapping[str, Any], key: str) -> int:
    value = raw.get(key)
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise PriorConfigurationError(f"{key} must be a positive integer")
    return value


def _bounds(raw: Mapping[str, Any], key: str) -> tuple[float, float]:
    value = raw.get(key)
    if not isinstance(value, list) or len(value) != 2:
        raise PriorConfigurationError(f"{key} must contain two numeric bounds")
    lower = _list_number(value, 0, key)
    upper = _list_number(value, 1, key)
    if lower > upper:
        raise PriorConfigurationError(f"{key} lower bound exceeds upper bound")
    return lower, upper


def _list_number(raw: list[Any], index: int, key: str) -> float:
    value = raw[index]
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise PriorConfigurationError(f"{key} must contain numeric bounds")
    return float(value)


def _numeric_mapping(raw: Mapping[str, Any], key: str) -> Mapping[str, float]:
    value_map = _mapping(raw, key)
    return {name: _number(value_map, name) for name in value_map}


def _nested_numeric_mapping(
    raw: Mapping[str, Any], key: str, *, allow_none: bool = False
) -> Mapping[str, Mapping[str, float | int | None]]:
    result: dict[str, Mapping[str, float | int | None]] = {}
    for name, entry in _mapping(raw, key).items():
        if not isinstance(entry, dict):
            raise PriorConfigurationError(f"{key}.{name} must be an object")
        converted: dict[str, float | int | None] = {}
        for field, value in entry.items():
            if value is None and allow_none:
                converted[field] = None
            elif isinstance(value, bool) or not isinstance(value, (int, float)):
                raise PriorConfigurationError(f"{key}.{name}.{field} must be numeric")
            else:
                converted[field] = value
        result[name] = converted
    return result


def _bounds_mapping(
    raw: Mapping[str, Any], key: str
) -> Mapping[str, tuple[float, float] | float]:
    result: dict[str, tuple[float, float] | float] = {}
    for name, value in _mapping(raw, key).items():
        if isinstance(value, list):
            result[name] = _bounds({name: value}, name)
        elif isinstance(value, bool) or not isinstance(value, (int, float)):
            raise PriorConfigurationError(f"{key}.{name} must be numeric or bounds")
        else:
            result[name] = float(value)
    return result
