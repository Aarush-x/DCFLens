import { useEffect, useRef } from 'react'

/* `#s-hunt` from design/index.html — the app's DEFAULT state.
 *
 * No company is loaded until the user asks for one. There is no default ticker,
 * no example chips and no pre-selected row; the rail beside this is the only
 * other thing on screen. Copy is the mockup's, verbatim.
 */
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
          placeholder="Apple, Microsoft, Nvidia…"
          aria-label="Company name or ticker"
        />
      </form>
    </section>
  )
}
