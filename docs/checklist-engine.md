# Deterministic ten-point checklist engine

## Contract boundary

The implementation evaluates the original DeltaDCF checklist preserved in [deltadcf-checklist.md](deltadcf-checklist.md). `apps/api/app/checklist/contract.py` contains exactly ten frozen items in their original order. The evaluator returns exactly one result for each item and has no aggregate score, BUY/SELL recommendation, or replacement framework.

Sector adaptation can change only applicability, supporting metrics, context, interpretation, evidence selection, the plain-English explanation, and the technical caveat. It cannot change the item number or text.

The engine is deterministic. It consumes normalized SEC facts and already-validated filing observations. It does not call SEC, FastAPI, a cache, or an AI provider. Raw or unvalidated model output must not be passed directly into `QualitativeChecklistFacts`.

## Result contract

Every `ChecklistResult` contains:

- original checklist number and exact text;
- one of `SUPPORTS`, `WEAKENS`, `MONITOR`, `UNKNOWN`, or `NOT_APPLICABLE`;
- plain-English and technical explanations;
- an applicability reason;
- machine-readable supporting metrics;
- complete structured-fact or filing evidence references;
- missing-information labels;
- sector context;
- potential valuation relevance.

`UNKNOWN` means the item applies but evidence cannot support a conclusion. `NOT_APPLICABLE` means the underlying ordinary-company interpretation is not economically relevant to that business type. Missing data never becomes zero and does not by itself produce `WEAKENS`.

## Deterministic evaluation rules

### Item 1: gross profit margin

```text
gross profit margin = gross profit / revenue
```

Aligned annual revenue must be positive. A margin strictly above 20% `SUPPORTS`; 20% or below `WEAKENS`. The item remains present for banks and other sectors where gross profit may not be a standard reported subtotal. In that case missing aligned facts produce `UNKNOWN`, not `NOT_APPLICABLE`.

The explanation states that a high gross margin is not proof of a moat.

### Item 2: revenue and gross-profit growth

For the latest two aligned annual periods:

```text
normalized growth = (latest - prior) / abs(prior)
alignment gap = abs(revenue growth - gross profit growth)
```

- Gap through 5 percentage points with both measures non-negative: `SUPPORTS`.
- Gap above 5 through 10 points: `MONITOR`.
- Gap above 10 points: `WEAKENS`.
- Both measures declining: at best `MONITOR`, even when aligned.

Zero comparison denominators or fewer than two aligned periods produce `UNKNOWN`.

### Item 3: EPS, profits, and dilution

The engine compares normalized annual changes in net income, diluted EPS, and diluted average shares.

- EPS within 10 percentage points of net-income growth and diluted-share growth no greater than 2%: `SUPPORTS`.
- Positive net-income growth with non-positive EPS growth, or dilution above 5% with material EPS underperformance: `WEAKENS`.
- Other supported but inconclusive combinations: `MONITOR`.

Two aligned periods and non-zero comparison values are required.

### Item 4: debt level

For an ordinary operating company, the preferred metric is:

```text
net debt = total debt - cash and short-term investments
net debt to FCF = net debt / latest positive FCF
```

- Through 2.5 times: `SUPPORTS`.
- Above 2.5 through 4.0 times: `MONITOR`.
- Above 4.0 times: `WEAKENS`.

When that ratio is unavailable but positive total assets exist, total debt to assets is used: through 40% supports, above 40% through 60% monitors, and above 60% weakens. A sourced zero-debt fact supports; missing debt does not.

Ordinary debt interpretation is `NOT_APPLICABLE` to banks and financial institutions. Their explanation calls for regulatory capital, asset quality, liquidity, and funding analysis instead.

### Item 5: inventory and PAT margin

The engine compares inventory growth with revenue growth and calculates PAT margin as net income divided by revenue.

- Inventory growth no more than 5 percentage points above revenue growth, with PAT-margin deterioration no worse than 1 point: `SUPPORTS`.
- Inventory more than 10 points above revenue while PAT margin falls more than 1 point: `WEAKENS`.
- Other valid combinations: `MONITOR`.

The item is `NOT_APPLICABLE` for software-led technology businesses and financial institutions. A utility with no material reported inventory is also not applicable, while a utility reporting material inventory is evaluated. Retail, healthcare products, and industrial examples require evidence; missing evidence produces `UNKNOWN`.

### Item 6: sales and receivables

```text
receivables growth excess = receivables growth - revenue growth
```

- Excess through 5 percentage points: `SUPPORTS`.
- Above 5 through 15 points: `MONITOR`.
- Above 15 points: `WEAKENS`.

Non-positive operating cash flow prevents a supporting status. Ordinary trade-receivables interpretation is `NOT_APPLICABLE` to banks because loans and financial receivables are operating assets; bank asset-quality analysis is separate.

### Item 7: cash flow from operations

Latest annual operating cash flow strictly above zero `SUPPORTS`; zero or negative `WEAKENS`; missing `UNKNOWN`. The rule applies across sectors.

### Item 8: return on equity

```text
average equity = (current equity + prior equity) / 2
ROE = net income / average equity
```

ROE strictly above 25% `SUPPORTS` only when average equity is positive, prior equity is available, and equity has not contracted by more than 20% in a way that can inflate the result. A result with only ending equity or another identified distortion `MONITOR`s regardless of the calculated rate. With a complete, positive-equity denominator, ROE at or below 25% `WEAKENS`. Zero or negative average equity `MONITOR`s without performing a misleading division.

The threshold remains present for banks, utilities, and every other sector, but the explanation discloses balance-sheet, regulatory, buyback, and negative-equity distortions.

### Item 9: business diversity

This item requires a validated business-line count plus direct Item 1 or segment-disclosure evidence.

- One or two lines: `SUPPORTS`.
- Three lines: `MONITOR`.
- More than three: `WEAKENS`.

The count describes complexity, not business quality. Missing count or evidence produces `UNKNOWN`.

### Item 10: subsidiaries

This item requires a validated subsidiary count plus Exhibit 21 or equivalent direct filing evidence.

- Ten or fewer subsidiaries: `SUPPORTS`.
- More than ten: `MONITOR`.

Count alone never produces `WEAKENS` and never alleges siphoning, misconduct, or related-party abuse. Those claims require separate direct evidence and human review. Missing count or evidence produces `UNKNOWN`.

## Evidence rules

Numeric metrics retain the complete `EvidenceReference` objects selected by SEC normalization. Business-line and subsidiary observations use `FilingEvidenceReference`, including CIK, accession, form, filing date, direct URL, locator, description, and retrieval timestamp. Supporting metrics list the evidence IDs used in each calculation.

Evidence is deduplicated by evidence ID in the final result. Explanations never use a generic annual-report link as a substitute for claim-level evidence.

## Valuation boundary

Checklist results provide research context. They do not automatically alter baseline growth, discount rate, cash flow, net debt, or diluted shares. Any reviewed scenario change must remain separate and preserve its own rationale and evidence. There is intentionally no universal composite score because aggregation would conceal missing data, sector applicability, and materially different evidence quality.
