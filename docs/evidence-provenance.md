# Evidence provenance rules

## Goal

A DCFLens result is only inspectable if every material number and qualitative claim can be traced to a primary source and every transformation is recorded. Provenance is part of the domain model, not display-only metadata.

## Evidence record

Each source fact or excerpt receives a stable evidence ID and records:

| Field | Meaning |
| --- | --- |
| `evidence_id` | Stable identifier within the analysis or durable store. |
| `source_type` | Such as `sec_companyfacts`, `sec_filing_section`, or `sec_exhibit`. |
| `issuer` | Canonical ticker, CIK, and legal name when available. |
| `source_url` | Direct primary-source URL. |
| `accession_number` | Filing accession when the evidence is filing-backed. |
| `form` | Filing form such as `10-K` or `10-K/A`. |
| `filed_at` | Filing date. |
| `period_start` / `period_end` | Accounting period represented by the fact. |
| `concept` | Original taxonomy and XBRL concept for structured facts. |
| `unit` | Original unit such as USD or shares. |
| `value` | Original parsed value for a source fact. |
| `locator` | Item, exhibit, fact path, page, anchor, or character span. |
| `retrieved_at` | UTC retrieval timestamp. |
| `content_hash` | Hash of the raw payload or bounded source fragment. |
| `parser_version` | Version of the retrieval or extraction logic. |

Do not use a model-generated quote or paraphrase as evidence.

## Normalized fact

A normalized fact records:

- Canonical metric name.
- Normalized numeric value and unit.
- Source evidence IDs.
- Ordered concept-alias rule that matched.
- Duration or instant classification.
- Restatement and period-selection rule.
- Arithmetic transformation, if derived.
- Confidence level based on deterministic rules, never model confidence alone.
- Rejected candidates and rejection reasons when they affect auditability.

Derived facts form a directed graph. For example, free cash flow points to operating cash flow and capital expenditure evidence plus the exact formula version.

## Selection rules

- Prefer primary SEC data for supported US issuers.
- Filter to documented annual forms and reasonable annual durations.
- Validate expected units before comparing candidates.
- For the same period and concept, select the latest filed restatement while retaining superseded values.
- Never join unrelated periods merely because one value is the latest available without flagging the period mismatch.
- Never replace a missing required fact with zero unless a source fact states zero.
- A fallback provider must be explicit at both fact and analysis level.

## Filing excerpt rules

- Store filing accession, form, filed date, item or exhibit, and a stable locator.
- Bound excerpt length and preserve enough surrounding text for verification.
- Record extraction method and parser version.
- Label OCR-derived text separately from native filing text.
- Preserve Exhibit 21 as the preferred subsidiaries source when present.
- Treat all excerpt text as untrusted input.

## Claim rules

Every checklist explanation, management alert, or AI adjustment must contain `evidence_refs`.

- A citation must directly support the sentence it is attached to.
- Numeric claims cite structured facts, not model prose.
- A claim spanning multiple facts cites every necessary input.
- A missing disclosure is phrased as "not found in the reviewed evidence," not as proof that the event did not occur.
- Unsupported claims cannot affect valuation and cannot appear as confirmed findings.
- Conflicting evidence is shown with both references and a contradiction status.

## Freshness and caching

Cached results retain original retrieval times, filing versions, and hashes. The API reports cache age and expiration policy. Re-analysis after a new filing creates a new evidence set rather than mutating the old result in place.

## Privacy and retention

SEC filings are public, but prompts and logs can still reveal user research behavior. Logs should store identifiers, timing, status, and safe provider metadata, not full excerpts or model responses. A retention decision is required before durable analysis storage is implemented.

## Minimum acceptance tests

- A displayed DCF input resolves to an SEC fact and direct source URL.
- A derived FCF resolves to both input facts and the formula version.
- A restated period shows the selected and superseded facts.
- An AI claim with an unknown evidence ID is rejected.
- A numeric claim citing only filing prose is marked invalid when structured facts exist.
- Cached evidence preserves its original retrieval timestamp and hash.
