import { describe, it, expect } from 'vitest'
import { filedOn, evidenceValue, transformationGloss } from './EvidenceDrawer.jsx'
import { EMPTY } from '../lib/format.js'

/* Only the two pure functions. The drawer's rendering is checked by eye against
   design/index.html — the parity screenshots are the gate for that — but these two
   turn API strings into the words on screen and are worth pinning: one of them is
   the difference between "$0.68" and "67.9%". */

describe('filedOn', () => {
  it('reads an ISO date into English', () => {
    expect(filedOn('2025-11-01')).toBe('1 November 2025')
    expect(filedOn('2026-07-29')).toBe('29 July 2026')
  })

  it('passes anything unparseable straight through rather than guessing', () => {
    expect(filedOn('sometime in 2025')).toBe('sometime in 2025')
  })

  it('is null when there is no date at all', () => {
    expect(filedOn(null)).toBe(null)
    expect(filedOn('')).toBe(null)
  })
})

describe('evidenceValue', () => {
  it('formats USD as money', () => {
    expect(evidenceValue(118254000000, 'USD')).toBe('$118.3B')
  })

  /* The one that matters: gross_profit_margin arrives as 0.679 with unit
     decimal_ratio, and money() would print a plausible-looking "$0.68". */
  it('formats a ratio as a percentage, not as dollars', () => {
    expect(evidenceValue(0.6794409337058032, 'decimal_ratio')).toBe('67.9%')
    expect(evidenceValue(0.0972, 'decimal_fraction')).toBe('9.7%')
  })

  it('formats a share count without a currency symbol', () => {
    expect(evidenceValue(15200000000, 'shares')).toBe('15.2B')
  })

  it('spells out a unit it does not recognise instead of assuming dollars', () => {
    expect(evidenceValue(4200000, 'barrels')).toBe('4.2M barrels')
  })

  it('is an em dash for a figure we do not have — never a zero', () => {
    expect(evidenceValue(null, 'USD')).toBe(EMPTY)
    expect(evidenceValue(undefined, 'decimal_ratio')).toBe(EMPTY)
  })
})

/* The transformation strings the live envelope actually sends, on 2026-08-31. The
   long ones are why the raw string stopped being printed at all. */
const REPORTED = 'reported_value'
const FCF_OCF =
  'free_cash_flow = operating_cash_flow - abs(capital_expenditure); source transformation: reported_value'
const FCF_CAPEX =
  'free_cash_flow = operating_cash_flow - abs(capital_expenditure); source transformation: absolute_value(reported_value)'

describe('transformationGloss', () => {
  it('reads a bare tag into English', () => {
    expect(transformationGloss(REPORTED)).toMatch(/exactly as reported/i)
  })

  /* The one the screenshot was about: a derived field arrives with its formula
     attached, and the formula is not what gets printed — the tag after it is. */
  it('takes the source tag out of a derived transformation and glosses that', () => {
    const said = transformationGloss(FCF_OCF)
    expect(said).toBe(transformationGloss(REPORTED))
    expect(said).not.toMatch(/free_cash_flow|operating_cash_flow|abs\(/)
  })

  it('distinguishes a figure whose sign was taken off from one that was not', () => {
    expect(transformationGloss(FCF_CAPEX)).not.toBe(transformationGloss(FCF_OCF))
    expect(transformationGloss(FCF_CAPEX)).toMatch(/negative/i)
  })

  it('unwraps a wrapper it does not know around a tag it does', () => {
    expect(transformationGloss('rounded(reported_value)')).toBe(transformationGloss(REPORTED))
  })

  /* Null, never the tag itself — printing the tag is the thing this replaced. */
  it('is null for a tag we have no English for, and for nothing at all', () => {
    expect(transformationGloss('some_new_tag_v2')).toBe(null)
    expect(transformationGloss('')).toBe(null)
    expect(transformationGloss(null)).toBe(null)
    expect(transformationGloss(undefined)).toBe(null)
  })
})
