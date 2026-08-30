import { EMPTY } from '../lib/format.js'
import Eyebrow from './ui/Eyebrow.jsx'
import './SourceRecord.css'

/* ── The source record ────────────────────────────────────────────────────────
 *
 * The proof-of-work block: it names the exact document every number on the page
 * came from, by its EDGAR accession number, and links to that document.
 *
 * Two of these five rows are the whole point. The accession number is the primary
 * key of a filing on EDGAR — paste it into full-text search and you land on this
 * document and no other — and the retrieval timestamp says when we read it. Those
 * are what a sceptic checks, so they get the mono face at full size and are never
 * truncated or abbreviated.
 *
 * ── The link ─────────────────────────────────────────────────────────────────
 * `filing.url` (envelope `latest_filing.filing_url`), NEVER an evidence
 * `source_url`. The latter is https://data.sec.gov/api/xbrl/companyfacts/CIK…json
 * — the machine feed. Sending a beginner to a wall of raw JSON is the same "the
 * proof is in here somewhere" failure as sending them to a search page, in a worse
 * format. Verified 2026-08-30 against the live MSFT response: `filing_url` returns
 * the 8.5MB 10-K itself, "Fiscal Year Ended June 30, 2026".
 *
 * If there is no URL there is no link. A dead or placeholder href on the one block
 * whose entire job is provenance would discredit everything above it.
 *
 * ── The heading ──────────────────────────────────────────────────────────────
 * The deployed site calls this "Direct filing provenance." That is the right idea
 * in the wrong voice — "provenance" is a word this product's reader does not use.
 * The claim is stated plainly instead; the eyebrow still names the block.
 *
 * ── Dates ────────────────────────────────────────────────────────────────────
 * Formatted here rather than in src/lib/format.js, which owns numbers only, and
 * deliberately NOT shared with EvidenceDrawer's `filedOn` ("29 July 2026"). That
 * one sits inside a sentence in prose; these sit in a mono column beside an
 * accession number, where the American short form is the register the record
 * itself is written in.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2025-09-27" -> "Sep 27, 2025". Null for anything that is not a plain ISO date —
 *  a half-parsed date printed with confidence is worse than no date. */
export function shortDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''))
  if (!m) return null
  const month = MONTHS[Number(m[2]) - 1]
  if (!month) return null
  return `${month} ${Number(m[3])}, ${m[1]}`
}

/**
 * "2026-08-29T20:38:50.492382Z" -> "Aug 29, 2026 at 08:38 PM UTC".
 *
 * The zone is asserted only when the string actually carries Z or +00:00, because
 * this row's whole value is that it is checkable — labelling a local time "UTC"
 * would make the one timestamp a sceptic reads a lie. Anything else is passed
 * through verbatim rather than reinterpreted, and `new Date()` is never involved:
 * it would silently shift the clock into the viewer's own zone.
 */
export function retrievedAt(iso) {
  const s = String(iso ?? '').trim()
  if (!s) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|\+00:?00)$/i.exec(s)
  if (!m) return s
  const month = MONTHS[Number(m[2]) - 1]
  if (!month) return s
  const hour = Number(m[4])
  const meridiem = hour < 12 ? 'AM' : 'PM'
  const twelve = hour % 12 === 0 ? 12 : hour % 12
  return `${month} ${Number(m[3])}, ${m[1]} at ${String(twelve).padStart(2, '0')}:${m[5]} ${meridiem} UTC`
}

/**
 * @param {object} props
 * @param {object} props.data  the view object from src/lib/adapter.js — `filing`
 *                             (toFiling) and `retrievedAt`. Nothing here reads the
 *                             raw envelope.
 */
export default function SourceRecord({ data }) {
  const filing = data?.filing ?? null

  const rows = filing && [
    ['Filing', filing.form],
    ['Period', shortDate(filing.reportDate)],
    ['Filed', shortDate(filing.filingDate)],
    ['Accession', filing.accessionNumber],
    ['SEC retrieval', retrievedAt(data?.retrievedAt)],
  ]

  return (
    /* `.av` folds this into the staggered reveal AppScreen already runs over the
       "Why we think so" blocks — one entrance for the whole lower half of the
       screen, no new motion invented here. */
    <section className="srcrec av" aria-labelledby="srcrec-h">
      <Eyebrow>Source record</Eyebrow>
      {/* The heading states the claim, so it cannot outlive the evidence for it.
          With no filing there is no document to have come from, and asserting one
          over a paragraph that says the opposite would be the one contradiction
          this block cannot afford. */}
      <h2 id="srcrec-h">
        {filing
          ? 'Every figure above came from this one document.'
          : 'There is no filing for us to point to.'}
      </h2>

      {!filing ? (
        <p className="srcnone">The API did not return filing metadata.</p>
      ) : (
        <>
          <dl className="srclist">
            {rows.map(([label, value]) => (
              <div className="srcrow" key={label}>
                <dt>{label}</dt>
                <dd>{value ?? EMPTY}</dd>
              </div>
            ))}
          </dl>

          {filing.url && (
            <a className="srcopen" href={filing.url} target="_blank" rel="noreferrer">
              Open the SEC filing
              <span className="srsronly"> (opens in a new tab)</span>
              <span aria-hidden="true"> ↗</span>
            </a>
          )}
        </>
      )}
    </section>
  )
}
