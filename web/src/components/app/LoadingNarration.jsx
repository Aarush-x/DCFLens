import { useEffect, useRef, useState } from 'react'

/* `#s-load` from design/app.html, ported — the narrated wait.
 *
 * ── Why this state is load-bearing ───────────────────────────────────────────
 * The API sleeps on Render's free tier, so the FIRST request of a session pays
 * about thirty seconds to wake the container before any analysis begins. Thirty
 * seconds of blank screen reads as broken, and nobody watching a demo waits it
 * out. The mockup drew this state for exactly that reason. Never a bare spinner.
 *
 * ── What it does NOT do ──────────────────────────────────────────────────────
 * The API streams no progress, so every beat here is a clock, not a report. That
 * puts two rules on it:
 *
 *   1. Nothing is marked done that we have not actually been told about. The
 *      steps narrate the work the service is known to do, in order, and the last
 *      one stays in flight until the response lands — the component unmounts at
 *      that moment, so a step is never ticked off by a timer that outran the work.
 *   2. NO PRICE STEP. The mockup's second line is "Pulled today's price —
 *      $178.20". The live service has no quote provider (D-017), so that line
 *      would be a fabricated number inside a loading screen — the one place a
 *      user has no way to check it. It is dropped, not adapted.
 *
 * The bar is asymptotic rather than linear for the same reason: it approaches but
 * never reaches full, because we do not know when full is.
 *
 * ── Escalation ───────────────────────────────────────────────────────────────
 * The footnote grows in tiers as the wait does — nothing, then the sleeping
 * service, then an admission that this one is slow. Tiers are only ever ADDED.
 * Copy that appears and then vanishes is worse than copy that never appeared: the
 * reader is left unsure whether they misread it. There is no spinner theatre and
 * no fake progress beyond the honest asymptote; under prefers-reduced-motion the
 * pulse and the bar's slide are dropped in app.css and the beats still advance,
 * because the wait is information and only its decoration was motion.
 */

/* Ordered as the service works: resolve the ticker against the SEC company index,
   pull the newest 10-K, normalise the cash-flow history, discount it. */
const STEPS = [
  { at: 0, text: (who) => `Finding ${who} in the SEC's company index` },
  { at: 3.5, text: (who) => `Reading ${who}'s latest annual report…` },
  { at: 9, text: () => 'Working out how much spare cash it makes' },
  { at: 16, text: () => "Estimating what that's worth today" },
]

/* The two moments this screen has something more to say. Both are clocks, like the
   steps, and both only ever move forward — `elapsed` is measured against a fixed
   start, so a line that has appeared never disappears again.

   Four seconds is where a wait stops reading as "the page is working" and starts
   reading as "the page is stuck". That is when the reason is owed: the machine was
   asleep. Saying it any earlier is noise on a request that was about to land.

   Twenty is well past the measured cold start (~21s, and the analysis follows it),
   so a wait that reaches it really is unusual and is worth naming rather than
   leaving the reader to decide on their own that we have hung. */
export const COLD_START_AFTER = 4
export const LONGER_THAN_USUAL_AFTER = 20

/** Which footnotes are owed at `elapsed` seconds, in the order they appeared.
 *
 *  Pulled out of the component as a pure function so the one rule that matters
 *  can be tested without a DOM: the list only ever GROWS. Copy that appears and
 *  then vanishes leaves the reader unsure whether they misread it, and a wait is
 *  the worst moment to introduce that doubt. */
export function footnotesAt(elapsed) {
  const notes = []
  if (elapsed >= COLD_START_AFTER) notes.push('coldStart')
  if (elapsed >= LONGER_THAN_USUAL_AFTER) notes.push('longerThanUsual')
  return notes
}

/* Approaches 1 without arriving. At 14s ≈ 63%, at 30s ≈ 88%, capped at 94% so the
   bar never sits full while we are still waiting. */
const progressAt = (t) => Math.min(0.94, 1 - Math.exp(-t / 14))

export default function LoadingNarration({ ticker, name }) {
  const [elapsed, setElapsed] = useState(0)
  const started = useRef(0)

  /* No dependency on the ticker: the caller keys this component by it, so a new
     company remounts and the clock starts from zero on its own. Resetting state
     from inside the effect instead would render once against the previous
     company's elapsed time. */
  useEffect(() => {
    started.current = Date.now()
    const id = setInterval(() => setElapsed((Date.now() - started.current) / 1000), 250)
    return () => clearInterval(id)
  }, [])

  /* The company is named only if we already knew the name — a ticker typed into
     the search field is just a symbol until the response tells us otherwise, and
     "Reading TSLA's latest annual report" is honest where inventing "Tesla, Inc."
     would not be. */
  const who = name && name !== ticker ? name : (ticker ?? 'this company')
  const eyebrow = [name && name !== ticker ? name : null, ticker].filter(Boolean).join(' · ')

  const current = STEPS.reduce((acc, s, i) => (elapsed >= s.at ? i : acc), 0)
  const notes = footnotesAt(elapsed)
  const cold = notes.includes('coldStart')
  const slow = notes.includes('longerThanUsual')

  return (
    <section className="load" data-state="loading" aria-live="polite" aria-busy="true">
      {eyebrow && <div className="eyebrow">{eyebrow}</div>}
      <h2>Working through {who}&rsquo;s numbers</h2>
      <div className="meta">Step {current + 1} of {STEPS.length}</div>

      <div className="prog" role="presentation">
        <i style={{ width: `${(progressAt(elapsed) * 100).toFixed(1)}%` }} />
      </div>

      {STEPS.map((step, i) => (
        <div key={i} className={`step${i < current ? ' done' : i === current ? ' now' : ''}`}>
          <span className={`ix${i === current ? ' blink' : ''}`} aria-hidden="true">
            {i < current ? '✓' : i === current ? '→' : i + 1}
          </span>
          <span>{step.text(who)}</span>
        </div>
      ))}

      {/* Three tiers, each one quieter than the last, and each one only added —
          never swapped in, never taken away. A line that has been read once should
          still be there when the reader looks back at it. */}
      <p className="foot">
        This usually takes under a minute. You can leave the page open.

        {cold && (
          <span className="coldstart">
            Our analysis service goes to sleep when nobody is using it, so the
            first look-up after a quiet spell spends about half a minute waking
            up before it reads anything.
          </span>
        )}

        {slow && (
          <span className="coldstart">
            This one is taking longer than usual. Nothing has gone wrong that we
            know of — we are still waiting on it, and the answer will appear here
            the moment it arrives.
          </span>
        )}
      </p>
    </section>
  )
}
