# Gemini qualitative-analysis trust model

## Purpose

Gemini is an evidence-bound qualitative analyst. It is neither a financial-data provider nor the DCF engine. DCFLens always calculates the deterministic adaptive baseline, its valuation, sensitivity interval, and the original checklist before sending any request to Gemini.

The integration returns one final intrinsic valuation. Its interval shows sensitivity to assumptions; it is not a probability or prediction interval.

## Authority boundary

Gemini may propose additive adjustments only to:

| Assumption | Python-enforced adjustment range |
| --- | ---: |
| Stage-one growth | -3 to +3 percentage points |
| Stage-two growth | -2 to +2 percentage points |
| Discount rate | -1.5 to +1.5 percentage points |

The model cannot alter historical facts, current or diluted shares, net debt, stage durations, terminal growth, DCF formulas, sensitivity formulas, evidence records, or checklist wording and order. The application constructs final assumptions from the deterministic baseline and the three validated additive adjustments. It then invokes the unchanged deterministic DCF engine.

## Request boundary

Only bounded evidence excerpts and immutable evidence metadata are supplied. Every item has a stable evidence ID and a direct HTTPS SEC URL. Annual-report and exhibit text is explicitly marked as untrusted data and placed inside a delimited JSON document. Instructions appearing inside evidence are data, not commands.

The server supplies:

- The deterministic assumptions and valuation.
- The exact three adjustment bounds.
- The unchanged checklist and deterministic checklist results.
- Evidence IDs, source types, direct SEC URLs, and bounded source text.

Provider credentials remain server-side. `GOOGLE_API_KEY`, `GEMINI_MODEL`, and `GEMINI_TIMEOUT_SECONDS` are backend variables and are never exposed through a `NEXT_PUBLIC_` variable.

## Structured output and validation

The provider request asks for JSON using a strict response schema. Provider-level schema conformance is only the first gate. Python independently rejects:

- Malformed JSON, missing fields, extra fields, incorrect types, and non-finite numbers.
- Missing, duplicate, unknown, or out-of-range assumptions.
- Adjustments outside the code-owned bounds.
- Invalid claim types, evidence-support values, checklist statuses, or checklist numbers.
- Duplicate checklist findings.
- Any claim, rationale, finding, or disagreement citing an evidence ID absent from the input.

Every claim is labeled `FACT`, `INTERPRETATION`, or `ASSUMPTION`. Evidence support is separately labeled `SUPPORTED`, `PARTIALLY_SUPPORTED`, `UNSUPPORTED`, or `CONTRADICTED`. The provider returns checklist numbers only; Python reattaches the immutable original text. This prevents the model from rewriting or reordering the checklist.

The API returns concise rationales, citations, and calculation impacts. It does not request, persist, expose, or depend on private chain-of-thought.

## Missing evidence and failure behavior

No evidence means no provider call. Missing evidence remains missing and cannot become a confident negative conclusion. Timeout, provider failure, malformed output, fabricated citations, invalid bounds, or an invalid resulting DCF all produce `DETERMINISTIC_FALLBACK`.

Fallback preserves the exact deterministic assumptions, valuation, sensitivity interval, and checklist results. All three AI adjustments are reported as zero, the reason is machine-readable, and confidence is `Low`.

## Output separation

The result keeps these records distinct:

- Deterministic baseline assumptions and baseline valuation.
- Baseline, AI adjustment, final value, bounds, rationale, evidence, and isolated valuation impact for each adjustable assumption.
- One final valuation and its non-probabilistic sensitivity interval.
- Evidence assessments with claim type and support status.
- Deterministic checklist results and separate qualitative findings.
- Checklist disagreements without overwriting either side.
- Overall valuation and evidence disagreement summary.

## Confidence

Confidence is `High`, `Medium`, or `Low` and is the equal-weighted summary of six normalized factors:

1. Data coverage in the deterministic baseline traces.
2. Historical cash-flow stability.
3. Width of the valuation sensitivity interval.
4. Terminal-value concentration.
5. Support quality for evidence-bound AI claims.
6. AI and deterministic disagreement, including adjustment size and checklist disagreement.

Fallback is always `Low`. The result includes each factor and its score, plus `is_probability: false`. Confidence describes analysis support and robustness; it is not the probability that the valuation will be reached.

## Current integration boundary

The FastAPI `/api/analyze/{ticker}` route composes SEC Company Facts, deterministic valuation/checklist results, and optional Gemini analysis. It currently supplies structured-fact evidence, not retrieved 10-K narrative or Exhibit 21 text. Public-request authentication/throttling and broader narrative integration remain separate production-hardening/product work. The route serializes validated results without relaxing the domain trust boundaries.

The Gemini adapter combines non-thought answer text parts and never returns thought-marked text. Missing or malformed optional usage metadata does not invalidate an otherwise usable answer. Invalid or empty envelopes, oversized responses, and interrupted reads produce safe diagnostic events; evidence/schema validation still decides whether a response is applied.
