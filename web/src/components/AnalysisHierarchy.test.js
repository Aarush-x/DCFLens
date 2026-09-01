import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect, vi } from 'vitest'
import PlainEnglish from './PlainEnglish.jsx'
import TheNumbers from './TheNumbers.jsx'
import WhyDrawer from './WhyDrawer.jsx'
import DeepDive from './DeepDive.jsx'
import EvidenceProvider from './EvidenceProvider.jsx'

const render = (Component, props) => {
  vi.stubGlobal('React', React)
  try {
    return renderToStaticMarkup(createElement(Component, props))
  } finally { vi.unstubAllGlobals() }
}

const renderWithEvidence = (Component, props) => {
  vi.stubGlobal('React', React)
  try {
    return renderToStaticMarkup(
      createElement(EvidenceProvider, null, createElement(Component, props)),
    )
  } finally { vi.unstubAllGlobals() }
}

const math = {
  starting_free_cash_flow: 100,
  stage_1: { years: 5, growth_pct: 8 },
  stage_2: { years: 5, growth_pct: 5 },
  terminal_growth_pct: 3,
  discount_rate_pct: 10,
  net_debt: 20,
  shares_outstanding: 10,
  evidence: { starting_free_cash_flow: { values_used: [] } },
}

describe('analysis information hierarchy', () => {
  it('keeps the default explanation plain and removes valuation assumptions', () => {
    const html = render(PlainEnglish, {
      data: { the_math: math },
      items: [{ title: 'Keeps more of each sales dollar', body: 'Gross profit margin is 46.9%.', sentiment: 'positive' }],
    })
    expect(html).toContain('Why we think so')
    expect(html).toContain('Keeps more of each sales dollar')
    expect(html).not.toContain('Gross profit margin')
    expect(html).not.toContain('What must be true')
    expect(html).not.toContain('Spare cash keeps growing')
  })

  it('does not render the market-implied reverse-DCF card', () => {
    const html = render(TheNumbers, {
      data: {
        the_math: { ...math, scenarios: [{ name: 'Realistic', value_per_share: 10 }] },
        price: { fair_value_mid: 10, current: 12 },
        verdict: { margin_of_safety_pct: -16.7 },
        what_has_to_be_true: { implied_growth_pct: 12, historical_growth_pct: 8, summary: 'Market expects faster growth.' },
      },
    })
    expect(html).toContain('Our best estimate')
    expect(html).not.toContain('What has to be true')
    expect(html).not.toContain('Market expects')
  })

  it('keeps the math disclosure limited to inputs and sources', () => {
    const html = renderWithEvidence(WhyDrawer, { math })
    expect(html).toContain('The inputs')
    expect(html).toContain('Source')
    expect(html).not.toContain('What we checked')
    expect(html).not.toContain('Where this value comes from')
    expect(html).not.toContain('sensitivity')
  })

  it('moves technical interpretation into its own disclosure', () => {
    const html = render(DeepDive, { math, checks: [], price: null })
    expect(html).toContain('Dig deeper')
    expect(html).toContain('technical layer')
    expect(html).not.toContain('The seven inputs')
  })
})
