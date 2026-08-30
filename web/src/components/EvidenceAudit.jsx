import Label from './ui/Label.jsx'
import ViewEvidence from './ViewEvidence.jsx'
import './EvidenceAudit.css'

/* ── The evidence audit ───────────────────────────────────────────────────────
 *
 * `checks[]` from the adapter, rendered inside the Why layer. Each row is one
 * item of the deterministic checklist: what was looked at, what was found, and
 * the filing evidence behind the finding.
 *
 * ── Four states, never a binary ──────────────────────────────────────────────
 * Verdict.pdf's objection to PASS/FAIL is that a two-valued scale misclassifies
 * whole business models: a retailer fails a gross-margin test it was never meant
 * to pass, a bank fails ordinary debt rules that do not describe how a bank is
 * financed, and a software company fails an inventory test for having no
 * warehouses. So the engine emits five values and this renders four states plus
 * a relevance axis, and each row is judged on its own:
 *
 *   supports     → var(--under)   the evidence backs the case
 *   weakens      → var(--over)    the evidence cuts against it
 *   monitor      → var(--fair)    mixed, or moving in a direction worth watching
 *   insufficient → var(--faint)   the filings do not answer this
 *
 * `sector_relevance: 'not_applicable'` is the fifth thing, and it is NOT a state —
 * the adapter keeps it on its own axis for exactly this reason. Those rows render
 * greyed and say so. They are never hidden: showing that a check was considered
 * and set aside is the whole argument against PASS/FAIL, and a reader who cannot
 * see the set-aside rows has no way to tell a considered omission from a gap.
 *
 * ── No score, no tally ───────────────────────────────────────────────────────
 * Nothing here counts. No "8 of 10 passed", no ratio, no progress bar, no reorder
 * that floats the greens to the top — Verdict.pdf names "a stock passing eight
 * out of ten checks is a buy" as the specific claim that damages trust, and every
 * one of those is a way of making it without writing the sentence. The rows stay
 * in the checklist's own order, which is a fixed list applied in sequence rather
 * than a leaderboard.
 *
 * ── Colour is never the only signal ──────────────────────────────────────────
 * Every row states its verdict in words beside the pip. Four states separated
 * only by a 6px green/red/yellow dot would be four states a colourblind reader
 * cannot distinguish, and --faint against --fair is close to indistinguishable
 * for anyone at a projector.
 */

/* The four states, in the words a beginner reads. Keyed by the adapter's
   lowercase `status` (docs/API.md), not by the engine's uppercase enum — the
   translation already happened at the seam and does not happen twice. */
const STATE = {
  supports: { word: 'Supports', colour: 'var(--under)' },
  weakens: { word: 'Weakens', colour: 'var(--over)' },
  monitor: { word: 'Worth watching', colour: 'var(--fair)' },
  insufficient: { word: 'Not enough evidence', colour: 'var(--faint)' },
}

/* Relevance, not a state. Sits in the same slot because that is where the reader
   looks for the row's outcome, and "we did not judge this" IS the outcome. */
const NOT_APPLICABLE = { word: 'Not applicable', colour: 'var(--faint)' }

/** The required sentence for a set-aside row. */
export const NA_LINE = 'Not applicable to this business type.'

/**
 * The badge for one row. `sector_relevance` outranks `status`, because the
 * adapter collapses NOT_APPLICABLE into `insufficient` on the status axis and
 * "we had no evidence" and "this does not apply" are different claims.
 * An unrecognised status falls to `insufficient` rather than rendering nothing —
 * the contract may grow a sixth value and a silent row would be worse than a
 * cautious one.
 */
export function stateFor(check) {
  const na = check?.sector_relevance === 'not_applicable'
  const base = na ? NOT_APPLICABLE : STATE[check?.status] ?? STATE.insufficient
  return { ...base, na }
}

/**
 * The lines under a set-aside row's label.
 *
 * The engine's own wording for these usually already IS the required sentence
 * with a because-clause attached ("Not applicable to this business type because
 * physical inventory is not a material operating driver."), so printing both
 * would say it twice. When the engine explains itself in those terms we print its
 * sentence, which contains the required line verbatim and adds the reason; when
 * it says something else, or nothing, the required line leads.
 */
export function naLines(check) {
  const reason = (check?.applicability_reason || check?.detail || '').trim()
  if (!reason) return [NA_LINE]
  if (/not applicable to this business type/i.test(reason)) return [reason]
  return [NA_LINE, reason]
}

/**
 * "validated subsidiary count" + "Exhibit 21 or equivalent subsidiary evidence"
 * -> one sentence naming what is missing.
 *
 * Only for rows we could not judge. Non-negotiable #3 is refuse rather than
 * guess, and a refusal that names the missing document is a refusal a reader can
 * check; one that just goes quiet is indistinguishable from an oversight.
 */
export function neededFor(check) {
  const missing = Array.isArray(check?.missing_information)
    ? check.missing_information.map((m) => String(m ?? '').trim()).filter(Boolean)
    : []
  if (!missing.length) return null
  return `To judge this we would need: ${missing.join(' · ')}`
}

function Check({ check }) {
  const state = stateFor(check)
  const needed = state.na ? null : neededFor(check)
  const lines = state.na ? naLines(check) : [check?.detail].filter(Boolean)

  return (
    <li className={state.na ? 'chk na' : 'chk'}>
      <div className="chkstate">
        {/* Decorative — the word beside it carries the meaning. */}
        <span className="pip" style={{ background: state.colour }} aria-hidden="true" />
        <span className="word" style={{ color: state.colour }}>{state.word}</span>
        {Number.isFinite(check?.number) ? <span className="no">Check {check.number}</span> : null}
      </div>

      <h4 className="chklabel">{check?.label ?? 'Check'}</h4>

      {/* The analyst's original wording of the rule. Jargon, and allowed here and
          only here — the adapter preserves it on `technical_label` for exactly
          this layer. It is the rule being applied; the line below is the finding. */}
      {check?.technical_label ? <p className="rule">{check.technical_label}</p> : null}

      {lines.map((line) => <p className="detail" key={line}>{line}</p>)}

      {needed ? <p className="need">{needed}</p> : null}

      {/* Null evidence renders no trigger at all rather than a dead control —
          see ViewEvidence.jsx. A set-aside row carries none by construction. */}
      <ViewEvidence evidence={check?.evidence ?? null} claim={check?.label ?? null} />
    </li>
  )
}

/**
 * @param {object} props
 * @param {Array}  props.checks  `checks` from the adapter. Any length — the
 *                               contract does not promise ten, and the engine
 *                               happening to emit ten today is not a guarantee.
 *                               Empty (the cannot-value payload) renders nothing:
 *                               a heading over no rows is a promise of an audit
 *                               that did not happen.
 */
export default function EvidenceAudit({ checks }) {
  const rows = Array.isArray(checks) ? checks.filter(Boolean) : []
  if (!rows.length) return null

  return (
    <section className="evidence-audit">
      <Label as="h3" className="blkh">What we checked</Label>
      <p className="hint">
        A fixed list of things a careful investor looks at, judged one at a time against
        this company&rsquo;s filings. We never total them up: a check that doesn&rsquo;t apply
        to how this business makes money says nothing about it either way.
      </p>

      <ul className="auditlist">
        {rows.map((check, i) => (
          <Check check={check} key={check.number ?? check.label ?? i} />
        ))}
      </ul>
    </section>
  )
}
