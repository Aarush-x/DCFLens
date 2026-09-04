import { useEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'
import { useGSAP } from '@gsap/react'
import { money, count, percent, EMPTY } from '../lib/format.js'
import { readsAsEnglish, SOURCE_TAG } from '../lib/plain.js'
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
 * Nothing here computes. Every figure and label is printed as the adapter handed it
 * over; a value we do not have is an em dash and a section we do not have is simply
 * absent. This is the audit surface — the one place in the app where inventing
 * anything would be worst.
 *
 * What it does do is refuse to print our own machine vocabulary. XBRL tags,
 * transformation expressions and substituted debug traces are dropped rather than
 * shown, because non-negotiable #1 holds here too: the reader never meets the way we
 * talk to ourselves. Dropping is not inventing — nothing is paraphrased into a claim
 * the payload didn't make, and everything that makes this checkable against the
 * source (form, period, filed date, the figures, the links) stays.
 */

/**
 * The href for "Read the filing on SEC.gov".
 *
 * Two mechanisms, and they stack. `evidence.url` already ends in the inline-XBRL
 * element id, which scrolls the filing to the figure. A scroll-to-text-fragment
 * appended after it (`#f-307:~:text=111%2C482`) makes the browser paint its own
 * temporary highlight on the number too — the reader sees WHICH number we mean,
 * and the mark clears on their next click. We do not style it and cannot: the
 * page is sec.gov's.
 *
 * Guarded on `document.fragmentDirective` because the two mechanisms do NOT
 * degrade into one another. A browser that has not implemented fragment
 * directives reads the whole of `f-307:~:text=…` as one element id, finds no such
 * element, and scrolls nowhere — losing the anchor we already had. So the
 * directive is only ever added where it is understood.
 *
 * The backend supplies `highlight` only where it has established that the browser
 * will land on OUR figure and not an earlier printing of the same number (see
 * app/data/sec/fact_anchors.py). Where it has not, this returns the plain anchor,
 * which is exactly the link that shipped before the highlight existed.
 */
export function filingHref(evidence, doc = typeof document === 'undefined' ? null : document) {
  const url = evidence?.url
  if (!url) return null
  const text = evidence?.highlight
  if (!text || !doc || !('fragmentDirective' in doc)) return url
  return `${url}:~:text=${encodeURIComponent(text)}`
}

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

/* The envelope's `transformation` is a machine string describing how the number got
   from the filing to us. It arrives in two shapes — a bare tag ("reported_value"),
   or a derived field with the expression that produced it and the source tag stuck
   on the end:

     free_cash_flow = operating_cash_flow - abs(capital_expenditure);
     source transformation: reported_value

   It used to be printed verbatim, on the argument that the raw string is the
   strongest auditability signal in the payload. It is — for us. For the reader it
   is source code, and non-negotiable #1 says our vocabulary never reaches the
   screen. The expression also says nothing the panel doesn't already say better:
   "The calculation" states the same operation as a sentence, directly beneath.

   So the string is read for its source tag, the tag is printed as English, and the
   expression is dropped. No provenance is lost with it — the form, the period, the
   filed date, the figures themselves and both links are all still on the panel. */
const TRANSFORMATIONS = {
  reported_value: 'Taken from the filing exactly as reported. Nothing was adjusted.',
  'absolute_value(reported_value)':
    'Taken from the filing as reported, then read as an amount rather than a direction — the filing writes money spent as a negative.',
  absolute_value: 'Read as an amount rather than a direction, so money spent counts as spending.',
  sum: 'Added together from more than one reported line.',
  difference: 'One reported line subtracted from another.',
  ratio: 'One reported line divided by another.',
  annualized: 'Scaled from a part-year figure to a full year.',
  sign_flipped: 'Sign reversed, so the figure reads the way the sentence describes it.',
}

/**
 * The English for a transformation string, or null when we have none.
 *
 * Null is the right answer for an unrecognised tag: the alternative is printing the
 * tag itself, which is the thing this function exists to keep off the screen. A row
 * with no gloss simply shows its label and its figure, which is still true.
 */
export function transformationGloss(transformation) {
  const raw = String(transformation ?? '').trim()
  if (!raw) return null
  const at = raw.lastIndexOf(SOURCE_TAG)
  const tag = (at === -1 ? raw : raw.slice(at + SOURCE_TAG.length)).trim()
  if (!tag) return null
  if (TRANSFORMATIONS[tag]) return TRANSFORMATIONS[tag]
  // An unknown wrapper around a tag we do know — abs(reported_value) and friends.
  const inner = /^[a-z_]+\((.+)\)$/.exec(tag)?.[1]
  return (inner && TRANSFORMATIONS[inner]) || null
}

/* Provenance. A structured XBRL fact and a number lifted out of prose are not the
   same kind of claim, and the reader has to be able to tell them apart at a glance —
   a distinction they can make without ever meeting the word XBRL. The filing
   reported it as data, or we read it off the page: that is the whole difference.

   Neither is an error, so neither reaches for --over. The filing's own data gets the
   green dot the palette already uses for "this holds up"; parsed text gets the amber
   one and --dim copy — the caution colour, one step quieter, which is what lower
   confidence looks like in this palette. */
const PROVENANCE = {
  xbrl: {
    label: 'Straight from the filing',
    dot: 'var(--under)',
    gloss: 'A figure the company reported as data in the filing itself, not one we read out of the text.',
  },
  text: {
    label: 'Read from the filing’s text',
    dot: 'var(--fair)',
    gloss: 'Taken from the filing’s prose rather than the data it reported. Worth checking against the source.',
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

  /* The gloss is usually the same on every row — `reported_value` on all of them, in
     most live responses. Printing the identical sentence three times would bury the
     one row that differs, which is the row a reader came here to find. So a gloss is
     attached to the FIRST row that uses it and the repeats stay silent; with the tag
     itself gone from the row, a repeated sentence would be the only thing there. */
  const glossed = new Set()
  const valueRows = values.map((v, i) => {
    const said = transformationGloss(v.transformation)
    const gloss = said && !glossed.has(said) ? said : null
    if (said) glossed.add(said)
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

        {/* The figures themselves: what the filing called it, what it said, and — in
            English, once per distinct answer — what we did to it on the way here.
            The XBRL tag and the expression used to sit under every row; see the note
            on TRANSFORMATIONS for why they don't any more. */}
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
                {v.gloss ? <p className="evgloss">{v.gloss}</p> : null}
              </div>
            ))}
          </section>
        ) : null}

        {/* What was done with them. Plain English where the engine gave us plain
            English; its own wording either way, never a paraphrase. */}
        {readsAsEnglish(evidence.calculation) ? (
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
                {readsAsEnglish(m.calculation) ? <p className="evgloss">{m.calculation}</p> : null}
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
            <a href={filingHref(evidence)} target="_blank" rel="noreferrer">
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
