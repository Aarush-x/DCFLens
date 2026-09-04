/* What the growth working claims.
 *
 * Two halves, and the split matches TerminalValueShare.test.js: the adapter block is
 * asserted against the live envelope, because a weight or a rate that disagrees with
 * the engine's own trace is a wrong number on a valuation screen; and the copy
 * functions are asserted directly, because on this section the sentence IS the claim
 * — "counted for less than we normally would" is a statement about what the engine
 * did, not decoration around it.
 *
 * There is no DOM renderer in this build, so the component itself is exercised only
 * through the functions it exports.
 */

import { describe, expect, it } from 'vitest'

import envelope from '../mocks/msft-live.json'
import { toView } from '../lib/adapter.js'
import {
  adjustmentCopy,
  aiCopy,
  ingredientCopy,
  points,
  unusableCopy,
} from './GrowthWorking.jsx'

const view = toView(envelope)
const growth = view.the_math.growth
const traces = envelope.analysis.deterministic_baseline.traces
const traceFor = (name) => traces.find((t) => t.assumption === name)
const clone = () => JSON.parse(JSON.stringify(envelope))

describe('the growth working, off the live envelope', () => {
  it('reads the rates the engine recorded, not rates of its own', () => {
    expect(growth.stage_1.baseline_pct).toBeCloseTo(
      traceFor('stage_one_growth_rate').final_baseline * 100, 9,
    )
    expect(growth.stage_2.baseline_pct).toBeCloseTo(
      traceFor('stage_two_growth_rate').final_baseline * 100, 9,
    )
    expect(growth.terminal.final_pct).toBeCloseTo(
      traceFor('terminal_growth_rate').final_baseline * 100, 9,
    )
    // The stage-one figure the drawer's own input row prints is the same number.
    expect(growth.stage_1.final_pct).toBeCloseTo(view.the_math.stage_1.growth_pct, 9)
  })

  it('shows the weight that applied, not the weight the config asks for', () => {
    const trace = traceFor('stage_one_growth_rate')
    const weight = (signal) => trace.weights.find((w) => w.signal === signal)
    const cash = growth.stage_1.ingredients.find((i) => i.key === 'cash')

    expect(cash.weight_pct).toBeCloseTo(weight('historical_fcf_growth').normalized_weight * 100, 9)
    // The point of the distinction: the config asks for 40% and the blend gave 22%.
    expect(weight('historical_fcf_growth').target_weight).toBe(0.4)
    expect(cash.weight_pct).toBeLessThan(40)
    expect(cash.downweighted).toBe(true)
  })

  it('the three shares add up to the whole blend', () => {
    const total = growth.stage_1.ingredients.reduce((sum, i) => sum + i.weight_pct, 0)
    expect(total).toBeCloseTo(100, 6)
  })

  it('reads the window the compound rate actually spanned', () => {
    expect(growth.stage_1.ingredients.find((i) => i.key === 'cash').span_years).toBe(18)
    expect(growth.stage_1.ingredients.find((i) => i.key === 'sales').span_years).toBe(18)
    // The sector rate is not a measurement, so it has no window.
    expect(growth.stage_1.ingredients.find((i) => i.key === 'sector').span_years).toBeNull()
  })

  it('lists only the adjustments that moved the number', () => {
    const trace = traceFor('stage_one_growth_rate')
    expect(trace.company_modifiers).toHaveLength(3)
    expect(trace.company_modifiers.filter((m) => m.value !== 0)).toHaveLength(1)
    expect(growth.stage_1.adjustments).toHaveLength(1)
    expect(growth.stage_1.adjustments[0].key).toBe('cash_flow_stability')
  })

  it('states the fade as the engine performed it', () => {
    expect(growth.stage_2.keeps_pct).toBeCloseTo(40, 9)
    expect(growth.stage_2.from_pct).toBeCloseTo(growth.stage_1.baseline_pct, 9)
    expect(growth.stage_2.to_pct).toBeCloseTo(growth.terminal.final_pct, 9)
    // to + keeps * (from − to), which is what the trace's own arithmetic is.
    const rebuilt =
      growth.stage_2.to_pct +
      (growth.stage_2.keeps_pct / 100) * (growth.stage_2.from_pct - growth.stage_2.to_pct)
    expect(growth.stage_2.baseline_pct).toBeCloseTo(rebuilt, 9)
  })

  it('claims no AI review on a payload where the AI never ran', () => {
    // msft-live is a DETERMINISTIC_FALLBACK capture, and it still carries a full set
    // of zero-point adjustments with a placeholder rationale. Reading those as a
    // decision would put a review on screen that never happened.
    expect(envelope.analysis.status).toBe('DETERMINISTIC_FALLBACK')
    expect(envelope.analysis.adjustments).toHaveLength(3)
    expect(growth.stage_1.ai).toBeNull()
    expect(growth.stage_2.ai).toBeNull()
  })
})

describe('the growth working, on payloads the live one does not cover', () => {
  it('states a signal the engine could not use, and drops it from the blend', () => {
    const e = clone()
    const trace = e.analysis.deterministic_baseline.traces.find(
      (t) => t.assumption === 'stage_one_growth_rate',
    )
    const observation = trace.raw_observations.find((o) => o.name === 'historical_fcf_growth')
    observation.value = null
    observation.status = 'negative'
    trace.weights.find((w) => w.signal === 'historical_fcf_growth').normalized_weight = 0

    const g = toView(e).the_math.growth
    // It leaves the blend, because it contributed nothing to it...
    expect(g.stage_1.ingredients.map((i) => i.key)).toEqual(['sector', 'sales'])
    // ...and it is still stated, because a blend of two things where the reader
    // expects three is a different blend, and the reason is the informative part.
    expect(g.stage_1.unusable).toEqual([{ key: 'cash', reason: 'negative' }])
  })

  it('shows the capped value, and says what was refused', () => {
    const e = clone()
    const trace = e.analysis.deterministic_baseline.traces.find(
      (t) => t.assumption === 'stage_one_growth_rate',
    )
    const cap = trace.bounds_applied.find((b) => b.name === 'historical_fcf_growth_cap')
    cap.was_applied = true
    cap.input_value = 0.84
    cap.output_value = 0.6

    const cash = toView(e).the_math.growth.stage_1.ingredients.find((i) => i.key === 'cash')
    expect(cash.value_pct).toBeCloseTo(60, 9)
    expect(cash.capped_from_pct).toBeCloseTo(84, 9)
  })

  it('loses the window rather than guessing when the calculation is not the engine\'s shape', () => {
    const e = clone()
    const trace = e.analysis.deterministic_baseline.traces.find(
      (t) => t.assumption === 'stage_one_growth_rate',
    )
    trace.raw_observations.find((o) => o.name === 'revenue_growth').calculation = 'CAGR'

    const sales = toView(e).the_math.growth.stage_1.ingredients.find((i) => i.key === 'sales')
    expect(sales.span_years).toBeNull()
    expect(ingredientCopy(sales, 'Technology').label).toContain('over its filed history')
  })

  it('reports an AI move once the review has actually run', () => {
    const e = clone()
    e.analysis.status = 'APPLIED'
    e.analysis.adjustments.find((a) => a.assumption === 'stage_one_growth_rate').ai_adjustment = 0.01

    const ai = toView(e).the_math.growth.stage_1.ai
    expect(ai.points).toBeCloseTo(1, 9)
    expect(ai.limit_points).toBeCloseTo(3, 9)
  })

  it('renders nothing at all where the engine wrote no traces', () => {
    const e = clone()
    e.analysis.deterministic_baseline.traces = []
    expect(toView(e).the_math.growth).toBeNull()
  })
})

describe('the sentences the section prints', () => {
  it('states adjustments in percentage points, singular at one', () => {
    expect(points(-0.745)).toBe('−0.7 points')
    expect(points(1.5)).toBe('+1.5 points')
    expect(points(-1)).toBe('−1.0 point')
    expect(points(0)).toBe('+0.0 points')
    expect(points(null)).toBeNull()
  })

  it('names the sector it starts from, and says so when it cannot', () => {
    const sector = { key: 'sector', value_pct: 12, weight_pct: 46, span_years: null }
    expect(ingredientCopy(sector, 'Technology').label).toBe('Typical for a Technology company')
    expect(ingredientCopy(sector, null).label).toBe('Typical for a company like this one')
  })

  it('says why the cash-flow signal counts for less, only when it does', () => {
    const cash = { key: 'cash', value_pct: 7.4, weight_pct: 21, span_years: 18, capped_from_pct: null }
    expect(ingredientCopy({ ...cash, downweighted: true }, 'Technology').gloss)
      .toContain('swung about')
    expect(ingredientCopy({ ...cash, downweighted: false }, 'Technology').gloss)
      .not.toContain('swung about')
  })

  it('carries the refused figure into the row when a cap bit', () => {
    const cash = { key: 'cash', value_pct: 60, weight_pct: 12, span_years: 9, downweighted: false, capped_from_pct: 84.2 }
    const copy = ingredientCopy(cash, 'Technology')
    expect(copy.note).toContain('84.2%')
    expect(copy.note).toContain('60.0%')
    expect(ingredientCopy({ ...cash, capped_from_pct: null }, 'Technology').note).toBeNull()
  })

  it('gives each unusable reason its own explanation', () => {
    expect(unusableCopy({ key: 'cash', reason: 'negative' }).gloss).toContain('latest figure is negative')
    expect(unusableCopy({ key: 'cash', reason: 'newly_positive' }).gloss).toContain('just crossed')
    expect(unusableCopy({ key: 'sales', reason: 'missing' }).gloss).toContain('fewer than two years')
    // An unknown reason still says the signal was not used, and invents no cause.
    expect(unusableCopy({ key: 'sales', reason: 'something_new' }).gloss)
      .toContain('could not read it from the filings')
  })

  it('explains an adjustment from the state the engine recorded', () => {
    expect(adjustmentCopy({ key: 'cash_flow_stability', points: -0.6, state: null }))
      .toContain('uneven')
    expect(adjustmentCopy({ key: 'company_maturity', points: -1.5, state: 'mature' }))
      .toContain('public a long time')
    expect(adjustmentCopy({ key: 'company_maturity', points: 1.5, state: 'emerging' }))
      .toContain('young')
    expect(adjustmentCopy({ key: 'fcf_state', points: -2, state: 'negative' }))
      .toContain('negative right now')
    // No state parsed: the copy names the subject and claims nothing about it.
    expect(adjustmentCopy({ key: 'company_maturity', points: -1.5, state: null }))
      .toBe('how long it has been public')
    expect(adjustmentCopy({ key: 'something_new', points: 1, state: null })).toBeNull()
  })

  it('separates a review that changed nothing from a review that never happened', () => {
    expect(aiCopy(null)).toBeNull()
    const unchanged = aiCopy({ points: 0, limit_points: 3, rationale: 'No adjustment is proposed.' })
    expect(unchanged).toContain('changed nothing')
    expect(unchanged).toContain('at most 3.0 points')
    // The rationale for a non-event is a paragraph saying nothing happened.
    expect(unchanged).not.toContain('No adjustment is proposed')
  })

  it('quotes the reviewer only where it explains a change', () => {
    const moved = aiCopy({ points: 1, limit_points: 3, rationale: 'Segment growth is decelerating.' })
    expect(moved).toContain('+1.0 point')
    expect(moved).toContain('Segment growth is decelerating.')
  })
})
