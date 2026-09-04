import { useRef, useState } from 'react'
import { gsap } from 'gsap'
import { useGSAP } from '@gsap/react'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { money, percent, count, EMPTY } from '../lib/format.js'
import ViewEvidence from './ViewEvidence.jsx'
import GrowthWorking from './GrowthWorking.jsx'
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
 * The seven rows, in the mockup's order: { label, gloss, value, field }.
 * A figure we do not have renders as EMPTY — an em dash — never as zero.
 *
 * `field` is the key this row's provenance hangs off in `the_math.evidence`, which
 * docs/API.md defines as keyed by field name with an absent key meaning null. The
 * two growth stages have no key of their own — they are OUR assumptions, not
 * reported figures, and there is no filing to point at for them, so they carry no
 * trigger rather than a trigger that leads nowhere. What they get instead is
 * GrowthWorking below: not a source, which does not exist, but the method, which
 * does.
 */
function rowsFor(math) {
  const s1 = math.stage_1 ?? {}
  const s2 = math.stage_2 ?? {}
  const s1Span = stageLabel(1, s1.years)
  const s2Span = stageLabel(Number.isFinite(s1.years) ? s1.years + 1 : NaN, s2.years)

  return [
    {
      label: 'Spare cash last year',
      field: 'starting_free_cash_flow',
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
      field: 'terminal_growth_pct',
      gloss: 'Roughly the pace of the economy itself.',
      value: percent(math.terminal_growth_pct),
    },
    {
      label: 'Discount rate',
      field: 'discount_rate_pct',
      gloss: 'How much we shrink future money, to account for risk and for waiting.',
      value: percent(math.discount_rate_pct),
    },
    {
      // Mockup: "Negative means Apple holds more cash than it owes."
      label: 'Debt, minus cash',
      field: 'net_debt',
      gloss: 'Negative means the company holds more cash than it owes.',
      value: money(math.net_debt),
    },
    {
      label: 'Shares outstanding',
      field: 'shares_outstanding',
      gloss: 'We divide the whole business by this to get a price per share.',
      value: count(math.shares_outstanding),
    },
  ]
}

/**
 * @param {object}      props
 * @param {object|null} props.math    `the_math` from the adapter. Null on the
 *                                    cannot-value payload — there is no maths to
 *                                    show, so the trigger does not appear at all.
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
      {/* The trigger used to be one 14.5px line and a ▾ glyph in a plain outlined
          box — the smallest, quietest thing on a screen whose entire second half
          it opens. It now says what is behind it, because "show me the math" is a
          promise a beginner has no way to price: nothing on the closed screen
          hints that clicking gets you the seven inputs, the checklist and the
          sensitivity grid. The subtitle is the offer; the button is the door. */}
      <button
        type="button"
        className="why"
        aria-expanded={open}
        aria-controls="why-body"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="whylabel">
          <span className="whytitle">Why? Show me the math</span>
          <span className="whysub">
            The seven inputs behind the estimate, where each value came from, and how
            the growth rate was arrived at.
          </span>
        </span>
        {/* A ring rather than a bare glyph: the chevron alone gave no target and
            no state. GSAP still drives the rotation, so the open/close reads as
            one gesture. */}
        <span className="chev" ref={chevron} aria-hidden="true">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </span>
      </button>

      <div className="whybody" id="why-body" ref={body}>
        <div className="whyinner">
          <div className="whyinputs">
              {/* The rows carried no heading when they were the first thing in the
                  drawer. Beside a headed column they need one, and it is the same
                  .blkh treatment the four narrative blocks and the audit use. */}
              <span className="blkh">The inputs</span>
              <p className="hint">Every figure the estimate is built from. Change one and the range moves.</p>

              {rowsFor(math).map((row) => (
                <div className="mathrow" key={row.label}>
                  <span className="k">
                    {row.label}
                    <em>{row.gloss}</em>
                    {/* The provenance of this exact input. "Source" rather than "View
                        evidence" — inside a row of figures the question is where the
                        number came from, and the shorter word keeps the row's second
                        line from outgrowing the gloss above it. */}
                    <ViewEvidence
                      evidence={row.field ? (math.evidence?.[row.field] ?? null) : null}
                      claim={row.label}
                      label="Source"
                    />
                  </span>
                  <span className={row.value === EMPTY ? 'v missing' : 'v'}>{row.value}</span>
                </div>
              ))}
          </div>

          {/* The two growth rows above are the only inputs on this screen that are
              ours rather than the filing's, and they are the ones the answer is
              most sensitive to. This is their working. Absent — as on any payload
              without the engine's assumption traces — it renders nothing. */}
          <GrowthWorking growth={math.growth} />
        </div>
      </div>
    </div>
  )
}
