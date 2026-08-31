import { describe, it, expect } from 'vitest'
import { readsAsEnglish } from './plain.js'

/* Strings taken verbatim from GET /api/analyze/AAPL on 2026-08-31 — both kinds, in
   the same fields. The rule has to sort these and only these; it is not a general
   English detector and does not need to be. */

describe('readsAsEnglish', () => {
  it('keeps a calculation written in words', () => {
    expect(readsAsEnglish('gross profit / revenue')).toBe(true)
    expect(readsAsEnglish('net debt / latest positive FCF')).toBe(true)
    expect(readsAsEnglish('total debt - cash and short-term investments')).toBe(true)
    expect(readsAsEnglish('(latest revenue - prior revenue) / abs(prior revenue)')).toBe(true)
    expect(readsAsEnglish('latest normalized annual fact')).toBe(true)
  })

  it('keeps an explanation that happens to contain arithmetic', () => {
    expect(
      readsAsEnglish(
        'Normalized changes use (latest - prior) / abs(prior). A gap through 5 percentage points supports.',
      ),
    ).toBe(true)
  })

  /* The debug traces. Each is rejected by a different tell, on purpose — one
     missing tell would let the rest through. */
  it('rejects a trace with our field names in it', () => {
    expect(readsAsEnglish('reported or normalized total debt')).toBe(true)
    expect(readsAsEnglish('(total_debt 90678000000.0 - cash 54697000000.0) / latest_fcf 98767000000.0')).toBe(false)
  })

  it('rejects a magnitude substituted in at full precision', () => {
    expect(readsAsEnglish('gross profit margin = 195201000000.0 / 416161000000.0')).toBe(false)
    expect(readsAsEnglish('a spread of 1.8408475352740363')).toBe(false)
  })

  it('rejects an exponent', () => {
    expect(readsAsEnglish('CAGR = (416161 / 24578)^(1 / 18) - 1')).toBe(false)
  })

  it('rejects the machine suffix the envelope appends', () => {
    expect(
      readsAsEnglish(
        'free_cash_flow = operating_cash_flow - abs(capital_expenditure); source transformation: reported_value',
      ),
    ).toBe(false)
  })

  it('rejects a bare number and nothing at all', () => {
    expect(readsAsEnglish('3571')).toBe(false)
    expect(readsAsEnglish('   ')).toBe(false)
    expect(readsAsEnglish(null)).toBe(false)
    expect(readsAsEnglish(undefined)).toBe(false)
  })
})
