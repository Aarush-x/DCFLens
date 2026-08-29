import { useRef } from 'react'
import { gsap } from 'gsap'
import { useGSAP } from '@gsap/react'
import Pill from '../ui/Pill.jsx'
import Eyebrow from '../ui/Eyebrow.jsx'
import { prefersReducedMotion } from '../../lib/useLenis.js'

/* The three headline lines are masked by .line{overflow:hidden} and slid in from
   below — the reveal only works if the text stays split exactly this way. */
const LINES = ['Know what', 'a stock is', 'actually worth.']

export default function Hero({ onEnter, onSeeExample }) {
  const root = useRef(null)

  useGSAP(() => {
    if (prefersReducedMotion()) return

    gsap.timeline({ defaults: { ease: 'power4.out' } })
      .from('.kicker', { y: '110%', duration: 0.7 })
      .from('h1.big .line > span', { y: '110%', duration: 1.05, stagger: 0.085 }, '-=.45')
      .from('.lede', { opacity: 0, y: 20, duration: 0.8 }, '-=.6')
      .from('.cta-row', { opacity: 0, y: 20, duration: 0.8 }, '-=.65')
  }, { scope: root })

  return (
    <section className="hero wrap" ref={root}>
      <Eyebrow className="kicker">For people who have never read a balance sheet</Eyebrow>

      <h1 className="big">
        {LINES.map((line, i) => (
          <span className="line" key={line}>
            <span className={i === LINES.length - 1 ? 'accent' : undefined}>{line}</span>
          </span>
        ))}
      </h1>

      <p className="lede">
        We read the filings, do the maths, and tell you whether today&rsquo;s price looks
        reasonable. In a sentence you can actually understand.
      </p>

      <div className="cta-row">
        <Pill solid onClick={onEnter}>Value a company free</Pill>
        <Pill onClick={onSeeExample}>See an example</Pill>
      </div>

      <div className="scrollcue">SCROLL</div>
    </section>
  )
}
