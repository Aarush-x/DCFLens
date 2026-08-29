import { useEffect, useRef } from 'react'

/* `.topbar` from design/index.html. The mockup renders it as a static div —
 * "Search a company  /" — because there was nothing behind it. Here it is the
 * real thing: the `/` shortcut it advertises actually focuses the field, and
 * Enter submits.
 *
 * The shape, padding, radius, type and colours are the mockup's `.search` rule
 * unchanged; only the element changed, from a div to an input.
 */
export default function TopBar({ onSubmit }) {
  const input = useRef(null)

  /* The kbd hint says "/" — so "/" has to work. Ignored while the user is
     already typing somewhere, or the shortcut would eat the slash. */
  useEffect(() => {
    function onKey(e) {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const el = document.activeElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      e.preventDefault()
      input.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function submit(e) {
    e.preventDefault()
    const q = input.current?.value ?? ''
    if (!q.trim()) return
    onSubmit(q)
    input.current.value = ''
    input.current.blur()
  }

  return (
    <div className="topbar">
      <form className="search" onSubmit={submit} role="search">
        <input
          ref={input}
          type="text"
          placeholder="Search a company"
          aria-label="Search a company"
        />
        <span className="kbd" aria-hidden="true">/</span>
      </form>
    </div>
  )
}
