import Pill from '../ui/Pill.jsx'

/* The last thing on the page asks the question the product answers. */
export default function ClosingCta({ onEnter }) {
  return (
    <section className="fcta wrap">
      <h2 className="rv">So — should you buy it?</h2>
      <Pill solid className="rv" onClick={onEnter}>Value a company free</Pill>
      <div className="fine rv">
        Not investment advice · Data from SEC EDGAR &amp; Yahoo Finance
      </div>
    </section>
  )
}
