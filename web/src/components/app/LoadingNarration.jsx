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
 */

/* Ordered as the service works: resolve the ticker against the SEC company index,
   pull the newest 10-K, normalise the cash-flow history, discount it. */
const STEPS = [
  { at: 0, text: (who) => `Finding ${who} in the SEC's company index` },
  { at: 3.5, text: (who) => `Reading ${who}'s latest annual report…` },
  { at: 9, text: () => 'Working out how much spare cash it makes' },
  { at: 16, text: () => "Estimating what that's worth today" },
]

/* When we start admitting the machine was asleep. Under this, saying so is noise;
   over it, the user has waited long enough to deserve the reason. */
const COLD_START_AFTER = 8

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
  const cold = elapsed >= COLD_START_AFTER

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

      <p className="foot">
        This usually takes under a minute. You can leave the page open.
        {cold && (
          <>
            {' '}
            <span className="coldstart">
              Our analysis service goes to sleep when nobody is using it, so the
              first look-up after a quiet spell spends about half a minute waking
              up before it reads anything.
            </span>
          </>
        )}
      </p>
    </section>
  )
}
