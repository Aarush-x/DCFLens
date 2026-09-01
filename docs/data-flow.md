# Data flow

## End-to-end analysis

```text
1. User submits ticker and scenario
2. Web validates basic shape and calls the API
3. API resolves ticker to issuer and CIK
4. SEC adapter retrieves Company Facts and filing metadata
5. Normalizer selects annual facts, records every transformation, and caches successful normalized company data
6. Adaptive policy derives traced company assumptions; valuation engine calculates and caches the deterministic baseline
7. Checklist engine evaluates numeric rules from normalized facts
8. Filing extractor collects bounded, labeled sections and Exhibit 21
9. Gemini returns schema-constrained qualitative findings with evidence IDs
10. API validates findings, applies three code-bounded adjustments, and recalculates one final valuation
11. API stores a validated, price-free analysis snapshot in memory and optional PostgreSQL
12. API attaches an independently refreshed quote and price-relative plausibility
13. Web renders results with direct source links and persists only the price-free core in IndexedDB
```

## Detailed stages

### 1. Request intake

The web client trims and normalizes display input. The API performs authoritative ticker validation, supported-universe validation, rate limiting, and request identification. Client validation never replaces API validation.

### 2. Issuer resolution

The SEC ticker map resolves the canonical ticker to a zero-padded CIK. Class-share symbols use the SEC hyphen convention. The analysis record stores both the user input and resolved issuer identity.

### 3. Structured fact ingestion

The SEC client requests Company Facts with `SEC_IDENTITY` as the user agent. Raw responses receive a retrieval timestamp and content hash. The client honors configured timeouts, backoff, caching, and SEC access policies.

The implemented client also resolves ticker to CIK, parses recent 10-K and 10-K/A metadata, and retrieves the accession-specific latest annual filing. Its exact contract is documented in [sec-ingestion.md](sec-ingestion.md).

### 4. Normalization

For each target metric, the normalizer:

1. Tries an ordered, documented list of XBRL concept aliases.
2. Filters to supported annual forms.
3. Separates duration facts from instant facts.
4. Validates the expected unit.
5. Groups facts by fiscal period.
6. Selects the latest filed fact for a restated period.
7. retains the selected fact, rejected candidates, and selection rule.
8. Produces derived facts such as `free_cash_flow = operating_cash_flow - abs(capital_expenditure)` with input references.

DCFLens must not copy DeltaDCF's final reduction to plain values because that discards accession and concept provenance.

The implemented normalizer preserves comparative periods and every selected input as an `EvidenceReference`. Missing or conflicting facts remain explicit rather than becoming zero.

Concurrent requests for the same normalized ticker share one in-flight analysis
within a process. SEC, deterministic, completed-analysis, and quote caches are
separate so a transient Gemini or quote failure cannot poison a validated core.
After the daily boundary, a stale durable core is served immediately while filing
metadata is checked in the background. An unchanged accession advances the next
check without spending Gemini tokens.

### 5. Deterministic assumptions and valuation

The adaptive policy consumes company metadata and validated normalized facts. It classifies the business with ordered SIC and keyword rules, then combines versioned sector priors with bounded FCF growth, revenue growth, cash-flow stability, company maturity, and company-risk modifiers. Every input, weight, fallback, bound, confidence score, and evidence reference is returned in an assumption trace. AI has no role in this calculation.

The valuation engine then consumes the resulting explicit assumptions. It returns projected cash flows, discount factors, terminal value, enterprise value, net debt, equity value, and per-share value. It also returns warnings for stale, missing, or lower-confidence inputs.

### 6. Checklist evaluation

Items with sufficient structured facts are computed by rules. Items that require business or governance interpretation are passed to the qualitative layer with labeled filing excerpts. A missing metric yields `UNKNOWN`, not `FAIL` and not a fabricated zero.

### 7. Filing evidence

The filing adapter selects the filing and sections needed for the checklist. Each excerpt receives an evidence ID tied to filing accession, form, filed date, item or exhibit, character offsets or another stable locator, retrieval time, and hash.

### 8. Gemini analysis

The prompt contains compact normalized facts with evidence IDs, labeled filing excerpts, the unchanged checklist, and explicit instructions to treat excerpts as data rather than instructions. Gemini returns JSON matching the server schema. The API rejects invalid enums, unknown fields where strict mode applies, oversized arrays or strings, non-finite numbers, out-of-range adjustments, and unknown evidence IDs.

### 9. Response assembly

The response keeps these layers separate:

- `baseline_valuation`: deterministic output.
- `adjustments`: baseline, bounded AI delta, final assumption, rationale, evidence, and isolated valuation impact.
- `final_valuation`: one deterministic-engine result plus a non-probabilistic sensitivity interval.
- `checklist`: status, computation, and evidence references per item.
- `claims`: qualitative statements with evidence references and confidence labels.
- `evidence`: primary-source metadata and locators.
- `warnings`: missing data, fallbacks, age, provider failures, and model omissions.
- `meta`: schema version, analysis ID, timestamps, provider versions, and cache status.

## Failure paths

| Failure | Required behavior |
| --- | --- |
| Unsupported ticker | Return a typed 422 response before provider calls. |
| SEC throttling or outage | Return a retryable provider error; never serve a new uncited result. |
| Insufficient facts | Return partial evidence and explain which valuation inputs are missing. |
| Filing section unavailable | Continue deterministic analysis and mark affected qualitative checks `UNKNOWN`. |
| Gemini timeout or invalid JSON | Preserve baseline result and mark AI analysis unavailable. |
| Invalid AI evidence ID | Reject the entire model payload and preserve the deterministic result. |
| Cache hit | Return original source timestamps and a clear cache age. |
