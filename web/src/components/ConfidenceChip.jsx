/* The confidence chip — how much weight this analysis will carry, said quietly.
 *
 * The engine returns `analysis.confidence` and the adapter carries it through as
 * `confidence: { level, score, explanation, isProbability, factors }`, with
 * `verdict.confidence` holding the same level as a bare string (docs/API.md).
 * Both shapes are accepted here so the chip works against the live envelope and
 * against src/mocks/aapl.json, which carries only the string.
 *
 * ── Why it looks the way it does ─────────────────────────────────────────────
 * Low confidence is an honest answer, not a failure. A red chip would say the app
 * broke; what actually happened is that the filings were thinner than we would
 * like, and the range should be read as wide rather than as wrong. So the chip
 * stays in the quiet half of the palette — --faint label, --dim value, hairline
 * border, --surface fill — and never reaches for --over. It is the same pill the
 * mockup already uses for .search and .pill: 999px, hairline, mono.
 *
 * ── Why there is no number on it ─────────────────────────────────────────────
 * The live payload carries `score: 0.552` alongside `is_probability: false`, and
 * its own explanation says so in as many words: confidence summarises data
 * quality and model sensitivity, it is NOT the chance the value gets reached.
 * Printing "55%" beside a valuation would be read as exactly the thing it is not,
 * so the score is shown only if the API ever declares it a probability.
 */

const LEVELS = {
  high: {
    word: 'High',
    gloss: 'The filings gave us most of what this estimate needs.',
  },
  medium: {
    word: 'Medium',
    gloss: 'Some of what this estimate needs was missing, or had to be estimated.',
  },
  low: {
    word: 'Low',
    gloss: 'A lot of this rests on estimates. Read the range as wide — not as wrong.',
  },
}

const CHIP = {
  display: 'inline-flex',
  alignItems: 'baseline',
  gap: 8,
  fontFamily: 'var(--m)',
  fontSize: 11,
  letterSpacing: '.16em',
  textTransform: 'uppercase',
  border: '1px solid var(--hair)',
  borderRadius: 999,
  padding: '5px 12px',
  background: 'var(--surface)',
  whiteSpace: 'nowrap',
  cursor: 'help',
}

/**
 * Read a level out of either shape, and only a level we recognise.
 * An unknown string is not coerced to "low" — a confidence we cannot read is
 * absent, and an absent chip is better than a made-up one.
 *
 * @param {object|string|null} confidence
 * @returns {{level: string, score: number|null, explanation: string|null, isProbability: boolean}|null}
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
  }
}

export default function ConfidenceChip({ confidence, style, ...props }) {
  const c = readConfidence(confidence)
  if (!c) return null

  const { word, gloss } = LEVELS[c.level]
  // Only ever a percentage when the API itself says the score is one.
  const pct = c.isProbability && c.score !== null ? ` ${Math.round(c.score * 100)}%` : ''
  const title = [`Confidence: ${word}.`, gloss, c.explanation].filter(Boolean).join(' ')

  return (
    <span
      style={{ ...CHIP, ...style }}
      title={title}
      aria-label={title}
      data-confidence={c.level}
      {...props}
    >
      <span style={{ color: 'var(--faint)' }}>Confidence</span>
      <span style={{ color: 'var(--dim)' }}>{word}{pct}</span>
    </span>
  )
}
