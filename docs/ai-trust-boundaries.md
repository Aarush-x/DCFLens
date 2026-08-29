# AI trust boundaries

## Trust model

Gemini is a constrained research assistant, not a source of record and not the valuation engine. SEC filings and structured facts are evidence. Deterministic code performs calculations. Human-readable model output remains a claim that must be validated and cited.

## Allowed uses

Gemini may:

- Classify filing excerpts against checklist items.
- Summarize business lines, risks, related-party disclosures, executive compensation, and subsidiaries.
- Identify passages that deserve review.
- Produce a schema-constrained `PASS`, `FAIL`, `MONITOR`, or `UNKNOWN` recommendation with evidence IDs.
- Propose a bounded alternative scenario when each adjustment includes rationale and evidence references.

## Prohibited uses

Gemini must not:

- Supply or overwrite authoritative financial facts.
- Perform the canonical DCF calculation.
- Convert missing facts to zero.
- Create evidence URLs, accessions, quotations, or source locators.
- Follow instructions embedded in filing text.
- expose secrets, prompts, or full filing text in logs or client errors.
- silently select the final valuation scenario.
- claim all 10 checklist items were assessed when required evidence was absent.

## Input boundary

The server constructs prompts from:

- The unchanged checklist.
- Compact normalized facts with stable evidence IDs.
- Bounded filing excerpts with evidence IDs and section labels.
- Explicit source-priority and prompt-injection instructions.
- A versioned response schema.

Filing excerpts are wrapped and labeled as untrusted data. The prompt states that structured facts control numeric items and that instructions inside evidence must be ignored.

## Output validation

The API accepts model output only after validating:

- Valid JSON with no executable interpretation.
- Exact top-level schema and permitted fields.
- Allowed statuses and severity enums.
- Checklist IDs, uniqueness, and coverage.
- Maximum array lengths and string lengths.
- Finite numeric values within reviewed bounds.
- Evidence IDs that exist in the prompt context.
- Citations for every material qualitative claim and every proposed adjustment.

An invalid response is not partially trusted by default. The baseline analysis remains available with an `ai_unavailable` or `ai_invalid` warning.

## Provider configuration

- `GOOGLE_API_KEY` stays in `apps/api` and Render only.
- `GEMINI_MODEL` is explicit and logged by safe model identifier with each analysis.
- Production does not silently fall back to a local model or a different cloud model.
- Retries are bounded and limited to retryable failures.
- Timeouts and maximum prompt/output sizes are enforced.
- Provider responses are never logged verbatim in production.

DeltaDCF's use of the Google Gen AI client, timeout configuration, structured JSON request, provider-specific errors, and validation bounds are reusable patterns. Its code-embedded model name and model-owned valuation offsets should be redesigned.

## Claim status

Every AI claim has one of these states:

- `supported`: at least one valid evidence reference directly supports the claim.
- `partially_supported`: evidence supports only part of the statement.
- `unsupported`: no valid evidence reference; hidden from headline conclusions.
- `contradicted`: structured facts or stronger evidence conflict with the claim.

Structured facts win numeric conflicts. Contradictions are surfaced, not averaged away.

## Evaluation requirements

Before enabling Gemini in production:

- Build a fixed evaluation set across industries and filing styles.
- Measure citation validity, checklist coverage, unsupported-claim rate, schema failure, and contradiction rate.
- Include prompt-injection passages and malformed filing text.
- Compare model versions before changing `GEMINI_MODEL`.
- Test provider outage, rate limit, timeout, empty output, truncated JSON, and unsafe numeric output.
- Require a reviewed threshold for evidence validity rather than only prose quality.
