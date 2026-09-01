import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect, vi } from 'vitest'
import AnnualReportReview from './AnnualReportReview.jsx'
import { toAnnualReport } from '../lib/annualReport.js'
import { toView } from '../lib/adapter.js'
import { annualReportFixture } from '../lib/annualReport.fixture.js'
import live from '../mocks/msft-live.json'

const fixture = () => structuredClone(annualReportFixture)
const render = (raw) => {
  // Match the classic JSX runtime used by this repository's Vitest 3 setup.
  vi.stubGlobal('React', React)
  try {
    return renderToStaticMarkup(createElement(AnnualReportReview, { report: toAnnualReport(raw) }))
  } finally { vi.unstubAllGlobals() }
}

describe('annual-report integration', () => {
  it('maps the additive API object through the central adapter', () => {
    const envelope = structuredClone(live)
    envelope.analysis.status = 'APPLIED'
    envelope.analysis.annual_report = fixture()
    expect(toView(envelope).annualReport.topics[0].summary).toContain('Management describes')
    envelope.analysis.status = 'DETERMINISTIC_FALLBACK'
    expect(toView(envelope).annualReport.status).toBe('AI_UNAVAILABLE')
    expect(toView(envelope).annualReport.topics[0].summary).toBe(null)
  })

  it('does not invent findings for an older API response', () => {
    expect(toView(live).annualReport).toBe(null)
    expect(render(null)).toContain('Findings are interpretations, not independently verified facts.')
  })

  it('uses a provider-neutral interpretation disclaimer', () => {
    const html = render(fixture())
    expect(html).toContain('Findings are interpretations, not independently verified facts.')
    expect(html).not.toContain('Gemini')
  })

  it('renders four topics, interpretation labels, exact excerpts and provenance', () => {
    const html = render(fixture())
    expect((html.match(/<article /g) || []).length).toBe(4)
    expect(html).toContain('AI interpretation')
    expect(html).toContain('Governance coverage is incomplete')
    expect(html).toContain('proxy was not retrieved')
    expect(html).toContain('0000000001-26-000001')
    expect(html).toContain('2026-08-31T12:00:00Z')
    expect(html).toContain('a'.repeat(64))
    expect(html).toContain('noopener noreferrer')
    expect(html).toContain('<details>')
    expect(html).not.toContain('<details open')
    expect(html).toContain('Know why')
  })

  it.each(['NO_FINDINGS', 'UNAVAILABLE', 'AI_UNAVAILABLE', 'unrecognized'])('never shows stale findings for %s', (status) => {
    const raw = fixture()
    raw.status = status
    const html = render(raw)
    expect(html).not.toContain('Management describes a recurring')
    expect(html).toContain('Coverage gap')
    expect(html).toContain('SYNTHETIC TEST EXCERPT')
  })

  it.each(['unknown', 'wrong-topic', 'not-selected', 'no-citation', 'fact'])('withholds a finding with %s evidence', (mode) => {
    const raw = fixture()
    if (mode === 'unknown') raw.findings[0].evidence_references.push({ evidence_id: 'invented' })
    if (mode === 'wrong-topic') raw.findings[0].evidence_references = [{ evidence_id: 'test-mda' }]
    if (mode === 'not-selected') raw.selected_evidence_ids = []
    if (mode === 'no-citation') raw.findings[0].evidence_references = []
    if (mode === 'fact') raw.findings[0].claim_type = 'FACT'
    expect(toAnnualReport(raw).topics[0].summary).toBe(null)
  })

  it.each(['javascript:alert(1)', 'http://www.sec.gov/Archives/x', 'https://www.sec.gov.evil.test/Archives/x', 'https://evil.test/Archives/x', 'https://user:password@www.sec.gov/Archives/x', 'https://www.sec.gov/search'])('rejects unsafe source URL %s', (url) => {
    const raw = fixture()
    raw.excerpts[0].source_url = url
    expect(toAnnualReport(raw).topics[0].excerpts[0].url).toBe(null)
  })

  it('renders model and filing markup as inert text', () => {
    const raw = fixture()
    raw.findings[0].summary = '<script>alert(1)</script>'
    raw.excerpts[0].text = '<img src=x onerror=alert(1)>'
    const html = render(raw)
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&lt;img')
  })

  it('handles malformed optional collections without breaking the valuation page', () => {
    expect(() => render({ status: 'REVIEWED', excerpts: [null], findings: [null], coverage: [null] })).not.toThrow()
  })
})
