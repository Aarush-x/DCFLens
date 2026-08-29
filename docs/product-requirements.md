# Product requirements

## Product intent

DCFLens turns public-company filings and normalized financial facts into an inspectable valuation workspace. A user should be able to see the result, the assumptions that produced it, and the primary evidence behind every material research claim.

The product is for research and education. It is not financial advice, a trading system, a portfolio optimizer, or a substitute for reading primary filings.

## Primary users

- An individual investor who wants a repeatable first-pass DCF and filing review.
- An analyst who wants to audit inputs, formulas, and evidence rather than accept a black-box price target.
- A learner who wants to understand how reported facts become normalized metrics and valuation scenarios.

## Required outcomes

1. Accept a supported ticker and resolve it to a stable issuer identity such as ticker plus CIK.
2. Retrieve SEC EDGAR facts and filing sections using a compliant, monitored `SEC_IDENTITY`.
3. Normalize source facts into a canonical financial model without losing units, periods, filings, or accession references.
4. Calculate a deterministic baseline DCF from explicit inputs.
5. Evaluate the unchanged DeltaDCF 10-point checklist using structured facts where possible and filing evidence where judgment is required.
6. Use Gemini only for evidence-backed qualitative extraction and analysis.
7. Show baseline, optional AI-proposed scenario adjustments, final scenario values, and all constraints separately.
8. Attach evidence references to every AI-generated material claim.
9. Distinguish missing data, unavailable providers, unsupported issuers, and model failure from a valid negative finding.
10. Expose health information suitable for Render without calling SEC, Gemini, or another paid or rate-limited provider.

## MVP scope

- US public companies with SEC EDGAR coverage. The initial supported universe must be explicit and versioned.
- SEC Company Facts for structured financial data.
- 10-K narrative sections and Exhibit 21 where available.
- Two-stage DCF with a Gordon Growth terminal value.
- Baseline and user-visible alternative scenarios.
- The unchanged 10-point checklist plus a separate management-integrity review.
- Evidence cards that link to primary filings and identify source locations.
- Next.js web client on Vercel and Dockerized FastAPI API on Render.

## Non-goals for the first release

- Brokerage connections, order execution, portfolio advice, or alerts.
- Intraday pricing or real-time financial statements.
- Silent support for issuers whose accounting taxonomy cannot be normalized reliably.
- Allowing model prose to overwrite source facts.
- Hiding source gaps by substituting uncited web content.
- Multi-provider AI fallback in production without an explicit configured policy.

## Functional requirements

### Analysis

- The same normalized inputs and scenario assumptions must produce the same numeric valuation.
- Free cash flow must be defined and displayed, including each source component.
- All rates must be stored as decimal fractions and displayed consistently as percentages.
- The API must reject `discount_rate <= terminal_growth_rate` and non-positive diluted shares.
- Missing required valuation inputs must stop the affected valuation. They must not be coerced to zero unless the accounting meaning is explicitly zero.

### Evidence

- Each normalized fact must carry its original concept, unit, period, filing form, accession number, filing date, and source URL when available.
- Restatements must remain visible. The selected value must include the selection rule and superseded candidates.
- Each qualitative finding must cite one or more evidence records or be labeled `unsupported`.
- Users must be able to open the cited primary source from the result.

### AI

- Filing text is untrusted input and cannot instruct the system or model.
- Structured SEC facts are authoritative for numeric checklist items.
- Model output must pass a strict schema, enum, size, finiteness, and range validation gate.
- A model failure must not change the deterministic baseline valuation.
- AI-proposed valuation adjustments must be optional, bounded, attributed, and displayed separately.

## Quality attributes

| Attribute | Requirement |
| --- | --- |
| Auditability | A reviewer can trace a displayed number or claim back to its source and transformation. |
| Security | Secrets stay server-side; production CORS uses exact origins; downloaded content is bounded. |
| Reliability | External failures return typed errors; health checks have no external dependencies. |
| Performance | Cache immutable or slow-changing SEC data with an explicit freshness policy. |
| Accessibility | Core analysis, errors, citations, and scenario controls work with keyboard and screen readers. |
| Observability | Logs include request and analysis identifiers without logging filing bodies, prompts, or secrets. |

## Acceptance criteria for implementation readiness

- The data contract and provenance fields are agreed before ingestion code is written.
- The supported issuer universe and fallback-provider policy are decided.
- Baseline DCF fixtures reproduce expected values independently of AI availability.
- Every checklist item has a documented evidence strategy and missing-data behavior.
- Deployment configuration validates required production variables before serving traffic.
- The documentation mapping in [deployment-mapping.md](deployment-mapping.md) is reflected in the eventual files.
