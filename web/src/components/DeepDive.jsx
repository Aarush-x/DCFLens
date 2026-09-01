import EvidenceAudit from './EvidenceAudit.jsx'
import TerminalValueShare from './TerminalValueShare.jsx'
import SensitivityMatrix from './SensitivityMatrix.jsx'
import './DeepDive.css'

/**
 * The technical layer that used to be mixed into “Show me the math”. Keeping it
 * separate lets that first disclosure answer one narrow question—what inputs went
 * into the estimate—while this section holds interpretation, checklist evidence,
 * and sensitivity for readers who deliberately choose the deeper analysis.
 */
export default function DeepDive({ math, checks, price = null }) {
  if (!math) return null

  return (
    <details className="deep-dive">
      <summary>
        <span className="deep-label">
          <span className="deep-title">Dig deeper</span>
          <span className="deep-subtitle">
            See the evidence checklist, how much rests on the distant future, and how the estimate changes when assumptions move.
          </span>
        </span>
        <span className="deep-chevron" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </span>
      </summary>

      <div className="deep-body">
        <p className="deep-intro">
          This is the technical layer. It uses finance terms because it shows the model’s checks and stress tests, not the plain-English conclusion.
        </p>
        <div className="deep-value">
          <TerminalValueShare math={math} />
        </div>
        <EvidenceAudit checks={checks} />
        <SensitivityMatrix math={math} price={price} />
      </div>
    </details>
  )
}
