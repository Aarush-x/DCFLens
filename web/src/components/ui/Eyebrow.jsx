/* .eyebrow — 11px uppercase mono. The line above a heading. Same family as
   .lbl, one step larger; the mockup uses both and they are not interchangeable. */
export default function Eyebrow({ as: Tag = 'div', className = '', children, ...props }) {
  return (
    <Tag className={['eyebrow', className].filter(Boolean).join(' ')} {...props}>
      {children}
    </Tag>
  )
}
