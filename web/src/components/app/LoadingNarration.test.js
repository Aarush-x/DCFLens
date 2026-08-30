/* The escalating footnote on the narrated wait.
 *
 * The API sits on Render's free tier and its cold start is 21.4 seconds, measured.
 * A first-time visitor — a judge — otherwise watches a screen that says one thing
 * for twenty seconds and gives no sign that anything is happening. The footnote is
 * what closes that gap, and it has exactly one rule that can be got wrong silently:
 * it must only ever grow. A line that appears at 4s and is gone at 20s leaves the
 * reader unsure whether they misread it, which is worse than never having said it.
 */

import { describe, expect, it } from 'vitest'

import {
  COLD_START_AFTER,
  LONGER_THAN_USUAL_AFTER,
  footnotesAt,
} from './LoadingNarration.jsx'

describe('the tiers', () => {
  it('says nothing extra while the wait still reads as ordinary', () => {
    expect(footnotesAt(0)).toEqual([])
    expect(footnotesAt(COLD_START_AFTER - 0.25)).toEqual([])
  })

  it('explains the sleeping service once the wait stops looking like work', () => {
    expect(footnotesAt(COLD_START_AFTER)).toEqual(['coldStart'])
    expect(footnotesAt(12)).toEqual(['coldStart'])
  })

  it('admits it is slow past the measured cold start, without dropping the reason', () => {
    expect(footnotesAt(LONGER_THAN_USUAL_AFTER)).toEqual(['coldStart', 'longerThanUsual'])
    expect(footnotesAt(90)).toEqual(['coldStart', 'longerThanUsual'])
  })

  it('escalates only — no line ever disappears', () => {
    let previous = []
    for (let t = 0; t <= 120; t += 0.25) {
      const notes = footnotesAt(t)
      // Everything said before is still said, in the same order it was said in.
      expect(notes.slice(0, previous.length)).toEqual(previous)
      previous = notes
    }
  })

  it('waits for the cold start to be real before calling it unusual', () => {
    // 21.4s measured on Render's free tier. A threshold under it would call every
    // single first request "longer than usual", which makes the words worthless.
    expect(COLD_START_AFTER).toBeLessThan(LONGER_THAN_USUAL_AFTER)
    expect(LONGER_THAN_USUAL_AFTER).toBeGreaterThanOrEqual(20)
  })

  it('speaks up well before the reader concludes the page is broken', () => {
    expect(COLD_START_AFTER).toBeGreaterThan(0)
    expect(COLD_START_AFTER).toBeLessThanOrEqual(5)
  })
})
