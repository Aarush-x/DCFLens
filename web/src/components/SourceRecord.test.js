import { describe, it, expect } from 'vitest'
import { shortDate, retrievedAt } from './SourceRecord.jsx'

/* The two pure functions only, as with EvidenceDrawer.test.js. These turn the
   envelope's timestamps into the two strings a sceptic actually reads, and the
   failure mode worth pinning is a wrong-but-plausible date. */

describe('shortDate', () => {
  it('reads an ISO date into the record\'s short form', () => {
    expect(shortDate('2025-09-27')).toBe('Sep 27, 2025')
    expect(shortDate('2025-10-31')).toBe('Oct 31, 2025')
  })

  it('handles the live MSFT filing', () => {
    expect(shortDate('2026-06-30')).toBe('Jun 30, 2026')
    expect(shortDate('2026-07-29')).toBe('Jul 29, 2026')
  })

  it('does not pad the day', () => {
    expect(shortDate('2026-01-03')).toBe('Jan 3, 2026')
  })

  it('is null rather than a guess when there is no usable date', () => {
    expect(shortDate(null)).toBe(null)
    expect(shortDate('')).toBe(null)
    expect(shortDate('sometime in 2025')).toBe(null)
    expect(shortDate('2026-13-01')).toBe(null)
  })
})

describe('retrievedAt', () => {
  it('reads the live envelope timestamp, in UTC', () => {
    expect(retrievedAt('2026-08-29T20:38:50.492382Z')).toBe('Aug 29, 2026 at 08:38 PM UTC')
    expect(retrievedAt('2026-08-29T19:50:00Z')).toBe('Aug 29, 2026 at 07:50 PM UTC')
  })

  it('pads the hour and keeps midnight and noon the right way round', () => {
    expect(retrievedAt('2026-08-29T00:05:00Z')).toBe('Aug 29, 2026 at 12:05 AM UTC')
    expect(retrievedAt('2026-08-29T12:00:00Z')).toBe('Aug 29, 2026 at 12:00 PM UTC')
    expect(retrievedAt('2026-08-29T09:07:00Z')).toBe('Aug 29, 2026 at 09:07 AM UTC')
  })

  it('accepts an explicit +00:00 offset as UTC', () => {
    expect(retrievedAt('2026-08-29T20:38:50+00:00')).toBe('Aug 29, 2026 at 08:38 PM UTC')
  })

  /* The row's whole value is that it is checkable. A local time relabelled "UTC"
     would make the one figure a sceptic verifies the one figure that is wrong. */
  it('will not assert UTC over a zone it was not given', () => {
    expect(retrievedAt('2026-08-29T20:38:50+05:30')).toBe('2026-08-29T20:38:50+05:30')
    expect(retrievedAt('2026-08-29T20:38:50')).toBe('2026-08-29T20:38:50')
  })

  it('is null when there is nothing to print', () => {
    expect(retrievedAt(null)).toBe(null)
    expect(retrievedAt('  ')).toBe(null)
  })
})
