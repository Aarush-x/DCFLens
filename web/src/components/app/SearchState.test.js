/* The cold-start hint under the search field.
 *
 * Emptying the rail (1C.1, D-019) left a first-time visitor with nothing to click,
 * so the running start moved to a hint under the field. A hint that offers a dead
 * name is worse than no hint — the judge clicks it, and the first thing the product
 * does is fail. These tests guard the two ways that happens: a name the resolver
 * cannot turn into a ticker, and a ticker the API cannot value.
 */

import { describe, expect, it } from 'vitest'

import { STARTERS } from './SearchState.jsx'
import { resolveTicker } from './AppScreen.jsx'
import { nameFor } from './RecentRail.jsx'

/* Verified against dcflens-api.onrender.com on 2026-08-30. */
const RETURNS_200 = ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'JNJ']

/* 422 missing_sec_data, and — worse, because it looks like an answer — valuations
   off by 9x and 12x. See CLAUDE.md and the backend QA notes. */
const NEVER_OFFER = ['WMT', 'XOM', 'PG', 'KO', 'AMZN']

describe('the starters are offers that work', () => {
  it('offers two or three — a hint, not a menu', () => {
    expect(STARTERS.length).toBeGreaterThanOrEqual(2)
    expect(STARTERS.length).toBeLessThanOrEqual(3)
  })

  it('every one resolves to a ticker, so no click is dead', () => {
    for (const name of STARTERS) expect(resolveTicker(name)).not.toBeNull()
  })

  it('every one is a ticker the API can actually value', () => {
    for (const name of STARTERS) expect(RETURNS_200).toContain(resolveTicker(name))
  })

  it('offers nothing that 422s or values wrongly', () => {
    for (const name of STARTERS) expect(NEVER_OFFER).not.toContain(resolveTicker(name))
  })

  it('names companies rather than tickers — beginners do not think in symbols', () => {
    for (const name of STARTERS) expect(name).not.toBe(resolveTicker(name))
  })

  it('opens a named row, not a bare symbol, because the rail knows each one', () => {
    for (const name of STARTERS) expect(nameFor(resolveTicker(name))).not.toBeNull()
  })

  it('does not repeat itself', () => {
    expect(new Set(STARTERS).size).toBe(STARTERS.length)
  })
})
