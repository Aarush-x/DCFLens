import Label from './ui/Label.jsx'
import ViewEvidence from './ViewEvidence.jsx'
import { percent, cleanName } from '../lib/format.js'
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
 * ── Every claim carries its source ───────────────────────────────────────────
 * `.cite` under each card, in plain English ("Apple's 2025 annual report · Cash
 * flow statement ↗"), and an explicit "No filing cited for this statement." where
 * the adapter handed us no evidence. Nothing is invented to fill either.
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

/* 10-K → "annual report". The citation is on the default screen, so the form
   number — which is what a filing is actually called — is the jargon we translate
   away. Anything unrecognised keeps its own name rather than being guessed at. */
const FORM_NAMES = {
  '10-K': 'annual report',
  '10-K/A': 'amended annual report',
  '10-Q': 'quarterly report',
  '20-F': 'annual report',
  '8-K': 'current report',
}

/** "Apple Inc." → "Apple", "MICROSOFT CORP" → "Microsoft". The SEC registrant name
 *  is a legal string, and it arrives in caps — mid-sentence, inside a citation, it
 *  reads as shouting a form field. Only fully-uppercase names are recased, so
 *  "eBay" and "NVIDIA Corp" keep whatever casing the filer actually uses. */
function shortName(name) {
  if (typeof name !== 'string' || !name.trim()) return null
  const bare = (cleanName(name) ?? '')
    .replace(/[,.]?\s+(inc|incorporated|corp|corporation|co|company|plc|ltd|limited|holdings|group)\.?$/i, '')
    .trim()
  if (!bare) return null
  if (/[a-z]/.test(bare)) return bare
  return bare.replace(/[A-Z][A-Z']*/g, (w) => w.charAt(0) + w.slice(1).toLowerCase())
}

/** The year the filing covers, off the fiscal period ("FY2025") or the filing date. */
function citeYear(evidence) {
  const fy = /(\d{4})/.exec(evidence.fiscal_period ?? '')
  if (fy) return fy[1]
  const filed = /^(\d{4})-/.exec(evidence.filed_on ?? '')
  return filed ? filed[1] : null
}

/**
 * "Apple's 2025 annual report · Cash flow statement ↗" — the mockup's own format.
 * Each part is dropped when we don't have it rather than filled in.
 */
function citeText(evidence, companyName) {
  const who = shortName(companyName)
  const year = citeYear(evidence)
  const form = FORM_NAMES[evidence.filing_type] ?? evidence.filing_type ?? 'filing'

  const doc = [who ? `${who}’s` : null, year, form].filter(Boolean).join(' ')
  return [doc || 'SEC filing', evidence.section].filter(Boolean).join(' · ')
}

/** The `.cite` line under a claim. A claim with no filing behind it says so —
 *  that is the mockup's `.cite.none`, and it is load-bearing, not a placeholder. */
function Cite({ evidence, companyName }) {
  const url = evidence?.url
  if (!evidence || typeof url !== 'string' || !url) {
    return <div className="cite none">No filing cited for this statement.</div>
  }
  return (
    <div className="cite">
      <a href={url} target="_blank" rel="noreferrer">
        {citeText(evidence, companyName)} &#8599;
      </a>
    </div>
  )
}

function Claim({ item, companyName }) {
  return (
    <article className="pe">
      <h3>
        <span className="pip" style={{ background: pipColour(item.sentiment) }} />
        {item.title}
      </h3>
      {item.body ? <p>{item.body}</p> : null}
      {/* The citation names the document; the trigger opens what was actually read
          out of it — the tagged figures, the arithmetic, and whether the number was
          machine-readable or lifted out of prose. Both, or neither: a claim with no
          evidence renders the "No filing cited" line alone, because ViewEvidence
          returns null rather than a dead control. */}
      <div className="citerow">
        <Cite evidence={item.evidence} companyName={companyName} />
        <ViewEvidence evidence={item.evidence} claim={item.title} />
      </div>
    </article>
  )
}

/* `av` carries no styles of its own — it is the mockup's hook for the app screen's
   entrance timeline (`gsap.to('#app .av', …)`), which AppScreen owns. The mockup
   marks the BLOCKS, not the cards, so the four blocks stagger in as units. */
function Block({ heading, hint, items, empty, companyName }) {
  return (
    <div className="blk av">
      <span className="blkh">{heading}</span>
      <p className="hint">{hint}</p>
      {items.length === 0
        ? <p className="empty">{empty}</p>
        : items.map((item, i) => (
            <Claim key={item.title ?? i} item={item} companyName={companyName} />
          ))}
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
 * These deliberately carry NO citation. They are our assumptions, not the filing's
 * — citing a document for a claim it does not make would be worse than the honest
 * "No filing cited for this statement." that Cite renders instead.
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

/* ── the write-up we didn't get ───────────────────────────────────────────────
 *
 * Gemini fails every call in production, so this renders on every live response.
 * It used to be a full-width bordered card between the range bar and the panes —
 * the second thing on the screen, interrupting the argument to apologise before
 * the argument had started.
 *
 * It belongs here instead. The thing that is missing is the written case, and the
 * written case is this section, so the notice is a caveat ON the heading rather
 * than a page-level announcement: pane-width, no box, one hairline down its left
 * edge. It says exactly what it said before — every figure on the page is real —
 * it just no longer says it across the whole page, or first.
 */
function AiNote({ reason }) {
  return (
    <p className="ainote">
      <b>Written explanation unavailable.</b> The estimate, the range and the
      assumptions behind them are unaffected &mdash; they come from the filings, not
      from the write-up. What&rsquo;s missing is only the part that turns those
      numbers into sentences.
      {reason ? <span className="why"> ({reason})</span> : null}
    </p>
  )
}

const aiUnavailable = (data) => data?.aiStatus === 'DETERMINISTIC_FALLBACK'

/**
 * @param {object} props
 * @param {Array}  props.items  `plain_english[]` from the adapter.
 * @param {object} props.data   the whole view object — the first and fourth blocks
 *                              read `what_has_to_be_true` and `falsifiers`, which
 *                              do not live on `plain_english`.
 */
export default function PlainEnglish({ items, data }) {
  const companyName = data?.company_name ?? data?.companyName ?? null

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
        {aiUnavailable(data) && <AiNote reason={data.aiFallbackReason} />}
        {cards.length === 0
          ? <p className="empty">We don’t have a written account of what got in the way.</p>
          : cards.map((item, i) => (
              /* --faint pips throughout: design/app.html colours every cannot-value
                 card that way, because none of them is a verdict about the company. */
              <Claim key={item.title ?? i} item={{ ...item, sentiment: null }} companyName={companyName} />
            ))}
      </section>
    )
  }

  const { mustBeTrue, supports, weakens, proveWrong } = partition(items, data)

  return (
    <section className="plain-english">
      <Label>Why we think so</Label>
      {aiUnavailable(data) && <AiNote reason={data.aiFallbackReason} />}

      <Block
        heading="What must be true for this to hold"
        hint="The estimate assumes all of these. If one fails, the number is wrong."
        items={mustBeTrue}
        empty="We haven’t written up what this estimate assumes."
        companyName={companyName}
      />
      <Block
        heading="What supports the estimate"
        hint="Things in the filings that make the estimate more believable."
        items={supports}
        empty="Nothing in the filings we read argues for this estimate."
        companyName={companyName}
      />
      <Block
        heading="What weakens the estimate"
        hint="Things in the filings that cut the other way."
        items={weakens}
        empty="Nothing in the filings we read argues against this estimate."
        companyName={companyName}
      />
      <Block
        heading="What could prove it wrong"
        hint="Specific things to watch for. If you see one, come back and redo this."
        items={proveWrong}
        empty="We haven’t written this part up. Nothing has been guessed to fill it."
        companyName={companyName}
      />
    </section>
  )
}
