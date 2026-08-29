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

When several configured concepts exist for the same metric and period, concept order is authoritative. A lower-priority concept never replaces a higher-priority concept merely because it was filed later. Differing values generate `alternative_concept_conflict`. Facts in unexpected units are retained in `rejected_facts` and generate `conflicting_unit_rejected`.

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
| Total debt | USD | Instant | Direct total-debt concepts, otherwise matching current plus noncurrent debt components |
| Cash and short-term investments | USD | Instant | Direct combined concepts, otherwise matching cash plus short-term-investment components |
| Inventory | USD | Instant | `InventoryNet`, `InventoryFinishedGoodsNetOfAllowances` |
| Receivables | USD | Instant | `AccountsReceivableNetCurrent`, `AccountsNotesAndLoansReceivableNetCurrent` |
| Stockholders' equity | USD | Instant | `StockholdersEquity`, then the noncontrolling-interest-inclusive concept |
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
- timezone-aware retrieval timestamp.

Calculated facts retain every input evidence reference. Each reference records the derived formula plus its own source transformation, allowing a free-cash-flow, debt, or cash claim to resolve to every contributing SEC fact.

## Partial-data behavior

`NormalizationResult` always exposes the complete metric-key contract. Unavailable values are empty tuples and appear in `missing_metrics`; they are never silently set to zero. Stable warning codes explain missing metrics, rejected units, concept conflicts, restatements, amendments, and incomplete calculations. `rejected_facts` retains conflicting-unit observations for inspection.

This behavior is intentional for sector differences. A bank without gross profit or inventory returns its available revenue, income, equity, assets, debt, and cash facts while marking the other metrics missing.
