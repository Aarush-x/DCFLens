/* The history rail's two 1C.1 requirements: it starts EMPTY, and it survives a
 * reload capped at ~8 and deduped by ticker.
 *
 * Both were unmet until this change — the rail seeded five companies and kept no
 * storage at all, so it reset to the same five on every visit and could never
 * fill from use, which was the whole point of it.
 *
 * The storage tests drive a stand-in rather than a real browser: what matters is
 * the contract this module holds itself to — never throw on boot, never trust
 * what comes back — and a fake is the only way to produce a store that throws.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { loadHistory, saveHistory, pushHistory, nameFor } from './RecentRail.jsx'

const KEY = 'dcflens.history.v1'

/** A localStorage that behaves, unless told to throw. */
function fakeStore(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    throws: false,
    getItem(k) {
      if (this.throws) throw new DOMException('denied', 'SecurityError')
      return map.has(k) ? map.get(k) : null
    },
    setItem(k, v) {
      if (this.throws) throw new DOMException('quota', 'QuotaExceededError')
      map.set(k, v)
    },
    read: (k) => map.get(k),
  }
}

let store

beforeEach(() => {
  store = fakeStore()
  vi.stubGlobal('window', { localStorage: store })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the rail starts empty', () => {
  it('has no history at all on a first visit', () => {
    expect(loadHistory()).toEqual([])
  })

  it('seeds nothing — no company appears until the user looks one up', () => {
    const first = loadHistory()
    expect(first).toHaveLength(0)
    for (const t of ['AAPL', 'MSFT', 'NVDA', 'KO', 'COST']) {
      expect(first.some((e) => e.ticker === t)).toBe(false)
    }
  })
})

describe('it survives a reload', () => {
  it('reads back exactly what the last visit wrote', () => {
    saveHistory([{ ticker: 'TSLA', name: 'Tesla' }, { ticker: 'AAPL', name: 'Apple' }])
    expect(loadHistory()).toEqual([
      { ticker: 'TSLA', name: 'Tesla' },
      { ticker: 'AAPL', name: 'Apple' },
    ])
  })

  it('caps at eight on the way out and on the way back in', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ ticker: `T${i}`, name: `Co ${i}` }))
    saveHistory(many)
    expect(JSON.parse(store.read(KEY))).toHaveLength(8)
    expect(loadHistory()).toHaveLength(8)
  })

  it('caps a stored array an older build left oversized', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ ticker: `T${i}`, name: `Co ${i}` }))
    store.setItem(KEY, JSON.stringify(many))
    expect(loadHistory()).toHaveLength(8)
  })

  it('de-duplicates by ticker, keeping the first occurrence', () => {
    store.setItem(
      KEY,
      JSON.stringify([
        { ticker: 'AAPL', name: 'Apple' },
        { ticker: 'AAPL', name: 'Apple Inc.' },
        { ticker: 'MSFT', name: 'Microsoft' },
      ]),
    )
    expect(loadHistory()).toEqual([
      { ticker: 'AAPL', name: 'Apple' },
      { ticker: 'MSFT', name: 'Microsoft' },
    ])
  })
})

describe('it never takes the app down', () => {
  it('returns no history when the store throws on read', () => {
    store.throws = true
    expect(loadHistory()).toEqual([])
  })

  it('does not throw when the store throws on write', () => {
    store.throws = true
    expect(() => saveHistory([{ ticker: 'AAPL', name: 'Apple' }])).not.toThrow()
  })

  it('ignores a payload that is not an array', () => {
    store.setItem(KEY, JSON.stringify({ ticker: 'AAPL' }))
    expect(loadHistory()).toEqual([])
  })

  it('ignores malformed JSON', () => {
    store.setItem(KEY, '{not json')
    expect(loadHistory()).toEqual([])
  })

  it('drops rows with no ticker, which could not be clicked anyway', () => {
    store.setItem(
      KEY,
      JSON.stringify([{ name: 'Nameless' }, { ticker: '  ' }, { ticker: 'KO', name: 'Coca-Cola' }]),
    )
    expect(loadHistory()).toEqual([{ ticker: 'KO', name: 'Coca-Cola' }])
  })

  it('falls back to the ticker when a stored row lost its name', () => {
    store.setItem(KEY, JSON.stringify([{ ticker: 'NVDA' }]))
    expect(loadHistory()).toEqual([{ ticker: 'NVDA', name: 'NVDA' }])
  })
})

describe('pushHistory, unchanged', () => {
  it('puts the newest first and moves a repeat back to the top', () => {
    let h = []
    h = pushHistory(h, { ticker: 'AAPL', name: 'Apple' })
    h = pushHistory(h, { ticker: 'MSFT', name: 'Microsoft' })
    h = pushHistory(h, { ticker: 'AAPL', name: 'Apple' })
    expect(h.map((e) => e.ticker)).toEqual(['AAPL', 'MSFT'])
  })

  it('caps at eight', () => {
    let h = []
    for (let i = 0; i < 12; i += 1) h = pushHistory(h, { ticker: `T${i}`, name: `Co ${i}` })
    expect(h).toHaveLength(8)
    expect(h[0].ticker).toBe('T11')
  })
})

describe('nameFor is a naming table, not history', () => {
  it('names the companies the search field already resolves', () => {
    expect(nameFor('AAPL')).toBe('Apple')
    expect(nameFor('COST')).toBe('Costco')
  })

  it('returns null for anything else rather than guessing', () => {
    expect(nameFor('TSLA')).toBeNull()
  })
})
