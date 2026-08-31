const list = (value) => Array.isArray(value) ? value : []
const text = (value) => typeof value === 'string' ? value.trim() : ''

export const REPORT_TOPICS = [
  ['business', 'The business'],
  ['management_discussion', 'Management discussion'],
  ['risks', 'Risks to watch'],
  ['governance', 'Governance and oversight'],
]

function filingUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'www.sec.gov'
      && !url.username && !url.password && !url.port && url.pathname.startsWith('/Archives/')
      ? url.href : null
  } catch { return null }
}

/** Additive API contract. Older deployments remain readable, never fabricated. */
export function toAnnualReport(raw, aiFailed = false) {
  if (!raw || typeof raw !== 'object') return null
  const status = aiFailed ? 'AI_UNAVAILABLE' : (
    ['REVIEWED', 'NO_FINDINGS', 'UNAVAILABLE', 'AI_UNAVAILABLE'].includes(raw.status)
      ? raw.status : 'UNAVAILABLE'
  )
  const selected = new Set(list(raw.selected_evidence_ids))
  const excerpts = list(raw.excerpts).slice(0, 8).filter((e) => e && text(e.evidence_id) && text(e.text))
  return {
    status,
    warnings: list(raw.warnings).filter((v) => text(v)).slice(0, 12),
    topics: REPORT_TOPICS.map(([id, label]) => {
      const coverage = list(raw.coverage).find((c) => c?.topic === id)
      const finding = status === 'REVIEWED' && list(raw.findings).find((f) =>
        f?.topic === id && f.claim_type === 'INTERPRETATION' && text(f.summary))
      const refs = list(finding?.evidence_references)
      const cited = refs.map((ref) => excerpts.find((e) =>
        e.topic === id && e.evidence_id === ref?.evidence_id && selected.has(e.evidence_id)))
      // Do not display a claim if even one of its supplied citations cannot resolve.
      const supported = refs.length > 0 && cited.every(Boolean)
      const topicExcerpts = excerpts.filter((e) => e.topic === id).map((e) => ({
        id: e.evidence_id, text: e.text, section: text(e.section),
        url: filingUrl(e.source_url), accession: text(e.accession_number),
        filed: text(e.filing_date), retrieved: text(e.retrieved_at), locator: text(e.locator),
        parser: text(e.parser_version), hash: text(e.document_sha256),
        cited: supported && cited.some((c) => c.evidence_id === e.evidence_id),
      }))
      return {
        id, label,
        summary: supported ? text(finding.summary) : null,
        coverage: text(coverage?.status), reason: text(coverage?.reason), excerpts: topicExcerpts,
      }
    }),
  }
}
