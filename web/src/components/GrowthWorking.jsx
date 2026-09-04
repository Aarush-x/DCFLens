import { EMPTY, percent } from '../lib/format.js'
import './GrowthWorking.css'

/* "Where the growth rate comes from" — the working behind the three growth rows.
 *
 * Two of the drawer's seven input rows are growth rates, and they are the only rows
 * that carry no "Source" trigger, for a reason recorded in three separate places
 * already: growth is not a filed figure. No company reports how fast it will grow,
 * DESIGN.md §5 struck the "No filing cited for this statement" line specifically
 * because it sat under these rows advertising the absence of a source they never
 * could have had (D-026), and `mathEvidence` in the adapter refuses to dress a
 * sector assumption in a 10-K header.
 *
 * All of that is right, and it leaves a hole. "Growth, years 1–5: 14.2%" with a
 * one-line gloss is indistinguishable, to a beginner, from a number somebody typed
 * in — and growth is the assumption the answer is most sensitive to. What that row
 * needs is not provenance, which does not exist. It is the method, which does.
 *
 * ── What this section is allowed to say ───────────────────────────────────────
 * Every figure comes across `the_math.growth` from the adapter, which reads the
 * engine's own assumption traces. Nothing is computed here. The copy is written
 * here rather than carried across because the engine's own sentences are written
 * for the engine — see the note above `toGrowth` in adapter.js.
 *
 * The drawer is the one place jargon is licensed (non-negotiable #1) and the price
 * is a gloss beside every term. This section mostly avoids needing to pay it: it
 * says "typical for a Technology company" rather than "sector prior", "its own
 * spare cash" rather than "historical FCF", and "growth fades" rather than "stage
 * two fade fraction". Nothing here is a simplification of the arithmetic — the
 * weights, the trim and the cap are the real ones, in the order they were applied.
 */

/** "−0.7 points" / "+1.5 points" / "−1.0 point". Percentage POINTS, not percent:
 *  these are added to a rate, and "−0.7%" beside "14.2%" would read as a proportion
 *  of it. Singular below 1.05 so "1.0 point" never prints as "1.0 points". */
export function points(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null
  const abs = Math.abs(n)
  const unit = abs.toFixed(1) === '1.0' ? 'point' : 'points'
  return `${n < 0 ? '−' : '+'}${abs.toFixed(1)} ${unit}`
}

/** "over the last 18 years" — the window the engine's compound rate actually
 *  spanned. The clause disappears rather than guessing when the span is unknown;
 *  a rate with no window invites the reader to supply their own. */
const over = (years) => (years ? `over the last ${years} years` : 'over its filed history')

/**
 * One row of the blend: what it is, and why it counts for what it counts for.
 * Exported for the tests — the copy is the claim this section makes.
 */
export function ingredientCopy(ing, sector) {
  if (ing.key === 'sector') {
    return {
      label: sector ? `Typical for a ${sector} company` : 'Typical for a company like this one',
      gloss: 'Where we start, before looking at this company at all.',
    }
  }

  if (ing.key === 'cash') {
    return {
      label: `How fast its own spare cash grew, ${over(ing.span_years)}`,
      gloss: ing.downweighted
        ? 'Counted for less than we normally would, because this company’s cash flow has swung about from one year to the next.'
        : 'What was left after running costs and equipment, year after year.',
      // Only when the clip actually bit. The reader is owed the number we refused.
      note: ing.capped_from_pct === null
        ? null
        : `Its filed record is ${percent(ing.capped_from_pct)} a year. We never carry more than ${percent(ing.value_pct)} of that into the blend — one extraordinary stretch should not set the next five years.`,
    }
  }

  return {
    label: `How fast its own sales grew, ${over(ing.span_years)}`,
    gloss: 'Sales move more steadily than cash flow, so they get a say of their own.',
    note: ing.capped_from_pct === null
      ? null
      : `Its filed record is ${percent(ing.capped_from_pct)} a year, carried into the blend at ${percent(ing.value_pct)}.`,
  }
}

/** A signal the engine had, looked at, and could not use. Stated rather than
 *  quietly dropped: a blend of two things where the reader expects three is a
 *  different blend, and the reason is usually the most informative thing on the
 *  screen. */
export function unusableCopy(item) {
  const thing = item.key === 'cash' ? 'its own spare cash' : 'its own sales'
  const why = {
    missing: 'we have fewer than two years of it on file',
    negative: 'the latest figure is negative, and a growth percentage from that would be meaningless',
    newly_positive: 'it has only just crossed from negative to positive, and a percentage across that jump would be nonsense',
    unusable: 'the two ends of the series cannot produce a meaningful percentage',
  }[item.reason]

  return {
    label: `How fast ${thing} grew`,
    gloss: `Not used: ${why ?? 'we could not read it from the filings'}. Its share of the blend went to the other two.`,
  }
}

/** One adjustment made to the blend, in the engine's own order. `state` is the word
 *  the engine recorded; when it is missing the copy names no state rather than
 *  guessing one. */
export function adjustmentCopy(adj) {
  if (adj.key === 'cash_flow_stability') {
    return 'its cash flow has been uneven from year to year, so we trim what the blend produced'
  }
  if (adj.key === 'company_maturity') {
    if (adj.state === 'mature') return 'it has been public a long time, and the easy growth is usually behind a company by then'
    if (adj.state === 'emerging') return 'it is young, and young companies more often grow quickly'
    return 'how long it has been public'
  }
  if (adj.key === 'fcf_state') {
    if (adj.state === 'negative') return 'its spare cash is negative right now'
    if (adj.state === 'newly_positive') return 'its spare cash has only just turned positive'
    if (adj.state === 'missing') return 'we could not read its spare cash history'
    return 'the state of its spare cash'
  }
  return null
}

/** The AI line, or null. Two different sentences, because "reviewed and changed
 *  nothing" and "moved it by a point" are two different facts about the number. The
 *  reviewer's own words are quoted only where they explain a change; a rationale for
 *  a non-event is a paragraph saying nothing happened. */
export function aiCopy(ai) {
  if (!ai) return null
  const limit = ai.limit_points === null ? null : percent(ai.limit_points).replace('%', '')
  const bound = limit ? ` It can move it by at most ${limit} points in either direction.` : ''
  if (ai.points === 0) {
    return `An AI reviewer checked this rate against the filing and changed nothing.${bound}`
  }
  return `An AI reviewer moved this by ${points(ai.points)} after reading the filing${
    ai.rationale ? `: “${ai.rationale}”` : '.'
  }`
}

/** One rate, its working, and what it ended at. */
function Stage({ title, rate, children }) {
  return (
    <section className="gwstage">
      <div className="gwhead">
        <span className="gwtitle">{title}</span>
        <span className="gwrate">{percent(rate)} a year</span>
      </div>
      {children}
    </section>
  )
}

/**
 * @param {object}      props
 * @param {object|null} props.growth  `the_math.growth` from the adapter. Null on any
 *                                    payload without the engine's assumption traces
 *                                    — including the contract fixture — and the whole
 *                                    section then does not render. A working we do
 *                                    not have is never filled in with a likely one.
 */
export default function GrowthWorking({ growth }) {
  if (!growth?.stage_1) return null

  const { sector, stage_1: one, stage_2: two, terminal } = growth
  const stageLabel = (from, years) =>
    !years || years < 1 ? null : years === 1 ? `Year ${from}` : `Years ${from}–${from + years - 1}`

  const oneTitle = stageLabel(1, one.years) ?? 'The first stretch'
  const twoTitle = two ? (stageLabel((one.years ?? 0) + 1, two.years) ?? 'The stretch after that') : null
  const ai = aiCopy(one.ai)

  return (
    <div className="growthwork">
      <span className="blkh">Where the growth rate comes from</span>
      <p className="hint">
        No company files a figure for how fast it will grow, so these three rates are
        ours rather than theirs. This is how each one was reached.
      </p>

      <Stage title={oneTitle} rate={one.final_pct}>
        <p className="gwlead">Three things, blended — each counting for the share beside it.</p>

        <div className="gwblend">
          {one.ingredients.map((ing) => {
            const copy = ingredientCopy(ing, sector)
            return (
              <div className="gwrow" key={ing.key}>
                <span className="k">
                  {copy.label}
                  <em>{copy.gloss}</em>
                  {copy.note && <em className="capnote">{copy.note}</em>}
                </span>
                <span className="v">
                  <b>{percent(ing.value_pct)}</b>
                  {/* The share that actually applied, not the one the config asks
                      for — see `toGrowth`. The bar is the same figure drawn, so a
                      reader can compare three rows without reading three numbers. */}
                  <i className="gwbar" aria-hidden="true">
                    <i style={{ width: `${Math.max(0, Math.min(100, ing.weight_pct))}%` }} />
                  </i>
                  <small>{Math.round(ing.weight_pct)}% of the blend</small>
                </span>
              </div>
            )
          })}

          {one.unusable.map((item) => {
            const copy = unusableCopy(item)
            return (
              <div className="gwrow missing" key={`x-${item.key}`}>
                <span className="k">
                  {copy.label}
                  <em>{copy.gloss}</em>
                </span>
                <span className="v"><b>{EMPTY}</b></span>
              </div>
            )
          })}
        </div>

        {one.adjustments.length > 0 && (
          <ul className="gwadjust">
            {one.adjustments.map((adj) => {
              const why = adjustmentCopy(adj)
              return !why ? null : (
                <li key={adj.key}>
                  <span className="pts">{points(adj.points)}</span> because {why}.
                </li>
              )
            })}
          </ul>
        )}

        {one.cap?.applied && (
          <p className="gwcap">
            Then capped at {percent(one.cap.upper_pct)}. The blend came out at{' '}
            {percent(one.cap.input_pct)}, and we do not project a company above that
            ceiling for {one.years} years however good its record is.
          </p>
        )}

        {ai && <p className="gwai">{ai}</p>}
      </Stage>

      {two && (
        <Stage title={twoTitle} rate={two.final_pct}>
          <p className="gwlead">
            Growth fades. This rate sits {Math.round(two.keeps_pct)}% of the way from{' '}
            {percent(two.from_pct)} back down toward the long-run {percent(two.to_pct)}.
            No company grows quickly forever, and how fast one slows is a judgement
            about its industry rather than about the company.
          </p>
          {aiCopy(two.ai) && <p className="gwai">{aiCopy(two.ai)}</p>}
        </Stage>
      )}

      {terminal && (
        <Stage title="After that, forever" rate={terminal.final_pct}>
          <p className="gwlead">
            Roughly the pace of the economy as a whole.
            {typeof terminal.cap?.upper_pct === 'number' && (
              <> We never use more than {percent(terminal.cap.upper_pct)} here: a company
              growing faster than the economy forever eventually outgrows the world it
              sells into.</>
            )}
          </p>
        </Stage>
      )}
    </div>
  )
}
