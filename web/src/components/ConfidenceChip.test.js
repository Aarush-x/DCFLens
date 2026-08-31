/* The chip prints a colour and a panel of numbers, and both are claims. What is
 * worth asserting is the part that could put a claim on screen the response does
 * not support: a level we invented, a factor row with no score behind it, an
 * average that isn't the average, or a band rule that has drifted from the
 * backend's (app/ai/service.py `_confidence`).
 *
 * Pure functions only; there is no DOM renderer in this build.
 */

import { describe, expect, it } from 'vitest'

import {
  BANDS,
  averageOf,
  bandFor,
  readConfidence,
  readFactors,
} from './ConfidenceChip.jsx'

const FACTORS = [
  { name: 'data_coverage', score: 0.9 },
  { name: 'cash_flow_stability', score: 0.5 },
  { name: 'sensitivity', score: 0.1 },
]

describe('reading the confidence', () => {
  it('carries the factors through the object shape', () => {
    const c = readConfidence({ level: 'Low', score: 0.55, factors: FACTORS })
    expect(c.level).toBe('low')
    expect(c.factors).toHaveLength(3)
    expect(c.factors[0].label).toBe('How much of the filing we could read')
  })

  it('reads the bare string with no factors rather than failing', () => {
    const c = readConfidence('medium')
    expect(c.level).toBe('medium')
    expect(c.factors).toEqual([])
  })

  it('is absent rather than guessed when the level is missing or unknown', () => {
    expect(readConfidence(null)).toBeNull()
    expect(readConfidence({})).toBeNull()
    expect(readConfidence('probably fine')).toBeNull()
  })
})

describe('the factor rows', () => {
  it('drops a factor with no readable score instead of showing an empty bar', () => {
    expect(readFactors([{ name: 'sensitivity' }, { name: 'x', score: null }])).toEqual([])
    expect(readFactors(null)).toEqual([])
  })

  it('still shows a factor whose name we have no plain English for', () => {
    const [row] = readFactors([{ name: 'some_new_factor', score: 0.4 }])
    expect(row.label).toBe('Some new factor')
  })

  it('clamps a score into the bar it has to be drawn in', () => {
    expect(readFactors([{ name: 'a', score: 1.4 }])[0].score).toBe(1)
    expect(readFactors([{ name: 'a', score: -0.2 }])[0].score).toBe(0)
  })
})

describe('the bands', () => {
  it('matches the thresholds the backend applies', () => {
    expect(BANDS).toEqual({ high: 0.75, medium: 0.5 })
    expect(bandFor(0.75)).toBe('high')
    expect(bandFor(0.7499)).toBe('medium')
    expect(bandFor(0.5)).toBe('medium')
    expect(bandFor(0.4999)).toBe('low')
  })

  it('has no band for a score that isn’t one', () => {
    expect(bandFor(null)).toBeNull()
    expect(bandFor(Number.NaN)).toBeNull()
  })
})

describe('the average', () => {
  it('is the mean of the rows on screen, so the panel adds up', () => {
    expect(averageOf(readFactors(FACTORS))).toBeCloseTo(0.5)
  })

  it('is absent rather than zero when there are no rows', () => {
    expect(averageOf([])).toBeNull()
  })
})
