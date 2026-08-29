import { useRef, useState } from 'react'
import { gsap } from 'gsap'
import { useGSAP } from '@gsap/react'
import { useAnalysis, readParams } from '../../lib/useAnalysis.js'
import VerdictBanner from '../VerdictBanner.jsx'
import RangeBar from '../RangeBar.jsx'
import PlainEnglish from '../PlainEnglish.jsx'
import WhyDrawer from '../WhyDrawer.jsx'
import TheNumbers from '../TheNumbers.jsx'
import RecentRail, { seedHistory, pushHistory, nameFor } from './RecentRail.jsx'
import TopBar from './TopBar.jsx'
import SearchState from './SearchState.jsx'
import SourcesFooter from './SourcesFooter.jsx'
import Eyebrow from '../ui/Eyebrow.jsx'
import Card from '../ui/Card.jsx'
import Label from '../ui/Label.jsx'
import './app.css'

/* ── The app screen: `#app` from design/index.html, assembled ─────────────────
 *
 * Two states, and the mockup's own swap() decides which one you land on: the app
 * opens on the SEARCH state, never on a company. `?state=result` opens straight on
 * the analysis, which is the mockup's capture parameter and what the parity
 * screenshots use.
 *
 * Layout, top to bottom, matching the mockup and the diagram in CLAUDE.md:
 *
 *   rail (232px, sticky)  |  topbar · verdict · range bar
 *                         |  .panes — PlainEnglish + WhyDrawer  |  TheNumbers
 *                         |  sources
 *
 * Data comes in one door — useAnalysis, which reads through src/lib/adapter.js.
 * Nothing below this file fetches.
 */

/** The verdict tint. One property on the container, and RangeBar's knob and its
 *  26px bloom inherit it via currentColor — see RangeBar.css. */
const VERDICT_COLOUR = {
  UNDERVALUED: 'var(--under)',
  FAIRLY_PRICED: 'var(--fair)',
  OVERVALUED: 'var(--over)',
}

/* A typed query becomes a ticker. Names the rail knows resolve by name; anything
   that already looks like a symbol is passed through as one. We do NOT guess at a
   name we don't know — an unresolvable query is reported, not approximated into
   some other company's filings. */
const BY_NAME = {
  apple: 'AAPL', aapl: 'AAPL',
  microsoft: 'MSFT', msft: 'MSFT',
  nvidia: 'NVDA', nvda: 'NVDA',
  'coca-cola': 'KO', 'coca cola': 'KO', coke: 'KO', ko: 'KO',
  costco: 'COST', cost: 'COST',
}

export function resolveTicker(query) {
  const q = String(query ?? '').trim()
  if (!q) return null
  const known = BY_NAME[q.toLowerCase()]
  if (known) return known
  return /^[A-Za-z][A-Za-z.-]{0,5}$/.test(q) ? q.toUpperCase() : null
}

export default function AppScreen({ onBack }) {
  const params = readParams()

  /* The mockup's HISTORY array, lifted into React. Seeded — see RecentRail.jsx
     for why that departs from design/index.html. */
  const [history, setHistory] = useState(seedHistory)

  /* `?state=result` (and `?ticker=`, and check.sh's `?mock=`) skip the search state.
     A capture with no ticker of its own selects nothing in particular — useAnalysis
     then serves the committed mock, which is exactly what the parity screenshots and
     the batch gate want: the same bytes every run, no network. */
  const [selected, setSelected] = useState(() => {
    if (params.ticker) return { ticker: params.ticker, name: nameFor(params.ticker) }
    if (params.state === 'result' || params.mockExplicit) return { ticker: null, name: null }
    return null
  })

  const { data, loading, error } = useAnalysis(selected?.ticker ?? null)

  function open(entry) {
    setHistory((h) => pushHistory(h, entry))
    setSelected(entry)
    window.scrollTo(0, 0)
  }

  function search(query) {
    const ticker = resolveTicker(query)
    if (!ticker) return
    open({ ticker, name: nameFor(ticker) ?? ticker })
  }

  return (
    <div id="app">
      <RecentRail
        history={history}
        /* Whatever is actually on screen, not what was clicked — a capture that
           opened the result with no ticker of its own still highlights the company
           the payload names. Nothing is highlighted on the search state: no company
           is open there, and a lit row would say one was. */
        active={selected ? selected.ticker ?? data?.ticker ?? null : null}
        onSelect={open}
        onHome={onBack}
      />

      <main className="main">
        {/* The mockup hides the top bar on the search state — the big centred
            field is the search there, and two of them would compete. */}
        {selected && <TopBar onSubmit={search} />}

        {!selected
          ? <SearchState onSubmit={search} />
          : <Result data={data} loading={loading} error={error} ticker={selected.ticker} />}
      </main>
    </div>
  )
}

/* ── the analysis screen ─────────────────────────────────────────────────────── */

function Result({ data, loading, error, ticker }) {
  if (loading) return <Loading ticker={ticker} />
  if (error) return <Failed error={error} />
  if (!data) return null

  return <Analysis data={data} />
}

function Analysis({ data }) {
  const scope = useRef(null)
  const fallback = data.aiStatus === 'DETERMINISTIC_FALLBACK'

  /* The tail of playApp() in design/index.html — the four "Why we think so" blocks
     stagger in last. VerdictBanner and RangeBar own the beats before this one; the
     1.45s delay is where `.to('#app .av', …, '-=.3')` lands in the mockup's single
     timeline, so the three components together reproduce its cadence. */
  useGSAP(
    () => {
      const blocks = gsap.utils.toArray('.av')
      if (!blocks.length) return
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        gsap.set(blocks, { opacity: 1, y: 0 })
        return
      }
      gsap.fromTo(
        blocks,
        { opacity: 0, y: 16 },
        { opacity: 1, y: 0, duration: 0.55, stagger: 0.08, delay: 1.45, ease: 'power3.out' },
      )
    },
    { scope, dependencies: [data], revertOnUpdate: true },
  )

  const tint = VERDICT_COLOUR[data.verdict?.label] ?? 'var(--cream)'

  return (
    <div
      ref={scope}
      data-state="ready"
      data-verdict={data.verdict?.label ?? null}
      data-ai-status={data.aiStatus}
    >
      {/* Product non-negotiable #4 — verdict before reasoning, biggest on screen. */}
      <VerdictBanner data={data} />

      {/* The one place the verdict colour is set, and it is scoped to the bar:
          RangeBar's knob and its 26px bloom read it off currentColor rather than
          taking a prop (RangeBar.css). Everything else on the page states its own
          colour, so tinting a wider container would repaint text that shouldn't move. */}
      <div style={{ color: tint }}>
        <RangeBar price={data.price} />
      </div>

      {fallback && <AiFallbackNotice reason={data.aiFallbackReason} />}

      <div className="panes">
        <div>
          <PlainEnglish items={data.plain_english} data={data} />
          {/* The second layer. The ONLY place jargon is allowed, and only glossed. */}
          <WhyDrawer math={data.the_math} />
        </div>
        <TheNumbers data={data} />
      </div>

      <SourcesFooter sources={data.sources} />
    </div>
  )
}

/* ── the states around it ────────────────────────────────────────────────────── */

/* Today's normal path: Gemini fails every call and the API answers
   DETERMINISTIC_FALLBACK. This is a notice, not an error — the arithmetic is
   untouched and every figure on the page is still real. It sits under the range
   bar so it cannot outrank the verdict. */
function AiFallbackNotice({ reason }) {
  return (
    <Card variant="box" data-notice="fallback" style={{ marginBottom: 34 }}>
      <Label>Written explanation unavailable</Label>
      <p style={{ color: 'var(--dim)', margin: '10px 0 0', fontSize: 14.5, lineHeight: 1.6, maxWidth: '60ch' }}>
        The estimate, the range and the assumptions behind them are unaffected — they
        come from the filings, not from the write-up. What&rsquo;s missing is only the
        part that turns those numbers into sentences.
        {reason ? ` (${reason})` : ''}
      </p>
    </Card>
  )
}

function Loading({ ticker }) {
  return (
    <div data-state="loading">
      <Eyebrow>{ticker ? `Reading ${ticker}’s filings…` : 'Reading the filings…'}</Eyebrow>
      <h1 className="verdict" style={{ color: 'var(--faint)' }}>One moment</h1>
      <p style={{ fontSize: 17, color: 'var(--dim)', maxWidth: '54ch', lineHeight: 1.55 }}>
        We&rsquo;re pulling the latest annual report from SEC EDGAR and doing the maths.
      </p>
    </div>
  )
}

/* A load that never arrived is not the same as a company we decline to value, and
   it must not borrow the designed refusal — that state means "we read the filings
   and won't publish a number", which would be a lie here. */
function Failed({ error }) {
  return (
    <div data-state="error">
      <Eyebrow>Nothing to show</Eyebrow>
      <h1 className="verdict" style={{ color: 'var(--faint)' }}>We couldn’t load this</h1>
      <p style={{ fontSize: 17, color: 'var(--dim)', maxWidth: '54ch', lineHeight: 1.55, marginBottom: 34 }}>
        This is a problem on our side, not a judgement about the company. Try another
        company from the rail, or the same one again in a moment.
      </p>
      <Card variant="box">
        <Label>What went wrong</Label>
        <p style={{ color: 'var(--dim)', margin: '10px 0 0', fontSize: 14.5 }}>{error.message}</p>
      </Card>
    </div>
  )
}
