import { useRef, useState } from 'react'
import { gsap } from 'gsap'
import { useGSAP } from '@gsap/react'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { money, percent, count, EMPTY } from '../lib/format.js'
import './WhyDrawer.css'

/* "Why? Show me the math" — the second layer, ported from the `.why` / `.whybody` /
 * `.mathrow` block in design/index.html.
 *
 * This drawer is the ONLY place jargon is allowed (product non-negotiable #1), and
 * the price of that licence is that every term carries a gloss. The gloss copy below
 * is lifted verbatim from the mockup — it is carefully written and is not
 * paraphrased. Two strings differ, both marked at their row:
 *   - the stage labels' year ranges are read from the assumptions, not fixed at
 *     "1–5" / "6–10", which were Apple's horizon in the mockup
 *   - the net-debt gloss says "the company" where the mockup said "Apple"
 */

gsap.registerPlugin(useGSAP, ScrollTrigger)

/** "years 1–5" / "years 6–10". Null when the horizon is not in the payload. */
function stageLabel(from, years) {
  if (!Number.isFinite(from) || !Number.isFinite(years) || years < 1) return null
  const last = from + years - 1
  return last === from ? `year ${from}` : `years ${from}–${last}`
}

/**
 * The seven rows, in the mockup's order: { label, gloss, value }.
 * A figure we do not have renders as EMPTY — an em dash — never as zero.
 */
function rowsFor(math) {
  const s1 = math.stage_1 ?? {}
  const s2 = math.stage_2 ?? {}
  const s1Span = stageLabel(1, s1.years)
  const s2Span = stageLabel(Number.isFinite(s1.years) ? s1.years + 1 : NaN, s2.years)

  return [
    {
      label: 'Spare cash last year',
      gloss: "What's left after running costs and equipment. The starting point for everything.",
      value: money(math.starting_free_cash_flow),
    },
    {
      // Mockup: "Growth, years 1–5". The horizon is an assumption, so it is read.
      label: s1Span ? `Growth, ${s1Span}` : 'Growth, the first stage',
      gloss: 'How fast we assume that cash grows at first.',
      value: percent(s1.growth_pct),
    },
    {
      // Mockup: "Growth, years 6–10".
      label: s2Span ? `Growth, ${s2Span}` : 'Growth, the stage after that',
      gloss: 'Slower, because no company grows fast forever.',
      value: percent(s2.growth_pct),
    },
    {
      label: 'Growth after that, forever',
      gloss: 'Roughly the pace of the economy itself.',
      value: percent(math.terminal_growth_pct),
    },
    {
      label: 'Discount rate',
      gloss: 'How much we shrink future money, to account for risk and for waiting.',
      value: percent(math.discount_rate_pct),
    },
    {
      // Mockup: "Negative means Apple holds more cash than it owes."
      label: 'Debt, minus cash',
      gloss: 'Negative means the company holds more cash than it owes.',
      value: money(math.net_debt),
    },
    {
      label: 'Shares outstanding',
      gloss: 'We divide the whole business by this to get a price per share.',
      value: count(math.shares_outstanding),
    },
  ]
}

/**
 * @param {object}      props
 * @param {object|null} props.math  `the_math` from the adapter. Null on the
 *                                  cannot-value payload — there is no maths to show,
 *                                  so the trigger does not appear at all.
 */
export default function WhyDrawer({ math }) {
  const [open, setOpen] = useState(false) // collapsed by default
  const body = useRef(null)
  const chevron = useRef(null)
  const scope = useRef(null)

  useGSAP(
    () => {
      if (!body.current) return
      const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
      const duration = reduce ? 0 : 0.45

      gsap.to(chevron.current, { rotate: open ? 180 : 0, duration, ease: 'power3.inOut' })
      gsap.to(body.current, {
        height: open ? 'auto' : 0,
        duration,
        ease: 'power3.inOut',
        onComplete: () => {
          /* GSAP resolves `auto` to a pixel height and leaves it there, which goes
             stale the moment the gloss text rewraps at a narrower width. Hand the
             height back to the content once the tween has landed. */
          if (open) gsap.set(body.current, { height: 'auto' })
          ScrollTrigger.refresh()
        },
      })
      if (open && !reduce) {
        gsap.from('.mathrow', { opacity: 0, y: 10, duration: 0.4, stagger: 0.045, delay: 0.1 })
      }
    },
    { dependencies: [open], scope },
  )

  if (!math) return null

  return (
    <div className="whydrawer" ref={scope}>
      <button
        type="button"
        className="why"
        aria-expanded={open}
        aria-controls="why-body"
        onClick={() => setOpen((v) => !v)}
      >
        <span>Why? Show me the math</span>
        <span className="chev" ref={chevron} aria-hidden="true">&#9662;</span>
      </button>

      <div className="whybody" id="why-body" ref={body}>
        <div className="whyinner">
          {rowsFor(math).map((row) => (
            <div className="mathrow" key={row.label}>
              <span className="k">
                {row.label}
                <em>{row.gloss}</em>
              </span>
              <span className={row.value === EMPTY ? 'v missing' : 'v'}>{row.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
