import { useEvidence } from './EvidenceProvider.jsx'
import './ViewEvidence.css'

/* ── "View evidence" ──────────────────────────────────────────────────────────
 *
 * The inline trigger that opens the evidence drawer for one claim.
 *
 * It sits directly under a sentence, next to the `.cite` line, and it must not
 * compete with the sentence for attention — a claim's own words are the point,
 * the audit trail behind them is the offer. So this is the mockup's `.cite a`
 * treatment: --dim, no underline, one hairline beneath, brightening to --cream on
 * hover. It is a button, not a link, because it opens a panel rather than
 * navigating anywhere.
 *
 * `evidence` null renders NOTHING — not a disabled control, not a greyed
 * "unavailable". The claim's citation line already says "No filing cited for this
 * statement", and a dead button beside that sentence would say it twice while
 * looking like something the reader failed to click.
 */

/**
 * @param {object}      props
 * @param {object|null} props.evidence  one `evidence` object from the adapter
 * @param {string|null} props.claim     the claim this backs, used as the drawer's
 *                                      heading so the panel says what it is evidence FOR
 * @param {string}      props.label     trigger copy; overridden where "evidence"
 *                                      would read oddly (a maths row says "Source")
 */
export default function ViewEvidence({ evidence, claim = null, label = 'View evidence' }) {
  const drawer = useEvidence()

  // No evidence, or no provider above us — say nothing rather than something dead.
  if (!evidence || !drawer) return null

  return (
    <button
      type="button"
      className="viewev"
      onClick={() => drawer.show(evidence, claim)}
      aria-haspopup="dialog"
    >
      {label}
    </button>
  )
}
