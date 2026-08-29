import { useRef } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useGSAP } from '@gsap/react'
import Card from '../ui/Card.jsx'
import { prefersReducedMotion } from '../../lib/useLenis.js'

gsap.registerPlugin(ScrollTrigger)

/* Illustrative copy, ported verbatim from design/index.html. The app screen
   renders the real plain_english[] items through PlainEnglish.jsx; these three
   are the landing's worked example and are deliberately hard-coded. */
const CARDS = [
  {
    n: '01',
    title: 'It makes a lot of spare cash',
    body: 'After paying for everything it needs to run, Apple had about $99 billion left over last year. That leftover cash is what the company is ultimately worth.',
    chip: 'Strong',
    tone: 'g',
  },
  {
    n: '02',
    title: 'Growth has slowed down',
    body: 'That spare cash grew about 6% a year over the last five years. Steady, but well below the pace of a decade ago.',
    chip: 'Watch',
    tone: 'a',
  },
  {
    n: '03',
    title: 'Very little debt to worry about',
    body: 'Apple holds more cash than it owes, so there is no real risk of it struggling to pay what it owes.',
    chip: 'Strong',
    tone: 'g',
  },
]

export default function ExplainerCards() {
  const root = useRef(null)

  useGSAP(() => {
    if (prefersReducedMotion()) return

    gsap.from('.card', {
      opacity: 0,
      y: 34,
      duration: 0.8,
      stagger: 0.1,
      ease: 'power3.out',
      scrollTrigger: { trigger: '.cards', start: 'top 82%' },
    })
  }, { scope: root })

  return (
    <section className="sect wrap" ref={root}>
      <h2 className="rv">Then we tell you why.</h2>
      <p className="sub rv">
        Three reasons, no jargon. Everything technical stays folded away until you ask for it.
      </p>
      <div className="cards">
        {CARDS.map((c) => (
          <Card as="article" key={c.n}>
            <div className="n">{c.n}</div>
            <h3>{c.title}</h3>
            <p>{c.body}</p>
            <span className={`chip2 ${c.tone}`}>{c.chip}</span>
          </Card>
        ))}
      </div>
    </section>
  )
}
