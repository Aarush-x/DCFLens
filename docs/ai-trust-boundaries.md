# AI trust boundaries

The implemented contract is specified in [trust-model.md](trust-model.md). This document records the broader product policy and production-readiness requirements.

## Trust model

Gemini is a constrained research assistant, not a source of record and not the valuation engine. SEC filings and structured facts are evidence. Deterministic code performs calculations. Human-readable model output remains a claim that must be validated and cited.

## Allowed uses

Gemini may:

- Classify filing excerpts against checklist items.
- Summarize business lines, risks, related-party disclosures, executive compensation, and subsidiaries.
- Identify passages that deserve review.
- Produce a schema-constrained `SUPPORTS`, `WEAKENS`, `MONITOR`, `UNKNOWN`, or `NOT_APPLICABLE` recommendation with evidence IDs for later validation; deterministic structured-fact results remain authoritative.
- Propose bounded additive adjustments to stage-one growth, stage-two growth, and discount rate when every adjustment includes a rationale and supplied evidence IDs.

## Prohibited uses

Gemini must not:

- Supply or overwrite authoritative financial facts.
- Perform the canonical DCF calculation.
- Convert missing facts to zero.
- Create evidence URLs, accessions, quotations, or source locators.
- Follow instructions embedded in filing text.
- expose secrets, prompts, or full filing text in logs or client errors.
- alter terminal growth, stage durations, shares, net debt, evidence records, DCF formulas, or the original checklist.
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

An invalid response is not partially trusted. The result uses `DETERMINISTIC_FALLBACK`, reports a machine-readable reason, and preserves the deterministic baseline valuation and sensitivity interval exactly.

## Provider configuration

- `GOOGLE_API_KEY` stays in `apps/api` and Render only.
- `GEMINI_MODEL` is explicit and logged by safe model identifier with each analysis.
- Production does not silently fall back to a local model or a different cloud model.
- Retries are bounded and limited to retryable failures.
- Timeouts and maximum prompt/output sizes are enforced.
- Provider responses are never logged verbatim in production.

### Bounded Gemini recovery

The REST adapter tries the configured `GEMINI_MODEL`, then the reviewed
`gemini-2.5-flash` fallback if the primary model fails with a retryable
availability, rate-limit, model-selection, or request error, or malformed JSON.
If the configured model is already `gemini-2.5-flash`, it is not tried twice.
Model switches are logged; no local AI provider is introduced.

- HTTP 429, 500, 502, and 503 permit at most two delayed retries per model.
  Delays are 1 then 2 seconds, each with 0–0.25 seconds of jitter. Schema-mode
  changes do not reset this retry counter.
- All attempts share an eight-request ceiling and a scheduling deadline of
  `min(60 seconds, 2 × GEMINI_TIMEOUT_SECONDS)`. Each network attempt's timeout
  is capped by the remaining budget; no further attempt or backoff is scheduled
  once that budget expires. The standard-library socket timeout is an I/O
  timeout, not a hard cancellation of a slowly streaming response.
- Authentication failures and socket timeouts are not retried or sent to a
  fallback model. If both models remain overloaded, the API returns the unchanged
  deterministic valuation with `provider_unavailable`.
- The existing single HTTP-400 schema compatibility attempt keeps JSON MIME
  mode and places the complete application-owned schema in the **system
  instruction**. It does not mix schema instructions with untrusted evidence or
  mutate the original request. All exact-field, finite-number, adjustment-bound,
  checklist, and evidence-ID checks still run in Python.
- `gemini_transient_retry_scheduled` records only the model, HTTP status, retry
  and attempt numbers, and delay. Model fallback events identify the failed and
  next model. Never log API keys, prompts, evidence text, or generated text.
  `gemini_fallback_model_succeeded` means parseable JSON was received; only an
  analysis status of `APPLIED` confirms that subsequent domain validation passed.

Tests simulate temporary/persistent overload, authentication failures, exhausted
attempt/deadline budgets, schema rejection followed by overload, and valid versus
fabricated citations after recovery. They do not certify current Google capacity
or account quota. Paid API usage does not guarantee elimination of HTTP 503s.

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
