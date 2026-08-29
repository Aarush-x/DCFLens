import Label from './ui/Label.jsx'
import './PlainEnglish.css'

/* The left pane's narrative column — the `.pe` articles from the app screen of
   design/index.html. */

/* Sentiment → pip colour, exactly as design/index.html sets it inline. An item with
   no usable sentiment gets --faint, the treatment design/app.html uses for the
   cannot-value cards. */
const PIP = {
  positive: 'var(--under)',
  neutral: 'var(--fair)',
  negative: 'var(--over)',
}

const pipColour = (sentiment) => PIP[sentiment] ?? 'var(--faint)'

/* The empty case is a designed state, not blank space.
 *
 * It is reached two ways, and today the first is the *normal* path: every live
 * response comes back DETERMINISTIC_FALLBACK, so there is no written narrative at
 * all. Prompt 3D.2's AiFallbackNotice sits above this and explains why; this card
 * only has to keep the column from collapsing, and has to say — without hedging —
 * that what is missing is prose, not arithmetic. Nothing is invented to fill it
 * (product non-negotiable #3). */
function NothingToSay() {
  return (
    <article className="pe">
      <h3>
        <span className="pip" style={{ background: 'var(--faint)' }} />
        We haven&rsquo;t written this one up
      </h3>
      <p>
        Everything we calculate — the estimate, the range, the assumptions behind them —
        is unaffected and still on this page. What&rsquo;s missing is only the part that
        turns those numbers into sentences. Nothing has been guessed to fill the gap.
      </p>
    </article>
  )
}

/**
 * "Why we think so" — one card per plain-English point.
 *
 * @param {object} props
 * @param {Array}  props.items  `plain_english[]` from the adapter. The length is not
 *                              fixed: docs/API.md allows up to five, the live
 *                              deterministic path yields three, and a refusal yields
 *                              none.
 */
export default function PlainEnglish({ items }) {
  const cards = Array.isArray(items) ? items.filter(Boolean) : []

  return (
    <section className="plain-english">
      <Label>Why we think so</Label>

      {cards.length === 0
        ? <NothingToSay />
        : cards.map((item, i) => (
            /* `av` carries no styles of its own — it is the mockup's hook for the app
               screen's entrance timeline (`gsap.to('#app .av', …)`), which the
               composing screen owns. Animating here too would double up on it. */
            <article className="pe av" key={item.title ?? i}>
              <h3>
                <span className="pip" style={{ background: pipColour(item.sentiment) }} />
                {item.title}
              </h3>
              <p>{item.body}</p>
            </article>
          ))}
    </section>
  )
}
