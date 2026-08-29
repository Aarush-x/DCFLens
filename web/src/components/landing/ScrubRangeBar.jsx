import { useRef } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useGSAP } from '@gsap/react'
import Label from '../ui/Label.jsx'
import { price, priceShort, range } from '../../lib/format.js'
import { prefersReducedMotion } from '../../lib/useLenis.js'

gsap.registerPlugin(ScrollTrigger)

/* ── The signature moment ────────────────────────────────────────────────────
   Scrolling drags the price marker across the range, and the verdict word,
   its colour and its subtitle all follow the marker. It teaches the entire
   product in one gesture: the verdict IS the price's position in the range.

   This section is illustrative and self-contained. Its numbers are scroll-driven,
   not API-driven, so the live API's missing price does not reach it.

   Geometry, from the mockup: the axis runs $140–$215 and the band sits at
   25%–75% of it. The mockup's subtitle said "$165 – $205", which is NOT where it
   drew the band — 25%/75% of that axis is $158.75/$196.25. Rounding the band to
   $160–$195 keeps the mockup's geometry to within 1.7% and makes the number in
   the sentence true. Reported rather than fixed silently.                       */

const AXIS_MIN = 140
const AXIS_MAX = 215
const SPAN = AXIS_MAX - AXIS_MIN

const FAIR_LOW = 160
const FAIR_HIGH = 195

/* the marker sweeps 6% → 94% so it never sits under the viewport edge */
const SWEEP_START = 6
const SWEEP_END = 94

const AXIS_TICKS = [140, 155, 170, 185, 200, 215]

const pctOf = (value) => ((value - AXIS_MIN) / SPAN) * 100
const priceAt = (pct) => AXIS_MIN + (pct / 100) * SPAN

const BAND_LEFT = pctOf(FAIR_LOW)
const BAND_RIGHT = pctOf(FAIR_HIGH)

/* The state the page shows when motion is off: the marker parked mid-range,
   which is the "fairly priced" case the rest of the site talks about. */
const RESTING_PCT = (BAND_LEFT + BAND_RIGHT) / 2

/* One pure function drives both the first paint and every scrub frame, so the
   two can never disagree. */
function viewFor(pct) {
  const at = priceAt(pct)
  if (pct < BAND_LEFT) {
    return {
      pct,
      price: at,
      state: 'Looks cheap',
      colour: 'var(--under)',
      sub: 'Trading below what we estimate the business is worth.',
    }
  }
  if (pct < BAND_RIGHT) {
    return {
      pct,
      price: at,
      state: 'Fairly priced',
      colour: 'var(--fair)',
      sub: 'Inside the range we would call reasonable. No bargain, no warning.',
    }
  }
  return {
    pct,
    price: at,
    state: 'Looks expensive',
    colour: 'var(--over)',
    sub: 'Above our estimate. The price assumes growth it has not delivered.',
  }
}

export default function ScrubRangeBar({ sectionRef }) {
  const inner = useRef(null)
  const knob = useRef(null)
  const knobLab = useRef(null)
  const knobPrice = useRef(null)
  const vstate = useRef(null)
  const vsub = useRef(null)

  const reduced = prefersReducedMotion()
  /* Under reduced motion the marker rests mid-range and the subtitle carries the
     explicit price-against-range sentence, because that static frame has to
     teach on its own — nothing is going to move to explain it. With motion on,
     the marker starts where the scrub starts so the first frame is not a jump. */
  const initial = reduced
    ? {
        ...viewFor(RESTING_PCT),
        sub: `${price(priceAt(RESTING_PCT))} today, against an estimated ${range(FAIR_LOW, FAIR_HIGH)}.`,
      }
    : viewFor(SWEEP_START)

  useGSAP(() => {
    if (reduced) return

    /* Written straight to the DOM rather than through React state: this runs on
       every scroll frame, and a re-render per frame is not something the
       signature moment can afford. */
    const apply = (pct) => {
      const v = viewFor(pct)
      knob.current.style.left = `${pct}%`
      knob.current.style.background = v.colour
      knob.current.style.color = v.colour
      knobLab.current.style.left = `${pct}%`
      knobPrice.current.textContent = price(v.price)
      vstate.current.textContent = v.state
      vstate.current.style.color = v.colour
      vsub.current.textContent = v.sub
    }

    ScrollTrigger.create({
      trigger: sectionRef.current,
      start: 'top top',
      end: 'bottom bottom',
      scrub: 0.5,
      onUpdate: (self) => apply(SWEEP_START + self.progress * (SWEEP_END - SWEEP_START)),
    })
  }, { scope: inner, dependencies: [reduced] })

  return (
    <section className="bar-sect" ref={sectionRef}>
      <div className="bar-inner" ref={inner}>
        <div className="wrap" style={{ width: '100%' }}>
          <Label>Apple Inc. · AAPL</Label>

          <h2 className="vstate" ref={vstate} style={{ color: initial.colour }}>
            {initial.state}
          </h2>
          <p className="vsub" ref={vsub}>{initial.sub}</p>

          <div className="axis">
            {AXIS_TICKS.map((tick) => <span key={tick}>{priceShort(tick)}</span>)}
          </div>

          <div className="track">
            <div
              className="band"
              style={{ left: `${BAND_LEFT}%`, width: `${BAND_RIGHT - BAND_LEFT}%` }}
            />
            <div className="edge" style={{ left: `${BAND_LEFT}%` }} />
            <div className="edge" style={{ left: `${BAND_RIGHT}%` }} />

            <div
              className="knob"
              ref={knob}
              style={{ left: `${initial.pct}%`, background: initial.colour, color: initial.colour }}
            />
            <div className="knoblab" ref={knobLab} style={{ left: `${initial.pct}%` }}>
              <span ref={knobPrice}>{price(initial.price)}</span>
              <small>TODAY</small>
            </div>
          </div>

          <div className="zones">
            <span>Looks cheap</span>
            <span>Fairly priced</span>
            <span>Looks expensive</span>
          </div>
        </div>
      </div>
    </section>
  )
}
