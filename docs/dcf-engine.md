# Deterministic DCF engine

## Scope and boundary

`apps/api/app/valuation/engine.py` calculates one deterministic two-stage discounted cash flow valuation from explicit inputs. The calculator has no FastAPI, SEC, AI-provider, cache, environment-variable, logging, or frontend-formatting dependency. It performs no I/O and reads no global mutable state.

The adjacent adaptive baseline builder consumes already-normalized SEC fact types and produces explicit `DcfAssumptions` plus complete traces. It does not alter the calculator's boundary or perform SEC requests. See [adaptive-baseline.md](adaptive-baseline.md).

The engine does not create bull, base, bear, or other named scenarios. Each call returns one final valuation and an assumption-sensitivity interval around that valuation.

## Inputs and units

| Field | Unit | Rule |
| --- | --- | --- |
| `starting_free_cash_flow` | Currency units per year | Finite. May be negative or zero; a negative value produces a warning rather than being replaced. |
| `net_debt` | Same currency units as FCF | Finite. Defined as interest-bearing debt minus cash. A negative value represents net cash. |
| `diluted_shares` | Shares | Finite and strictly greater than zero. |
| `currency` | Three-letter uppercase currency code | Identifies every monetary output; the engine performs no currency conversion. |
| `historical_free_cash_flows` | Same currency units per year, oldest to newest | Optional immutable tuple. When present, it contains at least two finite observations. |
| `stage_one_years` | Years | Integer from 1 through 50. |
| `stage_two_years` | Years | Integer from 1 through 50. Combined projection length cannot exceed 100 years. |
| Growth and discount rates | Decimal fractions | `0.18` means 18%, not 0.18%. All rates must be finite. |
| `growth_rate_delta` | Decimal fraction, equivalently absolute percentage points | `0.005` means a 0.5 percentage-point sensitivity change. |
| `discount_rate_delta` | Decimal fraction, equivalently absolute percentage points | `0.005` means a 0.5 percentage-point sensitivity change. |

Stage and terminal growth rates must be greater than `-1.0` and no greater than `1.0`. The discount rate must be greater than `0.0` and no greater than `1.0`. The discount rate must also be strictly greater than terminal growth. Sensitivity deltas must be greater than zero and no greater than `0.25`.

## Projection formulas

Let:

- `FCF_0` be starting annual free cash flow in currency units per year.
- `n_1` and `n_2` be the stage durations in years.
- `g_1` and `g_2` be stage growth rates as decimal fractions.
- `r` be the discount rate as a decimal fraction.
- `t` be a projected year from 1 through `n = n_1 + n_2`.

The rate applied in year `t` is:

```text
g_t = g_1, when 1 <= t <= n_1
g_t = g_2, when n_1 < t <= n
```

Projected free cash flow, discount divisor, and present value are:

```text
FCF_t = FCF_(t-1) * (1 + g_t)
discount_factor_t = (1 + r)^t
PV(FCF_t) = FCF_t / discount_factor_t
```

`FCF_t` and `PV(FCF_t)` are currency units. `discount_factor_t` is dimensionless. The engine returns every year, stage number, applied rate, projected FCF, discount factor, and present value without rounding.

Stage present values are:

```text
PV(stage 1) = sum(PV(FCF_t)) for t = 1 through n_1
PV(stage 2) = sum(PV(FCF_t)) for t = n_1 + 1 through n
PV(projected FCFs) = PV(stage 1) + PV(stage 2)
```

All three values are currency units.

## Terminal value

Let `g_terminal` be terminal growth as a decimal fraction. At the end of projection year `n`:

```text
terminal_year_FCF = FCF_n * (1 + g_terminal)
capitalization_spread = r - g_terminal
terminal_value_n = terminal_year_FCF / capitalization_spread
terminal_discount_factor = (1 + r)^n
PV(terminal_value) = terminal_value_n / terminal_discount_factor
```

Terminal-year FCF, undiscounted terminal value, and present value are currency units. Capitalization spread is a decimal fraction. The terminal discount factor is dimensionless. `r <= g_terminal` is invalid and no result is returned.

## Enterprise, equity, and per-share value

```text
enterprise_value = PV(projected FCFs) + PV(terminal_value)
net_debt_adjustment = -net_debt
equity_value = enterprise_value + net_debt_adjustment
intrinsic_value_per_share = equity_value / diluted_shares
```

Enterprise value, net debt, its adjustment, and equity value are currency units. Intrinsic value per share is `currency/share`. Negative net debt therefore adds net cash to equity value. The engine does not floor a negative enterprise, equity, or per-share value at zero.

## Terminal-value concentration

Terminal concentration is a dimensionless decimal fraction:

```text
terminal_concentration =
    abs(PV(terminal_value))
    / (abs(PV(projected FCFs)) + abs(PV(terminal_value)))
```

If both contributions are zero, concentration is zero. Absolute contributions keep the measure bounded from zero through one for negative-FCF valuations. A concentration of `0.75` or more emits `high_terminal_value_concentration`.

## Historical FCF stability

Historical analysis is descriptive and does not change the valuation. For `m` historical observations `H_i`, in currency units:

```text
mean_absolute_FCF = sum(abs(H_i)) / m
normalized_range = (max(H_i) - min(H_i)) / mean_absolute_FCF
```

When every observation is zero, normalized range is zero. A sign change is counted when two adjacent observations have a product below zero. History is classified as unstable when `normalized_range >= 1.0` or at least one sign change exists. The result then emits `unstable_historical_free_cash_flow`.

## Assumption-sensitivity interval

The sensitivity calculation evaluates two simultaneous symmetric perturbations around the single supplied assumption set. Let `delta_g` be `growth_rate_delta` and `delta_r` be `discount_rate_delta`:

```text
point 1 = (g_1 - delta_g, g_2 - delta_g,
           g_terminal - delta_g, r + delta_r)

point 2 = (g_1 + delta_g, g_2 + delta_g,
           g_terminal + delta_g, r - delta_r)

lower_bound = min(final_value, point_1_value, point_2_value)
upper_bound = max(final_value, point_1_value, point_2_value)
```

Durations, FCF, net debt, shares, and currency remain unchanged. Both perturbed points must satisfy every normal growth, discount, and terminal-spread validation rule; the engine never clamps an invalid endpoint.

The output sets `method` to `symmetric_assumption_perturbation` and `is_probability_interval` to `false`. This range communicates sensitivity to selected assumptions. It is not a confidence interval, forecast distribution, likelihood statement, or probability interval.

## Machine-readable result

The immutable `DcfResult` contains:

- normalized inputs and assumptions;
- one record for every projected year's intermediate calculation;
- terminal-value inputs and intermediate values;
- stage-one, stage-two, total projected, terminal, enterprise, net-debt, equity, and per-share decomposition;
- terminal concentration;
- the central value, sensitivity bounds, and both evaluated assumption points;
- optional historical FCF stability metrics;
- stable warning codes;
- explicit unit metadata.

`DcfResult.to_dict()` recursively expands the dataclasses into primitives suitable for JSON encoding. Calculations use finite IEEE-754 double-precision numbers and are not rounded inside the domain layer. Presentation rounding belongs outside this package.

Invalid inputs raise `DcfValidationError` with machine-readable `field`, `code`, and `message` attributes. No partial valuation is returned after a validation or non-finite-calculation failure.
