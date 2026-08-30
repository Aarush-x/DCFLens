import { useEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'
import { useGSAP } from '@gsap/react'
import { money, count, percent, EMPTY } from '../lib/format.js'
import './EvidenceDrawer.css'

/* ── The evidence drawer ──────────────────────────────────────────────────────
 *
 * One component renders the provenance of ANY claim. Plain-English cards,
 * checklist rows and maths rows all carry the same `evidence` shape (docs/API.md
 * v2, built by `toEvidence` in src/lib/adapter.js), so there is one panel and it
 * takes whichever one it is handed.
 *
 * ── Why a slide-over and not an inline expansion ─────────────────────────────
 * The Why drawer expands in place because its content is a list of seven rows that
 * belongs under the sentence it explains. Evidence does not: the same panel opens
 * from a card in the left pane, from a maths row inside an already-open drawer,
 * and (once the checklist renders) from a check. An inline expansion would have to
 * fit all three columns, and inside the Why drawer it would be an accordion within
 * an accordion. A slide-over is the same panel from anywhere, which is exactly the
 * relationship the data has.
 *
 * The MOTION is the Why drawer's: 0.45s, power3.inOut, and the rows stagger in at
 * 0.045 behind it — the same numbers, so the two layers feel like one product.
 *
 * ── What it must never do ────────────────────────────────────────────────────
 * Nothing here computes. Every figure, label, concept and transformation string is
 * printed as the adapter handed it over; a value we do not have is an em dash and
 * a section we do not have is simply absent. This is the audit surface — the one
 * place in the app where inventing anything would be worst.
 */

/* ── formatting ─────────────────────────────────────────────────────────────── */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** "2025-11-01" -> "1 November 2025". Anything that isn't a plain ISO date is
 *  passed through untouched rather than mangled into a wrong date. */
export function filedOn(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''))
  if (!m) return typeof iso === 'string' && iso.trim() ? iso : null
  const month = MONTHS[Number(m[2]) - 1]
  if (!month) return iso
  return `${Number(m[3])} ${month} ${m[1]}`
}

/**
 * A reported figure, formatted by the unit the filing gave it.
 *
 * The unit matters: `gross_profit_margin` arrives as 0.6794 with unit
 * "decimal_ratio", and money() would print that as "$0.68" — a plausible-looking
 * number that is wrong by nine orders of magnitude. Anything we don't recognise
 * prints as a plain magnitude with its unit spelled out beside it, which is honest
 * about the fact that we don't know how to read it.
 */
export function evidenceValue(value, unit) {
  if (!Number.isFinite(value)) return EMPTY
  const u = String(unit ?? 'USD').toLowerCase()
  if (u === 'usd') return money(value)
  if (u === 'decimal_ratio' || u === 'decimal_fraction' || u === 'pure') return percent(value * 100)
  if (u === 'shares') return count(value)
  return `${count(value)} ${unit}`
}

/* The envelope's `transformation` is a machine string describing how the number
   got from the filing to us. It is the single strongest auditability signal in the
   payload and it is printed verbatim — but verbatim is not English, so the ones we
   know carry a gloss, in the manner of the Why drawer's `.mathrow em`. */
const TRANSFORMATIONS = {
  reported_value: 'Taken from the filing exactly as reported. Nothing was adjusted.',
  sum: 'Added together from more than one reported line.',
  difference: 'One reported line subtracted from another.',
  ratio: 'One reported line divided by another.',
  annualized: 'Scaled from a part-year figure to a full year.',
  sign_flipped: 'Sign reversed, so the figure reads the way the sentence describes it.',
}

/* Provenance. A structured XBRL fact and a number lifted out of prose are not the
   same kind of claim, and the reader has to be able to tell them apart at a glance.

   Neither is an error, so neither reaches for --over. XBRL gets the green dot the
   palette already uses for "this holds up"; parsed text gets the amber one and
   --dim copy — the caution colour, one step quieter, which is what lower
   confidence looks like in this palette. */
const PROVENANCE = {
  xbrl: {
    label: 'From XBRL',
    dot: 'var(--under)',
    gloss: 'A tagged, machine-readable figure in the filing itself.',
  },
  text: {
    label: 'Parsed from filing text',
    dot: 'var(--fair)',
    gloss: 'Read out of the filing’s prose rather than its tagged data. Worth checking against the source.',
  },
}

/* ── the drawer ─────────────────────────────────────────────────────────────── */

/**
 * @param {object}      props
 * @param {object|null} props.evidence  the evidence object being shown
 * @param {string|null} props.claim     the claim it backs, used as the heading
 * @param {boolean}     props.open      EvidenceProvider owns this — one at a time
 * @param {Function}    props.onClose
 */
export default function EvidenceDrawer({ evidence, claim = null, open, onClose }) {
  const scope = useRef(null)
  const panel = useRef(null)
  const scrim = useRef(null)
  const closeBtn = useRef(null)
  const returnTo = useRef(null)

  /* `open` falls to false the moment the trigger is clicked; the panel has to stay
     mounted until it has finished tweening off screen, so mount is its own flag and
     the exit tween is what clears it. Raised during render rather than in an effect
     — the panel must exist on the SAME commit that opens it, or useGSAP below has
     nothing to tween in and the drawer appears without its entrance. */
  const [mounted, setMounted] = useState(false)
  if (open && !mounted) setMounted(true)

  /* Escape closes it — one of the two dismissals the spec names. Bound while open
     only, so it never eats an Escape meant for something else. */
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  /* Focus goes into the panel on open and back where it came from on close. A
     keyboard user who opens the drawer from a card must not be left tabbing
     through the page behind it, and must not lose their place when it shuts. */
  useEffect(() => {
    if (open) {
      returnTo.current = document.activeElement
      closeBtn.current?.focus()
      return undefined
    }
    const back = returnTo.current
    returnTo.current = null
    if (back && typeof back.focus === 'function') back.focus()
    return undefined
  }, [open])

  useGSAP(
    () => {
      if (!mounted || !panel.current) return
      const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
      // The Why drawer's numbers, deliberately — see the header.
      const duration = reduce ? 0 : 0.45
      const ease = 'power3.inOut'

      if (open) {
        gsap.fromTo(scrim.current, { opacity: 0 }, { opacity: 1, duration, ease })
        gsap.fromTo(panel.current, { xPercent: 100 }, { xPercent: 0, duration, ease })
        if (!reduce) {
          gsap.from('.evrow', { opacity: 0, y: 10, duration: 0.4, stagger: 0.045, delay: 0.12 })
        }
      } else {
        gsap.to(scrim.current, { opacity: 0, duration, ease })
        gsap.to(panel.current, {
          xPercent: 100,
          duration,
          ease,
          onComplete: () => setMounted(false),
        })
      }
    },
    { dependencies: [open, mounted], scope },
  )

  if (!mounted || !evidence) return null

  const prov = PROVENANCE[evidence.provenance] ?? null
  const values = Array.isArray(evidence.values_used) ? evidence.values_used : []
  const metrics = Array.isArray(evidence.metrics) ? evidence.metrics : []
  const filed = filedOn(evidence.filed_on)
  const filingLine = [evidence.filing_type, evidence.fiscal_period].filter(Boolean).join(' · ')

  /* The gloss explains a transformation tag, and the tag is usually the same on
     every row — `reported_value` on all of them, in most live responses. Printing
     the identical sentence three times would bury the one row that differs, which
     is the row a reader came here to find. So each gloss is attached to the FIRST
     row that uses its tag; every row still shows the tag itself. */
  const glossed = new Set()
  const valueRows = values.map((v, i) => {
    const t = v.transformation ?? null
    const gloss = t && !glossed.has(t) ? (TRANSFORMATIONS[t] ?? null) : null
    if (t) glossed.add(t)
    /* Index-keyed on purpose. One concept can legitimately appear twice in the
       same evidence object — the same XBRL tag read for two fiscal periods, which
       is how a growth claim is evidenced — so the concept is not unique and the
       list never reorders. */
    return { ...v, gloss, key: `${v.concept ?? v.label ?? 'value'}-${i}` }
  })

  return (
    <div className="evscope" ref={scope}>
      {/* Clicking outside — the drawer's other dismissal. mousedown rather than
          click, so a drag that starts inside the panel and ends on the scrim
          doesn't shut it. */}
      <div className="evscrim" ref={scrim} onMouseDown={onClose} aria-hidden="true" />

      <aside
        className="evpanel"
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ev-title"
        /* Lenis is mounted app-wide and would otherwise swallow the wheel inside
           the panel and scroll the page behind it instead. */
        data-lenis-prevent=""
      >
        <header className="evhead">
          <div>
            <div className="cap">Evidence</div>
            <h2 id="ev-title">{claim ?? 'Where this figure comes from'}</h2>
          </div>
          <button type="button" className="evclose" ref={closeBtn} onClick={onClose} aria-label="Close evidence">
            &#10005;
          </button>
        </header>

        {/* The document, first: what was filed, and when. */}
        <div className="evfiling">
          <span className="evform">{filingLine || 'Filing'}</span>
          {filed ? <span className="evfiled">Filed {filed}</span> : null}
        </div>

        {prov ? (
          <div className="evprov" data-provenance={evidence.provenance}>
            <span className="evdot" style={{ background: prov.dot }} aria-hidden="true" />
            <span className="evprovlabel">{prov.label}</span>
            <em>{prov.gloss}</em>
          </div>
        ) : null}

        {/* The figures themselves. Each one carries the XBRL concept it was tagged
            under and the transformation applied to it — the two things that make
            this an audit trail rather than a restatement. */}
        {values.length ? (
          <section className="evsect">
            <div className="cap">The figures used</div>
            {valueRows.map((v) => (
              <div className="evrow" key={v.key}>
                <div className="evrowtop">
                  <span className="k">{v.label ?? 'Reported value'}</span>
                  <span className={Number.isFinite(v.value) ? 'v' : 'v missing'}>
                    {evidenceValue(v.value, v.unit)}
                  </span>
                </div>
                {v.concept ? <div className="evconcept">{v.concept}</div> : null}
                {v.transformation ? (
                  <div className="evtransform">
                    <code>{v.transformation}</code>
                    {v.gloss ? <em>{v.gloss}</em> : null}
                  </div>
                ) : null}
              </div>
            ))}
          </section>
        ) : null}

        {/* What was done with them. Plain English where the engine gave us plain
            English; its own wording either way, never a paraphrase. */}
        {evidence.calculation ? (
          <section className="evsect">
            <div className="cap">The calculation</div>
            <p className="evcalc">{evidence.calculation}</p>
          </section>
        ) : null}

        {/* Derived metrics, when the checklist row carried any. Same treatment as
            the figures, one level quieter — these are our arithmetic, not the
            filing's numbers. */}
        {metrics.length ? (
          <section className="evsect">
            <div className="cap">What that gives</div>
            {metrics.map((m, i) => (
              <div className="evrow" key={m.label ?? i}>
                <div className="evrowtop">
                  <span className="k">{m.label ?? 'Metric'}</span>
                  <span className={Number.isFinite(m.value) ? 'v' : 'v missing'}>
                    {evidenceValue(m.value, m.unit)}
                  </span>
                </div>
                {m.calculation ? <div className="evconcept">{m.calculation}</div> : null}
              </div>
            ))}
          </section>
        ) : null}

        {evidence.section ? (
          <section className="evsect">
            <div className="cap">Where in the filing</div>
            <p className="evsection">{evidence.section}</p>
          </section>
        ) : null}

        {/* The deep link. The readable document on sec.gov, not the raw XBRL
            endpoint — see the note on `url` in adapter.js `toEvidence`. The raw
            feed is offered second, for anyone who actually wants it. */}
        <footer className="evlinks">
          {evidence.url ? (
            <a href={evidence.url} target="_blank" rel="noreferrer">
              Read the filing on SEC.gov &#8599;
            </a>
          ) : (
            <span className="evnolink">We don’t have a link to the filing this came from.</span>
          )}
          {evidence.data_url ? (
            <a className="secondary" href={evidence.data_url} target="_blank" rel="noreferrer">
              The raw XBRL data &#8599;
            </a>
          ) : null}
        </footer>
      </aside>
    </div>
  )
}
