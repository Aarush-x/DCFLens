import Pill from '../ui/Pill.jsx'

/* Fixed header, ported from #site header in design/index.html. It fades the page
   background out from under itself rather than sitting on a solid bar, so the
   hero scrolls up into nothing. */
export default function LandingHeader({ onEnter, onHowItWorks, onTop }) {
  return (
    <header>
      <div className="mark" onClick={onTop}>
        DCF<span>Lens</span>
        <small>VALUATION, IN PLAIN ENGLISH</small>
      </div>
      <nav className="nav">
        <Pill onClick={onHowItWorks}>How it works</Pill>
        <Pill solid onClick={onEnter}>Value a company</Pill>
      </nav>
    </header>
  )
}
