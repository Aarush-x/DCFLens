/* The seam.
 *
 * The frontend is designed against docs/API.md (see src/mocks/aapl.json — that file
 * IS the contract). The API returns the FastAPI `AnalysisEnvelope`, which is a
 * different, deeper, snake_case shape (see src/mocks/msft-live.json — a byte-for-byte
 * capture of GET /api/analyze/MSFT on 2026-08-30).
 *
 * toView(envelope) is the ONLY place those two shapes meet. No component may read
 * the raw envelope. If a number is wrong on screen, it is wrong here.
 *
 * ── What toView returns ───────────────────────────────────────────────────────
 * The docs/API.md object the 1B components already read (`verdict`, `price`,
 * `plain_english`, `the_math`, `checks`, `sources`), PLUS the named fields the 1A.2
 * spec lists ("map at minimum"): companyName, retrievedAt, filing.*, value.*,
 * confidence.*, evidence, aiStatus. Both surfaces describe the same data; the
 * camelCase half is the spec's vocabulary, the snake_case half is what the
 * components were built against. Neither is derived at render time.
 *
 * ── The price, and the gate on the verdict (docs/API.md v3) ───────────────────
 * The envelope carries two v3 keys — `market_price` and `plausibility` — and
 * between them they settle everything on this screen that is defined as price
 * against value. THREE STATES, three different things to say:
 *
 *   1. PRICE PRESENT, GATE OPEN  — `market_price.status` is AVAILABLE and
 *      `plausibility.can_state_verdict` is true.
 *      The full designed verdict. `price.current` is the quoted price,
 *      `verdict.label` is one of the three words, `margin_of_safety_pct` is
 *      computed against it at last, and nothing carries an unavailable_reason.
 *
 *   2. PRICE PRESENT, GATE CLOSED — `can_state_verdict` is false.
 *      The price is real and renders; so does the range. THE WORD DOES NOT.
 *      `verdict.label` is null and stamped `VERDICT_WITHHELD`, and the margin of
 *      safety goes with it — a signed percentage against a price we have just said
 *      we will not rank is the same verdict said in numbers. `plausibility.summary`
 *      and `reasons[].explanation` are the backend's own beginner-readable
 *      sentences and are carried across verbatim, so the screen explains the
 *      refusal in the words the gate was written in rather than inventing its own.
 *
 *   3. PRICE ABSENT — `status: "UNAVAILABLE"`, or the key missing altogether.
 *      Invariant 1 says those two degrade IDENTICALLY, which is what let this
 *      adapter ship before the quote provider did. `price.current` is null and
 *      never 0, and every field *defined* as price-vs-value is null with it:
 *        - verdict.label            (a word is a comparison; one side is missing)
 *        - verdict.combination      (five of its six legal strings judge a price)
 *        - margin_of_safety_pct     ((mid − current) / current)
 *        - implied_growth_pct       (solved against the price)
 *      Each carries `unavailable_reason: NO_PRICE` so the UI can state the gap
 *      rather than render an em dash and leave the user guessing.
 *
 * THE GATE IS NEVER RE-DERIVED HERE. `can_state_verdict` is read and obeyed. No
 * threshold is copied, no ratio recomputed, and `final_valuation.warnings` is never
 * consulted to second-guess it. The thresholds live in the backend (D-027) so they
 * cannot drift into two languages, and so a refusal cannot be bypassed by pointing
 * a different client at the API. `level`, `price_to_midpoint_ratio`,
 * `price_position` and `reasons[]` come across for EXPLAINING the gate to a reader,
 * never for computing it. The one thing this file derives from position is *which*
 * of the three words to use once the gate has already opened — and even that reads
 * the backend's `price_position` first.
 *
 * Invariant 8, and the oldest rule in this codebase: never invent a price. Not 0,
 * not the range midpoint, not a stale quote wearing today's date.
 *
 * What survives all three states is real and renders regardless: the valuation
 * range, the checklist, the math, the filing provenance, and
 * `verdict.business_quality` — which docs/API.md defines as "the quality axis,
 * independent of price".
 */

import { readsAsEnglish } from './plain.js'

/** Why a price-dependent field is null. Three different facts, never blended:
 *  "we have no price", "we have a price and will not rank it", and "we have a
 *  price but do not solve this particular number from it" are three different
 *  things to tell a beginner, and the middle one is the hardest. */
import { toAnnualReport } from './annualReport.js'

export const NO_PRICE = 'no_market_price'
export const VERDICT_WITHHELD = 'verdict_withheld'
export const IMPLIED_GROWTH_UNSOLVED = 'implied_growth_not_solved'

/** aiStatus values. A string, not an object, so useAnalysis's `?status=` URL
 *  override (`params.status || data.aiStatus`) keeps working unchanged. The
 *  machine-readable reason rides alongside on `aiFallbackReason`. */
export const AI_OK = 'OK'
export const AI_FALLBACK = 'DETERMINISTIC_FALLBACK'

/* ── primitives ─────────────────────────────────────────────────────────────── */

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v) => (typeof v === 'string' && v.trim() ? v : null)
const arr = (v) => (Array.isArray(v) ? v : [])

/** Envelope rates are decimal fractions (`units.rates: "decimal_fraction"`).
 *  The view layer is percent. 0.0972… -> 9.72… */
const toPct = (v) => (num(v) === null ? null : v * 100)

/** "2026-08-29T20:38:50.492382Z" -> "2026-08-29". Never throws on junk. */
const dateOnly = (v) => (str(v) ? v.slice(0, 10) : null)

/** "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax" -> "Revenue from
 *  contract with customer excluding assessed tax". Used for evidence row labels. */
function humanizeConcept(concept) {
  const bare = str(concept)?.split(':').pop()
  if (!bare) return null
  const words = bare.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** "net_debt_to_fcf" -> "Net debt to fcf" */
function humanizeMetric(name) {
  const s = str(name)
  if (!s) return null
  const words = s.replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** The deterministic checklist writes raw floats into its own prose, e.g.
 *  "cash flow from operations is 1.82935e+11 USD". Scientific notation on a screen
 *  aimed at beginners is not acceptable, and this is display text, not a figure we
 *  compute with — so it is rewritten in place. Narrow on purpose: only an
 *  exponent-form number, only when followed by an explicit USD. */
function tidyExponents(text) {
  const s = str(text)
  if (!s) return s
  return s.replace(/(\d+(?:\.\d+)?)e([+-]\d+)(\s*USD)/gi, (match, mant, exp) => {
    const value = Number(`${mant}e${exp}`)
    if (!Number.isFinite(value)) return match
    const abs = Math.abs(value)
    const sign = value < 0 ? '−' : ''
    for (const [size, suffix] of [[1e12, 'T'], [1e9, 'B'], [1e6, 'M']]) {
      if (abs >= size) return `${sign}$${(abs / size).toFixed(1)}${suffix}`
    }
    return `${sign}$${Math.round(abs).toLocaleString('en-US')}`
  })
}

/* ── checklist ──────────────────────────────────────────────────────────────── */

/* docs/API.md checks[].status is lowercase and four-valued. The engine
 * (app/checklist/models.py ChecklistStatus) is five-valued and uppercase.
 * NOT_APPLICABLE collapses into `insufficient` because the contract carries
 * relevance on its own axis, `sector_relevance`. */
const CHECK_STATUS = {
  SUPPORTS: 'supports',
  WEAKENS: 'weakens',
  MONITOR: 'monitor',
  UNKNOWN: 'insufficient',
  NOT_APPLICABLE: 'insufficient',
}

/* Product non-negotiable #1: no jargon on the default screen. The engine's
 * `checklist_text` is the analyst's wording ("Gross Profit Margin > 20%: Higher the
 * margin, higher is the evidence of a sustainable moat"). docs/API.md's own example
 * labels are plain English ("Keeps a healthy share of every sales dollar"), so the
 * ten fixed checklist items get plain labels here. The original wording is preserved
 * on `technical_label` for the Why drawer, where jargon is allowed. */
const PLAIN_LABELS = {
  1: 'Keeps a healthy share of every sales dollar',
  2: 'Sales growth and profit growth move together',
  3: 'Per-share earnings keep up with total profits',
  4: "Doesn't lean too hard on borrowed money",
  5: 'Manages the stock it holds',
  6: 'Sales turn into cash it actually collects',
  7: 'The core business brings in cash',
  8: 'Puts shareholder money to good use',
  9: 'Sticks to a business you can explain',
  10: "Isn't a maze of subsidiaries",
}

/** Falls back to the text before the first colon when the number is unrecognised,
 *  so a checklist that grows past ten still renders something sane. */
function checkLabel(result) {
  const plain = PLAIN_LABELS[result?.checklist_number]
  if (plain) return plain
  const text = str(result?.checklist_text)
  if (!text) return 'Check'
  return text.split(':')[0].trim()
}

/* ── evidence ───────────────────────────────────────────────────────────────── */

/** "FY" + report_date 2026-06-30 -> "FY2026". The envelope's evidence
 *  `fiscal_period` is the bare period type; the year comes off the filing. */
function fiscalPeriod(filing, ref) {
  const year = dateOnly(filing?.report_date)?.slice(0, 4)
  const period = str(ref?.fiscal_period) || 'FY'
  if (!year) return period === 'FY' ? null : period
  return period === 'FY' ? `FY${year}` : `${period} ${year}`
}

/* The tags the Why drawer's rows resolve to. `humanizeConcept` renders
 * NetCashProvidedByUsedInOperatingActivities as "Net cash provided by used in
 * operating activities" — the tag's own broken grammar, faithfully preserved. The
 * drawer no longer prints the raw tag under the row, so this label is the only name
 * the figure gets: every concept that reaches a drawer in the ordinary path belongs
 * in this table. One that doesn't falls back to the humanised tag — clumsy, but
 * still English. */
const CONCEPT_LABELS = {
  'us-gaap:NetCashProvidedByUsedInOperatingActivities': 'Cash from operations',
  'us-gaap:PaymentsToAcquirePropertyPlantAndEquipment': 'Spent on property and equipment',
  'us-gaap:PaymentsToAcquireProductiveAssets': 'Spent on long-lived assets',
  'us-gaap:LongTermDebt': 'Long-term debt',
  'us-gaap:LongTermDebtNoncurrent': 'Long-term debt',
  'us-gaap:CashCashEquivalentsAndShortTermInvestments': 'Cash and short-term investments',
  'us-gaap:CashAndCashEquivalentsAtCarryingValue': 'Cash on hand',
  'us-gaap:ShortTermInvestments': 'Short-term investments',
  'us-gaap:MarketableSecuritiesCurrent': 'Short-term investments',
  'us-gaap:WeightedAverageNumberOfDilutedSharesOutstanding': 'Diluted shares outstanding',
  'us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax': 'Revenue',
  'us-gaap:Revenues': 'Revenue',
  'us-gaap:SalesRevenueNet': 'Revenue',
  'us-gaap:CostOfRevenue': 'Cost of sales',
  'us-gaap:GrossProfit': 'Gross profit',
  'us-gaap:OperatingIncomeLoss': 'Operating profit',
  'us-gaap:NetIncomeLoss': 'Profit for the year',
  'us-gaap:EarningsPerShareDiluted': 'Profit per share',
  'us-gaap:AccountsReceivableNetCurrent': 'Money owed by customers',
  'us-gaap:InventoryNet': 'Inventory',
  'us-gaap:Assets': 'Total assets',
  'us-gaap:StockholdersEquity': 'Shareholders’ equity',
}

/** The reported figure behind a reference. */
const refValue = (ref) => num(ref?.normalized_value) ?? num(ref?.raw_value)

/* Ids we will paste into a URL fragment, mirrored from the backend's own rule
   (apps/api/app/data/sec/fact_anchors.py). Nothing malformed reaches this far, and
   an anchor we cannot vouch for is dropped rather than escaped — the link then
   opens the filing at page one, which is where it used to open anyway. */
const ANCHOR = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/

/**
 * The readable filing on sec.gov, opened at the figure rather than at page one.
 *
 * Inline XBRL gives every tagged number an element id and SEC serves the document
 * as text/html, so `…/aapl-20250927.htm#f-307` scrolls the reader straight to the
 * line the drawer is quoting. The backend attaches that id as
 * `evidence_reference.filing_anchor`, and only for figures it located in THIS
 * filing — hence the accession check: an id from an older 10-K would point at
 * nothing here, or at a different number that happens to share it.
 *
 * `highlight` is the same figure as the filing prints it ("111,482"), carried
 * separately because it goes in a different part of the URL and only where the
 * browser supports it — see `filingHref` in EvidenceDrawer.jsx. It comes from the
 * SAME reference as the anchor, never a second one, so the two can never disagree
 * about which figure they mean.
 *
 * A reference without an anchor is the ordinary case, not a failure. Most of the
 * envelope's references come from earlier years, and the link degrades to exactly
 * what it was before: the filing, undeep-linked.
 */
function filingLink(refs, filing) {
  const base = str(filing?.filing_url)
  if (!base || base.includes('#')) return { url: base, highlight: null }
  const accession = str(filing?.accession_number)
  const hit = arr(refs).find(
    (r) =>
      ANCHOR.test(String(r?.filing_anchor ?? '')) &&
      accession != null &&
      str(r?.accession_number) === accession,
  )
  if (!hit) return { url: base, highlight: null }
  return { url: `${base}#${hit.filing_anchor}`, highlight: str(hit.filing_highlight) }
}

/** One `values_used` row. Shared by the checklist evidence and the valuation-input
 *  evidence below, so both render identically in the drawer. */
function toValueUsed(ref) {
  const concept = str(ref?.xbrl_concept)
  return {
    label: CONCEPT_LABELS[concept] ?? humanizeConcept(concept) ?? 'Reported value',
    value: refValue(ref),
    // Extra key, additive to the contract. Without it a decimal_ratio like 0.679
    // formats as "$0.68". The formatter needs to know it is a ratio.
    unit: str(ref?.unit) ?? 'USD',
    // Also additive: the tag the figure was filed under, and what we did to it on
    // the way here. Neither is printed any more — the drawer glosses the
    // transformation into English and drops the tag entirely (see
    // EvidenceDrawer.jsx). `concept` stays because it identifies a row: the same
    // tag can legitimately appear twice in one evidence object, for two periods.
    concept,
    transformation: str(ref?.transformation),
  }
}

/**
 * Build one docs/API.md evidence object from a checklist result.
 *
 * `url` is `latest_filing.filing_url` — the readable 10-K on sec.gov — NOT
 * `evidence_reference.source_url`. Verified in the live response: all 199 evidence
 * objects share two source_urls, and the one they carry is the raw XBRL companyfacts
 * JSON (data.sec.gov/api/xbrl/companyfacts/CIK…json). Sending a beginner there is
 * worse than sending them nowhere. source_url is kept as `data_url`, secondary.
 * `filingUrl` then aims that link at the figure itself where the backend located
 * one, so "Read the filing on SEC.gov" opens the cash-flow statement and not the
 * cover page.
 *
 * Returns null when there is nothing to show — the contract says evidence is
 * nullable everywhere and a null renders as no trigger at all.
 */
function toEvidence(result, filing) {
  const refs = arr(result?.evidence_references)
  const metrics = arr(result?.metrics_used)
  if (!refs.length && !metrics.length) return null

  const head = refs[0] ?? null
  const values_used = refs.map(toValueUsed)
  const link = filingLink(refs, filing)

  /* The first calculation string that was written for a reader rather than for a
     log. `metrics_used[].calculation` is usually the readable one ("gross profit /
     revenue") and `technical_explanation` the trace with the magnitudes substituted
     in, but not always — either field can hold either kind, so both go through the
     same rule and the first survivor wins. Nothing readable, nothing printed: the
     drawer omits the section rather than showing the trace. */
  const calculation =
    metrics.map((m) => str(m?.calculation)).find(readsAsEnglish) ??
    [str(result?.technical_explanation)].find(readsAsEnglish) ??
    null

  return {
    filing_type: str(head?.filing_form) ?? str(filing?.filing_form),
    fiscal_period: fiscalPeriod(filing, head),
    filed_on: dateOnly(head?.filing_date) ?? dateOnly(filing?.filing_date),
    values_used,
    calculation,
    // The envelope has no filing section pointer. Contract allows null.
    section: null,
    url: link.url,
    highlight: link.highlight,
    // Every reference in this envelope is an XBRL concept. `text` is reserved for
    // claims parsed out of filing prose, which only the AI path produces.
    provenance: refs.length ? 'xbrl' : 'text',
    data_url: str(head?.source_url),
    metrics: metrics.map((m) => ({
      label: humanizeMetric(m?.name),
      value: num(m?.value),
      unit: str(m?.unit),
      calculation: str(m?.calculation),
    })),
  }
}

/* ── evidence for the valuation inputs ──────────────────────────────────────── */

/* The Why drawer's rows are valuation INPUTS, and the envelope attaches evidence to
 * checklist rows, not to inputs. What it does carry is
 * `deterministic_baseline.traces[].evidence_references` — but that is one
 * undifferentiated bucket repeated across the traces (the same 56 refs on three of
 * MSFT's four, spanning seventeen fiscal years). It is the set of facts the engine
 * LOADED, not the provenance of any one assumption. Handing all 56 to "Discount
 * rate" would be the "the proof is somewhere in this document" failure this drawer
 * exists to prevent, so no row is given the bucket.
 *
 * Instead a row earns evidence only when its figure can be RECONSTRUCTED from named
 * references: the one pair whose difference is exactly `starting_free_cash_flow`,
 * the one pair whose difference is exactly `net_debt`, the one reference equal to
 * the diluted share count. That is a verified match rather than an attribution — if
 * nothing reproduces the input, or if more than one combination does, the field gets
 * no evidence and the row shows no trigger.
 *
 * The two rate rows are deliberately absent. `terminal_growth_rate` is
 * "sector_terminal_prior=0.0300000000; final=0.0300000000" and `discount_rate` is a
 * sector prior plus modifiers; neither is a filed figure, and this drawer's entire
 * frame is filing provenance. Dressing a sector assumption in a 10-K header would
 * present it as something the company reported, which it is not.
 */

const OCF = 'us-gaap:NetCashProvidedByUsedInOperatingActivities'
const CAPEX = 'us-gaap:PaymentsToAcquirePropertyPlantAndEquipment'
const DEBT = 'us-gaap:LongTermDebt'
const CASH = 'us-gaap:CashCashEquivalentsAndShortTermInvestments'
const DILUTED = 'us-gaap:WeightedAverageNumberOfDilutedSharesOutstanding'

/** Whole-dollar figures in the billions, which float64 holds exactly; the tolerance
 *  only absorbs the engine's own rounding, never a genuinely different number. */
const equal = (a, b) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * 1e-9)

/**
 * Every reference the baseline traces cite, de-duplicated, narrowed to the filing
 * the valuation actually starts from.
 *
 * The narrowing matters: the bucket carries seventeen years of the same five tags,
 * and the inputs are the latest year's. Without it a cross-year coincidence could
 * reproduce an input and we would cite the wrong fiscal year — the one failure mode
 * worse than showing no evidence at all. When the envelope names no accession the
 * whole bucket is searched, and the uniqueness rule below is what keeps that honest.
 */
function inputRefs(analysis, filing) {
  const seen = new Set()
  const all = []
  arr(analysis?.deterministic_baseline?.traces).forEach((trace) => {
    arr(trace?.evidence_references).forEach((ref) => {
      if (refValue(ref) === null) return
      const id = str(ref?.evidence_id) ?? `${ref?.xbrl_concept}:${ref?.raw_value}`
      if (seen.has(id)) return
      seen.add(id)
      all.push(ref)
    })
  })
  const accession = str(filing?.accession_number)
  if (!accession) return all
  return all.filter((ref) => str(ref?.accession_number) === accession)
}

const conceptRefs = (refs, concept) => refs.filter((ref) => str(ref?.xbrl_concept) === concept)

/** The single reference equal to `target`. Null when none matches — and null when
 *  more than one does, because an ambiguous provenance is not a provenance. */
function soleRef(refs, concept, target) {
  if (num(target) === null) return null
  const hits = conceptRefs(refs, concept).filter((ref) => equal(refValue(ref), target))
  return hits.length === 1 ? hits : null
}

/**
 * The single (minuend, subtrahend) pair whose difference is `target`, in that order.
 * `absolute` applies the abs() the engine's own transformation string names —
 * "free_cash_flow = operating_cash_flow - abs(capital_expenditure)" — so a capital
 * expenditure filed as a negative subtracts the same way as one filed positive.
 */
function solePair(refs, minuend, subtrahend, target, absolute = false) {
  if (num(target) === null) return null
  const hits = []
  conceptRefs(refs, minuend).forEach((a) => {
    conceptRefs(refs, subtrahend).forEach((b) => {
      const taken = absolute ? Math.abs(refValue(b)) : refValue(b)
      if (equal(refValue(a) - taken, target)) hits.push([a, b])
    })
  })
  return hits.length === 1 ? hits[0] : null
}

/** An evidence object in the docs/API.md shape, built straight from references.
 *  Same `url` rule as `toEvidence`: the readable filing, never the companyfacts feed. */
function evidenceFromRefs(refs, filing, calculation) {
  if (!refs?.length) return null
  const head = refs[0]
  const link = filingLink(refs, filing)
  return {
    filing_type: str(head?.filing_form) ?? str(filing?.filing_form),
    fiscal_period: fiscalPeriod(filing, head),
    filed_on: dateOnly(head?.filing_date) ?? dateOnly(filing?.filing_date),
    values_used: refs.map(toValueUsed),
    calculation,
    section: null,
    url: link.url,
    highlight: link.highlight,
    provenance: 'xbrl',
    data_url: str(head?.source_url),
    metrics: [],
  }
}

/**
 * `the_math.evidence`, keyed by field name — docs/API.md: an absent key means null,
 * and a null renders as no trigger on that row.
 *
 * The calculation sentences describe the transformation the engine already recorded
 * on the references; nothing here is computed and no figure is restated.
 */
function mathEvidence(analysis, filing, inputs) {
  const refs = inputRefs(analysis, filing)
  if (!refs.length) return {}
  const out = {}

  const fcf = solePair(refs, OCF, CAPEX, num(inputs?.starting_free_cash_flow), true)
  if (fcf) {
    out.starting_free_cash_flow = evidenceFromRefs(
      fcf,
      filing,
      'The cash the business generated last year, less what it spent on property and equipment.',
    )
  }

  const netDebt = solePair(refs, DEBT, CASH, num(inputs?.net_debt))
  if (netDebt) {
    out.net_debt = evidenceFromRefs(
      netDebt,
      filing,
      'What the company owes over the long term, less the cash and short-term investments it holds. A negative figure means it holds more than it owes.',
    )
  }

  const shares = soleRef(refs, DILUTED, num(inputs?.diluted_shares))
  if (shares) {
    out.shares_outstanding = evidenceFromRefs(
      shares,
      filing,
      'The diluted share count the company reported — diluted, so it counts the shares that options and similar awards would add.',
    )
  }

  return out
}

/* ── business quality ───────────────────────────────────────────────────────── */

/**
 * docs/API.md: "The quality axis, independent of price. Never blended into label."
 * Independent of price is exactly why this one still resolves when price is null —
 * it reads the checklist, which needs no quote.
 *
 * Only `applies` rows count. A row set aside as not applicable to the sector is not
 * evidence of weakness.
 */
export function businessQuality(results) {
  const applicable = arr(results).filter((r) => r?.status !== 'NOT_APPLICABLE')
  if (!applicable.length) return 'insufficient'

  const n = applicable.length
  const supports = applicable.filter((r) => r?.status === 'SUPPORTS').length
  const weakens = applicable.filter((r) => r?.status === 'WEAKENS').length
  const unknown = applicable.filter((r) => r?.status === 'UNKNOWN').length

  if (unknown > n / 2) return 'insufficient'
  if (weakens >= n * 0.4) return 'weak'
  if (supports >= n * 0.6) return 'strong'
  return 'uncertain'
}

/* ── the math ───────────────────────────────────────────────────────────────── */

/** Compound annual growth over the historical FCF series. Null unless both ends are
 *  positive — a CAGR across a sign change is meaningless, not merely imprecise. */
export function historicalGrowthPct(series) {
  const xs = arr(series).map(num).filter((v) => v !== null)
  if (xs.length < 2) return null
  const first = xs[0]
  const last = xs[xs.length - 1]
  if (first <= 0 || last <= 0) return null
  const years = xs.length - 1
  return ((last / first) ** (1 / years) - 1) * 100
}

/* ── where the value comes from ─────────────────────────────────────────────── */

/** The present values of the ten projected years, when `decomposition` does not
 *  state their sum. Null unless every year carries one — a partial sum would
 *  understate the near-term half and overstate the terminal share, which is the
 *  exact direction this block must never be wrong in. */
function sumPresentValues(rows) {
  const vals = arr(rows).map((r) => num(r?.present_value))
  if (!vals.length || vals.some((v) => v === null)) return null
  return vals.reduce((a, b) => a + b, 0)
}

/**
 * The terminal-value split, for TerminalValueShare.jsx.
 *
 * `terminal_value_pct` above already carries the engine's own
 * `terminal_value.concentration`, but one number cannot draw a two-part bar. The
 * envelope states both halves outright, in `decomposition`:
 *
 *   present_value_projected_cash_flows + present_value_terminal_value = enterprise_value
 *
 * so both are carried across, and the share is computed FROM that pair rather than
 * read off `concentration` — a percentage derived from the same two numbers the bar
 * is drawn from cannot disagree with the bar. `concentration` is the fallback for an
 * envelope that omits the decomposition; then the two amounts are null and the
 * component draws from the share alone.
 *
 * Returns null when there is no honest share to state: no enterprise value to take
 * a share of, or a total that is zero or negative.
 */
function toTerminalValue(fv) {
  const tv = fv?.terminal_value ?? {}
  const d = fv?.decomposition ?? {}

  const beyond = num(d.present_value_terminal_value) ?? num(tv.present_value)
  const projected =
    num(d.present_value_projected_cash_flows) ?? sumPresentValues(fv?.projected_cash_flows)

  const total = beyond === null || projected === null ? null : beyond + projected
  // A share needs a whole to be a share of.
  if (total !== null && total <= 0) return null

  const share = total !== null ? (beyond / total) * 100 : toPct(tv.concentration)
  if (share === null) return null

  return {
    share_pct: share,
    // Both amounts, or neither: one figure beside an em dash in a two-line legend
    // reads as a missing number rather than as a split we could not resolve.
    present_value: total === null ? null : beyond,
    projected_present_value: total === null ? null : projected,
    total_present_value: total,
  }
}

/* ── sensitivity ────────────────────────────────────────────────────────────── */

/**
 * The published sensitivity interval, for SensitivityMatrix.jsx.
 *
 * `final_valuation.sensitivity_interval` is the engine's own answer to "how much do
 * our assumptions matter": it re-runs the DCF with growth shifted −δ and the discount
 * rate shifted +δ (the pessimistic corner), and again the other way (the optimistic
 * corner). Its `evaluated_points` carry ONLY those two corners plus nothing in
 * between, so the matrix cannot be read off the envelope — it is rebuilt from these
 * deltas and the assumptions the drawer already shows, then checked back against
 * these three published figures. See SensitivityMatrix.jsx.
 *
 * Deltas arrive as decimal fractions (`units.rates`) and leave as percentage points,
 * matching every other rate in `the_math`. Returns null unless the interval is
 * complete and both deltas are positive — a zero delta describes no interval at all,
 * and a grid built on it would be one number printed twenty-five times.
 */
function toSensitivity(fv) {
  const si = fv?.sensitivity_interval
  if (!si) return null

  const growth = toPct(si.growth_rate_delta)
  const discount = toPct(si.discount_rate_delta)
  if (growth === null || discount === null || growth <= 0 || discount <= 0) return null

  const central = num(si.central_value_per_share) ?? num(fv.intrinsic_value_per_share)
  const low = num(si.lower_bound_per_share)
  const high = num(si.upper_bound_per_share)
  if (central === null || low === null || high === null) return null

  return {
    method: str(si.method),
    // The engine states this outright, and it is false: the bounds are a
    // perturbation, not a confidence interval. Carried so no component can imply
    // a probability the envelope never claimed.
    is_probability_interval: si.is_probability_interval === true,
    growth_delta_pct: growth,
    discount_delta_pct: discount,
    central_per_share: central,
    low_per_share: low,
    high_per_share: high,
  }
}

function toTheMath(fv, analysis, filing) {
  if (!fv) return null
  const inputs = fv.inputs ?? {}
  const a = fv.assumptions ?? {}
  const si = fv.sensitivity_interval ?? {}

  const stageOne = toPct(a.stage_one_growth_rate)
  // The interval is a symmetric ±delta perturbation of growth and discount rate
  // (method: "symmetric_assumption_perturbation"), so the scenario growth rates are
  // the central rate ∓ the delta. Not invented — read off the interval object.
  const delta = toPct(si.growth_rate_delta)
  const shift = (sign) =>
    stageOne === null || delta === null ? null : stageOne + sign * delta

  return {
    starting_free_cash_flow: num(inputs.starting_free_cash_flow),
    stage_1: { years: num(a.stage_one_years), growth_pct: stageOne },
    stage_2: { years: num(a.stage_two_years), growth_pct: toPct(a.stage_two_growth_rate) },
    terminal_growth_pct: toPct(a.terminal_growth_rate),
    discount_rate_pct: toPct(a.discount_rate),
    terminal_value_pct: toPct(fv.terminal_value?.concentration),
    terminal_value: toTerminalValue(fv),
    net_debt: num(inputs.net_debt),
    shares_outstanding: num(inputs.diluted_shares),
    sensitivity: toSensitivity(fv),
    scenarios: [
      { name: 'Pessimistic', value_per_share: num(si.lower_bound_per_share), growth_pct: shift(-1) },
      { name: 'Realistic', value_per_share: num(fv.intrinsic_value_per_share), growth_pct: stageOne },
      { name: 'Optimistic', value_per_share: num(si.upper_bound_per_share), growth_pct: shift(+1) },
    ],
    // docs/API.md: the_math.evidence is keyed by field name, absent key === null.
    // The envelope attaches evidence to checklist rows, not to valuation inputs, so
    // only what is genuinely traceable is claimed here — see `mathEvidence`.
    evidence: mathEvidence(analysis, filing, inputs),
    warnings: arr(fv.warnings).map(String),
  }
}

/* ── plain english ──────────────────────────────────────────────────────────── */

/* Ordering: what weakens the case is more decision-relevant than what supports it,
 * so it leads. Within a status, the checklist's own order. */
const CARD_RANK = { WEAKENS: 0, MONITOR: 1, SUPPORTS: 2 }
const SENTIMENT = { SUPPORTS: 'positive', WEAKENS: 'negative', MONITOR: 'neutral' }

/**
 * The envelope has no narrative cards. `analysis.evidence_assessment` is the AI's
 * output and is EMPTY whenever Gemini falls back — which, today, is every call.
 *
 * So the cards are built from the deterministic checklist's own
 * `plain_english_explanation`. That is not fabrication: it is the engine's text,
 * carried across verbatim (bar exponent tidying). Each card is stamped
 * `source: 'deterministic'` so the UI can say where it came from.
 */
function toPlainEnglish(results, filing, limit = 3) {
  return arr(results)
    .filter((r) => r?.status !== 'NOT_APPLICABLE' && r?.status !== 'UNKNOWN')
    .filter((r) => str(r?.plain_english_explanation))
    .sort(
      (x, y) =>
        (CARD_RANK[x.status] ?? 9) - (CARD_RANK[y.status] ?? 9) ||
        (x.checklist_number ?? 0) - (y.checklist_number ?? 0),
    )
    .slice(0, limit)
    .map((r) => ({
      title: checkLabel(r),
      body: tidyExponents(r.plain_english_explanation),
      sentiment: SENTIMENT[r.status] ?? 'neutral',
      evidence: toEvidence(r, filing),
      source: 'deterministic',
    }))
}

/* ── cannot value ───────────────────────────────────────────────────────────── */

const CANNOT_VALUE_MESSAGES = {
  unsupported_ticker: "We don't have filings for this ticker",
  invalid_ticker: "That doesn't look like a ticker we can use",
  missing_sec_data: "This company's filings are missing data we need",
  provider_rate_limit: 'We are being rate-limited by the filing service',
  sec_provider_unavailable: 'The filing service is unavailable right now',
  calculation_error: "We can't value this company reliably",
  internal_error: 'Something went wrong on our side',
}

/**
 * The docs/API.md "cannot value" payload. Refusing to answer is a designed state,
 * not an error page — see product non-negotiable #3.
 * @param {object} envelope  the error body, `{ error: { code, message, request_id } }`
 */
export function toCannotValue(envelope = {}) {
  const err = envelope?.error ?? {}
  const code = str(err.code) ?? 'calculation_error'
  const filing = envelope?.latest_filing ?? null

  /* A refusal to value is not a refusal to show the price. When the envelope
     carries a quote — a 200 that produced no valuation still can — the price card
     prints it and the estimate beside it stays an em dash, which is the designed
     refusal in design/app.html rather than a blank screen. No valuation means no
     comparison, so there is still no word and no margin of safety. */
  const market = toMarketPrice(envelope?.market_price)
  const plausibility = toPlausibility(envelope?.plausibility)

  return {
    ticker: str(envelope?.ticker) ?? null,
    company_name: str(envelope?.company_name) ?? null,
    currency: 'USD',
    as_of: dateOnly(envelope?.sec_retrieved_at) ?? null,

    verdict: {
      label: 'CANNOT_VALUE',
      headline: "We can't value this company reliably",
      confidence: 'low',
      margin_of_safety_pct: null,
      business_quality: 'insufficient',
      combination: 'Insufficient evidence',
      reason: code,
      detail: str(err.message) ?? CANNOT_VALUE_MESSAGES[code] ?? null,
    },

    price: {
      current: market.current,
      fair_value_low: null,
      fair_value_mid: null,
      fair_value_high: null,
      unavailable_reason: market.current === null ? NO_PRICE : null,
      verdict_withheld: false,
      quote: market.quote,
      unavailable_message: market.message,
    },
    plain_english: [],
    what_has_to_be_true: null,
    falsifiers: [],
    the_math: null,
    checks: [],
    sources: sourcesFor(filing, market.quote),

    // named 1A.2 surface
    companyName: str(envelope?.company_name) ?? null,
    retrievedAt: str(envelope?.sec_retrieved_at) ?? null,
    filing: toFiling(filing),
    value: { low: null, mid: null, high: null },
    confidence: { level: 'low', score: null, explanation: null, factors: [] },
    evidence: [],
    aiStatus: AI_OK,
    aiFallbackReason: null,

    plausibility,

    priceAvailable: market.current !== null,
    canStateVerdict: false,
    canValue: false,
    errorCode: code,
    requestId: str(err.request_id) ?? null,
  }
}

/* ── market price and the plausibility gate (docs/API.md v3) ────────────────── */

/**
 * `market_price`, read defensively.
 *
 * Invariant 1: the key is always present, and absence is `status: "UNAVAILABLE"`
 * with a reason — never a missing key, never null, never 0. A missing key must
 * degrade IDENTICALLY to UNAVAILABLE, which is exactly what makes this safe to run
 * against a backend that has not shipped its quote provider: anything that is not a
 * well-formed AVAILABLE quote is read as no price at all.
 *
 * Invariant 2 promises an AVAILABLE quote always carries a positive number. This
 * checks anyway. A zero or a negative from a provider is the one figure that must
 * never reach the screen (invariant 8), and the check costs nothing.
 *
 * @returns {{current: number|null, quote: object|null, message: string|null,
 *            reason: string|null}}
 */
export function toMarketPrice(mp) {
  const quoted = num(mp?.quote?.price)
  if (str(mp?.status) !== 'AVAILABLE' || quoted === null || quoted <= 0) {
    return {
      current: null,
      quote: null,
      // The backend's own one-sentence explanation, written for a beginner and
      // safe to render verbatim. Null when the key is absent entirely — then it
      // said nothing, and we do not put words in its mouth.
      message: str(mp?.message),
      reason: str(mp?.unavailable_reason),
    }
  }
  const q = mp.quote
  return {
    current: quoted,
    /* `quoted_at` and `retrieved_at` are two different facts and both are carried:
       a price quoted on Friday and fetched on Sunday is stale, and only the pair
       says so. Neither is ever inferred from the other. */
    quote: {
      symbol: str(q.symbol),
      currency: str(q.currency),
      quotedAt: str(q.quoted_at),
      retrievedAt: str(q.retrieved_at),
      source: str(q.source),
      sourceUrl: str(q.source_url),
      exchangeName: str(q.exchange_name),
    },
    message: null,
    reason: null,
  }
}

/**
 * `plausibility`, carried across and never recomputed.
 *
 * Everything here except `canStateVerdict` exists to EXPLAIN the gate to a reader.
 * `canStateVerdict` is the gate itself, and it is read, not derived — see the
 * header and D-027.
 */
export function toPlausibility(pl) {
  return {
    /* Lets a consumer tell "the backend closed the gate" from "this response
       predates v3". Both withhold the word; only the first has sentences to show
       for it, and a screen that says nothing is better than one that improvises. */
    stated: Boolean(pl) && typeof pl === 'object' && !Array.isArray(pl),
    level: str(pl?.level),
    /* `=== true`, and nothing looser. A missing key, a null, a truthy string —
       all of them mean we have not been told we may say a word, and the default
       on "not been told" is silence. */
    canStateVerdict: pl?.can_state_verdict === true,
    reasons: arr(pl?.reasons)
      .map((r) => ({
        signal: str(r?.signal),
        /* Severity is the only field a component may branch on. `signal` is an
           open vocabulary by contract — switching on it breaks the first time the
           backend names a new one. */
        severity: str(r?.severity),
        explanation: str(r?.explanation),
      }))
      .filter((r) => r.explanation),
    priceToMidpointRatio: num(pl?.price_to_midpoint_ratio),
    pricePosition: str(pl?.price_position),
    summary: str(pl?.summary),
  }
}

const LABEL_FOR = {
  below_range: 'UNDERVALUED',
  in_range: 'FAIRLY_PRICED',
  above_range: 'OVERVALUED',
}

/**
 * WHICH of the three words, once the gate has already said one may be said.
 *
 * This is not the gate and not a threshold. `price_position` is the backend's own
 * statement of where the price falls and is used wherever it exists; the fallback
 * is the comparison that position is *defined* as in docs/API.md — below
 * `fair_value_low`, between the bounds inclusive, above `fair_value_high`.
 *
 * Null when there is no range to place the price in: a word needs both sides.
 */
function verdictLabel(position, current, low, high) {
  const stated = LABEL_FOR[position]
  if (stated) return stated
  if (current === null || low === null || high === null) return null
  if (current < low) return 'UNDERVALUED'
  if (current > high) return 'OVERVALUED'
  return 'FAIRLY_PRICED'
}

/** docs/API.md: `(mid − current) / current × 100`. Positive = cheap. */
function marginOfSafetyPct(mid, current) {
  if (mid === null || current === null || current <= 0) return null
  return ((mid - current) / current) * 100
}

const HEADLINE_FOR = {
  UNDERVALUED: 'looks cheap against what the filings support',
  FAIRLY_PRICED: 'looks fairly priced against what the filings support',
  OVERVALUED: 'looks expensive against what the filings support',
}

/* ── filing / sources ───────────────────────────────────────────────────────── */

function toFiling(filing) {
  if (!filing) return null
  return {
    form: str(filing.filing_form),
    reportDate: dateOnly(filing.report_date),
    filingDate: dateOnly(filing.filing_date),
    accessionNumber: str(filing.accession_number),
    url: str(filing.filing_url),
    cik: str(filing.cik),
    isAmendment: filing.is_amendment === true,
  }
}

/* Only sources actually used. The quote line appears if and only if there was a
 * quote: the mockup's "Yahoo Finance — price & financials" is a provenance claim,
 * and on a response with no price it would be a false one. Named from the quote's
 * own `source` and `source_url` rather than from a constant, so the footer credits
 * whichever provider actually answered. */
function sourcesFor(filing, quote) {
  const out = []
  const url = str(filing?.filing_url)
  if (url) {
    const form = str(filing?.filing_form) ?? 'filing'
    const year = dateOnly(filing?.report_date)?.slice(0, 4)
    out.push({ label: `SEC EDGAR — ${form}${year ? ` (FY${year})` : ''}`, url })
  }
  out.push({ label: 'SEC EDGAR — XBRL company facts', url: 'https://www.sec.gov/edgar' })
  if (quote?.source) {
    out.push({ label: `${quote.source} — share price`, url: quote.sourceUrl ?? null })
  }
  return out
}

/* ── the adapter ────────────────────────────────────────────────────────────── */

/**
 * Map an AnalysisEnvelope (or an error body) onto the docs/API.md v2 view shape.
 *
 * @param   {object} envelope  parsed JSON from GET /api/analyze/{ticker}
 * @returns {object}           never null; an unusable input yields the cannot-value shape
 */
export function toView(envelope) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    return toCannotValue({ error: { code: 'internal_error', message: 'Empty response' } })
  }
  // `{ error: { code, message, request_id } }` — 400 / 404 / 422 / 429 / 5xx.
  if (envelope.error) return toCannotValue(envelope)

  const analysis = envelope.analysis
  const fv = analysis?.final_valuation
  // A 200 with no valuation is still a refusal, not a crash.
  if (!fv || num(fv.intrinsic_value_per_share) === null) {
    return toCannotValue({
      ...envelope,
      error: { code: 'calculation_error', message: 'No valuation was produced for this company' },
    })
  }

  const filing = envelope.latest_filing ?? null
  const si = fv.sensitivity_interval ?? {}
  const results = arr(analysis?.deterministic_checklist?.results)
  const conf = analysis?.confidence ?? {}

  const mid = num(fv.intrinsic_value_per_share)
  const low = num(si.lower_bound_per_share)
  const high = num(si.upper_bound_per_share)

  const quality = businessQuality(results)
  const level = (str(conf.level) ?? 'low').toLowerCase() // engine: "High"|"Medium"|"Low"

  const aiFailed = str(analysis?.status) === 'DETERMINISTIC_FALLBACK'
  const histGrowth = historicalGrowthPct(fv.inputs?.historical_free_cash_flows)

  /* ── the price and the gate ─────────────────────────────────────────────────
     Read, in this order and no other: is there a price, and are we allowed to say
     a word about it. The second question is answered by the backend and this file
     does not have an opinion on it. See the header. */
  const market = toMarketPrice(envelope.market_price)
  const plausibility = toPlausibility(envelope.plausibility)
  const current = market.current
  const hasPrice = current !== null

  // Invariant 5: the word is printed if and only if `can_state_verdict` is true.
  const gateOpen = hasPrice && plausibility.canStateVerdict
  const label = gateOpen ? verdictLabel(plausibility.pricePosition, current, low, high) : null

  /* One expression, all three states. No price -> NO_PRICE. A price and a word ->
     nothing is missing. A price and no word -> VERDICT_WITHHELD, which covers both
     a gate the backend closed and the rarer case of a valuation with no range to
     place the price in. A null label always carries a reason for being null. */
  const verdictReason = !hasPrice ? NO_PRICE : label ? null : VERDICT_WITHHELD

  /* Computable at last — but only with the word. A signed percentage against a
     price we have just declined to rank is the same verdict said in numbers, and
     the gate does not distinguish between the two. */
  const mos = label ? marginOfSafetyPct(mid, current) : null

  const companyLabel = str(envelope.company_name) ?? str(envelope.ticker) ?? 'this company'

  return {
    /* ── docs/API.md v2 surface — what the 1B components read ───────────────── */
    ticker: str(envelope.ticker),
    company_name: str(envelope.company_name),
    currency: str(fv.inputs?.currency) ?? 'USD',
    as_of: dateOnly(envelope.sec_retrieved_at),

    verdict: {
      /* A word, or null and a reason. Never a guess: UNDERVALUED / FAIRLY_PRICED /
         OVERVALUED is a statement about price against value, and it is said only
         when we have both halves AND the backend has opened the gate. */
      label,
      headline: label
        ? `${companyLabel} ${HEADLINE_FOR[label]}`
        : hasPrice
          /* The gate's own sentence, written for a beginner by the side that
             closed it. Falls back to plain words when a pre-v3 response leaves us
             with a price and no gate to read. */
          ? (plausibility.summary ??
             `We valued ${companyLabel}, but our estimate sits too far from today's price for us to call it`)
          : `We valued ${companyLabel}, but we don't have today's share price to compare it against`,
      confidence: level,
      margin_of_safety_pct: mos,
      // Independent of price by definition, so it resolves in every state.
      business_quality: quality,
      /* Left to VerdictBanner, which owns the closed set and renders both axes; it
         reads a contract string here when one is sent and derives the pair
         otherwise. Never derived from the quality axis alone — five of the six
         legal strings encode a price judgment. */
      combination: null,
      unavailable_reason: verdictReason,
    },

    price: {
      current, // the quoted price, or null — never 0, never the midpoint
      fair_value_low: low,
      fair_value_mid: mid,
      fair_value_high: high,
      unavailable_reason: hasPrice ? null : NO_PRICE,
      /* Additive, and the only channel RangeBar has: it is handed the price object
         and nothing else. With the gate closed it must place the marker WITHOUT
         the three zone words beneath it — a knob sitting inside "Looks expensive"
         states in a picture the word we have just refused to say. */
      verdict_withheld: verdictReason === VERDICT_WITHHELD,
      // Where the quote came from, and — when there is none — the backend's own
      // sentence saying why. Both null in the other state.
      quote: market.quote,
      unavailable_message: market.message,
    },

    plain_english: toPlainEnglish(results, filing),

    what_has_to_be_true: {
      /* Implied growth is the growth rate that makes the DCF come out at today's
         price — solved by running the engine backwards. The engine is the
         backend's, and re-implementing it here would put two answers to the same
         question in two languages, which is the mistake D-027 exists to prevent.
         So this stays null even now that a price exists, and says which of the two
         reasons it is null for. */
      implied_growth_pct: null,
      historical_growth_pct: histGrowth,
      summary: hasPrice
        ? (histGrowth === null
            ? "We don't have enough filed history to say what this company's spare cash has actually done."
            : `Over the filed history this company's spare cash grew about ${histGrowth.toFixed(1)}% a year. That is the record; what today's price assumes about the future is a separate calculation we don't publish yet.`)
        : (histGrowth === null
            ? "We can't say what today's buyers are betting on without a share price."
            : `Over the filed history this company's spare cash grew about ${histGrowth.toFixed(1)}% a year. What today's buyers are betting on needs a share price, which we don't have.`),
      unavailable_reason: hasPrice ? IMPLIED_GROWTH_UNSOLVED : NO_PRICE,
    },

    // The envelope has no falsifiers field; they are an AI output. Never invented.
    falsifiers: [],

    the_math: toTheMath(fv, analysis, filing),

    checks: results.map((r) => ({
      label: checkLabel(r),
      detail: tidyExponents(r?.plain_english_explanation) ?? null,
      status: CHECK_STATUS[r?.status] ?? 'insufficient',
      sector_relevance: r?.status === 'NOT_APPLICABLE' ? 'not_applicable' : 'applies',
      evidence: toEvidence(r, filing),
      // Jargon lives here, inside the Why drawer — never on the default screen.
      technical_label: str(r?.checklist_text),
      technical_explanation: str(r?.technical_explanation),
      applicability_reason: str(r?.applicability_reason),
      missing_information: arr(r?.missing_information).map(String),
      number: num(r?.checklist_number),
    })),

    sources: sourcesFor(filing, market.quote),

    /* ── named 1A.2 surface ─────────────────────────────────────────────────── */
    companyName: str(envelope.company_name),
    retrievedAt: str(envelope.sec_retrieved_at),
    filing: toFiling(filing),
    value: { low, mid, high },
    confidence: {
      level,
      score: num(conf.score),
      explanation: str(conf.explanation),
      isProbability: conf.is_probability === true,
      factors: arr(conf.factors).map((f) => ({
        name: str(f?.name),
        label: humanizeMetric(f?.name),
        score: num(f?.score),
        explanation: str(f?.explanation),
      })),
    },

    /* Every evidence reference in the response, flattened and de-duplicated by
     * evidence_id. `analysis.evidence_assessment` is the AI's per-claim assessment
     * and is empty on the fallback path, so the checklist references are the real
     * provenance today. Both are merged, AI first. */
    evidence: collectEvidence(analysis, results),

    // String, so useAnalysis's `?status=` override keeps working.
    aiStatus: aiFailed ? AI_FALLBACK : AI_OK,
    aiFallbackReason: aiFailed ? (str(analysis?.fallback_reason) ?? 'unknown') : null,
    aiDisagreement: str(analysis?.disagreement?.summary),
    annualReport: toAnnualReport(analysis?.annual_report, aiFailed),

    /* The gate, and the sentences that explain it. Carried whole so a component
       can say why the word is missing in the backend's words rather than its own;
       `canStateVerdict` below is the only field anything may branch on. */
    plausibility,

    /* ── flags every consumer branches on ───────────────────────────────────── */
    priceAvailable: hasPrice,
    canStateVerdict: gateOpen,
    canValue: true,
    missingMetrics: arr(envelope.missing_metrics).map(String),
    normalizationWarningCount: arr(envelope.normalization_warnings).length,
  }
}

function collectEvidence(analysis, results) {
  const seen = new Map()
  const push = (e) => {
    const id = str(e?.evidence_id)
    if (!id || seen.has(id)) return
    seen.set(id, {
      id,
      provider: str(e.provider),
      concept: str(e.xbrl_concept),
      label: humanizeConcept(e.xbrl_concept),
      value: num(e.normalized_value) ?? num(e.raw_value),
      unit: str(e.unit),
      transformation: str(e.transformation),
      accessionNumber: str(e.accession_number),
      filingForm: str(e.filing_form),
      filingDate: dateOnly(e.filing_date),
      dataUrl: str(e.source_url),
      retrievedAt: str(e.retrieved_at),
    })
  }
  arr(analysis?.evidence_assessment).forEach(push)
  results.forEach((r) => arr(r?.evidence_references).forEach(push))
  return [...seen.values()]
}

export default toView
