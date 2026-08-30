import { useEffect, useRef } from 'react'

/* `#s-hunt` from design/index.html — the app's DEFAULT state.
 *
 * No company is loaded until the user asks for one. There is no default ticker
 * and no pre-selected row; the rail beside this is the only other thing on screen.
 * Copy is the mockup's, verbatim — apart from the starters line, which the mockup
 * does not have, and the placeholder, which it made redundant. See below.
 */

/* The cold start, answered as an offer rather than a claim.
 *
 * Emptying the rail (1C.1, D-019) made the cold start real: a first-time visitor —
 * a judge — lands on an empty screen and has to already know a ticker to get
 * anywhere. CLAUDE.md says where the running start belongs: a hint under the
 * field, NOT rows in the rail. A hint offers; a populated sidebar asserts a
 * history the user does not have.
 *
 * These three are named, not tickered, because beginners don't think in symbols —
 * and they are the three the resolver already knows by name (AppScreen's BY_NAME,
 * RecentRail's nameFor), so clicking one opens a properly named row instead of a
 * bare "GOOGL · GOOGL" that only corrects itself once the response lands.
 *
 * All three return 200 today. Do not extend this list without checking: WMT, XOM
 * and PG 422 with missing_sec_data, and KO and AMZN return valuations that are
 * wrong by 9x and 12x. The default screen is the last place to put a company we
 * cannot value.
 */
export const STARTERS = ['Apple', 'Microsoft', 'Nvidia']

export default function SearchState({ onSubmit }) {
  const input = useRef(null)

  useEffect(() => { input.current?.focus() }, [])

  function submit(e) {
    e.preventDefault()
    const q = input.current?.value ?? ''
    if (q.trim()) onSubmit(q)
  }

  return (
    <section className="hunt">
      <h1>What are you thinking of buying?</h1>
      <p>
        Type a company name. We read its filings, do the maths, and tell you whether
        today&rsquo;s price looks reasonable &mdash; in plain English.
      </p>
      <form className="bigsearch" onSubmit={submit} role="search">
        <input
          ref={input}
          type="text"
          /* The mockup listed "Apple, Microsoft, Nvidia…" here, because it had no
             hint underneath. Now that it does, ghost text repeating the hint's three
             names 70px above them reads as a stutter — and worse, it looks clickable
             and is not. The placeholder describes the input; the hint makes the offer. */
          placeholder="Company name or ticker"
          aria-label="Company name or ticker"
        />
      </form>
      <p className="starters">
        Not sure where to start? Try{' '}
        {STARTERS.map((name, i) => (
          <span key={name}>
            {i > 0 && (i === STARTERS.length - 1 ? ' or ' : ', ')}
            <button type="button" onClick={() => onSubmit(name)}>{name}</button>
          </span>
        ))}
        .
      </p>
    </section>
  )
}
