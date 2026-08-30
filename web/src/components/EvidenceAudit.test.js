/* The audit's risk is not layout — it is saying the wrong thing about a check.
 * Three failures matter: reading a set-aside row as a failed one, going quiet
 * about a check we could not judge, and letting an unrecognised status render as
 * nothing at all. Those three are what is pinned here.
 *
 * Pure functions only; there is no DOM renderer in this build.
 */

import { describe, expect, it } from 'vitest'

import { NA_LINE, naLines, neededFor, stateFor } from './EvidenceAudit.jsx'
import { toView } from '../lib/adapter.js'
import live from '../mocks/msft-live.json'

describe('stateFor', () => {
  it('gives each of the four states its own colour', () => {
    expect(stateFor({ status: 'supports' }).colour).toBe('var(--under)')
    expect(stateFor({ status: 'weakens' }).colour).toBe('var(--over)')
    expect(stateFor({ status: 'monitor' }).colour).toBe('var(--fair)')
    expect(stateFor({ status: 'insufficient' }).colour).toBe('var(--faint)')
  })

  /* Colour alone would leave --faint and --fair indistinguishable at a projector,
     and all four indistinguishable to a colourblind reader. */
  it('states every outcome in words as well as colour', () => {
    for (const status of ['supports', 'weakens', 'monitor', 'insufficient']) {
      expect(stateFor({ status }).word).toBeTruthy()
    }
  })

  /* The adapter collapses NOT_APPLICABLE into `insufficient` and carries relevance
     separately, so relevance has to outrank status here or a set-aside row would
     claim we looked and found nothing. */
  it('reads relevance ahead of status', () => {
    const na = stateFor({ status: 'insufficient', sector_relevance: 'not_applicable' })
    expect(na.na).toBe(true)
    expect(na.word).toBe('Not applicable')

    const unknown = stateFor({ status: 'insufficient', sector_relevance: 'applies' })
    expect(unknown.na).toBe(false)
    expect(unknown.word).not.toBe('Not applicable')
  })

  it('falls back to insufficient rather than rendering a stateless row', () => {
    expect(stateFor({ status: 'SOME_NEW_ENUM' }).word).toBe(stateFor({ status: 'insufficient' }).word)
    expect(stateFor(undefined).word).toBe(stateFor({ status: 'insufficient' }).word)
  })
})

describe('naLines', () => {
  it('says the row was set aside when the engine gives no reason', () => {
    expect(naLines({})).toEqual([NA_LINE])
  })

  /* The engine's own wording already contains the sentence; printing both would
     say it twice, one of them without the reason. */
  it('keeps the engine reason when it already says it, rather than repeating', () => {
    const reason =
      'Inventory analysis is not applicable to this business type because physical ' +
      'inventory is not a material operating driver.'
    expect(naLines({ applicability_reason: reason })).toEqual([reason])
  })

  it('leads with the required line when the reason says something else', () => {
    const lines = naLines({ applicability_reason: 'Banks are financed differently.' })
    expect(lines[0]).toBe(NA_LINE)
    expect(lines[1]).toBe('Banks are financed differently.')
  })
})

describe('neededFor', () => {
  it('names the missing documents rather than going quiet', () => {
    expect(neededFor({ missing_information: ['validated subsidiary count', 'Exhibit 21'] }))
      .toBe('To judge this we would need: validated subsidiary count · Exhibit 21')
  })

  it('is null when nothing is missing', () => {
    expect(neededFor({ missing_information: [] })).toBe(null)
    expect(neededFor({})).toBe(null)
  })
})

/* The live envelope is the real test of the four-state model: MSFT comes back with
   eight SUPPORTS, one NOT_APPLICABLE (inventory, on a software company — the exact
   misclassification Verdict.pdf raises) and two UNKNOWN. Every one of those has to
   land somewhere distinct. */
describe('against the live MSFT envelope', () => {
  const checks = toView(live).checks

  it('renders every check, hiding none', () => {
    expect(checks.length).toBe(live.analysis.deterministic_checklist.results.length)
  })

  it('sets the inventory check aside instead of failing it', () => {
    const inventory = checks.find((c) => c.number === 5)
    const state = stateFor(inventory)
    expect(state.na).toBe(true)
    expect(state.colour).not.toBe('var(--over)')
    expect(naLines(inventory).join(' ')).toMatch(/not applicable to this business type/i)
  })

  it('says what it would need for the checks it could not judge', () => {
    const unjudged = checks.filter((c) => c.status === 'insufficient' && c.sector_relevance === 'applies')
    expect(unjudged.length).toBeGreaterThan(0)
    for (const check of unjudged) expect(neededFor(check)).toMatch(/^To judge this we would need: /)
  })

  it('keeps the checklist in its own order rather than sorting by outcome', () => {
    const numbers = checks.map((c) => c.number)
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b))
  })
})
