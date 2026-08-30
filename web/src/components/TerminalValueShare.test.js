/* What the two-part bar claims.
 *
 * There is no DOM renderer in this build, so what is asserted is the function that
 * decides the claim — plus the adapter block it reads, because a share that
 * disagrees with the two amounts drawn beside it would be a wrong number on a
 * valuation screen.
 */

import { describe, expect, it } from 'vitest'

import envelope from '../mocks/msft-live.json'
import { toView } from '../lib/adapter.js'
import { HEAVY_SHARE, readShare } from './TerminalValueShare.jsx'

const view = toView(envelope)
const fv = envelope.analysis.final_valuation
const math = view.the_math

describe('the terminal value split, off the live envelope', () => {
  it('computes the share from decomposition, not from a field the backend omits', () => {
    const d = fv.decomposition
    expect(fv.terminal_value_pct).toBeUndefined()
    expect(math.terminal_value.present_value).toBe(d.present_value_terminal_value)
    expect(math.terminal_value.projected_present_value).toBe(
      d.present_value_projected_cash_flows,
    )
    expect(math.terminal_value.share_pct).toBeCloseTo(
      (d.present_value_terminal_value /
        (d.present_value_terminal_value + d.present_value_projected_cash_flows)) *
        100,
      9,
    )
  })

  it("agrees with the engine's own concentration figure", () => {
    expect(math.terminal_value.share_pct).toBeCloseTo(fv.terminal_value.concentration * 100, 6)
    expect(math.terminal_value.share_pct).toBeCloseTo(49.5, 1)
  })

  it('draws the bar from two halves that add up to the whole', () => {
    const tv = math.terminal_value
    expect(tv.present_value + tv.projected_present_value).toBeCloseTo(tv.total_present_value, 3)
    expect(tv.total_present_value).toBeCloseTo(fv.decomposition.enterprise_value, 3)
  })

  it('reads the horizon off the assumptions rather than assuming ten', () => {
    expect(readShare(math).horizon).toBe(
      fv.assumptions.stage_one_years + fv.assumptions.stage_two_years,
    )
  })

  it('does not flag MSFT — under half is not a caution', () => {
    expect(readShare(math).heavy).toBe(false)
  })
})

describe('when there is nothing honest to draw', () => {
  it('returns null when the valuation is null (the cannot-value payload)', () => {
    expect(toView({ error: { code: 'calculation_error' } }).the_math).toBeNull()
    expect(readShare(null)).toBeNull()
  })

  it('returns null rather than inventing a share from a missing split', () => {
    expect(readShare({})).toBeNull()
    expect(readShare({ terminal_value: null })).toBeNull()
    expect(readShare({ terminal_value: { share_pct: null } })).toBeNull()
  })

  it('refuses a split whose total is zero or negative — no whole to be a share of', () => {
    const broken = structuredClone(envelope)
    broken.analysis.final_valuation.decomposition.present_value_terminal_value = -5
    broken.analysis.final_valuation.decomposition.present_value_projected_cash_flows = 5
    broken.analysis.final_valuation.terminal_value.present_value = -5
    expect(toView(broken).the_math.terminal_value).toBeNull()
  })

  it('falls back to concentration when the decomposition is absent, and then claims no amounts', () => {
    const thin = structuredClone(envelope)
    delete thin.analysis.final_valuation.decomposition
    thin.analysis.final_valuation.projected_cash_flows = []
    const tv = toView(thin).the_math.terminal_value
    expect(tv.share_pct).toBeCloseTo(fv.terminal_value.concentration * 100, 9)
    expect(tv.present_value).toBeNull()
    expect(tv.projected_present_value).toBeNull()
  })
})

describe('the flag', () => {
  const at = (pct) => readShare({ terminal_value: { share_pct: pct } })

  it('flags above roughly three quarters, and not below', () => {
    expect(at(HEAVY_SHARE - 0.1).heavy).toBe(false)
    expect(at(HEAVY_SHARE).heavy).toBe(true)
    expect(at(92).heavy).toBe(true)
  })

  it('still states a share it cannot draw inside the bar', () => {
    // negative present value on the forecast years puts the share past 100
    expect(at(140).pct).toBe(140)
  })
})
