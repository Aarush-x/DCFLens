import Label from './ui/Label.jsx'
import { percent } from '../lib/format.js'
import './PlainEnglish.css'

/* The left pane's narrative column — the "Why we think so" block from the app
 * screen of design/index.html.
 *
 * ── Four blocks, not three flat cards ────────────────────────────────────────
 * design/index.html was regrouped on 2026-08-30 and this component is caught up
 * to it. The order is the argument, and it is the mockup's, not ours:
 *
 *   what must be true  ·  what supports  ·  what weakens  ·  what could prove it wrong
 *
 * A block with nothing in it does not disappear — it renders the mockup's `.empty`
 * line and says so. An absent half of the case is the thing a reader most needs to
 * notice, and today it is the normal state: the API falls back to the deterministic
 * checklist on every call, which yields supports and weakens but no falsifiers.
 *
 * ── One source record, not a citation under every claim ──────────────────
 * Until 2026-08-30 every card carried its own `.cite` line — "Apple’s 2025 annual
 * report ↗" under one claim, "No filing cited for this statement." under the next —
 * beside a "View evidence" trigger. Across four blocks that is the same document
 * named five times down a single column, and the repetition read as clutter rather
 * than as proof. The "no filing cited" line was worse: it drew the eye to an
 * absence under our own assumptions, where there was never a filing to cite.
 *
 * Provenance is stated ONCE now, at the foot of the screen, by SourceRecord — the
 * exact document, its accession number, when we read it, and a link to it. That is
 * a stronger claim than the per-card links made, because it covers every figure on
 * the page instead of one sentence at a time.
 *
 * The per-claim audit trail did not go away, it moved. ViewEvidence still opens the
 * drawer from the "Why? Show me the math" layer and from the evidence audit, which
 * is where tagged XBRL concepts and arithmetic belong (non-negotiable #1 — the
 * default screen stays free of that vocabulary).
 */

/* Sentiment → pip colour, exactly as design/index.html sets it inline. An item with
   no usable sentiment gets --faint, the treatment design/app.html uses for the
   cannot-value cards. */
const PIP = {
  positive: 'var(--under)',
  neutral: 'var(--fair)',
  negative: 'var(--over)',
}

const pipColour = (sentiment) => PIP[sentiment] ?? 'var(--faint)'

function Claim({ item }) {
  return (
    <article className="pe">
      <h3>
        <span className="pip" style={{ background: pipColour(item.sentiment) }} />
        {item.title}
      </h3>
      {item.body ? <p>{item.body}</p> : null}
    </article>
  )
}

/* `av` carries no styles of its own — it is the mockup's hook for the app screen's
   entrance timeline (`gsap.to('#app .av', …)`), which AppScreen owns. The mockup
   marks the BLOCKS, not the cards, so the four blocks stagger in as units. */
function Block({ heading, hint, items, empty }) {
  return (
    <div className="blk av">
      <span className="blkh">{heading}</span>
      <p className="hint">{hint}</p>
      {items.length === 0
        ? <p className="empty">{empty}</p>
        : items.map((item, i) => <Claim key={item.title ?? i} item={item} />)}
    </div>
  )
}

/**
 * The first block — "What must be true for this to hold".
 *
 * The mockup's two cards there are growth assumptions ("Spare cash keeps growing
 * about 8% a year"), and that is what `the_math` carries, so they are built from
 * it. Every figure is read straight off the payload; the sentence around it is
 * the mockup's own wording with the number substituted in.
 *
 * These carry no evidence object, and never did. They are our assumptions, not
 * the filing's, and citing a document for a claim it does not make would be a
 * misattribution — which is one reason the screen no longer promises a source
 * under every card. `evidence: null` is still set explicitly, so the field reads
 * as a stated absence rather than an oversight.
 *
 * `what_has_to_be_true.summary` is NOT used here. It is a sentence about what
 * today's buyers are betting, which is what the mockup puts in the right column's
 * `.belnote` — and TheNumbers already renders it there. Putting it in both places
 * printed the same sentence twice on one screen.
 */
function assumptionCards(data) {
  const math = data?.the_math
  if (!math) return []

  const s1 = math.stage_1 ?? {}
  const s2 = math.stage_2 ?? {}
  const hist = data?.what_has_to_be_true?.historical_growth_pct
  const out = []

  if (Number.isFinite(s1.growth_pct)) {
    const horizon = Number.isFinite(s1.years) ? `For the next ${s1.years} years.` : 'At first.'
    /* Only drawn when we have both halves — "faster than" needs something to be
       faster than, and the historical rate is null whenever the filed cash-flow
       series crosses zero (see historicalGrowthPct in adapter.js). */
    const against = Number.isFinite(hist)
      ? ` That is ${s1.growth_pct > hist ? 'faster' : 'slower'} than the ${percent(hist)} it has managed lately, so the estimate is already assuming things ${s1.growth_pct > hist ? 'improve' : 'ease off'}.`
      : ''
    out.push({
      title: `Spare cash keeps growing about ${percent(s1.growth_pct)} a year`,
      body: `${horizon}${against}`,
      sentiment: 'neutral',
      evidence: null,
    })
  }

  if (Number.isFinite(s2.growth_pct)) {
    out.push({
      title: `Then it slows to about ${percent(s2.growth_pct)} a year`,
      body: Number.isFinite(s2.years)
        ? `For the ${s2.years} years after that. Slower, because no company grows fast forever.`
        : 'Slower, because no company grows fast forever.',
      sentiment: 'neutral',
      evidence: null,
    })
  }

  return out
}

/**
 * Turn the adapter's flat `plain_english[]` into the mockup's four blocks.
 *
 * Nothing is rewritten on the way through — a card keeps its own title, body and
 * evidence, and only its position changes.
 *
 *   supports   sentiment "positive"  (checklist SUPPORTS)
 *   weakens    sentiment "negative"  (checklist WEAKENS)
 *   watch      sentiment "neutral"   (checklist MONITOR) — the engine's own
 *              "keep an eye on this" signals, which is what the fourth block asks
 *              for. They join `falsifiers`, which only the AI path ever produces
 *              and which is therefore empty on every live response today.
 */
function partition(items, data) {
  const cards = Array.isArray(items) ? items.filter(Boolean) : []
  const bySentiment = (s) => cards.filter((c) => c.sentiment === s)

  const falsifiers = (Array.isArray(data?.falsifiers) ? data.falsifiers : [])
    .filter(Boolean)
    .map((f, i) => ({
      title: f.text ?? f.title ?? `Watch this${i ? ` (${i + 1})` : ''}`,
      body: f.detail ?? f.body ?? '',
      sentiment: 'unknown',
      evidence: f.evidence ?? null,
    }))

  return {
    mustBeTrue: assumptionCards(data),
    supports: bySentiment('positive'),
    weakens: bySentiment('negative'),
    proveWrong: [...falsifiers, ...bySentiment('neutral')],
  }
}

/* ── the write-up we didn't get: NOT here any more ────────────────────────────
 *
 * This file used to own the AI-unavailable message, as a hairline-left `.ainote`
 * under the heading. It now lives in src/components/AiFallbackNotice.jsx, mounted
 * by AppScreen directly above this section — one message, not two, and no raw
 * `provider_failure` enum in the parenthetical.
 *
 * What carried over is the placement argument: it sits in THIS pane, above this
 * heading, and not full-width between the range bar and the panes. The thing that
 * is missing is the written case, and the written case is this section. What
 * changed is only its treatment — a --surface inset rather than a bare hairline,
 * because a system message that is going to appear on every single live response
 * should read as a designed state rather than as stray text.
 */

/**
 * @param {object} props
 * @param {Array}  props.items  `plain_english[]` from the adapter.
 * @param {object} props.data   the whole view object — the first and fourth blocks
 *                              read `what_has_to_be_true` and `falsifiers`, which
 *                              do not live on `plain_english`.
 */
export default function PlainEnglish({ items, data }) {
  /* A refusal gets a different column, and this is the mockup's, not a variant of
     ours: design/app.html's #s-novalue heads it "What happened" and lists flat `.pe`
     cards. The four blocks are an argument ABOUT an estimate — running them here
     would print "Nothing in the filings argues against this estimate" under a
     screen whose whole message is that there is no estimate. */
  if (data?.canValue === false || data?.verdict?.label === 'CANNOT_VALUE') {
    const cards = Array.isArray(items) ? items.filter(Boolean) : []
    return (
      <section className="plain-english">
        <Label>What happened</Label>
        {cards.length === 0
          ? <p className="empty">We don’t have a written account of what got in the way.</p>
          : cards.map((item, i) => (
              /* --faint pips throughout: design/app.html colours every cannot-value
                 card that way, because none of them is a verdict about the company. */
              <Claim key={item.title ?? i} item={{ ...item, sentiment: null }} />
            ))}
      </section>
    )
  }

  const { mustBeTrue, supports, weakens, proveWrong } = partition(items, data)

  return (
    <section className="plain-english">
      <Label>Why we think so</Label>

      <Block
        heading="What must be true for this to hold"
        hint="The estimate assumes all of these. If one fails, the number is wrong."
        items={mustBeTrue}
        empty="We haven’t written up what this estimate assumes."
      />
      <Block
        heading="What supports the estimate"
        hint="Things in the filings that make the estimate more believable."
        items={supports}
        empty="Nothing in the filings we read argues for this estimate."
      />
      <Block
        heading="What weakens the estimate"
        hint="Things in the filings that cut the other way."
        items={weakens}
        empty="Nothing in the filings we read argues against this estimate."
      />
      <Block
        heading="What could prove it wrong"
        hint="Specific things to watch for. If you see one, come back and redo this."
        items={proveWrong}
        empty="We haven’t written this part up. Nothing has been guessed to fill it."
      />
    </section>
  )
}
