# SEC EDGAR ingestion and normalization

## Scope and trust boundary

`apps/api/app/data/sec` retrieves public SEC EDGAR data and converts annual XBRL facts into evidence-preserving domain records. It does not perform valuation, call AI providers, expose FastAPI routes, format frontend values, or silently substitute missing financial facts.

All filing text and issuer-provided XBRL are external data. SEC is the provider and source of record, but normalization decisions remain explicit, inspectable transformations.

## Official sources

| Purpose | Direct endpoint |
| --- | --- |
| Ticker to CIK mapping | `https://www.sec.gov/files/company_tickers.json` |
| Company Facts | `https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json` |
| Filing submissions | `https://data.sec.gov/submissions/CIK##########.json` |
| Filing document | `https://www.sec.gov/Archives/edgar/data/{cik}/{accession_without_dashes}/{primary_document}` |

CIKs are normalized to ten digits for data APIs. Filing archive paths use the CIK without leading zeroes and the accession without dashes. Primary-document names and accessions are validated before URL construction.

The normalizer accepts only the exact CIK-specific Company Facts endpoint as evidence provenance. A generic issuer browse page or annual-report landing page is rejected.

## Client configuration

`SecClientConfig` is explicit and immutable.

| Field | Default | Bound or behavior |
| --- | ---: | --- |
| `user_agent` | Required | Contains an application or organization name and monitored email address. |
| `timeout_seconds` | 15 | Greater than zero and no more than 120 seconds; passed to every request. |
| `max_retries` | 2 | Zero through five retries after the first attempt. |
| `retry_backoff_seconds` | 0.5 | Zero through 30 seconds; exponential `base * 2^retry_index`. |
| `min_request_interval_seconds` | 0.1 | At least 0.1 seconds, keeping one client at or below ten requests per second. |
| `max_response_bytes` | 20,000,000 | 1,024 through 100,000,000 bytes, enforced while reading. |
| `cache_ttl_seconds` | 900 | One second through one day. |
| `cache_max_entries` | 32 | One through 512 responses. |

The default identity is not fabricated. Application composition must pass the configured `SEC_IDENTITY`; configuration fails if it does not contain both an identity and email.

HTTP `429`, `500`, `502`, `503`, and `504`, plus network and timeout failures, are retryable within the configured attempt bound. Other HTTP errors and oversized responses fail immediately. The client never retries forever.

Request pacing is serialized per client instance and applies to every uncached attempt, including retries. The cache is instance-local, thread-safe, TTL-bounded, and entry-bounded with least-recently-used eviction. Cache hits retain the original retrieval timestamp and do not generate SEC traffic.

## Ticker and filing selection

Ticker input is trimmed, uppercased, and converts dot class-share notation to the SEC hyphen form. Resolution returns canonical ticker, ten-digit CIK, and SEC company title.

The submissions parser reads the parallel `filings.recent` arrays, validates their lengths, dates, accession numbers, and primary documents, removes duplicate accessions, and retains forms `10-K` and `10-K/A`.

Filings are ordered by report date, filing date, then amendment status. For the newest report period, a later-filed `10-K/A` therefore supersedes the original `10-K`. `get_latest_10k` retrieves the accession-specific primary document under the same timeout, retry, pacing, size, and cache bounds.

## Annual fact eligibility

A reported fact is eligible only when:

- its form is `10-K` or `10-K/A`;
- its fiscal-period code is `FY`;
- its unit exactly matches the metric contract;
- value, end date, and filing date are valid and finite;
- a duration fact has a valid start date and spans 250 through 450 days;
- an instant fact has a valid period end.

Facts are grouped by fiscal period end, preserving comparative periods. The normalized fiscal year is the year of the fact's period end, not the `fy` value of the filing that repeated the comparative fact. This avoids relabeling an older comparative period as the newer filing year.

Exact duplicates are removed. Within one concept and period, the latest-filed value is selected and differing prior values generate `restated_fact_selected`. A selected `10-K/A` generates `amended_filing_selected`.

When several configured concepts exist for the same metric and period, concept order is authoritative. A lower-priority concept never replaces a higher-priority concept merely because it was filed later. Candidates sharing a period end are ordered by concept priority, then latest filing date, then `10-K/A` ahead of `10-K`, then accession number, so the same payload always yields the same selection. Differing values generate `alternative_concept_conflict`. Facts in unexpected units are retained in `rejected_facts` and generate `conflicting_unit_rejected`.

## Metric contracts

Concepts are tried from left to right.

| Metric | Unit | Period | Concepts or derivation |
| --- | --- | --- | --- |
| Revenue | USD | Duration | `RevenueFromContractWithCustomerExcludingAssessedTax`, `Revenues`, `SalesRevenueNet`, `SalesRevenueGoodsNet` |
| Gross profit | USD | Duration | `GrossProfit` |
| Net income | USD | Duration | `NetIncomeLoss`, `ProfitLoss` |
| Diluted EPS | USD/shares | Duration | `EarningsPerShareDiluted` |
| Diluted average shares | shares | Duration | `WeightedAverageNumberOfDilutedSharesOutstanding` |
| Current shares outstanding | shares | Instant | `dei:EntityCommonStockSharesOutstanding` |
| Operating cash flow | USD | Duration | `NetCashProvidedByUsedInOperatingActivities` |
| Capital expenditure | USD | Duration | Absolute value of `PaymentsToAcquirePropertyPlantAndEquipment` or `PaymentsToAcquireProductiveAssets` |
| Free cash flow | USD | Duration | Operating cash flow minus absolute capital expenditure for the exact same start and end dates |
| Total debt | USD | Instant | `LongTermDebtAndFinanceLeaseObligations`, `LongTermDebtAndCapitalLeaseObligations`, `LongTermDebt`, otherwise the matching current plus noncurrent components in **Derived facts** |
| Cash and short-term investments | USD | Instant | `CashCashEquivalentsAndShortTermInvestments`, `CashAndShortTermInvestments`, otherwise the matching cash plus short-term-investment components in **Derived facts** |
| Inventory | USD | Instant | `InventoryNet`, `InventoryFinishedGoodsNetOfAllowances` |
| Receivables | USD | Instant | `AccountsReceivableNetCurrent`, `AccountsNotesAndLoansReceivableNetCurrent` |
| Stockholders' equity | USD | Instant | `StockholdersEquity`, `StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest` |
| Total assets | USD | Instant | `Assets` |

No currency conversion occurs. `USD`, `USD/shares`, and `shares` are separate exact units.

## Derived facts

Derived facts require all components for the same period and unit:

```text
capital_expenditure = abs(reported_capital_expenditure)
free_cash_flow = operating_cash_flow - abs(capital_expenditure)
total_debt = current_debt + noncurrent_debt
cash_and_short_term_investments = cash_and_cash_equivalents
                                  + short_term_investments
```

The component concepts are internal. They are never exposed as their own metric keys in the result.

| Component | Concepts, tried in order |
| --- | --- |
| `current_debt` | `LongTermDebtAndFinanceLeaseObligationsCurrent`, `LongTermDebtCurrent` |
| `noncurrent_debt` | `LongTermDebtAndFinanceLeaseObligationsNoncurrent`, `LongTermDebtNoncurrent` |
| `cash_and_cash_equivalents` | `CashAndCashEquivalentsAtCarryingValue` |
| `short_term_investments` | `ShortTermInvestments` |

For `total_debt` and `cash_and_short_term_investments`, a directly reported fact wins over the derived sum for the same period end. The derived value fills only the periods where no direct fact exists. `free_cash_flow` has no direct concept and is always derived.

Free-cash-flow components must also share the same period start. A missing component is not treated as zero. When only some components exist, the combined metric remains missing and emits `incomplete_calculation`.

## EvidenceReference contract

Every reported normalized fact contains an immutable `EvidenceReference` with:

- stable evidence ID;
- provider (`SEC EDGAR`);
- ten-digit CIK;
- accession number when supplied by Company Facts;
- filing form and filing date;
- fiscal period;
- taxonomy-qualified XBRL concept;
- exact source unit;
- raw and normalized numeric values;
- explicit transformation or calculation;
- direct CIK-specific Company Facts URL;
- timezone-aware retrieval timestamp;
- `filing_anchor`, the inline-XBRL element id the figure carries in the latest annual filing, or `None`;
- `filing_highlight`, the figure as that filing prints it (`111,482`), or `None`.

## Filing anchors

Company Facts gives a value; it does not give a place. `app/data/sec/fact_anchors.py` reads the latest annual filing's primary inline-XBRL document and, for each evidence reference drawn from that same accession, records the element id the figure is tagged with. The frontend appends it to the filing URL as a fragment, so a reader following a citation lands on the line in the cash-flow statement rather than on the cover page.

An anchor is navigation and never a value. It is written only when concept, period, unit **and** magnitude all match a single tagged element, and only for facts rendered in the document body — facts inside `ix:header`/`ix:hidden` carry ids but have no layout, so a link to one would scroll nowhere. Magnitudes are compared unsigned, because a cash-flow statement prints capital expenditure as a negative and Company Facts stores it as a positive; that is the same line item either way, which is the whole of what an anchor claims.

### Highlighting the figure

`filing_highlight` carries the printed form of the figure so the frontend can append a scroll-to-text-fragment and let the browser paint its own temporary mark on the number. A browser resolves a text fragment to the **first** match in document order, and a directive that matches nothing is not merely ignored — the browser discards the element id along with it and scrolls nowhere. So the highlight is offered only where it is provably safe: the parser records each figure's position as the text streams, and keeps the highlight only when the first printed occurrence of that string in the document body is this fact's own. A figure the MD&A printed earlier gets no highlight and keeps its anchor.

Counting is done on the body text as a reader sees it. Block-level elements insert a boundary, because a browser will not match across one and neither may we: without that, adjacent table cells concatenate into `activities111,482` and the figure reads as the tail of a word. Text inside `ix:header` and inside `style`/`script`/`title` is excluded, and the haystack is bounded at 4M characters — past the bound nothing is offered, since a partial count could call a repeated figure unique.

Measured against eight live filings, 35–86% of anchored figures qualify (AAPL 86%, JNJ 81%, AMZN 85%, WMT 35%). Forty randomly sampled directives were confirmed in a browser to land on their own figure.

The pass is best-effort by construction. It runs outside the block that maps SEC failures onto errors, reuses the document the NVIDIA cash fallback already fetched when there is one, and returns the result untouched on any failure: a filing we cannot read costs the reader a precise link and costs the valuation nothing.

Every `NormalizedFact` also carries a `quality` of `reported` for a directly selected SEC fact or `calculated` for a derived one. Calculated facts retain every input evidence reference. Each reference records the derived formula plus its own source transformation, allowing a free-cash-flow, debt, or cash claim to resolve to every contributing SEC fact.

## Warning codes

Warnings are descriptive. They never remove a fact from the result or substitute a value. Each carries the metric and, where the warning is period-specific, the fiscal year. Warnings are deduplicated by code, metric, fiscal year, and message.

| Code | Emitted when |
| --- | --- |
| `missing_metric` | No eligible annual fact exists for an output metric. The key is still present with an empty tuple and is listed in `missing_metrics`. |
| `incomplete_calculation` | A derived metric has some but not all of its required components, so it stays missing rather than treating the absent component as zero. |
| `restated_fact_selected` | One concept reported differing values for one period. The latest-filed value was selected. |
| `amended_filing_selected` | The selected fact came from a `10-K/A` rather than the original `10-K`. |
| `alternative_concept_conflict` | A lower-priority concept reported a different value for the same period. The higher-priority concept was kept. |
| `conflicting_unit_rejected` | Facts existed under a unit other than the metric contract. They are retained in `rejected_facts`. |

## Partial-data behavior

`NormalizationResult` always exposes the complete metric-key contract. Unavailable values are empty tuples and appear in `missing_metrics`; they are never silently set to zero. Stable warning codes explain missing metrics, rejected units, concept conflicts, restatements, amendments, and incomplete calculations. `rejected_facts` retains conflicting-unit observations for inspection.

This behavior is intentional for sector differences. A bank without gross profit or inventory returns its available revenue, income, equity, assets, debt, and cash facts while marking the other metrics missing.
