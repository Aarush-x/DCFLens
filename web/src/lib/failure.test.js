import { describe, expect, it } from 'vitest'
import { failureFor, noResponse, unresolvedQuery, REFUSAL_STATUS, FAILURES } from './failure.js'
import { toView } from './adapter.js'

/* The point of these tests is the SPLIT, not the copy. The one thing that must
   never regress is 422 leaving this module alone: "we can't value this company"
   is a claim about the company, and routing an outage or a typo into it would put
   a judgement on a business we never read. */

const body = (code, message = 'server said so') => ({
  error: { code, message, request_id: 'abc123' },
})

describe('failureFor', () => {
  it.each([
    [400, 'invalid_ticker', 'unknown_ticker'],
    [404, 'unsupported_ticker', 'unsupported'],
    [429, 'provider_rate_limit', 'rate_limited'],
    [503, 'sec_provider_unavailable', 'unavailable'],
    [500, 'internal_error', 'unavailable'],
    [418, 'who_knows', 'unavailable'],
  ])('%i %s -> %s', (status, code, kind) => {
    const f = failureFor(status, body(code))
    expect(f.kind).toBe(kind)
    expect(f.status).toBe(status)
    expect(f.code).toBe(code)
  })

  it('keeps request_id so a failure during judging can be traced', () => {
    expect(failureFor(500, body('internal_error')).requestId).toBe('abc123')
  })

  it('carries the server sentence as detail, never as the headline', () => {
    const f = failureFor(404, body('unsupported_ticker', 'Ticker ZZZZ is not present in the SEC company mapping'))
    expect(f.detail).toBe('Ticker ZZZZ is not present in the SEC company mapping')
    expect(f.headline).toBe(FAILURES.unsupported.headline)
    // Product non-negotiable #1: the machine code is not on screen anywhere.
    expect(f.headline + f.body).not.toContain('unsupported_ticker')
  })

  it('survives a body with no error object at all — a gateway HTML page', () => {
    const f = failureFor(502, null)
    expect(f.kind).toBe('unavailable')
    expect(f.detail).toBeNull()
    expect(f.requestId).toBeNull()
  })
})

describe('the 422 line', () => {
  it('is the refusal, and the adapter — not this module — renders it', () => {
    expect(REFUSAL_STATUS).toBe(422)
    for (const code of ['missing_sec_data', 'calculation_error']) {
      const view = toView(body(code, 'no usable cash flow history'))
      expect(view.canValue).toBe(false)
      expect(view.verdict.label).toBe('CANNOT_VALUE')
      expect(view.errorCode).toBe(code)
      expect(view.requestId).toBe('abc123')
    }
  })

  it('never produces a verdict word, because there is no valuation to judge', () => {
    const view = toView(body('missing_sec_data'))
    expect(['UNDERVALUED', 'FAIRLY_PRICED', 'OVERVALUED']).not.toContain(view.verdict.label)
    expect(view.price.current).toBeNull()
  })
})

describe('failures that never reached the network', () => {
  it('an unresolvable query is an unknown ticker, quoted back to the user', () => {
    const f = unresolvedQuery('the apple company')
    expect(f.kind).toBe('unknown_ticker')
    expect(f.detail).toContain('the apple company')
  })

  it('a query we cannot echo still renders — no detail, designed copy intact', () => {
    const f = unresolvedQuery('')
    expect(f.detail).toBeNull()
    expect(f.headline).toBe(FAILURES.unknown_ticker.headline)
  })

  it('a timeout and a dead network say the same thing, because we cannot tell them apart', () => {
    expect(noResponse('timeout').kind).toBe('unavailable')
    expect(noResponse('network').kind).toBe('unavailable')
    expect(noResponse('timeout').detail).toMatch(/time limit/)
    expect(noResponse('network').detail).toBeNull()
  })
})

describe('every kind is renderable', () => {
  it('has a headline and a body, and neither is a code', () => {
    for (const [kind, copy] of Object.entries(FAILURES)) {
      expect(copy.headline.length).toBeGreaterThan(0)
      expect(copy.body.length).toBeGreaterThan(0)
      expect(copy.headline).not.toMatch(/_/)
      expect(copy.headline).not.toMatch(/\d{3}/)
    }
  })
})
