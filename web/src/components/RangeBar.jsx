import { useRef } from 'react'
import { gsap } from 'gsap'
import { useGSAP } from '@gsap/react'
import { price as fmtPrice, priceShort } from '../lib/format.js'
import './RangeBar.css'

/* RangeBar — the product's signature visual, ported from the app bar in
   design/index.html (#aband / #aknob / #alab).
 *
 * What it draws: an axis, the track, the fair-value band between low and high,
 * an edge mark and a $ label at each bound, the price knob at `current` with
 * its label, and the three zone words underneath.
 *
 * Nothing is hardcoded. The mockup's 33.33% / 86.67% / 50.93% are what
 * $165 / $205 / $178.20 happen to work out to on a $140–$215 axis; here the
 * axis is derived from the data (see axisFor) and every position is a
 * percentage of it, so the bar is correct for any company.
 *
 * Colour: the knob's fill and its 26px bloom are `currentColor`, so a parent
 * sets one property — `color: var(--under|--fair|--over)` — and the knob picks
 * up the verdict. The price label is pinned to --cream in CSS; only the knob
 * inherits.
 *
 * Two states the mockup never had, both of which are live today:
 *
 *   current === null  The API carries no market price (D-017). The valuation is
 *                     still real, so the band and both bounds render — but the
 *                     knob and its label are omitted entirely and the three zone
 *                     words are replaced by a line saying there is nothing to
 *                     compare against. Parking the knob at zero or at the
 *                     midpoint would be inventing a price, which is the one
 *                     thing D-017 forbids.
 *
 *   no usable range   Missing bounds, or low >= high. A zero-width range is a
 *                     point estimate wearing a range's clothes, which product
 *                     non-negotiable #2 rules out, so both cases fall through to
 *                     the "NO RANGE — NOT ENOUGH TO GO ON" bar from
 *                     design/app.html rather than drawing a degenerate band.
 */

const isNum = (n) => typeof n === 'number' && Number.isFinite(n)
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))

/* Round a rough interval up to one a human would label an axis with:
   1, 2, 2.5, 5 or 10 times a power of ten. */
const NICE = [1, 2, 2.5, 5, 10]
function niceStep(rough) {
  if (!(rough > 0)) return 1
  const mag = 10 ** Math.floor(Math.log10(rough))
  const frac = rough / mag
  return (NICE.find((n) => frac <= n) ?? 10) * mag
}

/* An axis wide enough to hold every value with air around it, ending on round
   numbers at both ends. Padding is 22% of the data's own spread, so a tight
   range gets a tight axis and a wide one gets a wide one — the band always
   occupies a readable share of the track instead of a sliver or the whole thing.
   $165–$205 with a $178.20 price lands on $140–$220 in steps of $20, which is
   the mockup's axis to within one tick. */
function axisFor(values) {
  const nums = values.filter(isNum)
  const lo = Math.min(...nums)
  const hi = Math.max(...nums)
  const spread = hi - lo || Math.abs(hi) || 1
  const pad = spread * 0.22
  const step = niceStep((spread + pad * 2) / 5)
  const min = Math.floor((lo - pad) / step) * step
  const max = Math.ceil((hi + pad) / step) * step

  const ticks = []
  const n = Math.round((max - min) / step)
  for (let i = 0; i <= n; i++) ticks.push(Number((min + i * step).toPrecision(12)))

  /* Rounded: these land in inline `left` styles, and 47.749999999999986% is
     the same pixel as 47.75% with more of it. */
  const pct = (v) => Number(clamp(((v - min) / (max - min)) * 100, 0, 100).toFixed(4))
  return { min, max, ticks, pct }
}

export default function RangeBar({ price }) {
  const root = useRef(null)
  const bandEl = useRef(null)
  const knobEl = useRef(null)
  const labelEl = useRef(null)

  const current = isNum(price?.current) ? price.current : null
  const low = isNum(price?.fair_value_low) ? price.fair_value_low : null
  const high = isNum(price?.fair_value_high) ? price.fair_value_high : null
  const hasRange = low !== null && high !== null && low < high

  const axis = hasRange ? axisFor([low, high, current]) : null
  const lowPct = hasRange ? axis.pct(low) : 0
  const highPct = hasRange ? axis.pct(high) : 0
  const bandPct = highPct - lowPct
  const knobPct = hasRange && current !== null ? axis.pct(current) : null

  /* Band widens out of nothing, the knob lands on it, the price arrives last —
     the beat order from playApp() in design/index.html, timings included.

     START is where the band begins in that timeline. playApp() runs the whole app
     screen as ONE timeline: the verdict word (0–0.6s), its sub (0.25–0.8s), then
     `.to('#aband', …, '-=.3')` — which lands at 0.5s. Split across components each
     timeline would otherwise start at zero, and the bar would race the headline it
     is meant to follow.

     Under prefers-reduced-motion the same end state is set in one frame. */
  const START = 0.5

  useGSAP(
    () => {
      if (!bandEl.current) return
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

      if (reduce) {
        gsap.set(bandEl.current, { width: `${bandPct}%` })
        if (knobEl.current) gsap.set([knobEl.current, labelEl.current], { opacity: 1, scale: 1, y: 0 })
        return
      }

      gsap.set(bandEl.current, { width: 0 })
      const tl = gsap.timeline({ delay: START })
      tl.to(bandEl.current, { width: `${bandPct}%`, duration: 0.9, ease: 'power4.inOut' })

      if (knobEl.current) {
        gsap.set(knobEl.current, { opacity: 0, scale: 0.3 })
        gsap.set(labelEl.current, { opacity: 0, y: -6 })
        tl.to(knobEl.current, { opacity: 1, scale: 1, duration: 0.5, ease: 'back.out(2.4)' }, '-=.32')
          .to(labelEl.current, { opacity: 1, y: 0, duration: 0.35 }, '-=.18')
      }
    },
    { scope: root, dependencies: [bandPct, knobPct], revertOnUpdate: true },
  )

  if (!hasRange) {
    return <div className="novbar">NO RANGE — NOT ENOUGH TO GO ON</div>
  }

  const label =
    current !== null
      ? `Estimated worth ${priceShort(low)} to ${priceShort(high)}, against ${fmtPrice(current)} today`
      : `Estimated worth ${priceShort(low)} to ${priceShort(high)}. No market price to compare against.`

  return (
    <div className="bar" ref={root} role="img" aria-label={label}>
      <div className="axis">
        {axis.ticks.map((t) => (
          <span key={t}>{priceShort(t)}</span>
        ))}
      </div>

      <div className="track">
        <div className="band" ref={bandEl} style={{ left: `${lowPct}%` }} />
        <div className="edge" style={{ left: `${lowPct}%` }} />
        <div className="edge" style={{ left: `${highPct}%` }} />
        <div className="bandlab" style={{ left: `${lowPct}%` }}>
          {priceShort(low)}
          <br />
          <span>LOW</span>
        </div>
        <div className="bandlab" style={{ left: `${highPct}%` }}>
          {priceShort(high)}
          <br />
          <span>HIGH</span>
        </div>

        {knobPct !== null && (
          <>
            <div className="knob" ref={knobEl} style={{ left: `${knobPct}%` }} />
            <div className="knoblab" ref={labelEl} style={{ left: `${knobPct}%` }}>
              {fmtPrice(current)}
              <small>TODAY</small>
            </div>
          </>
        )}
      </div>

      {knobPct !== null ? (
        <div className="zones">
          <span>Looks cheap</span>
          <span>Fairly priced</span>
          <span>Looks expensive</span>
        </div>
      ) : (
        <p className="noprice">
          We don&rsquo;t have today&rsquo;s share price, so there is nothing to place on this range yet.
        </p>
      )}
    </div>
  )
}
