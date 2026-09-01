/* The notice's only decision worth asserting is the one that can put a raw enum
 * on screen: fallback_reason -> sentence. Everything else it does is markup, and
 * there is no DOM renderer in this build.
 */

import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import AiFallbackNotice, { reasonSentence } from './AiFallbackNotice.jsx'
import { AI_FALLBACK } from '../lib/adapter.js'

/* Every reason the API can emit — apps/api/app/ai/gemini.py classifies provider
   failures into these, plus GeminiError's "provider_failure" default. */
const REAL_REASONS = [
  'provider_failure',
  'provider_timeout',
  'provider_rate_limit',
  'provider_unavailable',
  'provider_authentication',
  'provider_not_configured',
  'provider_invalid_request',
]

describe('the reason sentence', () => {
  it('never prints the enum, whatever it is handed', () => {
    const inputs = [...REAL_REASONS, 'something_we_have_never_seen', null, undefined, '', 42, {}]
    for (const r of inputs) {
      const s = reasonSentence(r)
      expect(s).not.toMatch(/_/)
      expect(s).not.toMatch(/provider/i)
    }
  })

  it('always returns one complete sentence — there is no empty state', () => {
    for (const r of [...REAL_REASONS, 'unknown', null, undefined]) {
      const s = reasonSentence(r)
      expect(s.length).toBeGreaterThan(20)
      expect(s.endsWith('.')).toBe(true)
    }
  })

  /* The live state, verified 2026-08-30. If this one ever falls through to the
     generic sentence the demo loses the only specific thing it can say. */
  it('names what happened for provider_failure, the reason every live call returns', () => {
    expect(reasonSentence('provider_failure')).toBe(
      'The service that writes those sentences did not respond.',
    )
  })

  it('gives each real reason its own sentence, so they are not all the same apology', () => {
    const distinct = new Set(REAL_REASONS.map(reasonSentence))
    expect(distinct.size).toBe(REAL_REASONS.length)
  })

  /* `?status=DETERMINISTIC_FALLBACK` forces this state from the URL for captures,
     and the mocks carry no reason to go with it. A missing reason must not become
     a claim about a cause we do not know. */
  it('falls back to a sentence that is true when we know nothing', () => {
    const generic = reasonSentence(null)
    expect(reasonSentence(undefined)).toBe(generic)
    expect(reasonSentence('brand_new_reason_code')).toBe(generic)
    expect(generic).toMatch(/did not return anything usable/)
  })

  it('does not say LLM', () => {
    for (const r of [...REAL_REASONS, null]) expect(reasonSentence(r)).not.toMatch(/LLM/i)
  })

  it('keeps internal valuation jargon off the default screen', () => {
    vi.stubGlobal('React', React)
    try {
      const html = renderToStaticMarkup(createElement(AiFallbackNotice, {
        data: { aiStatus: AI_FALLBACK, aiFallbackReason: 'provider_failure' },
      }))
      expect(html).toContain('The estimate still works.')
      expect(html).toContain('plain-English explanation')
      expect(html).not.toMatch(/deterministic/i)
    } finally { vi.unstubAllGlobals() }
  })
})
