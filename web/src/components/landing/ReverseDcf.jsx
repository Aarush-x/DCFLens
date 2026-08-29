import { useRef } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useGSAP } from '@gsap/react'
import { prefersReducedMotion } from '../../lib/useLenis.js'

gsap.registerPlugin(ScrollTrigger)

/* The two figures the reverse-DCF pitch turns on, matching the app screen's
   "What has to be true" card: the market is betting on 8.4% a year, the company
   has delivered 6.1%. */
const EXPECTED = 8.4
const DELIVERED = 6.1

export default function ReverseDcf() {
  const root = useRef(null)
  const expected = useRef(null)
  const delivered = useRef(null)

  const reduced = prefersReducedMotion()

  useGSAP(() => {
    if (reduced) return

    /* Count each figure up when it scrolls into view. Written to the node
       directly — the tween owns the number, React only owns the markup. */
    for (const [node, value] of [[expected.current, EXPECTED], [delivered.current, DELIVERED]]) {
      const o = { v: 0 }
      gsap.to(o, {
        v: value,
        duration: 1.5,
        ease: 'power2.out',
        scrollTrigger: { trigger: node, start: 'top 88%' },
        onUpdate: () => { node.textContent = o.v.toFixed(1) },
      })
    }
  }, { scope: root, dependencies: [reduced] })

  /* Reduced motion renders the final figure; otherwise the tween starts at 0.0
     and the markup has to agree with it. */
  const start = (v) => (reduced ? v.toFixed(1) : '0.0')

  return (
    <section className="sect wrap" ref={root}>
      <div className="belief">
        <div>
          <h2 className="rv">We don&rsquo;t guess the growth rate. We solve for it.</h2>
          <p className="sub rv" style={{ marginBottom: 0 }}>
            Every other calculator asks you to invent a number. We start from today&rsquo;s
            price and work backwards to find what the market is already betting on — then
            show you what the company has actually done.
          </p>
        </div>

        <div>
          <div className="rv">
            <div className="bl">The market expects</div>
            <div className="bignum" style={{ color: 'var(--fair)' }}>
              {/* the space sits outside .unit so it keeps the big face's width,
                  which is what sets the gap in the mockup */}
              <span ref={expected}>{start(EXPECTED)}</span>%{' '}
              <span className="unit">/ year</span>
            </div>
          </div>

          <div className="vs rv" />

          <div className="rv">
            <div className="bl">It has actually delivered</div>
            <div className="bignum">
              <span ref={delivered}>{start(DELIVERED)}</span>%{' '}
              <span className="unit">/ year</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
