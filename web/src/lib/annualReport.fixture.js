// Synthetic test data only. Never selected by the production analysis loader.
export const annualReportFixture = {
  status: 'REVIEWED',
  coverage: [
    { topic: 'business', status: 'EXCERPTS_SELECTED', reason: 'A limited sample of Item 1 was selected.' },
    { topic: 'management_discussion', status: 'EXCERPTS_SELECTED', reason: 'Selected passages from Item 7, not the entire discussion.' },
    { topic: 'risks', status: 'NOT_FOUND', reason: 'No usable risk passage was selected.' },
    { topic: 'governance', status: 'PARTIAL_REFERENCE', reason: 'The filing incorporates the proxy statement by reference. The proxy was not retrieved.' },
  ],
  findings: [
    { topic: 'business', summary: 'Management describes a recurring-service business. This suggests repeat demand, but does not establish a durable moat.', claim_type: 'INTERPRETATION', evidence_references: [{ evidence_id: 'test-business' }] },
    { topic: 'management_discussion', summary: 'Management attributes growth to customer renewals while noting higher investment costs. Cash conversion remains worth monitoring.', claim_type: 'INTERPRETATION', evidence_references: [{ evidence_id: 'test-mda' }] },
  ],
  excerpts: [
    { evidence_id: 'test-business', topic: 'business', section: 'Item 1', text: 'SYNTHETIC TEST EXCERPT: Our services are sold on renewable contracts. Renewal rates depend on customer satisfaction and competing offerings.', source_url: 'https://www.sec.gov/Archives/edgar/data/1/test/annual.htm', accession_number: '0000000001-26-000001', filing_date: '2026-08-01', retrieved_at: '2026-08-31T12:00:00Z', locator: 'Item 1; normalized characters [10,150)', parser_version: '10k-paragraphs-v1', document_sha256: 'a'.repeat(64) },
    { evidence_id: 'test-mda', topic: 'management_discussion', section: 'Item 7', text: 'SYNTHETIC TEST EXCERPT: Revenue increased with customer renewals. Investment costs also increased, and future cash generation depends on collections.', source_url: 'https://www.sec.gov/Archives/edgar/data/1/test/annual.htm', accession_number: '0000000001-26-000001', filing_date: '2026-08-01', retrieved_at: '2026-08-31T12:00:00Z', locator: 'Item 7; normalized characters [500,650)', parser_version: '10k-paragraphs-v1', document_sha256: 'a'.repeat(64) },
  ],
  selected_evidence_ids: ['test-business', 'test-mda'],
  warnings: ['Synthetic fixture. Selected paragraphs only; no proxy, news or subsidiary audit.'],
}
