# Valuation methodology

## Principle

DCFLens keeps valuation deterministic, inspectable, and separate from narrative analysis. The same input facts and scenario parameters must always produce the same numeric result. AI may propose a labeled scenario, but it does not own the baseline calculation.

The implemented domain contract, exact units, validation ranges, machine-readable fields, stability rule, and sensitivity construction are specified in [dcf-engine.md](dcf-engine.md).

## DeltaDCF reference scenario

The initial reference scenario preserves DeltaDCF's published baseline so results can be compared during implementation:

| Input | Reference value |
| --- | ---: |
| Starting free cash flow | Latest annual operating cash flow minus absolute capital expenditure |
| Stage 1 | 5 years at 18% growth |
| Stage 2 | 5 years at 10% growth |
| Terminal growth | 3% |
| Discount rate | 9% |

These are scenario assumptions, not universal estimates of a company's future. DCFLens must display them, allow reviewed alternatives, and never imply that the defaults are company-specific forecasts.

## Input definitions

### Starting free cash flow

For the reference scenario:

```text
FCF0 = operating cash flow - abs(capital expenditures)
```

Both components must refer to the same annual period and currency. Their evidence records must identify the source concepts, units, filing, accession, and selection rule. If either component is missing, the baseline valuation is unavailable.

### Net debt

```text
net debt = interest-bearing debt - cash and permitted cash equivalents
```

The exact included debt and cash concepts must be disclosed. Missing debt must not silently become zero. A verified zero-debt fact may be zero.

### Shares

Per-share value should use a documented diluted share measure aligned to the valuation date. If current shares outstanding and weighted-average diluted shares differ, DCFLens must show which measure was selected and why.

## Projection

For each projected year `t` with applicable growth rate `g_t`:

```text
FCF_t = FCF_(t-1) * (1 + g_t)
PV(FCF_t) = FCF_t / (1 + r)^t
```

The reference scenario uses `g_t = 18%` for years 1 through 5 and `10%` for years 6 through 10.

## Terminal value

At the end of year `n`:

```text
terminal value = FCF_n * (1 + g_terminal) / (r - g_terminal)
PV(terminal value) = terminal value / (1 + r)^n
```

The engine must reject `r <= g_terminal`.

## Enterprise, equity, and per-share value

```text
enterprise value = sum(PV projected FCFs) + PV terminal value
equity value = enterprise value - net debt
intrinsic value per share = equity value / diluted shares
```

The engine must reject non-positive shares and non-finite inputs or results.

## Assumption-set model

The domain engine calculates exactly one final valuation per call from one explicit assumption set. It does not assign bull, base, bear, or other scenario names. Comparing multiple user-authored assumption sets is an orchestration concern outside the domain engine.

The returned sensitivity interval changes assumptions symmetrically around that one valuation. It is explicitly marked as non-probabilistic and must not be displayed as a confidence or probability interval.

## AI adjustment policy

DeltaDCF currently validates these model-proposed offset ranges:

| Offset | DeltaDCF bound |
| --- | ---: |
| Stage 1 growth | -15 to +15 percentage points |
| Stage 2 growth | -8 to +8 percentage points |
| Discount rate | -5 to +10 percentage points |

DCFLens should treat those bounds as a reference requiring product and finance review, not automatically adopt them. They are wide enough to create very large valuation changes. The first implementation should either use narrower reviewed bounds or expose AI output as commentary without applying it until evidence and sensitivity tests are complete.

## Sensitivity and warnings

The result shows sensitivity across explicit growth and discount-rate deltas. It warns when:

- Terminal value forms an unusually large share of enterprise value.
- The discount rate approaches the terminal growth rate.
- Starting FCF is negative, volatile, stale, or derived from incomplete facts.
- Net debt or shares come from a different period than the cash-flow input.
- A fallback provider or lower-confidence concept alias was used.

## Required verification fixtures

- A fixed input fixture with an independently calculated enterprise value.
- A per-share fixture covering positive debt, net cash, and zero debt.
- Guards for `discount_rate <= terminal_growth_rate`, zero shares, NaN, infinity, and empty stages.
- A regression fixture that reproduces the DeltaDCF reference scenario before any deliberate methodology change.
- Property checks that a higher discount rate lowers value and, within valid domains, a higher growth rate raises value.
