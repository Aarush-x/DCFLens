import { useRef } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useGSAP } from '@gsap/react'
import { prefersReducedMotion } from '../lib/useLenis.js'
import LandingHeader from './landing/LandingHeader.jsx'
import Hero from './landing/Hero.jsx'
import PinnedStatement from './landing/PinnedStatement.jsx'
import ScrubRangeBar from './landing/ScrubRangeBar.jsx'
import ExplainerCards from './landing/ExplainerCards.jsx'
import ReverseDcf from './landing/ReverseDcf.jsx'
import Faq from './landing/Faq.jsx'
import ClosingCta from './landing/ClosingCta.jsx'
import './landing/landing.css'

/* ── The landing surface, ported from #site in design/index.html ─────────────
   Two things live here rather than in a section, because they are cross-cutting:
   the .rv reveal (every section marks its own elements with it) and the two
   scroll targets the header and hero link to.

   Every section animates through useGSAP(), so its ScrollTriggers are killed
   when the surface unmounts. App.jsx swaps this component out for the app screen
   behind the accent wipe; the mockup handled that with a manual
   ScrollTrigger.getAll().forEach(kill), which React would have fought.

   Lenis is App.jsx's — nothing here creates a second instance.               */

export default function Landing({ onEnter }) {
  const root = useRef(null)
  const pinSect = useRef(null)
  const barSect = useRef(null)

  const reduced = prefersReducedMotion()

  useGSAP(() => {
    if (reduced) return

    /* One reveal for every .rv on the surface, matching the mockup's
       gsap.utils.toArray('#site .rv'). Each element triggers on itself.

       clamp() is the one thing here the mockup does not do, and it is load-
       bearing: the last .rv on the page is the fine print under the closing CTA,
       whose unclamped start sits a few pixels past the bottom of the document.
       Without the clamp it is reachable or not depending on where the display
       face happens to reflow the page to, and in this build it lands just out of
       reach and never reveals — the disclaimer would silently never render. */
    gsap.utils.toArray('.rv').forEach((el) => {
      gsap.from(el, {
        opacity: 0,
        y: 26,
        duration: 0.85,
        ease: 'power3.out',
        scrollTrigger: { trigger: el, start: 'clamp(top 86%)' },
      })
    })

    /* Both display faces load from a CDN and the pinned sections are sized in
       vh, so every start position measured before the fonts land is wrong.
       Remeasure once they have. */
    let live = true
    document.fonts?.ready.then(() => { if (live) ScrollTrigger.refresh() })
    return () => { live = false }
  }, { scope: root, dependencies: [reduced] })

  const scrollTo = (ref) => ref.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' })

  return (
    <div id="site" className={reduced ? 'no-motion' : undefined} ref={root}>
      <LandingHeader
        onEnter={onEnter}
        onHowItWorks={() => scrollTo(pinSect)}
        onTop={() => window.scrollTo(0, 0)}
      />

      <Hero onEnter={onEnter} onSeeExample={() => scrollTo(barSect)} />
      <PinnedStatement sectionRef={pinSect} />
      <ScrubRangeBar sectionRef={barSect} />
      <ExplainerCards />
      <ReverseDcf />
      <Faq />
      <ClosingCta onEnter={onEnter} />
    </div>
  )
}
