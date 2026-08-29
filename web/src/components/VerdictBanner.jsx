import { useRef } from 'react'
import { gsap } from 'gsap'
import { useGSAP } from '@gsap/react'
import { price, range, cleanName } from '../lib/format.js'
import Eyebrow from './ui/Eyebrow.jsx'
import Label from './ui/Label.jsx'

/* The verdict block from the app screen of design/index.html.
 *
 * Product non-negotiable #4 — this is the largest element on screen and the first
 * thing read. Everything else on the page explains it.
 *
 * Three states, and today the API only reaches two of them:
 *
 *   verdict      label + price + range  -> the mockup exactly: the verdict word in
 *                the display face, coloured, over the price-vs-range sentence.
 *   no-price     range but price === null. THE DEFAULT PATH TODAY — the service is
 *                SEC/XBRL-only and carries no quote (adapter.js, NO_PRICE). A verdict
 *                is by definition price vs value, so there is no word and no marker.
 *                The range becomes the headline and the sub says why there is no
 *                comparison. Never a verdict word, never an invented price.
 *   cannot-value the designed refusal, copy from the s-novalue section of
 *                design/app.html. Not an error page (non-negotiable #3).
 */

/* Verdict words, colours and clauses are the mockup's own — index.html's scrub
   handler, which is where the three states are written down. Not paraphrased. */
const VERDICTS = {
  UNDERVALUED: {
    word: 'Looks cheap',
    color: 'var(--under)',
    clause: 'Trading below what we estimate the business is worth.',
  },
  FAIRLY_PRICED: {
    word: 'Fairly priced',
    color: 'var(--fair)',
    clause: 'Inside the range we would call reasonable. No bargain, no warning.',
  },
  OVERVALUED: {
    word: 'Looks expensive',
    color: 'var(--over)',
    clause: 'Above our estimate. The price assumes growth it has not delivered.',
  },
}

/* .avsub from design/index.html, kept here rather than in index.css so this
   component owns its own type. Values copied, not chosen. */
const SUB = {
  fontSize: 17,
  color: 'var(--dim)',
  maxWidth: '54ch',
  lineHeight: 1.55,
  margin: '0 0 54px',
}

const isNum = (n) => typeof n === 'number' && Number.isFinite(n)

/** "2026-08-29" -> "29 August 2026". UTC so the date never slips a day. */
function asOfLabel(iso) {
  if (typeof iso !== 'string' || !iso.slice(0, 10).match(/^\d{4}-\d{2}-\d{2}$/)) return null
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  })
}

/** "Apple Inc. · AAPL · as of 29 August 2026" — each part dropped if absent.
 *  Empty when we know none of the three, which renders no line at all. */
function eyebrowText(data) {
  const asOf = asOfLabel(data.as_of ?? data.retrievedAt)
  return [cleanName(data.company_name), data.ticker, asOf && `as of ${asOf}`]
    .filter(Boolean).join(' · ')
}

export default function VerdictBanner({ data }) {
  const scope = useRef(null)
  const head = useRef(null)
  const sub = useRef(null)

  useGSAP(() => {
    if (!head.current) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const parts = [head.current, sub.current].filter(Boolean)
    if (reduce) { gsap.set(parts, { opacity: 1, y: 0 }); return }

    /* playApp() in design/index.html: headline up first, sub overlapping into it. */
    gsap.timeline({ defaults: { ease: 'power3.out' } })
      .from(head.current, { opacity: 0, y: 22, duration: 0.6 })
      .from(sub.current, { opacity: 0, y: 14, duration: 0.55 }, '-=.35')
  }, { scope, dependencies: [data], revertOnUpdate: true })

  if (!data) return null

  const v = data.verdict ?? {}
  const p = data.price ?? {}
  const low = isNum(p.fair_value_low) ? p.fair_value_low : null
  const high = isNum(p.fair_value_high) ? p.fair_value_high : null
  const current = isNum(p.current) ? p.current : null
  const hasRange = low !== null && high !== null

  /* A range we could not build is the same refusal as one we would not publish —
     we do not fall back to the mid on its own (non-negotiable #2). */
  const cannotValue = data.canValue === false || v.label === 'CANNOT_VALUE' || !hasRange
  const verdict = !cannotValue && current !== null ? VERDICTS[v.label] : null

  let state = 'no-price'
  let headline = range(low, high)
  let color = 'var(--cream)'
  let body = null

  if (cannotValue) {
    state = 'cannot-value'
    headline = "We can't value this one reliably"
    color = 'var(--faint)'
    body = (
      <>
        We&rsquo;d rather show you nothing than a number we don&rsquo;t trust.
        Here&rsquo;s what got in the way.
        {v.detail ? ` ${v.detail}` : ''}
      </>
    )
  } else if (verdict) {
    state = 'verdict'
    headline = verdict.word
    color = verdict.color
    body = `${price(current)} today, against an estimated ${range(low, high)}. ${verdict.clause}`
  } else if (current !== null) {
    /* Priced, but the label is missing or one we don't know. We have both halves of
       the comparison and still won't pick a word for it — stating them is honest,
       inferring the verdict here would duplicate a judgement that belongs upstream. */
    state = 'no-verdict'
    body = `${price(current)} today, against an estimated ${range(low, high)}. We don't have a settled read on that gap yet.`
  } else {
    /* No price — so no verdict. Say that, in as many words.
       The company is named in the eyebrow directly above; repeating it here would
       mean shouting the SEC's ALL-CAPS registrant name mid-sentence. */
    body = (
      <>
        That&rsquo;s what the latest filings support, per share. We don&rsquo;t have
        today&rsquo;s share price yet, so we can&rsquo;t tell you whether the market
        agrees &mdash; and we won&rsquo;t make one up. Everything below is the working
        behind that range.
      </>
    )
  }

  const eyebrow = eyebrowText(data)
  const rangeHeadline = state === 'no-price' || state === 'no-verdict'

  return (
    <section ref={scope} data-verdict-state={state} data-verdict={v.label ?? null}>
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      {rangeHeadline && (
        <Label style={{ marginTop: 18 }}>Estimated value per share</Label>
      )}
      <h1
        ref={head}
        className="verdict"
        style={{ color, marginTop: rangeHeadline ? 10 : undefined }}
      >
        {headline}
      </h1>
      <p ref={sub} style={SUB}>{body}</p>
    </section>
  )
}
