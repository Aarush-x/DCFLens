import { useRef, useState } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useLenis } from './lib/useLenis.js'
import Landing from './components/Landing.jsx'
import AppScreen from './components/app/AppScreen.jsx'
import { readParams } from './lib/useAnalysis.js'

/* The two surfaces, and the wipe between them.
 *
 * Landing (#site) and app (#app) are never mounted at once — the mockup toggles a
 * `.hide` class on each; React unmounts instead, which is what kills the landing's
 * ScrollTriggers cleanly when the surface goes away.
 *
 * Everything else lives one level down: Landing owns the scroll animation,
 * AppScreen owns the analysis screen and the single data seam.
 */

export default function App() {
  const params = readParams()
  const [showApp, setShowApp] = useState(params.view === 'app')
  const wipeRef = useRef(null)
  const busy = useRef(false)
  const { jump } = useLenis()

  /* The accent wipe, ported from swap() in design/index.html: the panel rises to
     cover the viewport, the surfaces swap behind it while it is opaque, and it
     leaves upward. Same easings and durations. `busy` is the one addition — a
     second click mid-wipe would otherwise start a timeline over a running one and
     leave the panel stranded across the screen. */
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
