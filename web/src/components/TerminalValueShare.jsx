import { money, percent } from '../lib/format.js'
import './TerminalValueShare.css'

/* "Where this value comes from" — the terminal-value split, inside the Why layer.
 *
 * A DCF's answer is two numbers added together: the years we actually forecast, and
 * one estimate of what the business is worth after them. That second number is
 * usually the larger of the two, and a beginner has no way to know it — the page
 * shows a range and says nothing about how much of it rests on a guess about the far
 * future. Verdict.pdf lists "valuation depends heavily on terminal value" as a
 * legitimate Weakens item, so it is stated here rather than left implicit.
 *
 * This lives inside the Why drawer, which is the only place jargon is allowed
 * (product non-negotiable #1) — and the licence is paid the same way every other row
 * pays it: the term is named once, with a plain-English gloss beside it.
 *
 * ── Two deliberate departures ─────────────────────────────────────────────────
 * 1. design/index.html carries this same claim as a "What weakens" card, pipped
 *    var(--over). Here it is var(--fair): above three quarters is a caution about
 *    how much weight one assumption is carrying, not a failure of the valuation.
 *    Nothing about a high share makes the number wrong.
 * 2. "beyond year ten" is read from the horizon in the assumptions, not fixed at
 *    ten — the same rule WhyDrawer applies to its stage labels. Ten is what the
 *    engine uses today; it is not a constant of the contract.
 */

/** Above this share of the total, the split is flagged. "Roughly three quarters" —
 *  the threshold is a judgement about how much weight one assumption should carry,
 *  not a line the maths draws anywhere. */
export const HEAVY_SHARE = 75

/**
 * The split, or null when there is nothing honest to draw.
 *
 * Exported for the tests: this file has no DOM renderer, so what is asserted is the
 * function that decides what the bar claims.
 *
 * @param {object|null} math  `the_math` from the adapter — null on the cannot-value
 *                            payload, and null is the whole answer: no valuation,
 *                            no split, no section.
 */
export function readShare(math) {
  const tv = math?.terminal_value
  const pct = tv?.share_pct
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return null

  const years = (math?.stage_1?.years ?? 0) + (math?.stage_2?.years ?? 0)
  const horizon = Number.isFinite(years) && years >= 1 ? years : null

  return {
    pct,
    beyond: tv.present_value,
    projected: tv.projected_present_value,
    heavy: pct >= HEAVY_SHARE,
    horizon,
  }
}

/** Widths only. The percentage on screen is always the true one; a share outside
 *  0–100 (a company whose forecast years carry negative present value) still prints
 *  as it is, and the bar simply runs to its end rather than off it. */
const clamp = (n) => Math.min(100, Math.max(0, n))

export default function TerminalValueShare({ math }) {
  const split = readShare(math)
  if (!split) return null

  const { pct, beyond, projected, heavy, horizon } = split
  const far = clamp(pct)
  const near = 100 - far

  const after = horizon ? `beyond year ${horizon}` : 'beyond the years we forecast'
  const nearLabel = horizon ? `The first ${horizon} years` : 'The years we forecast'
  const farLabel = horizon ? `Everything after year ${horizon}` : 'Everything after that'

  return (
    <section className={heavy ? 'tvshare heavy' : 'tvshare'}>
      <div className="tvhead">
        <span className="k">
          Where this value comes from
          <em>
            Two halves added together: the years we forecast, and one estimate of what
            the business is worth after them. Analysts call that second half the
            terminal value.
          </em>
        </span>
        <span className="v">{percent(pct)}</span>
      </div>

      <div
        className="tvbar"
        role="img"
        aria-label={`${percent(pct)} of the valuation comes from the estimate of what the business is worth ${after}.`}
      >
        <span className="seg near" style={{ width: `${near}%` }} />
        <span className="seg far" style={{ width: `${far}%` }} />
      </div>

      <div className="tvkey">
        <div className="tvk">
          <i className="sw near" aria-hidden="true" />
          <span className="n">{nearLabel}</span>
          <span className="v">{money(projected)}</span>
        </div>
        <div className="tvk">
          <i className="sw far" aria-hidden="true" />
          <span className="n">{farLabel}</span>
          <span className="v">{money(beyond)}</span>
        </div>
      </div>

      <p className="tvgloss">
        {percent(pct)} of this valuation comes from our estimate of what the business is
        worth {after}. That part is the least certain.
      </p>

      {/* The mockup's own idiom for a flagged claim: colour the pip, not the prose
          (design/index.html, the `.pe` cards). var(--fair), never var(--over) — see
          the header. */}
      {heavy && (
        <p className="tvflag">
          <span className="pip" aria-hidden="true" />
          Most of the answer rests on that one estimate. Hold the range loosely — a small
          change to what we assume about the far future moves it a long way.
        </p>
      )}
    </section>
  )
}
