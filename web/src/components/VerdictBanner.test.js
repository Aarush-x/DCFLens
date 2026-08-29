/* The verdict block decides what the biggest words on the page say. The rendering
 * is the mockup's; what is worth asserting is the part that could put a claim on
 * screen the data does not support — the closed set of combination strings, the
 * rule that a combination needs BOTH axes, and the two contradictions that must
 * never be quietly averaged away.
 *
 * Pure functions only; there is no DOM renderer in this build.
 */

import { describe, expect, it } from 'vitest'

import { readConfidence } from './ConfidenceChip.jsx'
import { COMBINATIONS, combinationFor, legalCombination, tensionFor } from './VerdictBanner.jsx'

const QUALITIES = ['strong', 'weak', 'uncertain', 'insufficient']
const LABELS = ['UNDERVALUED', 'FAIRLY_PRICED', 'OVERVALUED']

describe('the combination headline', () => {
  it('only ever produces one of the six strings docs/API.md allows', () => {
    for (const q of QUALITIES) {
      for (const l of LABELS) {
        expect(COMBINATIONS).toContain(combinationFor(q, l))
      }
    }
  })

  it('names every legal pair — there is no real combination it cannot describe', () => {
    for (const q of QUALITIES) {
      for (const l of LABELS) {
        expect(combinationFor(q, l)).toBeTruthy()
      }
    }
  })

  /* The live path today: the checklist gives a quality axis, D-017 gives no price.
     Five of the six strings encode a price judgement, so there is no headline to
     be had — including "Insufficient evidence", which would misread a valuation
     that succeeded as one that failed. */
  it('refuses a combination when the price axis is missing', () => {
    for (const q of QUALITIES) expect(combinationFor(q, null)).toBeNull()
  })

  it('refuses a combination when the quality axis is missing', () => {
    for (const l of LABELS) expect(combinationFor(null, l)).toBeNull()
  })

  it('refuses an axis value it does not recognise', () => {
    expect(combinationFor('excellent', 'UNDERVALUED')).toBeNull()
    expect(combinationFor('strong', 'CANNOT_VALUE')).toBeNull()
  })

  it('passes through a contract string but never free text', () => {
    expect(legalCombination('Strong business, demanding price')).toBe('Strong business, demanding price')
    expect(legalCombination('Strong business, great price')).toBeNull()
    expect(legalCombination('')).toBeNull()
    expect(legalCombination(null)).toBeNull()
  })
})

describe('the two axes disagreeing', () => {
  it('names the contradiction when a weak business looks cheap', () => {
    expect(tensionFor('weak', 'UNDERVALUED')).toMatch(/fragile/)
  })

  it('names the contradiction when a strong business looks expensive', () => {
    expect(tensionFor('strong', 'OVERVALUED')).toBeTruthy()
  })

  /* Everything else agrees closely enough that a single colour is honest. */
  it('says nothing where the axes point the same way', () => {
    expect(tensionFor('strong', 'UNDERVALUED')).toBeNull()
    expect(tensionFor('strong', 'FAIRLY_PRICED')).toBeNull()
    expect(tensionFor('weak', 'OVERVALUED')).toBeNull()
    expect(tensionFor('uncertain', 'FAIRLY_PRICED')).toBeNull()
  })

  it('needs both axes before it can call anything a contradiction', () => {
    expect(tensionFor('weak', null)).toBeNull()
    expect(tensionFor(null, 'UNDERVALUED')).toBeNull()
  })
})

describe('the confidence chip', () => {
  it('reads the live envelope shape, level and all', () => {
    const c = readConfidence({ level: 'Low', score: 0.55, explanation: 'Confidence summarises data quality.' })
    expect(c.level).toBe('low')
    expect(c.score).toBeCloseTo(0.55)
    expect(c.explanation).toBe('Confidence summarises data quality.')
    expect(c.isProbability).toBe(false)
  })

  it('reads the bare string docs/API.md puts on verdict.confidence', () => {
    expect(readConfidence('medium').level).toBe('medium')
  })

  it('is absent rather than guessed when the level is missing or unknown', () => {
    expect(readConfidence(null)).toBeNull()
    expect(readConfidence({})).toBeNull()
    expect(readConfidence('probably fine')).toBeNull()
  })
})
