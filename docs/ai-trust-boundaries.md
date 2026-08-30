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
`gemini-3.5-flash-lite` fallback if the primary model fails with a retryable
availability, timeout, rate-limit, model-selection, or request error, or malformed JSON.
If the configured model is already `gemini-3.5-flash-lite`, it is not tried twice.
Model switches are logged; no local AI provider is introduced.

- HTTP 408, 429, 500, 502, and 503/504 and socket timeouts (including timeouts
  wrapped in `URLError`) permit at most two delayed retries per model.
  Delays are 1 then 2 seconds, each with 0–0.25 seconds of jitter. Schema-mode
  changes do not reset this retry counter.
- All attempts share an eight-request ceiling and a scheduling deadline of
  `min(60 seconds, 2 × GEMINI_TIMEOUT_SECONDS)`. Each network attempt's timeout
  is capped by the remaining budget. Each model gets an equal share of the
  remaining time so slow primary retries cannot use the fallback's scheduling
  window. With the default settings, the primary has 30 seconds and the fallback
  receives the remaining time, up to its configured 30-second I/O timeout.
  A primary timeout at 30 seconds therefore switches immediately to the fallback;
  a short transient timeout can retry the primary within its window. Raising
  `GEMINI_TIMEOUT_SECONDS` to 120 does not raise the 60-second total budget.
  No further attempt or backoff is scheduled
  once that budget expires. The standard-library socket timeout is an I/O
  timeout, not a hard cancellation of a slowly streaming response.
- Authentication failures are not retried or sent to a fallback model. If both
  models time out, the unchanged deterministic valuation is returned with
  `provider_timeout`. An exhausted deadline is not evidence of a rate limit.
- Gemini 3.x uses default sampling settings rather than forcing temperature 0.1,
  following [Google's migration guidance](https://ai.google.dev/gemini-api/docs/whats-new-gemini-3.5).
  This is a request-compatibility correction, not proof that sampling caused a
  reported timeout. The deterministic Python calculations and all AI-validation
  gates remain unchanged.
- The existing single HTTP-400 schema compatibility attempt keeps JSON MIME
  mode and places the complete application-owned schema in the **system
  instruction**. It does not mix schema instructions with untrusted evidence or
  mutate the original request. All exact-field, finite-number, adjustment-bound,
  checklist, and evidence-ID checks still run in Python.
- Request start, success, failure, retry, and model-switch logs share a random
  `gemini_call_id` scoped to one generation, not mutable client-wide state.
  Start/failure logs record attempt number, model, effective/configured timeout,
  request byte count, schema mode, and remaining budget. Failure logs include
  elapsed milliseconds, a safe exception type, and phase: `connection_or_headers`,
  `response_body`, or `response_validation`. Scheduling exhaustion instead names
  `model_deadline`, `generation_deadline`, or `attempt_limit`. Success events
  record elapsed time, finish reason, and answer/thought token counts only.
  Never log API keys, prompts, evidence text, or generated text.
  `gemini_fallback_model_succeeded` means parseable JSON was received; only an
  analysis status of `APPLIED` confirms that subsequent domain validation passed.

Tests simulate transport and upstream timeouts, fallback budget reservation,
temporary/persistent overload, authentication failures, exhausted
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
