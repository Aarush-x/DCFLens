/* The one place in this build where "no tests" does not apply.
 *
 * adapter.js is the seam between the AnalysisEnvelope and the docs/API.md v2 shape
 * the components render. A silent mis-map here is a wrong number on a valuation
 * screen — the failure mode this whole product exists to avoid. So every derived
 * field is asserted against src/mocks/msft-live.json, a byte-for-byte capture of a
 * real GET /api/analyze/MSFT.
 *
 * Values are asserted against the envelope, not against hard-coded constants, except
 * where a literal IS the point (the price gap, the enum translations, the 159.66
 * headline figure quoted in docs/FRONTEND-PROMPTS.md).
 */

import { describe, expect, it } from 'vitest'

import envelope from '../mocks/msft-live.json'
import {
  AI_FALLBACK,
  IMPLIED_GROWTH_UNSOLVED,
  NO_PRICE,
  VERDICT_WITHHELD,
  businessQuality,
  historicalGrowthPct,
  toCannotValue,
  toView,
} from './adapter.js'

const view = toView(envelope)
const fv = envelope.analysis.final_valuation
const si = fv.sensitivity_interval
const results = envelope.analysis.deterministic_checklist.results

/* ── the price gap: the assertions that matter most ─────────────────────────── */

/* SCOPED, not deleted. src/mocks/msft-live.json carries no `market_price` key at
 * all, so every assertion below is the price-ABSENT path — which docs/API.md v3
 * invariant 1 says must degrade identically to `status: "UNAVAILABLE"`. That is
 * still the live response today, and it is still the state this product must never
 * paper over. The two price-PRESENT states are asserted further down, in "the
 * market price and the plausibility gate". */
describe('the price gap, with no market_price key at all (non-negotiable #3)', () => {
  it('returns price.current === null, and specifically not 0', () => {
    expect(view.price.current).toBeNull()
    expect(view.price.current).not.toBe(0)
  })

  it('flags price as unavailable rather than leaving consumers to guess', () => {
    expect(view.priceAvailable).toBe(false)
    expect(view.price.unavailable_reason).toBe(NO_PRICE)
  })

  it('refuses a verdict word, because a verdict is price vs value', () => {
    expect(view.verdict.label).toBeNull()
    expect(view.verdict.unavailable_reason).toBe(NO_PRICE)
  })

  it('refuses a margin of safety and a combination string', () => {
    expect(view.verdict.margin_of_safety_pct).toBeNull()
    expect(view.verdict.combination).toBeNull()
  })

  it('refuses an implied growth rate, which is solved against the price', () => {
    expect(view.what_has_to_be_true.implied_growth_pct).toBeNull()
    expect(view.what_has_to_be_true.unavailable_reason).toBe(NO_PRICE)
  })

  it('never emits a numeric zero anywhere a price would sit', () => {
    for (const v of [
      view.price.current,
      view.verdict.margin_of_safety_pct,
      view.what_has_to_be_true.implied_growth_pct,
    ]) {
      expect(v).toBeNull()
    }
  })
})

/* ── the range: what survives the gap ───────────────────────────────────────── */

describe('valuation range', () => {
  it('maps intrinsic_value_per_share to both value.mid and price.fair_value_mid', () => {
    expect(view.value.mid).toBe(fv.intrinsic_value_per_share)
    expect(view.price.fair_value_mid).toBe(fv.intrinsic_value_per_share)
    expect(view.value.mid).toBeCloseTo(159.66, 2) // the figure quoted in FRONTEND-PROMPTS.md
  })

  it('maps the sensitivity interval bounds to low and high', () => {
    expect(view.value.low).toBe(si.lower_bound_per_share)
    expect(view.value.high).toBe(si.upper_bound_per_share)
    expect(view.price.fair_value_low).toBe(si.lower_bound_per_share)
    expect(view.price.fair_value_high).toBe(si.upper_bound_per_share)
    expect(view.value.low).toBeCloseTo(127.3, 1)
    expect(view.value.high).toBeCloseTo(212.2, 1)
  })

  it('is a populated, correctly ordered range', () => {
    expect(view.value.low).toBeLessThan(view.value.mid)
    expect(view.value.mid).toBeLessThan(view.value.high)
  })
})

/* ── identity, filing, provenance ───────────────────────────────────────────── */

describe('identity and filing', () => {
  it('maps company_name to both company_name and companyName', () => {
    expect(view.company_name).toBe('MICROSOFT CORP') // SEC registrant name, verbatim — never re-cased here
    expect(view.companyName).toBe(envelope.company_name)
  })

  it('maps ticker', () => {
    expect(view.ticker).toBe('MSFT')
  })

  it('maps sec_retrieved_at to retrievedAt, and as_of to its date half', () => {
    expect(view.retrievedAt).toBe(envelope.sec_retrieved_at)
    expect(view.as_of).toBe('2026-08-29')
    expect(view.as_of).toBe(envelope.sec_retrieved_at.slice(0, 10))
  })

  it('maps every latest_filing field named in the 1A.2 spec', () => {
    const f = envelope.latest_filing
    expect(view.filing).toEqual({
      form: f.filing_form,
      reportDate: f.report_date,
      filingDate: f.filing_date,
      accessionNumber: f.accession_number,
      url: f.filing_url,
      cik: f.cik,
      isAmendment: false,
    })
    expect(view.filing.form).toBe('10-K')
    expect(view.filing.accessionNumber).toBe('0001193125-26-323660')
  })

  it('cites only sources the service actually used — never Yahoo Finance', () => {
    expect(view.sources.length).toBeGreaterThan(0)
    for (const s of view.sources) {
      expect(s.url).toMatch(/^https:\/\//)
      expect(s.label.toLowerCase()).not.toContain('yahoo')
    }
    expect(view.sources[0].url).toBe(envelope.latest_filing.filing_url)
  })
})

/* ── confidence ─────────────────────────────────────────────────────────────── */

describe('confidence', () => {
  it('maps level, score and explanation, lowercasing the level for the contract', () => {
    const c = envelope.analysis.confidence
    expect(view.confidence.level).toBe('low') // engine emits "Low"
    expect(view.confidence.score).toBe(c.score)
    expect(view.confidence.explanation).toBe(c.explanation)
    expect(view.confidence.isProbability).toBe(false)
  })

  it('mirrors the level onto verdict.confidence, in the contract enum', () => {
    expect(view.verdict.confidence).toBe('low')
    expect(['high', 'medium', 'low']).toContain(view.verdict.confidence)
  })

  it('carries every confidence factor through with a readable label', () => {
    expect(view.confidence.factors).toHaveLength(envelope.analysis.confidence.factors.length)
    const coverage = view.confidence.factors.find((f) => f.name === 'data_coverage')
    expect(coverage.label).toBe('Data coverage')
    expect(coverage.score).toBeCloseTo(0.925, 3)
  })
})

/* ── checks ─────────────────────────────────────────────────────────────────── */

describe('checks', () => {
  it('maps every checklist result, losing none', () => {
    expect(view.checks).toHaveLength(results.length)
    expect(view.checks).toHaveLength(10)
  })

  it('translates the five engine statuses into the four contract statuses', () => {
    const by = (n) => view.checks.find((c) => c.number === n)
    expect(by(1).status).toBe('supports') // SUPPORTS
    expect(by(5).status).toBe('insufficient') // NOT_APPLICABLE
    expect(by(9).status).toBe('insufficient') // UNKNOWN
    for (const c of view.checks) {
      expect(['supports', 'weakens', 'monitor', 'insufficient']).toContain(c.status)
    }
  })

  it('carries sector relevance on its own axis, and never hides a row', () => {
    const notApplicable = view.checks.filter((c) => c.sector_relevance === 'not_applicable')
    expect(notApplicable).toHaveLength(1)
    expect(notApplicable[0].number).toBe(5) // Inventory, N/A for Microsoft
    expect(view.checks.every((c) => ['applies', 'not_applicable'].includes(c.sector_relevance))).toBe(true)
  })

  it('keeps jargon off the default label and parks it on technical_label', () => {
    const gross = view.checks.find((c) => c.number === 1)
    expect(gross.label).toBe('Keeps a healthy share of every sales dollar')
    expect(gross.label).not.toMatch(/margin|>|%/i)
    expect(gross.technical_label).toBe(results[0].checklist_text)
    expect(gross.technical_explanation).toContain('gross_profit_margin')
  })

  it('uses the engine plain-English line as the detail', () => {
    const gross = view.checks.find((c) => c.number === 1)
    expect(gross.detail).toBe(results[0].plain_english_explanation)
    expect(gross.detail).toContain('67.9%')
  })

  it('rewrites scientific notation out of beginner-facing text', () => {
    const ocf = view.checks.find((c) => c.number === 7)
    expect(ocf.detail).not.toMatch(/e\+\d/)
    expect(ocf.detail).toContain('$182.9B') // was "1.82935e+11 USD"
  })

  it('surfaces what is missing on an UNKNOWN row instead of going silent', () => {
    const diversity = view.checks.find((c) => c.number === 9)
    expect(diversity.status).toBe('insufficient')
    expect(diversity.missing_information.length).toBeGreaterThan(0)
  })
})

/* ── evidence ───────────────────────────────────────────────────────────────── */

describe('evidence', () => {
  it('attaches evidence in the contract shape where the engine has references', () => {
    const gross = view.checks.find((c) => c.number === 1)
    expect(gross.evidence).toMatchObject({
      filing_type: '10-K',
      fiscal_period: 'FY2026',
      filed_on: '2026-07-29',
      provenance: 'xbrl',
      section: null,
    })
    expect(gross.evidence.values_used).toHaveLength(2)
  })

  it('labels evidence rows from the XBRL concept and keeps the raw value', () => {
    const gross = view.checks.find((c) => c.number === 1)
    const [first] = gross.evidence.values_used
    expect(first.label).toBe('Gross profit')
    expect(first.value).toBe(225465000000)
    expect(first.unit).toBe('USD')
    expect(first.concept).toBe('us-gaap:GrossProfit')
  })

  it('links to the readable 10-K, never the raw companyfacts JSON', () => {
    for (const c of view.checks) {
      if (!c.evidence) continue
      expect(c.evidence.url).toBe(envelope.latest_filing.filing_url)
      expect(c.evidence.url).toContain('sec.gov/Archives')
      expect(c.evidence.url).not.toContain('data.sec.gov')
      // the raw feed stays available, but as secondary provenance only
      expect(c.evidence.data_url).toContain('data.sec.gov')
    }
  })

  it('returns null evidence — not an empty husk — where the engine has none', () => {
    const inventory = view.checks.find((c) => c.number === 5)
    expect(inventory.evidence).toBeNull()
  })

  it('flattens and de-duplicates every evidence reference by id', () => {
    expect(view.evidence.length).toBeGreaterThan(0)
    const ids = view.evidence.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(view.evidence[0]).toHaveProperty('concept')
    expect(view.evidence[0]).toHaveProperty('accessionNumber')
  })
})

/* ── evidence for the valuation inputs ──────────────────────────────────────── */

describe('the math: evidence on the inputs', () => {
  const ev = view.the_math.evidence
  const OCF = 'us-gaap:NetCashProvidedByUsedInOperatingActivities'
  const CAPEX = 'us-gaap:PaymentsToAcquirePropertyPlantAndEquipment'
  const concepts = (key) => ev[key].values_used.map((v) => v.concept)

  it('backs exactly the three inputs a filed figure can reconstruct', () => {
    expect(Object.keys(ev).sort()).toEqual(
      ['net_debt', 'shares_outstanding', 'starting_free_cash_flow'],
    )
  })

  it('cites no filing for the rates, which are sector priors and not reported', () => {
    // Present as keys on the_math, absent from evidence: the Why drawer shows the
    // row and no trigger. Inventing provenance for an assumption is the one thing
    // the audit surface must never do.
    expect(view.the_math.discount_rate_pct).not.toBeNull()
    expect(view.the_math.terminal_growth_pct).not.toBeNull()
    expect(ev.discount_rate_pct).toBeUndefined()
    expect(ev.terminal_growth_pct).toBeUndefined()
  })

  it('cites the two lines whose difference IS the starting free cash flow', () => {
    expect(concepts('starting_free_cash_flow')).toEqual([OCF, CAPEX])
    const [ocf, capex] = ev.starting_free_cash_flow.values_used
    expect(ocf.value - Math.abs(capex.value)).toBe(fv.inputs.starting_free_cash_flow)
  })

  it('cites the two lines whose difference IS net debt', () => {
    expect(concepts('net_debt')).toEqual([
      'us-gaap:LongTermDebt',
      'us-gaap:CashCashEquivalentsAndShortTermInvestments',
    ])
    const [debt, cash] = ev.net_debt.values_used
    expect(debt.value - cash.value).toBe(fv.inputs.net_debt)
  })

  it('cites the one line that IS the diluted share count, in shares not dollars', () => {
    const [shares] = ev.shares_outstanding.values_used
    expect(shares.concept).toBe('us-gaap:WeightedAverageNumberOfDilutedSharesOutstanding')
    expect(shares.value).toBe(fv.inputs.diluted_shares)
    // "shares", not "USD" — the drawer formats on this and would print "$7.5B".
    expect(shares.unit).toBe('shares')
  })

  it('takes every citation from the filing the valuation starts from', () => {
    for (const key of Object.keys(ev)) {
      expect(ev[key].filing_type).toBe('10-K')
      expect(ev[key].fiscal_period).toBe('FY2026')
      expect(ev[key].filed_on).toBe(envelope.latest_filing.filing_date)
      expect(ev[key].provenance).toBe('xbrl')
    }
  })

  it('links to the readable 10-K, never the raw companyfacts JSON', () => {
    for (const key of Object.keys(ev)) {
      expect(ev[key].url).toBe(envelope.latest_filing.filing_url)
      expect(ev[key].url).not.toContain('data.sec.gov')
      expect(ev[key].data_url).toContain('data.sec.gov')
    }
  })

  it('keeps the transformation string the engine recorded, verbatim', () => {
    const [ocf] = ev.starting_free_cash_flow.values_used
    expect(ocf.transformation).toContain('free_cash_flow = operating_cash_flow - abs(capital_expenditure)')
  })

  it('explains each figure in English without naming the XBRL tag', () => {
    expect(ev.starting_free_cash_flow.values_used[0].label).toBe('Cash from operations')
    expect(ev.starting_free_cash_flow.calculation).toMatch(/property and equipment/)
    expect(ev.net_debt.calculation).toMatch(/more than it owes/)
  })

  /* Refuse rather than guess (non-negotiable #3), at the level of provenance. */

  it('drops a field whose input no reference reproduces', () => {
    const bent = structuredClone(envelope)
    bent.analysis.final_valuation.inputs.net_debt = -1234
    const ev2 = toView(bent).the_math.evidence
    expect(ev2.net_debt).toBeUndefined()
    // the fields that still reconcile are unaffected
    expect(ev2.starting_free_cash_flow).toBeDefined()
  })

  it('drops a field two different references could equally explain', () => {
    const bent = structuredClone(envelope)
    const refs = bent.analysis.deterministic_baseline.traces[0].evidence_references
    const shares = refs.find((r) => r.xbrl_concept.includes('DilutedShares'))
    refs.push({ ...shares, evidence_id: 'sec_duplicate_but_distinct' })
    const ev2 = toView(bent).the_math.evidence
    expect(ev2.shares_outstanding).toBeUndefined()
  })

  it('is an empty object, never null, when the envelope carries no traces', () => {
    const bent = structuredClone(envelope)
    bent.analysis.deterministic_baseline.traces = []
    expect(toView(bent).the_math.evidence).toEqual({})
  })
})

/* ── the math ───────────────────────────────────────────────────────────────── */

describe('the math', () => {
  it('maps the DCF inputs off final_valuation', () => {
    expect(view.the_math.starting_free_cash_flow).toBe(fv.inputs.starting_free_cash_flow)
    expect(view.the_math.net_debt).toBe(fv.inputs.net_debt)
    expect(view.the_math.shares_outstanding).toBe(fv.inputs.diluted_shares)
  })

  it('converts decimal-fraction rates to percentages', () => {
    const a = fv.assumptions
    expect(view.the_math.stage_1.growth_pct).toBeCloseTo(a.stage_one_growth_rate * 100, 9)
    expect(view.the_math.stage_1.growth_pct).toBeCloseTo(9.72, 2)
    expect(view.the_math.stage_2.growth_pct).toBeCloseTo(a.stage_two_growth_rate * 100, 9)
    expect(view.the_math.terminal_growth_pct).toBeCloseTo(3.0, 6)
    expect(view.the_math.discount_rate_pct).toBeCloseTo(11.52, 2)
  })

  it('maps stage lengths', () => {
    expect(view.the_math.stage_1.years).toBe(5)
    expect(view.the_math.stage_2.years).toBe(5)
  })

  it('maps terminal value concentration to terminal_value_pct', () => {
    expect(view.the_math.terminal_value_pct).toBeCloseTo(fv.terminal_value.concentration * 100, 9)
    expect(view.the_math.terminal_value_pct).toBeCloseTo(49.5, 1)
  })

  it('builds scenarios off the sensitivity interval, not off invented numbers', () => {
    const [pess, real, opt] = view.the_math.scenarios
    expect(pess.value_per_share).toBe(si.lower_bound_per_share)
    expect(real.value_per_share).toBe(fv.intrinsic_value_per_share)
    expect(opt.value_per_share).toBe(si.upper_bound_per_share)
    // growth is the central rate ∓ the interval's own documented delta
    const delta = si.growth_rate_delta * 100
    expect(real.growth_pct - pess.growth_pct).toBeCloseTo(delta, 9)
    expect(opt.growth_pct - real.growth_pct).toBeCloseTo(delta, 9)
  })

  it('carries engine warnings rather than swallowing them', () => {
    expect(view.the_math.warnings).toContain('unstable_historical_free_cash_flow')
  })
})

/* ── business quality: the axis that survives a missing price ────────────────── */

describe('business quality', () => {
  it('resolves for MSFT even though there is no price', () => {
    expect(view.verdict.business_quality).toBe('strong') // 7 supports of 9 applicable
    expect(['strong', 'weak', 'uncertain', 'insufficient']).toContain(view.verdict.business_quality)
  })

  it('ignores not-applicable rows when judging quality', () => {
    const onlyNa = [{ status: 'NOT_APPLICABLE' }, { status: 'NOT_APPLICABLE' }]
    expect(businessQuality(onlyNa)).toBe('insufficient')
  })

  it('reads weak when the checklist mostly weakens', () => {
    const mostlyWeak = [
      { status: 'WEAKENS' }, { status: 'WEAKENS' }, { status: 'WEAKENS' },
      { status: 'WEAKENS' }, { status: 'SUPPORTS' },
    ]
    expect(businessQuality(mostlyWeak)).toBe('weak')
  })

  it('reads insufficient when most applicable rows are unknown', () => {
    const mostlyUnknown = [
      { status: 'UNKNOWN' }, { status: 'UNKNOWN' }, { status: 'UNKNOWN' }, { status: 'SUPPORTS' },
    ]
    expect(businessQuality(mostlyUnknown)).toBe('insufficient')
  })

  it('handles an empty or missing checklist', () => {
    expect(businessQuality([])).toBe('insufficient')
    expect(businessQuality(undefined)).toBe('insufficient')
  })
})

/* ── plain english ──────────────────────────────────────────────────────────── */

describe('plain english cards', () => {
  it('produces cards even though the AI narrative is unavailable', () => {
    expect(view.plain_english.length).toBeGreaterThan(0)
    expect(view.plain_english.length).toBeLessThanOrEqual(3)
  })

  it('marks them deterministic, so the UI can say where they came from', () => {
    for (const card of view.plain_english) {
      expect(card.source).toBe('deterministic')
    }
  })

  it('carries a contract-legal sentiment and a plain title', () => {
    for (const card of view.plain_english) {
      expect(['positive', 'neutral', 'negative']).toContain(card.sentiment)
      expect(card.title).toBeTruthy()
      expect(card.body).toBeTruthy()
    }
  })

  it('never builds a card from a not-applicable or unknown row', () => {
    const titles = view.plain_english.map((c) => c.title)
    expect(titles).not.toContain('Manages the stock it holds')
    expect(titles).not.toContain('Sticks to a business you can explain')
  })
})

/* ── AI status ──────────────────────────────────────────────────────────────── */

describe('AI status', () => {
  it('reports the fallback that is the current production state', () => {
    expect(view.aiStatus).toBe(AI_FALLBACK)
    expect(view.aiFallbackReason).toBe('provider_failure')
  })

  it('stays a string, so useAnalysis\'s ?status= override still works', () => {
    expect(typeof view.aiStatus).toBe('string')
  })

  it('carries the engine explanation of what was skipped', () => {
    expect(view.aiDisagreement).toContain('AI qualitative analysis was not applied')
  })

  it('reports OK when the AI path succeeded', () => {
    const ok = toView({ ...envelope, analysis: { ...envelope.analysis, status: 'AI_ADJUSTED', fallback_reason: null } })
    expect(ok.aiStatus).toBe('OK')
    expect(ok.aiFallbackReason).toBeNull()
  })
})

/* ── historical growth ──────────────────────────────────────────────────────── */

describe('historicalGrowthPct', () => {
  it('computes a CAGR across the filed history', () => {
    const xs = fv.inputs.historical_free_cash_flows
    const expected = ((xs.at(-1) / xs[0]) ** (1 / (xs.length - 1)) - 1) * 100
    expect(view.what_has_to_be_true.historical_growth_pct).toBeCloseTo(expected, 9)
  })

  it('refuses a CAGR across a sign change rather than returning a fake one', () => {
    expect(historicalGrowthPct([-100, 50])).toBeNull()
    expect(historicalGrowthPct([100, -50])).toBeNull()
  })

  it('refuses on too little data', () => {
    expect(historicalGrowthPct([100])).toBeNull()
    expect(historicalGrowthPct([])).toBeNull()
    expect(historicalGrowthPct(undefined)).toBeNull()
  })
})

/* ── the cannot-value path ──────────────────────────────────────────────────── */

describe('cannot-value shape', () => {
  // The live 404 body, captured 2026-08-30 from GET /api/analyze/ZZZZ
  const notFound = {
    error: {
      code: 'unsupported_ticker',
      message: 'Ticker ZZZZ is not present in the SEC company mapping',
      request_id: '887e88aa14074333bd562431c6741f09',
    },
  }
  // The 422 body shape, per app/main.py _service_error_status + errors.py
  const missingData = {
    error: {
      code: 'missing_sec_data',
      message: 'missing_sec_data: cash_and_short_term_investments',
      request_id: 'abc123',
    },
  }

  it('turns a 404 error body into the cannot-value shape', () => {
    const v = toView(notFound)
    expect(v.verdict.label).toBe('CANNOT_VALUE')
    expect(v.verdict.combination).toBe('Insufficient evidence')
    expect(v.canValue).toBe(false)
    expect(v.errorCode).toBe('unsupported_ticker')
    expect(v.requestId).toBe(notFound.error.request_id)
  })

  it('turns a 422 error body into the cannot-value shape', () => {
    const v = toView(missingData)
    expect(v.verdict.label).toBe('CANNOT_VALUE')
    expect(v.errorCode).toBe('missing_sec_data')
    expect(v.verdict.detail).toContain('cash_and_short_term_investments')
  })

  it('nulls the whole range, and never zeroes it', () => {
    const v = toView(missingData)
    expect(v.price).toMatchObject({
      current: null, fair_value_low: null, fair_value_mid: null, fair_value_high: null,
    })
    expect(v.value).toEqual({ low: null, mid: null, high: null })
  })

  it('matches the docs/API.md cannot-value payload for the nullable sections', () => {
    const v = toView(missingData)
    expect(v.what_has_to_be_true).toBeNull()
    expect(v.the_math).toBeNull()
    expect(v.falsifiers).toEqual([])
    expect(v.checks).toEqual([])
    expect(v.plain_english).toEqual([])
    expect(v.verdict.business_quality).toBe('insufficient')
    expect(v.verdict.confidence).toBe('low')
  })

  it('treats a 200 with no valuation as a refusal, not a crash', () => {
    const v = toView({ ...envelope, analysis: { ...envelope.analysis, final_valuation: null } })
    expect(v.verdict.label).toBe('CANNOT_VALUE')
    expect(v.errorCode).toBe('calculation_error')
    // identity survives, so the screen can still name the company
    expect(v.companyName).toBe('MICROSOFT CORP')
    expect(v.filing.form).toBe('10-K')
  })

  it('never throws on junk input', () => {
    for (const junk of [null, undefined, 'nope', 42, []]) {
      expect(() => toView(junk)).not.toThrow()
      expect(toView(junk).verdict.label).toBe('CANNOT_VALUE')
    }
  })

  it('is directly constructible for a synthetic refusal', () => {
    expect(toCannotValue().verdict.label).toBe('CANNOT_VALUE')
  })
})

/* ── the whole object ───────────────────────────────────────────────────────── */

describe('completeness', () => {
  it('returns every key the docs/API.md v2 contract names', () => {
    for (const k of [
      'ticker', 'company_name', 'currency', 'as_of', 'verdict', 'price',
      'plain_english', 'what_has_to_be_true', 'falsifiers', 'the_math', 'checks', 'sources',
    ]) {
      expect(view).toHaveProperty(k)
    }
  })

  it('returns every key the 1A.2 mapping names', () => {
    for (const k of [
      'companyName', 'ticker', 'retrievedAt', 'filing', 'value', 'confidence',
      'checks', 'evidence', 'aiStatus',
    ]) {
      expect(view).toHaveProperty(k)
    }
  })

  it('leaves no field undefined — missing is null, never absent', () => {
    const walk = (o, path = '') => {
      for (const [k, v] of Object.entries(o ?? {})) {
        expect(v, `${path}${k} is undefined`).not.toBeUndefined()
        if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, `${path}${k}.`)
      }
    }
    walk(view)
  })

  it('makes no claim about the price anywhere in the object', () => {
    const json = JSON.stringify(view)
    expect(json).not.toContain('"current":0')
    expect(json).toContain(`"${NO_PRICE}"`)
  })
})

/* ── the market price and the plausibility gate (docs/API.md v3) ─────────────── */

/* The two keys that close D-017. These build on the same msft-live envelope, so
 * everything asserted above still holds around them and only the price-dependent
 * half changes.
 *
 * MSFT's own numbers, which the fixtures below are chosen against:
 *   low 127.30 · mid 159.66 · high 212.20
 */
const IN_RANGE = 165
const ABOVE_RANGE = 260
const BELOW_RANGE = 100

const quoteOf = (price) => ({
  symbol: 'MSFT',
  price,
  currency: 'USD',
  quoted_at: '2026-08-28T20:00:00Z',
  retrieved_at: '2026-08-30T14:07:11Z',
  source: 'Yahoo Finance',
  source_url: 'https://finance.yahoo.com/quote/MSFT',
  exchange_name: 'NasdaqGS',
})

/** An envelope with a price and a gate on it. Everything else is the live capture. */
function priced(price, plausibility, marketOverrides = {}) {
  return {
    ...envelope,
    market_price: {
      status: 'AVAILABLE',
      quote: quoteOf(price),
      unavailable_reason: null,
      message: null,
      ...marketOverrides,
    },
    plausibility,
  }
}

const SOUND = {
  level: 'SOUND',
  can_state_verdict: true,
  reasons: [],
  price_to_midpoint_ratio: 1.033,
  price_position: 'in_range',
  summary: 'The price sits inside our estimated range and nothing in the analysis looks out of place.',
}

const UNRELIABLE = {
  level: 'UNRELIABLE',
  can_state_verdict: false,
  reasons: [
    {
      signal: 'price_to_midpoint_ratio_extreme',
      severity: 'DISQUALIFYING',
      explanation:
        "Today's price is more than nine times our estimate. A gap that large usually means our estimate is wrong, not that the market is.",
    },
  ],
  price_to_midpoint_ratio: 9.31,
  price_position: 'above_range',
  summary: 'Our estimate is too far from the market price for us to call this one.',
}

describe('a price, and the gate open', () => {
  const v = toView(priced(IN_RANGE, SOUND))

  it('carries the quoted price through, and nothing else', () => {
    expect(v.price.current).toBe(IN_RANGE)
    expect(v.priceAvailable).toBe(true)
    expect(v.price.unavailable_reason).toBeNull()
    expect(v.price.quote.source).toBe('Yahoo Finance')
    // Two different facts, both required: a Friday quote fetched on Sunday is
    // stale, and only the pair says so.
    expect(v.price.quote.quotedAt).toBe('2026-08-28T20:00:00Z')
    expect(v.price.quote.retrievedAt).toBe('2026-08-30T14:07:11Z')
  })

  it('says the verdict word — the state this codebase has never rendered live', () => {
    expect(v.verdict.label).toBe('FAIRLY_PRICED')
    expect(v.verdict.unavailable_reason).toBeNull()
    expect(v.canStateVerdict).toBe(true)
  })

  it('computes the margin of safety, (mid − current) / current × 100', () => {
    const expected = ((fv.intrinsic_value_per_share - IN_RANGE) / IN_RANGE) * 100
    expect(v.verdict.margin_of_safety_pct).toBeCloseTo(expected, 9)
    // MSFT's mid is below 165, so the estimate is the cheaper side: negative.
    expect(v.verdict.margin_of_safety_pct).toBeLessThan(0)
  })

  it('names the quote provider in the sources, now that there is one to name', () => {
    expect(v.sources.some((x) => x.label.includes('Yahoo Finance'))).toBe(true)
    // …and does not, on the response that has no quote.
    expect(view.sources.some((x) => x.label.includes('Yahoo Finance'))).toBe(false)
  })

  it('reads the backend price_position for WHICH word', () => {
    for (const [position, word] of [
      ['below_range', 'UNDERVALUED'],
      ['in_range', 'FAIRLY_PRICED'],
      ['above_range', 'OVERVALUED'],
    ]) {
      const out = toView(priced(IN_RANGE, { ...SOUND, price_position: position }))
      expect(out.verdict.label).toBe(word)
    }
  })

  it('falls back to the range comparison price_position is defined as', () => {
    const noPosition = { ...SOUND, price_position: null }
    expect(toView(priced(BELOW_RANGE, noPosition)).verdict.label).toBe('UNDERVALUED')
    expect(toView(priced(IN_RANGE, noPosition)).verdict.label).toBe('FAIRLY_PRICED')
    expect(toView(priced(ABOVE_RANGE, noPosition)).verdict.label).toBe('OVERVALUED')
  })

  it('carries the plausibility summary and reasons across verbatim', () => {
    const qualified = {
      ...SOUND,
      level: 'QUALIFIED',
      reasons: [
        { signal: 'unstable_historical_free_cash_flow', severity: 'QUALIFYING', explanation: 'First.' },
        { signal: 'high_terminal_concentration', severity: 'QUALIFYING', explanation: 'Second.' },
      ],
      summary: 'We can still give an answer, but two things make this shakier than usual.',
    }
    const out = toView(priced(IN_RANGE, qualified))
    expect(out.verdict.label).toBe('FAIRLY_PRICED')
    expect(out.plausibility.level).toBe('QUALIFIED')
    expect(out.plausibility.summary).toBe(qualified.summary)
    // Order preserved — the backend sends them most severe first.
    expect(out.plausibility.reasons.map((r) => r.explanation)).toEqual(['First.', 'Second.'])
  })

  it('stops claiming the price is missing everywhere else on the object', () => {
    expect(v.what_has_to_be_true.unavailable_reason).toBe(IMPLIED_GROWTH_UNSOLVED)
    expect(v.what_has_to_be_true.summary).not.toMatch(/share price/i)
    // Still not solved here — that is the backend's engine run backwards.
    expect(v.what_has_to_be_true.implied_growth_pct).toBeNull()
    expect(JSON.stringify(v)).not.toContain(`"${NO_PRICE}"`)
  })
})

describe('a price, and the gate closed', () => {
  const v = toView(priced(ABOVE_RANGE, UNRELIABLE))

  it('still shows the price', () => {
    expect(v.price.current).toBe(ABOVE_RANGE)
    expect(v.priceAvailable).toBe(true)
    expect(v.price.unavailable_reason).toBeNull()
  })

  it('still draws the range', () => {
    expect(v.price.fair_value_low).toBe(si.lower_bound_per_share)
    expect(v.price.fair_value_mid).toBe(fv.intrinsic_value_per_share)
    expect(v.price.fair_value_high).toBe(si.upper_bound_per_share)
    expect(v.value).toEqual({
      low: si.lower_bound_per_share,
      mid: fv.intrinsic_value_per_share,
      high: si.upper_bound_per_share,
    })
  })

  it('withholds the word, and says which of the two silences this is', () => {
    expect(v.verdict.label).toBeNull()
    expect(v.verdict.unavailable_reason).toBe(VERDICT_WITHHELD)
    expect(v.verdict.unavailable_reason).not.toBe(NO_PRICE)
    expect(v.canStateVerdict).toBe(false)
  })

  it('withholds the margin of safety with it — the same verdict said in numbers', () => {
    expect(v.verdict.margin_of_safety_pct).toBeNull()
  })

  it('flags the bar so the zone words cannot state the verdict in a picture', () => {
    expect(v.price.verdict_withheld).toBe(true)
    expect(toView(priced(IN_RANGE, SOUND)).price.verdict_withheld).toBe(false)
    expect(view.price.verdict_withheld).toBe(false)
  })

  it("surfaces the backend's sentences rather than inventing its own", () => {
    expect(v.plausibility.summary).toBe(UNRELIABLE.summary)
    expect(v.plausibility.reasons[0].explanation).toBe(UNRELIABLE.reasons[0].explanation)
    expect(v.plausibility.reasons[0].severity).toBe('DISQUALIFYING')
    expect(v.verdict.headline).toBe(UNRELIABLE.summary)
  })

  it('keeps everything the gap never touched', () => {
    expect(v.canValue).toBe(true)
    expect(v.verdict.business_quality).toBe(view.verdict.business_quality)
    expect(v.the_math.discount_rate_pct).toBe(view.the_math.discount_rate_pct)
    expect(v.checks).toHaveLength(view.checks.length)
  })
})

describe('the gate is obeyed, never recomputed', () => {
  /* The whole point of D-027: the thresholds live in the backend so they cannot
     drift into two languages, and so a refusal cannot be bypassed by pointing a
     different client at the API. */
  it('says no word when can_state_verdict is false and NOTHING ELSE looks wrong', () => {
    const looksFine = {
      level: 'SOUND',
      can_state_verdict: false,
      reasons: [],
      price_to_midpoint_ratio: 1.033,
      price_position: 'in_range',
      summary: 'No verdict this time.',
    }
    const v = toView(priced(IN_RANGE, looksFine))
    expect(v.verdict.label).toBeNull()
    expect(v.verdict.margin_of_safety_pct).toBeNull()
    expect(v.verdict.unavailable_reason).toBe(VERDICT_WITHHELD)
    // and the price is on the screen regardless
    expect(v.price.current).toBe(IN_RANGE)
  })

  it('does not read final_valuation.warnings to second-guess an open gate', () => {
    // The live capture already carries one: "unstable_historical_free_cash_flow".
    expect(fv.warnings.length).toBeGreaterThan(0)
    expect(toView(priced(IN_RANGE, SOUND)).verdict.label).toBe('FAIRLY_PRICED')
  })

  it('treats anything but a literal true as a closed gate', () => {
    for (const value of [false, null, undefined, 'true', 1, {}]) {
      const v = toView(priced(IN_RANGE, { ...SOUND, can_state_verdict: value }))
      expect(v.verdict.label, `can_state_verdict: ${JSON.stringify(value)}`).toBeNull()
      expect(v.canStateVerdict).toBe(false)
    }
  })

  it('withholds the word when plausibility is missing entirely', () => {
    const v = toView({ ...envelope, market_price: { status: 'AVAILABLE', quote: quoteOf(IN_RANGE) } })
    expect(v.verdict.label).toBeNull()
    expect(v.verdict.unavailable_reason).toBe(VERDICT_WITHHELD)
    expect(v.plausibility.stated).toBe(false)
    // The price is still real, and still shown.
    expect(v.price.current).toBe(IN_RANGE)
  })
})

describe('no price: UNAVAILABLE and a missing key degrade identically (invariant 1)', () => {
  const REASONS = [
    'quote_provider_disabled',
    'quote_symbol_not_found',
    'quote_provider_rate_limited',
    'quote_provider_timeout',
    'quote_provider_unavailable',
    'quote_provider_invalid_response',
  ]

  const priceFields = (v) => ({
    current: v.price.current,
    priceReason: v.price.unavailable_reason,
    withheld: v.price.verdict_withheld,
    label: v.verdict.label,
    verdictReason: v.verdict.unavailable_reason,
    mos: v.verdict.margin_of_safety_pct,
    implied: v.what_has_to_be_true.implied_growth_pct,
    impliedReason: v.what_has_to_be_true.unavailable_reason,
    priceAvailable: v.priceAvailable,
    canStateVerdict: v.canStateVerdict,
  })

  it('reads every named reason as no price at all', () => {
    for (const reason of REASONS) {
      const v = toView({
        ...envelope,
        market_price: { status: 'UNAVAILABLE', quote: null, unavailable_reason: reason, message: 'No price.' },
        plausibility: { ...UNRELIABLE, price_to_midpoint_ratio: null, price_position: null },
      })
      expect(priceFields(v), reason).toEqual(priceFields(view))
    }
  })

  it("surfaces the backend's own sentence for why there is none", () => {
    const v = toView({
      ...envelope,
      market_price: {
        status: 'UNAVAILABLE',
        quote: null,
        unavailable_reason: 'quote_provider_timeout',
        message: "The price service didn't answer in time.",
      },
    })
    expect(v.price.unavailable_message).toBe("The price service didn't answer in time.")
    expect(v.price.quote).toBeNull()
  })
})

describe('never a price we do not have (invariant 8)', () => {
  const MALFORMED = [
    ['a zero price', { status: 'AVAILABLE', quote: quoteOf(0) }],
    ['a negative price', { status: 'AVAILABLE', quote: quoteOf(-42) }],
    ['a price sent as a string', { status: 'AVAILABLE', quote: quoteOf('178.20') }],
    ['a NaN price', { status: 'AVAILABLE', quote: quoteOf(Number.NaN) }],
    ['AVAILABLE with no quote', { status: 'AVAILABLE', quote: null }],
    ['a quote with no price field', { status: 'AVAILABLE', quote: { symbol: 'MSFT' } }],
    ['UNAVAILABLE carrying a quote anyway', { status: 'UNAVAILABLE', quote: quoteOf(178.2) }],
    ['a status we do not know', { status: 'PENDING', quote: quoteOf(178.2) }],
    ['a null market_price', null],
    ['a market_price that is a string', 'AVAILABLE'],
  ]

  it.each(MALFORMED)('reads %s as no price, never as a number', (_name, market_price) => {
    const v = toView({ ...envelope, market_price, plausibility: SOUND })
    expect(v.price.current).toBeNull()
    expect(v.price.current).not.toBe(0)
    expect(v.priceAvailable).toBe(false)
    expect(v.price.unavailable_reason).toBe(NO_PRICE)
    // No price means no word, whatever the gate said — invariant 4 from our side.
    expect(v.verdict.label).toBeNull()
    expect(v.verdict.margin_of_safety_pct).toBeNull()
    expect(v.canStateVerdict).toBe(false)
  })

  it('never emits a zero where a price would sit, in any of the three states', () => {
    const states = [
      view,
      toView(priced(IN_RANGE, SOUND)),
      toView(priced(ABOVE_RANGE, UNRELIABLE)),
      toView({ ...envelope, market_price: { status: 'UNAVAILABLE', quote: null, unavailable_reason: 'quote_provider_disabled', message: null } }),
    ]
    for (const v of states) {
      expect(v.price.current === null || v.price.current > 0).toBe(true)
      expect(JSON.stringify(v)).not.toContain('"current":0')
      for (const n of [v.verdict.margin_of_safety_pct, v.what_has_to_be_true.implied_growth_pct]) {
        expect(n === null || n !== 0).toBe(true)
      }
    }
  })
})

describe('cannot value, with a price in hand', () => {
  const noValuation = {
    ...envelope,
    analysis: { ...envelope.analysis, final_valuation: null },
    market_price: { status: 'AVAILABLE', quote: quoteOf(178.2), unavailable_reason: null, message: null },
    plausibility: {
      level: 'UNRELIABLE',
      can_state_verdict: false,
      reasons: [
        {
          signal: 'no_valuation_produced',
          severity: 'DISQUALIFYING',
          explanation: "This company doesn't produce the spare cash our method needs.",
        },
      ],
      price_to_midpoint_ratio: null,
      price_position: null,
      summary: "We can't value this company reliably, so we won't say whether it's cheap or expensive.",
    },
  }

  it('refuses the valuation without also hiding the price', () => {
    const v = toView(noValuation)
    expect(v.verdict.label).toBe('CANNOT_VALUE')
    expect(v.canValue).toBe(false)
    expect(v.price.current).toBe(178.2)
    expect(v.priceAvailable).toBe(true)
    expect(v.price.unavailable_reason).toBeNull()
  })

  it('has no range to compare it against, and states no margin', () => {
    const v = toView(noValuation)
    expect(v.price).toMatchObject({ fair_value_low: null, fair_value_mid: null, fair_value_high: null })
    expect(v.verdict.margin_of_safety_pct).toBeNull()
    expect(v.canStateVerdict).toBe(false)
    expect(v.price.verdict_withheld).toBe(false)
  })

  it('keeps the price null on an error body, which carries no quote', () => {
    const v = toView({ error: { code: 'unsupported_ticker', message: 'No filings', request_id: 'r1' } })
    expect(v.price.current).toBeNull()
    expect(v.price.unavailable_reason).toBe(NO_PRICE)
    expect(v.priceAvailable).toBe(false)
  })
})
