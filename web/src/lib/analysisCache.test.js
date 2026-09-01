import { describe, expect, it } from 'vitest'

import { mergeMarketContext, stripMarketContext } from './analysisCache.js'


describe('persisted analysis boundary', () => {
  const envelope = {
    ticker: 'AAPL',
    analysis: { status: 'APPLIED' },
    market_price: { status: 'AVAILABLE', quote: { price: 180 } },
    plausibility: { level: 'SOUND' },
  }

  it('never stores a market price or price-relative plausibility', () => {
    expect(stripMarketContext(envelope)).toEqual({
      ticker: 'AAPL',
      analysis: { status: 'APPLIED' },
    })
  })

  it('merges only a newly fetched market context into a persisted core', () => {
    const core = stripMarketContext(envelope)
    const fresh = {
      market_price: { status: 'AVAILABLE', quote: { price: 181 } },
      plausibility: { level: 'QUALIFIED' },
    }

    expect(mergeMarketContext(core, fresh)).toEqual({
      ticker: 'AAPL',
      analysis: { status: 'APPLIED' },
      ...fresh,
    })
  })

  it('refuses malformed payloads instead of persisting arbitrary data', () => {
    expect(stripMarketContext(null)).toBeNull()
    expect(stripMarketContext({ ticker: 'AAPL' })).toBeNull()
    expect(stripMarketContext({ analysis: {} })).toBeNull()
  })
})
