import { useRef } from 'react'
import { gsap } from 'gsap'
import { useGSAP } from '@gsap/react'
import { price, range, cleanName } from '../lib/format.js'
import { VERDICT_WITHHELD } from '../lib/adapter.js'
import ConfidenceChip from './ConfidenceChip.jsx'
import Eyebrow from './ui/Eyebrow.jsx'
import Label from './ui/Label.jsx'

/* The verdict block from the app screen of design/index.html — reworked to two
 * axes (2A.1).
 *
 * Product non-negotiable #4 — this is the largest element on screen and the first
 * thing read. Everything else on the page explains it.
 *
 * ── Why two axes ─────────────────────────────────────────────────────────────
 * "Looks cheap / fairly priced / looks expensive" is a price axis only. Verdict.pdf
 * pressure-tested that and found the most valuable thing this product can say is
 * the case a single axis cannot express: when the arithmetic and the evidence
 * disagree. So the block now states both, side by side and never blended:
 *
 *   verdict.label             THE PRICE     — price against our estimate
 *   verdict.business_quality  THE BUSINESS  — what the filings say, independent
 *                                             of price (adapter.js businessQuality)
 *   verdict.combination       the headline, one of six strings, closed set
 *
 * A blended score would hide the contradiction; the contradiction is the insight.
 * When the two axes point opposite ways — strong business at an expensive price,
 * weak business at a cheap one — the headline refuses a colour and the subheading
 * names the tension out loud.
 *
 * ── What supplies each axis ──────────────────────────────────────────────────
 * `business_quality` is real in every state: the adapter derives it from
 * `analysis.deterministic_checklist`, which needs no quote, and docs/API.md
 * defines the axis as independent of price precisely because of that.
 *
 * `label` is the price axis, and docs/API.md v3 puts one gate on it —
 * `plausibility.can_state_verdict`. The adapter reads that gate and hands this
 * component either a word or a null with a reason; NOTHING HERE RE-DERIVES IT.
 * A combination is composed only when both axes are known — never from the quality
 * axis alone, because five of the six legal strings encode a price judgement.
 *
 * ── The states ───────────────────────────────────────────────────────────────
 *   verdict           both axes -> the combination headline, the price/range
 *                     sentence beneath it, the two-axis readout above the range
 *                     bar, and — when the gate opened with caveats attached — the
 *                     backend's own caveat sentences under the sub-line.
 *   price-only        price but no quality axis -> exactly the mockup: the verdict
 *                     word, coloured, over the price-vs-range sentence. No axis
 *                     readout, because one axis is not two.
 *   verdict-withheld  a price AND a range, and the gate closed on the word
 *                     (adapter VERDICT_WITHHELD). Not a new design: it is the
 *                     no-price layout with the price filled in — the range leads,
 *                     the price is stated as the fact it is, and the sub-line and
 *                     the caveat block say, in the backend's beginner-readable
 *                     sentences, that our estimate sits too far from the market
 *                     for us to call it. No word and no colour: a coloured
 *                     headline is a verdict said in paint.
 *   no-price          range but price === null. A verdict is by definition price
 *                     vs value, so there is no word and no marker. The range
 *                     becomes the headline. The quality axis still renders when we
 *                     have it, and the price axis says, in the readout, that we do
 *                     not have a price — never an invented one.
 *   cannot-value      the designed refusal, copy from the s-novalue section of
 *                     design/app.html. Not an error page (non-negotiable #3), and
 *                     no axes or chip: the refusal is the whole message.
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

/* The quality axis. Traffic lights again, and deliberately: the palette's whole
   argument (D-014) is that green/yellow/red need no explaining to a beginner. Each
   axis carries its own label directly above it, so a green here reads as "good
   business", not as "cheap".

   The clauses never quote a pass count. D-016: "a stock passing eight out of ten
   checks is a buy" is named in Verdict.pdf as a claim that damages trust, which is
   why the contract carries no count and does not promise ten checks. */
const QUALITY = {
  strong: {
    word: 'Strong',
    color: 'var(--under)',
    clause: 'Most of what we can check in the filings holds up.',
  },
  weak: {
    word: 'Weak',
    color: 'var(--over)',
    clause: 'Several of the things we check cut against it.',
  },
  uncertain: {
    word: 'Mixed',
    color: 'var(--fair)',
    clause: 'The filings point both ways. Neither case is clear.',
  },
  insufficient: {
    word: 'Not enough to judge',
    color: 'var(--faint)',
    clause: "The filings didn't tell us enough about the business either way.",
  },
}

/** docs/API.md: exactly one of six strings. Free text is not allowed, and a
 *  seventh reading is not ours to invent. */
export const COMBINATIONS = Object.freeze([
  'Strong business, demanding price',
  'Strong business, reasonable price',
  'Weak business, apparently cheap',
  'Uncertain business, fragile valuation',
  'Insufficient evidence',
  'Price depends on optimistic assumptions',
])

/* The two axes onto the closed set. Total over every legal pair, so there is no
   combination of real data this cannot name — and nothing here is a new claim, it
   is the pair read aloud. A weak business at a price that is not cheap is the
   contract's "Price depends on optimistic assumptions": the price only works if
   the business does better than the filings show. */
const COMBINATION_FOR = {
  strong: {
    UNDERVALUED: 'Strong business, reasonable price',
    FAIRLY_PRICED: 'Strong business, reasonable price',
    OVERVALUED: 'Strong business, demanding price',
  },
  weak: {
    UNDERVALUED: 'Weak business, apparently cheap',
    FAIRLY_PRICED: 'Price depends on optimistic assumptions',
    OVERVALUED: 'Price depends on optimistic assumptions',
  },
  uncertain: {
    UNDERVALUED: 'Uncertain business, fragile valuation',
    FAIRLY_PRICED: 'Uncertain business, fragile valuation',
    OVERVALUED: 'Uncertain business, fragile valuation',
  },
  insufficient: {
    UNDERVALUED: 'Insufficient evidence',
    FAIRLY_PRICED: 'Insufficient evidence',
    OVERVALUED: 'Insufficient evidence',
  },
}

/** The two pairs where the axes contradict each other. Not a third score — the
 *  point is that no single number could have said this. */
const TENSION = {
  'weak|UNDERVALUED': 'Apparently cheap, but the evidence suggests the valuation is fragile.',
  'strong|OVERVALUED': 'A business the filings back — at a price that already assumes it keeps winning.',
}

/** Pass through only what the contract allows. Anything else is treated as absent,
 *  so a backend that starts sending free text cannot put it on a headline. */
export function legalCombination(value) {
  return typeof value === 'string' && COMBINATIONS.includes(value) ? value : null
}

/** Both axes, or nothing. Never derived from the quality axis alone — see the
 *  header. @returns {string|null} one of COMBINATIONS */
export function combinationFor(quality, label) {
  if (!quality || !label) return null
  return COMBINATION_FOR[quality]?.[label] ?? null
}

/** @returns {string|null} the sentence naming the contradiction, when there is one */
export function tensionFor(quality, label) {
  if (!quality || !label) return null
  return TENSION[`${quality}|${label}`] ?? null
}

/* .avsub from design/index.html, kept here rather than in index.css so this
   component owns its own type. Values copied, not chosen. */
const SUB = {
  fontSize: 17,
  color: 'var(--dim)',
  maxWidth: '54ch',
  lineHeight: 1.55,
  margin: 0,
}

/* A combination is a sentence, not a word, and at the .verdict scale
   (up to 82px) it fills three lines and starts shouting. It drops to the mockup's
   own h2 step instead — still the largest thing on the page by a wide margin, so
   non-negotiable #4 holds. */
const COMBO_TYPE = {
  fontSize: 'clamp(30px, 4.6vw, 60px)',
  letterSpacing: '-.04em',
  lineHeight: 1.05,
  maxWidth: '20ch',
}

const HEAD_ROW = {
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  flexWrap: 'wrap',
}

/* The two-axis readout. A hairline rule and two columns — the same vocabulary as
   .sources and the mockup's .vs, no new furniture. Two columns side by side is the
   argument made visually: they are separate readings and neither is averaged into
   the other. */
/* Vertical rhythm. design/index.html allots exactly 54px between the sub-line and
   the range bar (`.avsub { margin: 0 0 54px }`), and this readout is new furniture
   inside that gap — 2A.1 spent 30px above it and 48px below, which is 78px of air
   where the reference has 54, and it is a good part of what pushed the top of the
   page down. 26 above (see the render) and 36 below puts it back within a few px
   of the mockup while still letting the bar breathe away from the axis clauses. */
const AXES = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
  gap: 30,
  maxWidth: '64ch',
  borderTop: '1px solid var(--hair)',
  paddingTop: 20,
  margin: '0 0 36px',
}

/* .card h3 from design/index.html — the display face at its small step. */
const AXIS_VALUE = {
  fontFamily: 'var(--fd)',
  fontSize: 22,
  fontWeight: 600,
  letterSpacing: '-.022em',
  lineHeight: 1.2,
  margin: '9px 0 0',
}

const AXIS_CLAUSE = {
  margin: '8px 0 0',
  fontSize: 14,
  lineHeight: 1.6,
  color: 'var(--dim)',
  maxWidth: '36ch',
}

/* The gate's own sentences. One quiet block under the sub-line, marked off by the
   same hairline the readout uses rather than by a colour: these explain why we are
   not calling it, and painting them red would say "bad company" when what they
   say is "our number is not good enough". Severity is the only field the contract
   lets us style on, and we style on it by ordering — the backend sends them most
   severe first — not by paint. */
const CAVEATS = {
  margin: '0 0 26px',
  padding: '0 0 0 16px',
  borderLeft: '1px solid var(--hair)',
  maxWidth: '54ch',
  listStyle: 'none',
}

const CAVEAT = {
  margin: '0 0 8px',
  fontSize: 14.5,
  lineHeight: 1.6,
  color: 'var(--dim)',
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

function Axis({ label, word, color, clause }) {
  return (
    <div>
      <Label>{label}</Label>
      <div style={{ ...AXIS_VALUE, color }}>{word}</div>
      <p style={AXIS_CLAUSE}>{clause}</p>
    </div>
  )
}

export default function VerdictBanner({ data }) {
  const scope = useRef(null)
  const head = useRef(null)
  const sub = useRef(null)
  const caveats = useRef(null)
  const axes = useRef(null)

  useGSAP(() => {
    if (!head.current) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const parts = [head.current, sub.current, caveats.current, axes.current].filter(Boolean)
    if (reduce) { gsap.set(parts, { opacity: 1, y: 0 }); return }

    /* playApp() in design/index.html: headline up first, sub overlapping into it.
       The axis readout is a third beat on the same overlap, and still lands well
       before the .av blocks at 1.45s (AppScreen). */
    const tl = gsap.timeline({ defaults: { ease: 'power3.out' } })
      .from(head.current, { opacity: 0, y: 22, duration: 0.6 })
      .from(sub.current, { opacity: 0, y: 14, duration: 0.55 }, '-=.35')
    if (caveats.current) tl.from(caveats.current, { opacity: 0, y: 12, duration: 0.5 }, '-=.34')
    if (axes.current) tl.from(axes.current, { opacity: 0, y: 12, duration: 0.5 }, '-=.32')
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

  /* The price axis needs both halves of the comparison. A label with no price
     behind it is not a reading we are entitled to show. */
  const priceAxis = !cannotValue && current !== null ? (VERDICTS[v.label] ?? null) : null
  const label = priceAxis ? v.label : null

  /* The quality axis survives the missing price by construction — it reads the
     checklist, which needs no quote. Absent when the payload has no quality field
     we recognise, and absent means absent: nothing is inferred in its place. */
  const quality = !cannotValue ? (QUALITY[v.business_quality] ? v.business_quality : null) : null
  const qualityAxis = quality ? QUALITY[quality] : null

  const combination = legalCombination(v.combination) ?? combinationFor(quality, label)
  const tension = tensionFor(quality, label)

  /* The gate, as the adapter read it — never as this component re-derives it. A
     word withheld with a price in hand is its own state; a word withheld for want
     of a price is the no-price state below, and the two must never wear each
     other's copy. */
  const withheld = !cannotValue && current !== null && v.unavailable_reason === VERDICT_WITHHELD

  /* The backend writes these for a beginner and they are rendered verbatim, in the
     order sent (most severe first). Two is the most this block will carry: past
     that it stops being the reason and starts being the page.

     Nothing here on the no-price screen. The gate's one reason there is that we
     have no price — which the sub-line has just said and the readout below is
     about to say again. A third telling is the wall this block must not become. */
  const plausibility = data.plausibility ?? null
  const caveatList =
    cannotValue || current === null
      ? []
      : (plausibility?.reasons ?? []).filter((r) => r?.explanation).slice(0, 2)
  const gateSummary = plausibility?.summary ?? null

  let state = 'no-price'
  let headline = range(low, high)
  let color = 'var(--cream)'
  let type = null
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
  } else if (withheld) {
    /* The no-price layout with the price filled in: the range is the headline, the
       price is stated beneath it as the fact it is, and the word stays unsaid. No
       verdict colour — a coloured headline is a verdict said in paint. */
    state = 'verdict-withheld'
    body = (
      <>
        {price(current)} today, against an estimated {range(low, high)}.{' '}
        {gateSummary ??
          "That gap is wide enough that the likeliest explanation is our estimate, not the market — so we won't call this one either way."}
      </>
    )
  } else if (combination) {
    /* Both axes. The combination is the answer; the numbers are the support. */
    state = 'verdict'
    headline = combination
    type = COMBO_TYPE
    /* One colour can only be honest while the axes agree. Where they contradict
       each other, refusing to pick one IS the reading — the readout below shows
       both, and the tension sentence says why there is no single word for it. */
    color = tension ? 'var(--cream)' : priceAxis.color
    body = (
      <>
        {tension && <span style={{ color: 'var(--cream)' }}>{tension} </span>}
        {price(current)} today, against an estimated {range(low, high)}.
      </>
    )
  } else if (priceAxis) {
    /* The price axis alone — the mockup exactly. This is the prompt's own
       fallback: no quality axis we can stand behind, so we show one axis and say
       nothing about the other rather than guess at it. */
    state = 'price-only'
    headline = priceAxis.word
    color = priceAxis.color
    body = `${price(current)} today, against an estimated ${range(low, high)}. ${priceAxis.clause}`
  } else if (current !== null) {
    /* Priced, but the label is missing or one we don't know. We have both halves of
       the comparison and still won't pick a word for it — stating them is honest,
       inferring the verdict here would duplicate a judgement that belongs upstream. */
    state = 'no-verdict'
    body = `${price(current)} today, against an estimated ${range(low, high)}. We don't have a settled read on that gap yet.`
  } else if (qualityAxis) {
    /* No price, but the filings still had plenty to say. The range leads, and the
       readout below carries both axes — including the one we are missing, stated
       as missing. The company is named in the eyebrow directly above. */
    body = (
      <>
        That&rsquo;s what the latest filings support, per share. Everything below is
        the working behind that range.
      </>
    )
  } else {
    /* No price and nothing to say about the business either. Say that, in as many
       words. */
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
  const rangeHeadline =
    state === 'no-price' || state === 'no-verdict' || state === 'verdict-withheld'
  /* Two axes or none. One axis under a two-column heading would read as a broken
     layout rather than as a missing reading. */
  const showAxes = Boolean(qualityAxis) && !cannotValue
  const confidence = data.confidence ?? v.confidence ?? null

  return (
    <section
      ref={scope}
      data-verdict-state={state}
      data-verdict={label}
      data-quality={quality}
      data-tension={tension ? 'true' : null}
    >
      <div style={HEAD_ROW}>
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        {/* The refusal state says everything already; a confidence reading on top
            of "we can't value this" is noise. */}
        {!cannotValue && <ConfidenceChip confidence={confidence} />}
      </div>
      {rangeHeadline && (
        <Label style={{ marginTop: 18 }}>Estimated value per share</Label>
      )}
      <h1
        ref={head}
        className="verdict"
        style={{ color, ...type, marginTop: rangeHeadline ? 10 : undefined }}
      >
        {headline}
      </h1>
      {/* The readout takes over the gap to the range bar when it is there, so the
          block below always starts the same distance down the page. */}
      {/* 54px is the mockup's gap from the sub-line to the bar. With the readout in
          between, this half shrinks and AXES carries the rest. */}
      {/* 54px is the mockup's gap from the sub-line to the bar, and it is shared
          out between whatever stands in it: the caveats when there are any, the
          axis readout when it renders, and the sub-line's own margin last. */}
      <p
        ref={sub}
        style={{ ...SUB, marginBottom: caveatList.length ? 18 : showAxes ? 26 : 54 }}
      >
        {body}
      </p>

      {caveatList.length > 0 && (
        <ul
          ref={caveats}
          style={{ ...CAVEATS, marginBottom: showAxes ? 26 : 54 }}
          data-caveats={state === 'verdict-withheld' ? 'withheld' : 'qualified'}
        >
          {caveatList.map((r) => (
            <li key={r.signal ?? r.explanation} style={CAVEAT}>
              {r.explanation}
            </li>
          ))}
        </ul>
      )}

      {showAxes && (
        <div ref={axes} style={AXES}>
          {priceAxis ? (
            <Axis
              label="The price"
              word={priceAxis.word}
              color={priceAxis.color}
              clause={priceAxis.clause}
            />
          ) : withheld ? (
            /* We have the price. What we do not have is permission to rank it, so
               the number stands here as a fact — in the neutral text colour, never
               a traffic light — and the clause says why no word follows it. */
            <Axis
              label="The price"
              word={price(current)}
              color="var(--cream)"
              /* Our own clause, as on every other axis — the backend's sentences
                 are already on the page above, in the sub-line and the caveats,
                 and printing one of them a second time inside 200px is how a
                 refusal turns into a wall. */
              clause="We have today's price. What we don't have is enough faith in our own estimate to rank it against one."
            />
          ) : (
            /* Never an em dash and never a zero — the gap is stated (D-017). */
            <Axis
              label="The price"
              word="No share price yet"
              color="var(--faint)"
              clause="A reading here is price against value, and we have the value half only. We won't make the other half up."
            />
          )}
          <Axis
            label="The business"
            word={qualityAxis.word}
            color={qualityAxis.color}
            clause={qualityAxis.clause}
          />
        </div>
      )}
    </section>
  )
}
