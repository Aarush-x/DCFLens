# Deterministic adaptive baseline

## Purpose and boundary

DCFLens derives one company-specific baseline assumption set before calling the pure DCF calculator. The baseline builder is deterministic: identical company metadata, normalized SEC facts, and prior configuration produce identical output. It imports no AI provider, performs no network requests, reads no environment variable, and does not make a probabilistic forecast.

The old DeltaDCF rates of 18% for stage one and 10% for stage two remain only in the regression test for the historical model. They are not DCFLens defaults.

Implementation files:

- `apps/api/app/valuation/adaptive.py` contains classification, signal calculation, bounds, modifiers, and traces.
- `apps/api/app/valuation/config/sector_priors.v1.json` contains all current priors, weights, thresholds, and rate caps.
- `apps/api/app/valuation/priors.py` validates and loads that configuration without caching mutable global state.

## Inputs and units

| Input | Unit | Rule |
| --- | --- | --- |
| SIC code | Four-digit integer | Preferred deterministic sector-classification input. |
| SIC and business descriptions | Text | Used only for ordered keyword fallback when SIC does not match. Text never supplies a numeric rate. |
| Years public | Years | Non-negative integer used for maturity classification. Missing uses an explicit unknown-maturity fallback. |
| Revenue history | Currency units per year | Annual normalized SEC facts, oldest to newest after internal sorting. |
| Free-cash-flow history | Currency units per year | Annual normalized `operating cash flow - abs(capital expenditure)` facts. |
| Total debt and cash | Currency units | Latest normalized values used for the net-debt-to-FCF risk modifier. |
| Growth and discount rates | Decimal fractions | `0.12` means 12%. |
| Confidence scores | Dimensionless score | Bounded from 0 through 1; not probability estimates. |

Every financial observation retains the selected fact's `EvidenceReference` records. A trace may have no evidence reference when the associated metadata or fact is unavailable; that absence is paired with a fallback and lower data-coverage confidence.

## Sector and business-type classification

Classification uses ordered, fixed rules:

1. Match a supplied SIC code to documented ranges for real estate, financials, utilities, retail, technology, healthcare, energy, or industrials.
2. If SIC is absent or unmatched, search the supplied SIC and business descriptions for ordered sector keywords.
3. If neither matches, use the versioned `other` prior.

An SIC match has classification confidence `1.0`, a keyword match `0.75`, and the explicit fallback `0.40`. The selected sector also provides the plain-language business type. These scores measure deterministic input coverage; they do not express a probability that the company belongs to a sector.

## Historical growth observations

For positive first and latest observations over `n` fiscal years, both normalized FCF growth and revenue growth use compound annual growth:

```text
growth = (latest value / first value)^(1 / n) - 1
```

FCF growth is not calculated when fewer than two observations exist, latest FCF is non-positive, or FCF has just crossed from non-positive to positive. A newly positive business therefore does not receive an unbounded percentage-growth signal. After at least two consecutive positive observations, CAGR uses that latest contiguous positive run rather than an older negative endpoint. Revenue CAGR requires positive endpoints. Raw CAGRs are retained in the trace before the configured signal caps are applied.

## Cash-flow stability

For annual normalized FCF values `F_i`:

```text
mean absolute FCF = sum(abs(F_i)) / observation count
normalized range = (max(F_i) - min(F_i)) / mean absolute FCF
sign changes = count of adjacent FCF pairs whose product is below zero
stability confidence = clamp(1 / (1 + normalized range) - 0.15 * sign changes, 0, 1)
```

When fewer than two FCF observations are available, stability confidence is the configured-behavior fallback `0.25`. Stability reduces the effective weight given to historical FCF growth, can subtract a bounded stage-one stability modifier, and adds a bounded discount-rate premium. It is a quality score, not statistical confidence.

## Company maturity

The versioned configuration assigns maturity using years public:

- `emerging`: 0 through 9 years;
- `established`: 10 through 19 years;
- `mature`: 20 years or more;
- `unknown`: years public missing.

Each state has visible stage-one and discount-rate modifiers. The current version adds growth and risk for emerging companies, reduces both for mature companies, and applies an uncertainty premium when maturity is unknown.

## Stage-one growth

The configured target weights are:

```text
sector prior          0.35
historical FCF growth 0.40
revenue growth        0.25
```

The FCF target weight is multiplied by stability confidence. Missing or unusable signals receive zero effective weight, and all remaining effective weights are normalized to sum to one:

```text
effective FCF weight = 0.40 * stability confidence
normalized weight_i = effective weight_i / sum(effective weights)
weighted blend = sum(signal_i * normalized weight_i)

stage-one pre-bound = weighted blend
                    + maturity modifier
                    + FCF-state modifier
                    + stability modifier
```

The final value is clamped to the intersection of the sector-specific and global stage-one bounds. The trace records the target, effective, and normalized weights; omitted signals; raw and bounded observations; every modifier; and whether each bound changed the result.

## Terminal and stage-two growth

Terminal growth is the selected sector's long-run prior, clamped to the global terminal-growth bounds.

Stage-two growth fades stage-one growth toward that terminal rate using the sector fade fraction `f`:

```text
stage-two growth = terminal growth
                 + f * (stage-one growth - terminal growth)
```

The result is bounded by both endpoints and the global stage-two bounds. Thus stage two cannot move farther away from the terminal rate than stage one. The trace reports both endpoint observations and their weights `f` and `1 - f`.

## Discount rate

The discount rate starts with the sector prior and adds only deterministic company-risk modifiers:

```text
discount pre-bound = sector discount prior
                   + stability premium
                   + data-coverage premium
                   + maturity modifier
                   + FCF-state modifier
                   + net-leverage modifier
```

The stability premium scales from zero to its configured maximum as stability confidence falls. The coverage premium behaves the same way for missing classification, FCF, revenue, leverage, or maturity inputs.

When debt and cash are present:

```text
net debt = total debt - cash and short-term investments
net-debt-to-FCF = net debt / latest positive FCF
```

Net cash receives the configured small discount-rate reduction. Moderate and high positive ratios receive their configured premiums. Missing debt, cash, or positive FCF produces an explicit fallback rather than inventing a ratio.

The rate is clamped to intersecting sector and global bounds. A final guard also enforces:

```text
discount rate >= terminal growth + configured minimum spread
```

The current minimum spread is two percentage points. The downstream DCF engine still independently rejects `discount rate <= terminal growth`.

## AssumptionTrace contract

The builder returns traces for stage-one growth, stage-two growth, terminal growth, and discount rate. Stage durations remain explicit configured inputs rather than inferred company forecasts. Each `AssumptionTrace` contains:

- raw observations and formulas;
- the selected sector prior and prior version;
- every company modifier;
- target, effective, and normalized weights;
- every fallback;
- every tested bound and whether it changed the value;
- the final baseline;
- deduplicated claim-level SEC evidence references;
- data-coverage and stability confidence scores;
- plain-English and technical explanations.

The four traces and final `DcfAssumptions` are machine-readable dataclasses. No trace text is used as a calculation input.

## Governance

Changing any prior, weight, threshold, modifier, or cap requires a new configuration version and regression review across sectors. Historical results must retain the prior version used. These priors are transparent prototype policy choices, not empirically calibrated market forecasts; calibration against long-horizon observations and finance review remains required before investment use.
