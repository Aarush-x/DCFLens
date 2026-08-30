import { useRef } from 'react'
import { gsap } from 'gsap'
import { useGSAP } from '@gsap/react'
import Card from './ui/Card.jsx'
import Label from './ui/Label.jsx'
import { price, range, percent, signedPercent, EMPTY } from '../lib/format.js'
import './TheNumbers.css'

/* The right-hand column of the app screen — "The numbers".
 * Ported from the <aside> in design/index.html, and from the reduced two-card
 * <aside> in design/app.html for the cannot-value state.
 *
 * Two cards, not three. What used to be "Our best estimate" and "If things go…"
 * were the same three figures twice over — see the note on BestEstimate — so the
 * column now leads with the scenarios and the range is left to the places that
 * already state it larger and earlier. No spread is ever synthesised around the
 * point estimate; if the interval is absent the card says so rather than
 * inventing one, and a lone "$184.80" never leads.
 *
 * Reads only the docs/API.md v2 view shape that src/lib/adapter.js produces.
 * Nothing here fetches, and nothing here computes a figure the adapter did not
 * hand it — margin of safety in particular is price-vs-estimate, and the live
 * service carries no price. When it is missing this column SAYS so; it never
 * renders a 0%, and never a bare dash where a real figure would sit.
 */

const reduced = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

/* The mockup's scenario wording. The adapter names the three scenarios
 * Pessimistic / Realistic / Optimistic; the screen says Badly / As expected /
 * Well, because non-negotiable #1 keeps analyst vocabulary off the default view.
 * An unrecognised name falls through to itself rather than being dropped. */
const SCENARIO_LABELS = {
  Pessimistic: 'Badly',
  Realistic: 'As expected',
  Optimistic: 'Well',
}

/**
 * Figures counted up on mount — `gsap.to({…}, …)` at the mockup's timing (1.4s,
 * power2.out, 0.45s in). Takes N values and a formatter rather than one number,
 * because the headline is now a range and both ends have to travel together.
 * The final text is what React renders, so the figure is correct before GSAP
 * touches it and correct if the tween never runs.
 */
function CountUp({ values, format, className = 'big2', style }) {
  const ref = useRef(null)
  const dep = values.join('|')

  useGSAP(
    () => {
      const node = ref.current
      if (!node || values.some((v) => !Number.isFinite(v)) || reduced()) return
      const o = {}
      const target = {}
      values.forEach((v, i) => { o[i] = 0; target[i] = v })
      const read = () => values.map((_, i) => o[i])
      node.textContent = format(read())
      gsap.to(o, {
        ...target,
        duration: 1.4,
        ease: 'power2.out',
        delay: 0.45,
        onUpdate: () => { node.textContent = format(read()) },
      })
    },
    { dependencies: [dep] },
  )

  return <div className={className} ref={ref} style={style}>{format(values)}</div>
}

/* ── card 1 · our best estimate ─────────────────────────────────────────────
 *
 * One card, where there were two. `price.fair_value_low/mid/high` and
 * `the_math.scenarios[].value_per_share` are not two readings that happen to
 * agree — adapter.js reads BOTH off the same three fields (`lower_bound_per_share`,
 * `intrinsic_value_per_share`, `upper_bound_per_share`), so "Our best estimate
 * $165 – $205 / Mid-point $184.80" and "If things go… Badly $165.00 / As expected
 * $184.80 / Well $205.00" were the same three numbers printed twice, one card
 * apart, by construction rather than by accident.
 *
 * Which of the two survives is not a toss-up. The range is DERIVED — it is the
 * span from the pessimistic case to the optimistic one — and it is already the
 * page's headline (or its sub-line), and the range bar's two band labels besides.
 * A fourth statement of it at the top of this column is the one thing on the
 * screen that carries no information at all. The scenario rows are the primitive,
 * and they say the same interval while naming what each end MEANS.
 *
 * So the column leads with the scenarios, and the margin of safety — the only
 * figure the old first card carried that appears nowhere else — comes with them.
 * It is measured from the mid, which is now the row directly above it.
 */
function BestEstimate({ data }) {
  const mid = data.price?.fair_value_mid ?? data.value?.mid ?? null
  const low = data.price?.fair_value_low ?? data.value?.low ?? null
  const high = data.price?.fair_value_high ?? data.value?.high ?? null
  const mos = data.verdict?.margin_of_safety_pct ?? null
  const hasPrice = Number.isFinite(data.price?.current)
  const hasRange = Number.isFinite(low) && Number.isFinite(high)
  const rows = (data.the_math?.scenarios ?? []).filter(Boolean)

  return (
    <Card variant="box">
      <div className="cap">Our best estimate</div>

      {rows.length
        ? (
          <>
            {/* The condition the rows answer. One line, so the rows keep the
                mockup's one-word labels instead of repeating "if things go" three
                times over. */}
            <p className="scnhint">If things go&hellip;</p>
            {rows.map((s, i) => (
              <div className="scn" key={s.name ?? i}>
                <span className="n">{SCENARIO_LABELS[s.name] ?? s.name ?? EMPTY}</span>
                {Number.isFinite(s.value_per_share)
                  ? <span className="v">{price(s.value_per_share)}</span>
                  /* Faint, so an absent bound reads as absent rather than as a figure. */
                  : <span className="v" style={{ color: 'var(--faint)' }}>{EMPTY}</span>}
              </div>
            ))}
          </>
        )
        /* No scenarios to lead with — a valuation without the interval behind it.
           Fall back to stating the figure we do have, at the card's headline size,
           exactly as this card did before the merge. */
        : hasRange
          ? <CountUp values={[low, high]} format={([lo, hi]) => range(lo, hi)} />
          : <CountUp values={[mid]} format={([v]) => price(v)} />}

      {/* The engine had no sensitivity interval. We do not manufacture one around
          the mid; we say the figure is lonelier than it looks. Still owed when the
          rows render, because two of the three then show a dash. */}
      {!hasRange && (
        <p className="numnote">
          We couldn&rsquo;t work out a range for this one, so this single figure is far
          less precise than it looks.
        </p>
      )}

      {Number.isFinite(mos)
        ? <div className="delta mos" style={{ color: deltaColour(mos) }}>{deltaText(mos)}</div>
        /* No delta at all — not a 0%, not a dash. One quiet line saying why.
           The live service is SEC/XBRL only, so this is today's normal state.

           D-017 wants the gap stated wherever a figure would have sat, and it is —
           but on a no-price response the two-axis readout and the range bar have
           BOTH already said it in full, above this and larger. A third sentence
           saying the same thing is the wall this rebalance is meant to prevent, so
           down here it is a footnote, not a paragraph. The has-a-price case is a
           different fact (we have the price, we could not compute the comparison)
           and keeps its full sentence. */
        : (
          <p className="numnote mos">
            {hasPrice
              ? "We can't compare this against today's price yet."
              : 'No share price to compare against.'}
          </p>
        )}
    </Card>
  )
}

/** Traffic lights, by sign: estimate above the price reads cheap, below reads
 *  expensive. Same three colours the verdict word uses. */
function deltaColour(mos) {
  if (mos > 0) return 'var(--under)'
  if (mos < 0) return 'var(--over)'
  return 'var(--fair)'
}

function deltaText(mos) {
  if (mos === 0) return "Level with today's price"
  return `${signedPercent(mos)} ${mos > 0 ? 'above' : 'below'} today's price`
}

/* ── card 3 · what has to be true ───────────────────────────────────────────── */

function WhatHasToBeTrue({ belief }) {
  if (!belief) return null
  const implied = belief.implied_growth_pct
  const historical = belief.historical_growth_pct
  const hasImplied = Number.isFinite(implied)
  const hasHistorical = Number.isFinite(historical)
  if (!hasImplied && !hasHistorical && !belief.summary) return null

  return (
    <Card variant="box">
      <div className="cap" style={{ marginBottom: 10 }}>What has to be true</div>
      {/* Implied growth is solved against the share price. With no price there is
          nothing to solve, so the row is omitted rather than dashed — the summary
          beneath already explains the gap. */}
      {hasImplied && (
        <div className="bel">
          <span className="k">Market expects</span>
          <span className="v" style={{ color: impliedColour(implied, historical) }}>
            {percent(implied)} / yr
          </span>
        </div>
      )}
      {hasHistorical && (
        <div className="bel">
          <span className="k">Actually delivered</span>
          <span className="v">{percent(historical)} / yr</span>
        </div>
      )}
      {belief.summary && <p className="belnote">{belief.summary}</p>}
    </Card>
  )
}

/* The mockup hardcodes --fair on this figure, in a case where the market expects
 * more than the company has delivered — the caution reading. Keep that, but make
 * it the actual condition: a market expecting less than the record is not a
 * caution, and colouring it amber would say the opposite of what it means. */
function impliedColour(implied, historical) {
  if (!Number.isFinite(historical)) return 'var(--fair)'
  return implied > historical ? 'var(--fair)' : 'var(--under)'
}

/* ── cannot value ───────────────────────────────────────────────────────────── */

/* design/app.html, the <aside> of #s-novalue: two cards, today's price and an em
 * dash where the estimate would be, with the refusal spelled out beneath it. The
 * dash is legible as "we withheld this" only because that line is there — so the
 * price card gets the same treatment when the price is missing too. */
function CannotValue({ data }) {
  const current = data.price?.current ?? null
  const hasPrice = Number.isFinite(current)

  return (
    <aside>
      <Label style={{ marginBottom: 22 }}>The numbers</Label>

      <Card variant="box">
        <div className="cap">Today&rsquo;s price</div>
        {hasPrice
          ? <div className="num-big">{price(current)}</div>
          : (
            <>
              <div className="num-big" style={{ color: 'var(--faint)' }}>{EMPTY}</div>
              <div className="delta" style={{ color: 'var(--faint)' }}>
                We don&rsquo;t have today&rsquo;s share price
              </div>
            </>
          )}
      </Card>

      <Card variant="box">
        <div className="cap">Our estimate</div>
        <div className="num-big" style={{ color: 'var(--faint)' }}>{EMPTY}</div>
        <div className="delta" style={{ color: 'var(--faint)' }}>Confidence too low to publish</div>
      </Card>
    </aside>
  )
}

/* ── the column ─────────────────────────────────────────────────────────────── */

/**
 * @param {{ data: object }} props  the view object from src/lib/adapter.js
 */
export default function TheNumbers({ data }) {
  if (!data) return null
  if (!data.the_math) return <CannotValue data={data} />

  return (
    <aside>
      <Label style={{ marginBottom: 22 }}>The numbers</Label>
      <BestEstimate data={data} />
      <WhatHasToBeTrue belief={data.what_has_to_be_true} />
    </aside>
  )
}
