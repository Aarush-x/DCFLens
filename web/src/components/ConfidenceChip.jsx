import { useEffect, useId, useRef, useState } from 'react'

import './ConfidenceChip.css'

/* The confidence chip — how much weight this analysis will carry, said quietly,
 * and now with its working available on hover.
 *
 * The engine returns `analysis.confidence` and the adapter carries it through as
 * `confidence: { level, score, explanation, isProbability, factors }`, with
 * `verdict.confidence` holding the same level as a bare string (docs/API.md).
 * Both shapes are accepted here so the chip works against the live envelope and
 * against src/mocks/aapl.json, which carries only the string.
 *
 * ── Why it is coloured now, when it deliberately was not ─────────────────────
 * This file used to argue that a red chip "would say the app broke", and stayed
 * in the quiet half of the palette. Reversed 2026-08-31 at the user's request:
 * a confidence reading with no colour is read at the same weight as the label
 * beside it, which is exactly the mistake — a Low reading is the one thing on
 * this row a beginner most needs to notice.
 *
 * What the old argument got right is kept. The colour is the palette's OWN
 * traffic light (--under / --fair / --over — the same three the range bar uses),
 * so no fourth scale is invented; it lands on the dot and the word only, never
 * on the fill, because a red pill is an alarm and this is a caveat; and the
 * panel's first sentence still says what Low actually means — read the range as
 * wide, not as wrong.
 *
 * ── Why the hover opens working rather than a definition ─────────────────────
 * "Confidence: Medium" invites exactly one question, and it is *how do you know*.
 * A tooltip that restates the word in longer words does not answer it. So the
 * panel shows the six factors the backend actually scored (app/ai/service.py
 * `_confidence`), each one's score, the average, and the bands that turned that
 * average into a word. Every number on it comes off the response; nothing is
 * recomputed here and nothing is filled in when the response omits it.
 *
 * ── Why there is no number on the chip itself ────────────────────────────────
 * The live payload carries `score: 0.552` alongside `is_probability: false`, and
 * its own explanation says so in as many words: confidence summarises data
 * quality and model sensitivity, it is NOT the chance the value gets reached.
 * Printing "55%" beside a valuation would be read as exactly the thing it is not,
 * so the score is shown on the chip only if the API ever declares it a
 * probability. Inside the panel it appears as a rating out of 10, which cannot be
 * misread as a percentage, and the caveat is printed under it either way.
 */

const LEVELS = {
  high: {
    word: 'High',
    color: 'var(--under)',
    gloss: 'The filings gave us most of what this estimate needs.',
  },
  medium: {
    word: 'Medium',
    color: 'var(--fair)',
    gloss: 'Some of what this estimate needs was missing, or had to be estimated.',
  },
  low: {
    word: 'Low',
    color: 'var(--over)',
    gloss: 'A lot of this rests on estimates. Read the range as wide — not as wrong.',
  },
}

/* The bands the backend applies to the average (app/ai/service.py `_confidence`).
 * Duplicated deliberately and used for ONE thing only: printing the rule under
 * the average so the reader can check our arithmetic. The level on screen is
 * always the level the backend sent — see `bandFor`'s caller. */
export const BANDS = { high: 0.75, medium: 0.5 }

/** The band a score falls in. Never used to decide what the chip says — only to
 *  notice when the backend's own level sits BELOW its average, which is the
 *  fallback rule showing through, and to say so instead of leaving a reader to
 *  spot the contradiction unaided. */
export function bandFor(score) {
  if (typeof score !== 'number' || !Number.isFinite(score)) return null
  if (score >= BANDS.high) return 'high'
  if (score >= BANDS.medium) return 'medium'
  return 'low'
}

/* Plain-English names for the six factors the engine scores. The response's own
 * names and explanations are written for the engine ("Coverage of normalized
 * inputs used by the deterministic baseline"), and this panel is read by someone
 * who has never heard of a DCF, so each known factor gets a beginner's phrasing.
 * An unknown factor falls back to whatever the response called it — a new factor
 * appearing in a name we don't recognise must still be shown, not swallowed. */
export const FACTOR_COPY = {
  data_coverage: {
    label: 'How much of the filing we could read',
    high: 'Most of the figures this needs were in the filing.',
  },
  cash_flow_stability: {
    label: 'How steady the cash has been',
    high: 'Past cash flow moved smoothly rather than jumping around.',
  },
  sensitivity: {
    label: 'How tight the range came out',
    high: 'Small changes to our assumptions barely move the answer.',
  },
  terminal_value_concentration: {
    label: 'How much rides on the distant future',
    high: 'Most of the value comes from years we can see, not from a guess about forever.',
  },
  evidence_support: {
    label: 'How well the filings back the story',
    high: 'The claims in the write-up are supported by cited filings.',
  },
  ai_deterministic_disagreement: {
    label: 'How much the AI and the maths agreed',
    high: 'The AI made only small adjustments to the numbers we calculated.',
  },
}

const titleCase = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

/**
 * Read a level out of either shape, and only a level we recognise.
 * An unknown string is not coerced to "low" — a confidence we cannot read is
 * absent, and an absent chip is better than a made-up one.
 *
 * @param {object|string|null} confidence
 * @returns {{level: string, score: number|null, explanation: string|null,
 *            isProbability: boolean, factors: Array}|null}
 */
export function readConfidence(confidence) {
  if (!confidence) return null
  const raw = typeof confidence === 'string' ? confidence : confidence.level
  const level = typeof raw === 'string' ? raw.trim().toLowerCase() : null
  if (!level || !LEVELS[level]) return null

  const o = typeof confidence === 'string' ? {} : confidence
  const score = typeof o.score === 'number' && Number.isFinite(o.score) ? o.score : null
  return {
    level,
    score,
    explanation: typeof o.explanation === 'string' && o.explanation.trim() ? o.explanation.trim() : null,
    isProbability: o.isProbability === true,
    factors: readFactors(o.factors),
  }
}

/** Only factors that carry a readable score survive. A row with a name and no
 *  number would be a claim that we measured something we didn't. */
export function readFactors(factors) {
  if (!Array.isArray(factors)) return []
  return factors
    .map((f) => {
      const score = typeof f?.score === 'number' && Number.isFinite(f.score) ? f.score : null
      if (score === null) return null
      const name = typeof f?.name === 'string' ? f.name.trim() : ''
      const copy = FACTOR_COPY[name]
      const fallback =
        (typeof f?.label === 'string' && f.label.trim()) || titleCase(name.replace(/_/g, ' '))
      return {
        name,
        label: copy?.label ?? fallback ?? 'Unnamed factor',
        score: Math.min(Math.max(score, 0), 1),
      }
    })
    .filter(Boolean)
}

/** The average, computed here only when the response omits its own score —
 *  the six factors ARE the average, so a panel showing all six and no total is
 *  the one arithmetic a reader would otherwise have to do by hand. */
export function averageOf(factors) {
  if (!factors.length) return null
  return factors.reduce((sum, f) => sum + f.score, 0) / factors.length
}

/** 0.552 -> "5.5". Out of ten, never out of a hundred: a percentage beside a
 *  valuation reads as the chance of reaching it, which is precisely what the
 *  response says this number is not. */
const outOfTen = (score) => (score * 10).toFixed(1)

export default function ConfidenceChip({ confidence, aiStatus = null, style, ...props }) {
  const c = readConfidence(confidence)

  /* Two ways in, and they behave differently on the way out. HOVER is a peek and
     leaves with the pointer. A CLICK — on the chip, or on "see how we got this" —
     pins the panel, because the working is a paragraph and a list of six rows and
     nobody should have to read it holding the mouse still. Focus counts as hover
     so the chip is reachable by keyboard; Enter on it pins, exactly as a click. */
  const [hover, setHover] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [working, setWorking] = useState(false)
  const wrap = useRef(null)
  const panelId = useId()
  const open = hover || pinned

  const close = () => { setHover(false); setPinned(false) }

  /* Escape closes it, and a click anywhere else closes it. Both are bound only
     while it is pinned, so neither ever fires for something that isn't this. */
  useEffect(() => {
    if (!pinned) return undefined
    const onKey = (e) => { if (e.key === 'Escape') close() }
    const onDown = (e) => { if (!wrap.current?.contains(e.target)) close() }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [pinned])

  if (!c) return null

  const { word, gloss, color } = LEVELS[c.level]
  // Only ever a percentage when the API itself says the score is one.
  const pct = c.isProbability && c.score !== null ? ` ${Math.round(c.score * 100)}%` : ''

  const factors = c.factors
  const average = c.score ?? averageOf(factors)
  /* The backend holds a fallback analysis at Low whatever its factors average to.
     When that has happened the panel says so, rather than printing an average
     that appears to contradict the word above it. */
  const heldDown = average !== null && bandFor(average) !== c.level

  /* The chip keeps its native tooltip: a reader who never hovers long enough for
     the panel, or who is on a browser where it misbehaves, still gets the gloss. */
  const title = [`Confidence: ${word}.`, gloss].filter(Boolean).join(' ')

  return (
    <span
      className="conf"
      ref={wrap}
      data-open={open ? 'true' : 'false'}
      style={{ '--level': color, ...style }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={(e) => { if (!wrap.current?.contains(e.relatedTarget)) setHover(false) }}
      {...props}
    >
      <button
        type="button"
        className="conf__chip"
        title={title}
        aria-expanded={open}
        aria-controls={panelId}
        data-confidence={c.level}
        onClick={() => { setPinned((p) => !p); setWorking(true) }}
      >
        <span className="conf__dot" aria-hidden="true" />
        <span className="conf__label">Confidence</span>
        <span className="conf__value">{word}{pct}</span>
        <span className="conf__more" aria-hidden="true">· How?</span>
      </button>

      {open && (
        <div className="conf__panel" id={panelId} role="group" aria-label={`Confidence: ${word}`}>
          <p className="conf__head">Confidence: {word}</p>
          <p className="conf__gloss">{gloss}</p>

          {!working && (
            <button
              type="button"
              className="conf__reveal"
              onClick={() => { setWorking(true); setPinned(true) }}
            >
              {factors.length ? 'See how we got this' : 'What this is, and is not'}
            </button>
          )}

          {working && (
            <div className="conf__work">
              {factors.length > 0 ? (
                <>
                  <p className="conf__lede">
                    We rate six things out of 10 and take the average. Nothing here is a
                    forecast — it is how much of the answer rests on what the filing
                    actually said.
                  </p>
                  {factors.map((f) => (
                    <div className="conf__factor" key={f.name || f.label}>
                      <div className="conf__row">
                        <span>{f.label}</span>
                        <span
                          className="conf__score"
                          style={{ '--level': LEVELS[bandFor(f.score)].color }}
                        >
                          {outOfTen(f.score)}
                        </span>
                      </div>
                      <div className="conf__track">
                        <div
                          className="conf__fill"
                          style={{
                            width: `${Math.round(f.score * 100)}%`,
                            '--level': LEVELS[bandFor(f.score)].color,
                          }}
                        />
                      </div>
                    </div>
                  ))}

                  {average !== null && (
                    <>
                      <div className="conf__total">
                        <span>Average</span>
                        {/* Coloured by the band the AVERAGE falls in, not by the level
                            on the chip. When those disagree the reader can see the
                            disagreement, which is what the line under it explains. */}
                        <span
                          className="conf__score"
                          style={{ '--level': LEVELS[bandFor(average)].color }}
                        >
                          {outOfTen(average)} / 10
                        </span>
                      </div>
                      <p className="conf__bands">
                        7.5 and above is High, 5.0 and above is Medium, below that is Low.
                      </p>
                      {heldDown && (
                        <p className="conf__bands">
                          {aiStatus === 'DETERMINISTIC_FALLBACK'
                            ? `Shown as ${word} despite that average: the AI reading of the filings didn’t run for this company, and we don’t award confidence for a review we didn’t get.`
                            : `Shown as ${word} despite that average — the average isn’t the only rule. An analysis that ran without its AI review is held at Low.`}
                        </p>
                      )}
                    </>
                  )}
                </>
              ) : (
                <p className="conf__lede">
                  This response carried the reading but not the working behind it, so
                  there is nothing to break down here.
                </p>
              )}

              <p className="conf__note">
                This is not the chance the price reaches our estimate. It is how much of
                this answer rests on solid figures rather than on our assumptions.
              </p>
            </div>
          )}
        </div>
      )}
    </span>
  )
}
