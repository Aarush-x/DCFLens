/* ── Is this string for a reader, or for a log? ───────────────────────────────
 *
 * The engine writes `calculation`, `technical_explanation` and `transformation`
 * strings for its own benefit, and only some of them happen to read as English.
 * Both kinds arrive in the same fields:
 *
 *   "net debt / latest positive FCF"                       ← a person can follow this
 *   "(latest revenue - prior revenue) / abs(prior revenue)" ← so can they, just
 *   "(total_debt 90678000000.0 - cash 54697000000.0) / latest_fcf 98767000000.0"
 *   "CAGR = (416161000000.0 / 24578000000.0)^(1 / 18) - 1"  ← a debug trace in a
 *                                                             string field
 *
 * Non-negotiable #1 keeps the second kind off the screen, and this is the one place
 * that decides which kind a string is, so the adapter and the evidence drawer cannot
 * disagree about it. The tells are cheap and specific: our own field names, raw
 * magnitudes at full precision, exponents, and the machine suffix the envelope
 * appends to a derived transformation.
 *
 * A string that fails is not rewritten or paraphrased — it is simply not shown. The
 * figures it would have sat under are unaffected, and a sentence the reader has to
 * decompile is worse than a line that isn't there.
 */

/** The suffix the envelope appends to a derived transformation:
 *  "free_cash_flow = ...; source transformation: reported_value" */
export const SOURCE_TAG = 'source transformation:'

/** True when a machine-written string is fit to print as it stands. */
export function readsAsEnglish(text) {
  const s = String(text ?? '').trim()
  if (!s) return false
  if (s.includes('_')) return false          // snake_case: our field names, not words
  if (s.includes('^')) return false          // an exponent
  if (s.includes(SOURCE_TAG)) return false   // the machine suffix
  if (/\d{4}/.test(s)) return false          // a raw magnitude, substituted in
  if (/\.\d{4}/.test(s)) return false        // full-precision output
  return true
}

export default readsAsEnglish
