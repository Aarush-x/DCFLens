import Label from './ui/Label.jsx'
import { AI_FALLBACK } from '../lib/adapter.js'
import './AiFallbackNotice.css'

/* ── The AI-unavailable notice ────────────────────────────────────────────────
 *
 * Not a hypothetical, and not an edge case. Verified 2026-08-30: every live call
 * comes back `analysis.status: "DETERMINISTIC_FALLBACK"`, `fallback_reason:
 * "provider_failure"`. This is the state the demo will be in unless Gemini is
 * fixed, so it is designed rather than caught.
 *
 * ── What the copy has to land ────────────────────────────────────────────────
 * The valuation is not degraded. The estimate, the range and the checklist are
 * computed from the filings by the deterministic engine and are byte-for-byte
 * what they would have been. The ONLY thing missing is the written interpretation
 * of them. A beginner must come away thinking "there is less to read here", not
 * "this number is shaky".
 *
 * The default screen avoids the internal word “deterministic.” It says what
 * survived and why in ordinary language. There is no warning triangle and no
 * error vocabulary.
 *
 * The eyebrow says "Written analysis unavailable", not the deployed site's "AI
 * analysis unavailable". On a screen whose whole job is one analysis, the second
 * reads as "the analysis is gone" — which is the exact misreading this component
 * exists to prevent.
 *
 * ── Colour ───────────────────────────────────────────────────────────────────
 * A calm --surface inset with a --hair border. NOT --over. In this palette red is
 * a claim about a company — "looks expensive" — and spending it on a system
 * message teaches the reader that the colour means "something is wrong",
 * which then poisons every verdict they read afterwards. Nor does it carry
 * --cardshadow: the green bloom belongs to the value cards.
 *
 * The word "LLM" appears nowhere in what renders.
 */

/* fallback_reason -> one plain sentence. The raw enum is never printed; a
   snake_case token tells a beginner nothing and looks like a crash.
 
   Every key here is a reason the API can actually emit — see
   apps/api/app/ai/gemini.py, which classifies provider failures into exactly
   these, plus the "provider_failure" default in GeminiError. Each sentence
   refers back to "those sentences" in the body copy above it, so it reads as a
   continuation rather than a stray fragment. */
const REASONS = {
  provider_failure: 'The service that writes those sentences did not respond.',
  provider_timeout: 'The service that writes those sentences took too long to answer.',
  provider_rate_limit: 'The service that writes those sentences was busy and turned this request away.',
  provider_unavailable: 'The service that writes those sentences was offline.',
  provider_authentication: 'We could not sign in to the service that writes those sentences.',
  provider_not_configured: 'The service that writes those sentences is not switched on here.',
  provider_invalid_request: 'The service that writes those sentences would not accept this request.',
}

/* The generic sentence has to be true of a reason we have never seen AND of no
   reason at all — `?status=DETERMINISTIC_FALLBACK` forces this state from the URL
   for captures, and the mocks carry no reason to go with it. It claims only what
   is observable in both cases: nothing usable came back. */
const GENERIC = 'The service that writes those sentences did not return anything usable this time.'

/** @param {string|null|undefined} reason  the raw `fallback_reason`.
 *  @returns {string} one plain-English sentence. Never the enum, never empty. */
export function reasonSentence(reason) {
  if (typeof reason !== 'string') return GENERIC
  return REASONS[reason.trim().toLowerCase()] ?? GENERIC
}

/**
 * @param {object} props
 * @param {object} props.data  the whole view object from src/lib/adapter.js.
 *                             Reads `aiStatus` and `aiFallbackReason`.
 */
export default function AiFallbackNotice({ data }) {
  /* APPLIED (which the adapter maps to AI_OK) renders nothing at all — not an
     empty element, not a spacer. When the write-up is there, there is nothing to
     say about it. */
  if (data?.aiStatus !== AI_FALLBACK) return null

  return (
    /* `.av` puts this in the same staggered reveal as the "Why we think so"
       blocks below it, which begins at 1.45s — after the verdict has landed.
       Non-negotiable #4: nothing arrives on screen ahead of the answer. */
    <section
      className="ai-fallback av"
      role="note"
      aria-labelledby="ai-fallback-title"
      /* The enum, kept where check.sh and a developer can read it and a user
         cannot. This is the only place in the component it survives. */
      data-fallback-reason={data.aiFallbackReason ?? 'unspecified'}
    >
      <Label as="p" className="ai-fallback__eyebrow">Written analysis unavailable</Label>

      <h3 id="ai-fallback-title" className="ai-fallback__head">
        The estimate still works.
      </h3>

      <p className="ai-fallback__body">
        The numbers come straight from the company&rsquo;s filings and were calculated
        the same way as every other company. The estimate, range and checks are all
        still available.
      </p>

      <p className="ai-fallback__body">
        What is missing is the plain-English explanation that turns those figures
        into a simple story. You can still inspect the numbers and sources below.
      </p>

      <p className="ai-fallback__why">{reasonSentence(data.aiFallbackReason)}</p>
    </section>
  )
}
