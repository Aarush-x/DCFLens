import { useEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'
import { useGSAP } from '@gsap/react'
import { useAnalysis, readParams } from '../../lib/useAnalysis.js'
import VerdictBanner from '../VerdictBanner.jsx'
import RangeBar from '../RangeBar.jsx'
import PlainEnglish from '../PlainEnglish.jsx'
import WhyDrawer from '../WhyDrawer.jsx'
import EvidenceProvider from '../EvidenceProvider.jsx'
import TheNumbers from '../TheNumbers.jsx'
import RecentRail, { seedHistory, pushHistory, nameFor } from './RecentRail.jsx'
import TopBar from './TopBar.jsx'
import SearchState from './SearchState.jsx'
import SourcesFooter from './SourcesFooter.jsx'
import LoadingNarration from './LoadingNarration.jsx'
import RequestFailed from './RequestFailed.jsx'
import { unresolvedQuery } from '../../lib/failure.js'
import { cleanName } from '../../lib/format.js'
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

  /* The rail names a company as soon as it is opened, but a ticker typed into the
     search field arrives as its own symbol — "TSLA · TSLA" — because we keep no
     name-to-ticker index and won't guess at one. The response does carry the name,
     so the row is corrected the moment it lands rather than being pre-filled with
     a guess.

     Only rows still showing their own symbol are touched. What the API returns is
     the SEC registrant name — "MICROSOFT CORP", "COSTCO WHOLESALE CORP /NEW" —
     which is worse to read than the curated one a seeded row already carries.
     Naming an unnamed row is a gain; shouting over a named one is not. The guard
     also stops this from looping. */
  useEffect(() => {
    const name = cleanName(data?.company_name)
    const t = data?.ticker
    if (!name || !t) return
    const unnamed = (e) => e.ticker === t && (!e.name || e.name === e.ticker)
    setHistory((h) => (h.some(unnamed) ? h.map((e) => (unnamed(e) ? { ...e, name } : e)) : h))
    setSelected((sel) => (sel && unnamed(sel) ? { ...sel, name } : sel))
  }, [data])

  function open(entry) {
    setHistory((h) => pushHistory(h, entry))
    setSelected({ ...entry, failure: null })
    window.scrollTo(0, 0)
  }

  /* A query the resolver cannot read is reported, not swallowed. Pressing Enter
     and having nothing whatsoever happen is the worst of the available answers —
     it looks like the app is broken rather than like the input was. No request is
     sent: we already know the API would reject it, and a wasted round trip on a
     cold container costs the user thirty seconds to learn nothing. */
  function search(query) {
    const ticker = resolveTicker(query)
    if (!ticker) {
      setSelected({ ticker: null, name: null, failure: unresolvedQuery(String(query).trim()) })
      return
    }
    open({ ticker, name: nameFor(ticker) ?? ticker })
  }

  return (
    <div id="app">
      <RecentRail
        history={history}
        /* Whatever is actually on screen, not what was clicked — a capture that
           opened the result with no ticker of its own still highlights the company
           the payload names. Nothing is highlighted on the search state: no company
           is open there, and a lit row would say one was.

           A query that never became a ticker gets the same treatment. It has no
           ticker of its own, so without the `failure` guard it would fall through
           to whatever `data` was last holding — lighting Apple while the screen
           says we don't recognise what you typed. */
        active={selected && !selected.failure ? selected.ticker ?? data?.ticker ?? null : null}
        onSelect={open}
        onHome={onBack}
      />

      <main className="main">
        {/* The mockup hides the top bar on the search state — the big centred
            field is the search there, and two of them would compete. */}
        {selected && <TopBar onSubmit={search} />}

        {!selected
          ? <SearchState onSubmit={search} />
          : (
            <Result
              data={data}
              loading={loading}
              error={selected.failure ?? error}
              ticker={selected.ticker}
              name={selected.name}
            />
          )}
      </main>
    </div>
  )
}

/* ── the analysis screen ─────────────────────────────────────────────────────── */

function Result({ data, loading, error, ticker, name }) {
  /* A query that never became a ticker fails before any request is made, so it
     outranks the hook — which is still sitting on whatever the last company left
     behind. */
  if (error) return <RequestFailed error={error} ticker={ticker} />
  if (loading) return <LoadingNarration key={ticker ?? 'mock'} ticker={ticker} name={name} />
  if (!data) return null

  return <Analysis data={data} />
}

function Analysis({ data }) {
  const scope = useRef(null)

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
    /* Evidence hangs off claims in both panes and off the maths rows inside the Why
       drawer, and only ONE panel may be open at a time — so the state sits here,
       above all three, rather than in each claim. See EvidenceProvider.jsx. */
    <EvidenceProvider>
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

        {/* The AI-unavailable notice used to sit HERE, full width, between the verdict
            and the reasoning — interrupting the argument to apologise on every live
            response. It now renders inside PlainEnglish, under the "Why we think so"
            heading, because the missing write-up IS that section. `data-ai-status`
            above still carries the state for the harness. */}

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
    </EvidenceProvider>
  )
}
