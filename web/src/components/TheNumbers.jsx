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
 * The first card leads with the RANGE, not the mid. A lone "$184.80" is the exact
 * false precision non-negotiable #2 forbids, so the headline figure is the real
 * sensitivity interval — adapter `value.low`/`value.high`, off the engine's
 * sensitivity_interval — and the mid is demoted to a faint line beneath it. No
 * spread is ever synthesised around the point estimate; if the interval is absent
 * the card says so rather than inventing one.
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

/* ── card 1 · our best estimate ─────────────────────────────────────────────── */

function BestEstimate({ data }) {
  const mid = data.price?.fair_value_mid ?? data.value?.mid ?? null
  const low = data.price?.fair_value_low ?? data.value?.low ?? null
  const high = data.price?.fair_value_high ?? data.value?.high ?? null
  const mos = data.verdict?.margin_of_safety_pct ?? null
  const hasPrice = Number.isFinite(data.price?.current)
  const hasRange = Number.isFinite(low) && Number.isFinite(high)

  return (
    <Card variant="box">
      <div className="cap">Our best estimate</div>

      {/* The headline. Whole dollars at both ends, which is what `range()` gives and
          what the mockup's band labels use — cents on a range would claim a precision
          the range itself exists to deny. */}
      {hasRange
        ? <CountUp values={[low, high]} format={([lo, hi]) => range(lo, hi)} />
        : <CountUp values={[mid]} format={([v]) => price(v)} />}

      {/* Secondary, faint: the same number that used to be the headline. It still
          earns its place — the margin of safety below is measured from it — but it
          is no longer the thing the eye lands on. */}
      {hasRange && Number.isFinite(mid) && (
        <div className="midline">Mid-point {price(mid)}</div>
      )}

      {/* The engine had no sensitivity interval. We do not manufacture one around
          the mid; we say the figure is lonelier than it looks. */}
      {!hasRange && (
        <p className="numnote">
          We couldn&rsquo;t work out a range for this one, so this single figure is far
          less precise than it looks.
        </p>
      )}

      {Number.isFinite(mos)
        ? <div className="delta" style={{ color: deltaColour(mos) }}>{deltaText(mos)}</div>
        /* No delta at all — not a 0%, not a dash. One quiet line saying why.
           The live service is SEC/XBRL only, so this is today's normal state. */
        : (
          <p className="numnote">
            {hasPrice
              ? "We can't compare this against today's price yet."
              : "We don't have today's share price, so there's nothing to compare this against."}
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

/* ── card 2 · if things go… ─────────────────────────────────────────────────── */

function Scenarios({ scenarios }) {
  const rows = (scenarios ?? []).filter(Boolean)
  if (!rows.length) return null

  return (
    <Card variant="box">
      <div className="cap" style={{ marginBottom: 8 }}>If things go…</div>
      {rows.map((s, i) => (
        <div className="scn" key={s.name ?? i}>
          <span className="n">{SCENARIO_LABELS[s.name] ?? s.name ?? EMPTY}</span>
          {Number.isFinite(s.value_per_share)
            ? <span className="v">{price(s.value_per_share)}</span>
            /* Faint, so an absent bound reads as absent rather than as a figure. */
            : <span className="v" style={{ color: 'var(--faint)' }}>{EMPTY}</span>}
        </div>
      ))}
    </Card>
  )
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
      <Scenarios scenarios={data.the_math.scenarios} />
      <WhatHasToBeTrue belief={data.what_has_to_be_true} />
    </aside>
  )
}
