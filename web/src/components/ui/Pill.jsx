/* .pill / .pill.solid from design/index.html. The solid variant carries the
   accent glow (see the emitter rules in styles/index.css) — it is the primary
   action and the only thing on a black page allowed to emit light. */
export default function Pill({ solid = false, className = '', children, ...props }) {
  return (
    <button
      type="button"
      className={['pill', solid ? 'solid' : '', className].filter(Boolean).join(' ')}
      {...props}
    >
      {children}
    </button>
  )
}
