import { useEffect, useRef } from 'react'
import Lenis from 'lenis'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/* Lenis, mounted once at App level. Settings copied from design/index.html:
     new Lenis({duration:1.1, smoothWheel:true}) driven off the GSAP ticker.
   Returns a ref holding the instance (null when reduced motion is on), plus a
   jump() that works either way — the mockup's `jump` helper. */
export function useLenis() {
  const ref = useRef(null)

  useEffect(() => {
    if (prefersReducedMotion()) return undefined

    const lenis = new Lenis({ duration: 1.1, smoothWheel: true })
    ref.current = lenis

    const onScroll = () => ScrollTrigger.update()
    lenis.on('scroll', onScroll)

    const raf = (t) => lenis.raf(t * 1000)
    gsap.ticker.add(raf)
    gsap.ticker.lagSmoothing(0)

    return () => {
      gsap.ticker.remove(raf)
      lenis.destroy()
      ref.current = null
    }
  }, [])

  const jump = (y) => {
    if (ref.current) ref.current.scrollTo(y, { immediate: true })
    else window.scrollTo(0, y)
  }

  return { lenis: ref, jump }
}
