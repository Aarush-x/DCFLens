/* .lbl — 10px uppercase mono, letter-spaced. Section labels inside the app. */
export default function Label({ as: Tag = 'div', className = '', children, ...props }) {
  return (
    <Tag className={['lbl', className].filter(Boolean).join(' ')} {...props}>
      {children}
    </Tag>
  )
}
