import { useRef, useState } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useLenis } from './lib/useLenis.js'
import Landing from './components/Landing.jsx'
import { useAnalysis, readParams } from './lib/useAnalysis.js'
import { price, range, signedPercent } from './lib/format.js'
import Card from './components/ui/Card.jsx'
import Label from './components/ui/Label.jsx'
import Eyebrow from './components/ui/Eyebrow.jsx'

/* Phase 1 shell. Landing and app are the two surfaces; the components that fill
   them arrive in batch 1B. What is real here is the structure: one Lenis, one
   accent wipe between the surfaces, one data hook. */

export default function App() {
  const params = readParams()
  const [showApp, setShowApp] = useState(params.view === 'app')
  const wipeRef = useRef(null)
  const busy = useRef(false)
  const { jump } = useLenis()

  /* The cream wipe, ported from swap() in design/index.html. The screen swap
     happens at the top of the wipe, while the accent covers the viewport. */
  function swap(next) {
    const w = wipeRef.current
    if (!w || busy.current) { setShowApp(next); return }
    busy.current = true
    gsap.timeline({ onComplete: () => { busy.current = false } })
      .set(w, { transform: 'translateY(100%)' })
      .to(w, { y: '0%', duration: 0.5, ease: 'power4.inOut' })
      .add(() => {
        ScrollTrigger.getAll().forEach((t) => t.kill())
        setShowApp(next)
        jump(0)
        ScrollTrigger.refresh()
      })
      .to(w, { y: '-100%', duration: 0.6, ease: 'power4.inOut' }, '+=.08')
  }

  return (
    <>
      <div id="wipe" ref={wipeRef} />
      {showApp
        ? <AppScreen onBack={() => swap(false)} />
        : <Landing onEnter={() => swap(true)} />}
    </>
  )
}

function Mark({ onClick }) {
  return (
    <div className="mark" onClick={onClick}>DCF<span>Lens</span></div>
  )
}

function AppScreen({ onBack }) {
  const params = readParams()
  const { data, loading, error } = useAnalysis(params.ticker)

  return (
    <div id="app">
      <aside className="rail">
        <Mark onClick={onBack} />
        <div className="railhead">Recent</div>
        {[['Apple', 'AAPL'], ['Microsoft', 'MSFT'], ['Nvidia', 'NVDA'],
          ['Coca-Cola', 'KO'], ['Costco', 'COST']].map(([name, tkr], i) => (
          <button key={tkr} className={`rowitem${i === 0 ? ' on' : ''}`} type="button">
            <b>{name}</b><i>{tkr}</i>
          </button>
        ))}
      </aside>

      <main className="main">
        <div className="topbar">
          <div className="search">Search a company<span className="kbd">/</span></div>
        </div>
        <ShellState loading={loading} error={error} data={data} />
      </main>
    </div>
  )
}

/* Batch 1A has no VerdictBanner, no range bar, no plain-English cards — those
   are 1B. This panel exists so the shell proves the seam works and so check.sh
   produces three visibly different screenshots. 1B replaces it wholesale. */
function ShellState({ loading, error, data }) {
  if (loading) return <Eyebrow>Loading…</Eyebrow>

  if (error) {
    return (
      <Card variant="box" data-state="error">
        <Label>Shell · payload unavailable</Label>
        <p style={{ color: 'var(--dim)', margin: '10px 0 0', fontSize: 14.5 }}>{error.message}</p>
      </Card>
    )
  }

  const v = data.verdict ?? {}
  const p = data.price ?? {}
  const fallback = data.aiStatus === 'DETERMINISTIC_FALLBACK'

  return (
    <div data-state="ready" data-verdict={v.label} data-ai-status={data.aiStatus}>
      {fallback && (
        <Card variant="box" data-notice="fallback">
          <Label>AI narrative unavailable</Label>
          <p style={{ color: 'var(--dim)', margin: '10px 0 0', fontSize: 14.5 }}>
            The deterministic valuation is preserved.
          </p>
        </Card>
      )}

      <Eyebrow>{data.company_name} · {data.ticker} · as of {data.as_of}</Eyebrow>
      <h1 className="verdict">{v.headline}</h1>

      <Card variant="box">
        <Label>Shell readout — components land in batch 1B</Label>
        <dl style={{ margin: '14px 0 0', fontFamily: 'var(--m)', fontSize: 13 }}>
          <Row k="Today" v={price(p.current)} />
          <Row k="Estimated range" v={range(p.fair_value_low, p.fair_value_high)} />
          <Row k="Best estimate" v={price(p.fair_value_mid)} />
          <Row k="Margin of safety" v={signedPercent(v.margin_of_safety_pct)} />
          <Row k="Verdict label" v={v.label} />
          <Row k="AI status" v={data.aiStatus} />
        </dl>
      </Card>
    </div>
  )
}

function Row({ k, v }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20, padding: '9px 0' }}>
      <dt style={{ color: 'var(--dim)' }}>{k}</dt>
      <dd style={{ margin: 0, fontWeight: 600 }}>{v}</dd>
    </div>
  )
}
