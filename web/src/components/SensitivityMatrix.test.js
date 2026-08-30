/* The matrix is the one place in the app that RUNS the valuation model rather than
 * reading a number the backend produced. That is only defensible while its
 * arithmetic and the engine's agree, so that is what is asserted here — against the
 * byte-for-byte capture of the live service, through the same adapter the component
 * reads from. If the engine's model ever changes, this test is where it surfaces.
 *
 * Pure functions only; there is no DOM renderer in this build.
 */

import { describe, expect, it } from 'vitest'

import { toView } from '../lib/adapter.js'
import msft from '../mocks/msft-live.json'
import { ANCHORS, STEPS, perShare, reproducesPublished, tintFor } from './SensitivityMatrix.jsx'

const math = toView(msft).the_math
const sens = math.sensitivity
const raw = msft.analysis.final_valuation.sensitivity_interval

describe('the adapter carries the published interval', () => {
  it('exposes both deltas as percentage points, not decimal fractions', () => {
    expect(sens.growth_delta_pct).toBeCloseTo(raw.growth_rate_delta * 100, 12)
    expect(sens.discount_delta_pct).toBeCloseTo(raw.discount_rate_delta * 100, 12)
  })

  it('does not let the perturbation be read as a probability', () => {
    expect(sens.is_probability_interval).toBe(false)
  })
})

describe('our arithmetic is the engine’s arithmetic', () => {
  /* The whole component rests on this. Three of the twenty-five cells are figures
     the backend published; if we cannot land on them, the other twenty-two are
     fiction. */
  it.each(ANCHORS)('reproduces $key at growth $gδ / discount $dδ', ({ g, d, key }) => {
    const mine = perShare(math, g * sens.growth_delta_pct, d * sens.discount_delta_pct)
    expect(mine).toBeCloseTo(sens[key], 6)
  })

  it('agrees with all three at once, which is what gates the render', () => {
    expect(reproducesPublished(math, sens)).toBe(true)
  })

  it('disowns the grid when a published figure does not match', () => {
    expect(reproducesPublished(math, { ...sens, central_per_share: 1 })).toBe(false)
  })
})

describe('the grid itself', () => {
  const cell = (g, d) => perShare(math, g * sens.growth_delta_pct, d * sens.discount_delta_pct)

  it('produces a value in all twenty-five cells for this company', () => {
    for (const g of STEPS) {
      for (const d of STEPS) expect(cell(g, d)).toBeGreaterThan(0)
    }
  })

  it('rises with growth and falls with the discount rate, in every row and column', () => {
    for (const d of STEPS) {
      for (let i = 1; i < STEPS.length; i += 1) {
        expect(cell(STEPS[i], d)).toBeGreaterThan(cell(STEPS[i - 1], d))
      }
    }
    for (const g of STEPS) {
      for (let i = 1; i < STEPS.length; i += 1) {
        expect(cell(g, STEPS[i])).toBeLessThan(cell(g, STEPS[i - 1]))
      }
    }
  })

  /* Non-negotiable #3, applied to our own maths: once the discount rate stops
     clearing perpetual growth the Gordon terminal value is a divide-by-nearly-zero,
     and the honest output is no number at all. */
  it('refuses a cell instead of printing an absurd one when the spread closes', () => {
    const tight = { ...math, terminal_growth_pct: math.discount_rate_pct - 0.4 }
    expect(perShare(tight, 0, 0)).toBeNull()
  })

  it('refuses every cell when an input the model needs is missing', () => {
    expect(perShare({ ...math, shares_outstanding: null }, 0, 0)).toBeNull()
    expect(perShare({ ...math, starting_free_cash_flow: null }, 0, 0)).toBeNull()
  })
})

describe('colour', () => {
  /* The live state. Tinting against a price we do not have would turn the grid a
     colour and state, in colour, something we do not know. */
  it('assigns no tint at all when there is no price', () => {
    for (const g of STEPS) {
      for (const d of STEPS) {
        const v = perShare(math, g * sens.growth_delta_pct, d * sens.discount_delta_pct)
        expect(tintFor(v, null)).toBeNull()
      }
    }
  })

  it('never treats a missing price as zero, which would read every cell as cheap', () => {
    expect(tintFor(160, 0)).toBeNull()
    expect(tintFor(160, undefined)).toBeNull()
  })

  it('tints against the price, not against the range', () => {
    expect(tintFor(160, 100)).toBe('under') // 60% above
    expect(tintFor(60, 100)).toBe('over') //  40% below
    expect(tintFor(105, 100)).toBe('fair') //   inside the band
    expect(tintFor(95, 100)).toBe('fair')
  })

  it('has no tint for a cell the model refused', () => {
    expect(tintFor(null, 100)).toBeNull()
  })
})
