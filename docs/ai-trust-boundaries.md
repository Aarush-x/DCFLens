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

### Compact qualitative review (`compact-v1`)

Gemini performs a short second opinion, not another DCF calculation or full
checklist evaluation. Python still computes the baseline, valuation, sensitivity,
and all ten original checklist items before any provider call.

- Send at most **16** evidence items from the validated set of up to 64.
  Evidence referenced by baseline traces is prioritized; original source order
  breaks ties. Selection never ranks evidence by positive or negative sentiment.
- Each selected item's content is preserved exactly, with its original ID.
  Items over 1,000 characters are omitted rather than truncated, preventing a
  qualifying sentence from being silently removed. Serialized evidence and its
  source table share an **8,000-byte** JSON budget, including Unicode escaping.
- Repeated direct SEC URLs are transmitted once in a `sources` table. Each item
  retains a `source_index`; full original references remain unchanged in Python.
  `review_scope` declares available, selected, and omitted counts. Selection is
  not a complete review of the filing, and omitted evidence is not adverse evidence.
- Python validates AI citations against **only the IDs actually transmitted**.
  Citing a real but omitted ID is rejected just like citing an invented ID. If
  no item fits, no provider call is made and `insufficient_evidence` preserves
  the baseline. The evidence-support confidence factor is multiplied by selected
  count / available count and explains this limited coverage. This is a coverage
  penalty, not a probability of correctness or a measure of source importance.
- Output keeps exactly three bounded adjustments, **1–3 evidence assessments**,
  **0–3 qualitative checklist findings**, and one disagreement summary. Text is
  capped at **240 characters per explanation**, with **1–2 citations per claim**.
  The provider schema and Python enforce array/citation limits; short text is
  requested via descriptions and enforced in Python (without relying on an
  undocumented JSON-schema `maxLength` constraint). No findings means
  no AI commentary, not a pass for the original checklist. All ten deterministic
  checklist results remain available and unchanged.
- `maxOutputTokens` is **4,096**, formerly 16,384. For the explicitly supported
  `gemini-3.5-flash` and `gemini-3.5-flash-lite` models, REST `thinkingConfig` uses
  `thinkingLevel: MINIMAL` and `includeThoughts: false`. Other configured models
  do not receive these model-specific controls. Sampling defaults are retained.
  [Google documents minimal thinking](https://ai.google.dev/gemini-api/docs/whats-new-gemini-3.5)
  for speed-oriented work; it does not guarantee that thinking is disabled.
- `gemini_context_prepared` logs policy version, evidence counts and prompt bytes,
  never content. Request logs include output-token limit and thinking level.

On the synthetic normalized-financial-facts fixture used by the tests, the prompt
decreased from 8,764 bytes / 24 items to 5,983 bytes / 16 items (32% fewer prompt
bytes). Including system instruction and serialized schema, the measured content
decreased from 11,819 to 9,897 bytes (16%). These are size measurements, not live
latency benchmarks. Shorter output and minimal thinking may reduce analysis depth;
provider outages, quota exhaustion, network delays, or invalid output can still
require deterministic fallback. Truncated JSON is never repaired into a fabricated
successful analysis. Retries remain bounded as documented below.

### Bounded Gemini recovery

The REST adapter tries the configured `GEMINI_MODEL`, then the reviewed
`gemini-3.5-flash-lite` fallback if the primary model fails with a retryable
availability, timeout, rate-limit, model-selection, or request error, or malformed JSON.
If the configured model is already `gemini-3.5-flash-lite`, it is not tried twice.
Model switches are logged; no local AI provider is introduced.

- HTTP 408, 429, 500, 502, and 503/504, socket timeouts (including timeouts
  wrapped in `URLError`), and transport failures such as connection resets or
  interrupted HTTP responses permit `GEMINI_MAX_RETRIES` delayed retries per
  model (default 2; configurable 0–3). Delay before retry number `n`, starting
  at 1, is `GEMINI_BACKOFF_SECONDS × 2^(n−1) + uniform(0, 0.25)` seconds.
  The initial backoff defaults to 1 second and accepts 0.1–10 seconds. Schema
  compatibility attempts do not reset the transient retry counter.
- All attempts share an eight-request ceiling and one
  `GEMINI_TOTAL_TIMEOUT_SECONDS` scheduling budget (default 75, range 1–120).
  `GEMINI_TIMEOUT_SECONDS` is the per-attempt I/O timeout (default 45, range
  1–120), passed explicitly to `urllib.request.urlopen`. It is capped by the
  remaining model window and total budget. Before the primary starts, reserve
  `min(30 seconds, remaining budget / 2)` for the reviewed fallback; when only
  one model remains it can use all remaining time. Default primary/fallback
  windows are therefore 45/30 seconds. A full primary timeout switches directly
  to fallback; a short transient failure can retry the primary within its window.
  An early primary failure leaves unused time available to the fallback.
  Setting retries to zero disables delayed same-model retries, not the reviewed
  model fallback or existing schema compatibility attempt. All ceilings still apply.
  No new attempt or backoff is scheduled once its window expires. Late results
  received after the total deadline are rejected. The standard-library socket
  timeout is an I/O timeout, not hard cancellation of DNS resolution or a slowly
  streaming response. Neither this setting nor retries guarantees provider uptime.
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
  `request_duration_ms` (and the existing `elapsed_ms` alias), a safe exception
  type, and phase: `connection_or_headers`,
  `response_body`, or `response_validation`. Scheduling exhaustion instead names
  `model_deadline`, `generation_deadline`, or `attempt_limit`. `duration_scope`
  is `attempt` for network failure/success events; scheduling-exhaustion events
  report total generation duration with scope `generation`. Success events
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
