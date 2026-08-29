/* Two surfaces from the mockup, same family:
   variant="card" → .card, the flat landing tile inside the 1px grid
   variant="box"  → .box,  the bordered, rounded panel used in the app column */
export default function Card({ variant = 'card', as: Tag = 'div', className = '', children, ...props }) {
  return (
    <Tag className={[variant === 'box' ? 'box' : 'card', className].filter(Boolean).join(' ')} {...props}>
      {children}
    </Tag>
  )
}
