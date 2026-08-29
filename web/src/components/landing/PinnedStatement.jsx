import { Fragment, useRef } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useGSAP } from '@gsap/react'
import { prefersReducedMotion } from '../../lib/useLenis.js'

gsap.registerPlugin(ScrollTrigger)

/* The thesis of the whole product, revealed one word at a time as you scroll.
   The mockup splits this with innerHTML at runtime; here the words are just
   elements, which is the same result without mutating the DOM behind React. */
const STATEMENT =
  'A price tells you what people will pay today. It does not tell you what the business is worth.'

export default function PinnedStatement({ sectionRef }) {
  const inner = useRef(null)

  useGSAP(() => {
    if (prefersReducedMotion()) return

    gsap.to('.statement .w', {
      opacity: 1,
      ease: 'none',
      stagger: 1,
      scrollTrigger: {
        trigger: sectionRef.current,
        start: 'top top',
        end: 'bottom bottom',
        scrub: 0.6,
      },
    })
  }, { scope: inner })

  return (
    <section className="pin-sect" ref={sectionRef}>
      <div className="pin-inner" ref={inner}>
        <div className="wrap">
          <p className="statement">
            {STATEMENT.split(' ').map((word, i) => (
              /* the space lives BETWEEN the spans, never inside one — .w is
                 inline-block and a trapped space breaks the wrapping */
              <Fragment key={`${i}-${word}`}>
                <span className="w">{word}</span>{' '}
              </Fragment>
            ))}
          </p>
        </div>
      </div>
    </section>
  )
}
