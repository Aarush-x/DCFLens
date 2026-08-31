# Targeted annual-report analysis

## Purpose and scope

The API and Render Workflow now retrieve the latest relevant 10-K primary document,
extract selected paragraphs locally, and include them in the existing Gemini
request. The full annual report is **not sent to Gemini**. There is no additional
AI call or new provider dependency.

This implementation covers four topics:

| Report topic | Filing sections searched |
| --- | --- |
| `business` | Item 1: products, segments, customers, and competition |
| `management_discussion` | Item 7: operating results, liquidity, cash flow, and capital allocation |
| `risks` | Item 1A: business and operating risks |
| `governance` | Item 9A and Items 10 through 14: controls, directors, compensation, ownership, related parties, and audit fees |

The [SEC's guide to reading a 10-K](https://www.sec.gov/answers/reada10k.htm)
explains these sections and incorporation of proxy disclosures by reference.
If governance information is only a pointer to a proxy statement, we disclose
the gap and do not treat that pointer as substantive governance evidence.

No news, proxy statements, separate Exhibit 21 subsidiary lists, PDFs/OCR, or
external links embedded in filings are fetched by this feature. Subsidiary counts
and misconduct must not be inferred from this limited sample. The existing ten
checklist items remain unchanged, and missing qualitative checklist inputs remain
unknown rather than being silently populated from model prose.

## Extraction and provenance

The existing SEC client supplies pacing, identity, timeouts, response-size limits,
bounded retry behavior, and caching. The financial baseline is calculated before
narrative retrieval. Filing failure does not invalidate available financial facts.

Parser version `10k-paragraphs-v1`:

1. Accepts native HTML or text, bounded to 20 million input characters. The SEC
   client's default download limit is separately 20 million bytes.
2. Removes scripts, styles, head content, inline-XBRL hidden sections, and elements
   marked hidden. It does not execute HTML, JavaScript, or follow links.
3. Normalizes whitespace and preserves block boundaries, with a 4 million character
   visible-text bound and a 256-element nesting bound.
4. Finds numbered Item headings with expected titles. Short table-of-contents
   entries are excluded; later substantive occurrences replace earlier candidates.
5. Ranks complete paragraphs using versioned topic keyword lists, without scoring
   positive versus negative sentiment. A following paragraph is included when it
   fits, preserving nearby qualifications. Oversized paragraphs are omitted, not
   cut. Selection is heuristic and does not guarantee every relevant qualification
   or disclosure is included.
6. Selects at most two non-overlapping excerpts per topic, eight total, at most
   900 characters each. Proxy-incorporation-only paragraphs are not candidates.

Each excerpt records its original selected text, issuer CIK, accession, form,
filing date, report date, direct filing URL, retrieval timestamp, document SHA256,
parser version, section, and start/end character offsets. Hashes use the decoded
document string re-encoded as UTF-8. Offsets are zero-based, end-exclusive positions
in the versioned normalized text, not raw HTML byte positions. This permits exact
reproduction of the excerpt without inventing an HTML anchor.

Evidence IDs hash parser version, accession, document hash, and offsets. Numeric
SEC evidence records are not rewritten or given fabricated values for prose.
AI findings resolve to the existing `FilingEvidenceReference` type; the full
excerpt details are returned beside them.

The SEC client selects the latest annual filing using its existing metadata rules.
If it selects a 10-K/A, this version reviews only that amendment and explicitly
warns that omitted original sections were not reviewed. It does not silently merge
an original report with potentially superseding amendments. Missing headings,
unusual layouts, scanned documents, and very long paragraphs can reduce coverage.

## Gemini contract and limits

The narrative policy is `compact-narrative-v1`. Facts-only requests retain
`compact-v1`. At most 64 evidence candidates enter the AI boundary. Narrative
excerpts reserve up to eight of those slots; the remaining slots contain the
existing fact candidates. These counts describe candidates, not every fact or
paragraph in the filing.

Within the shared prompt budget, one excerpt per narrative topic is prioritized,
then baseline-related financial facts, other facts, and remaining excerpts. The
existing limits still apply: at most 16 transmitted items and 8,000 serialized
bytes for evidence plus its shared URL table. Baseline instructions, the schema,
and small filing/coverage metadata are additional to that evidence-only budget.
Output remains capped at 4,096 tokens; existing deadlines and model recovery are
unchanged. More source retrieval and report output can still increase latency.

Gemini receives the deterministic baseline, original checklist, numeric evidence,
selected untrusted paragraphs, filing dates, topic mapping, and coverage warnings.
It must not follow instructions embedded in a filing or claim to have reviewed the
full document. Management assertions are attributed rather than treated as
independently verified facts.

When narrative excerpts are transmitted, the same structured JSON response must
also contain `annual_report_findings`. This is an array of zero to four entries,
with no repeated topics:

```json
{
  "topic": "management_discussion",
  "summary": "Management attributes growth to product mix but cautions that the benefit may not recur.",
  "claim_type": "INTERPRETATION",
  "evidence_ids": ["<supplied filing evidence ID>"]
}
```

The example is illustrative, not an actual issuer finding. Each summary is at
most 240 characters and cites one or two transmitted excerpts from that same
topic. Python rejects invented, omitted, wrong-section, or numeric-only citations
for these narrative findings. A valid citation establishes traceability, not the
truth of every interpretation; semantic support still needs human review.

The three existing bounded rate adjustments and their evidence remain separate.
Python still calculates the final DCF and confidence. Narrative summaries do not
introduce additional checklist items, a governance score, a BUY/SELL score, or an
independent confidence probability. Malformed report output rejects the entire AI
response and preserves the deterministic valuation, consistent with existing
strict validation behavior.

## API contract for the frontend

`GET /api/analyze/{ticker}` adds `analysis.annual_report`. The Workflow exposes
the same object at `result.analysis.annual_report`.

| Field | Meaning |
| --- | --- |
| `status` | `REVIEWED`, `NO_FINDINGS`, `UNAVAILABLE`, or `AI_UNAVAILABLE` |
| `coverage` | Extraction coverage per topic, including missing sections and incorporation by reference |
| `findings` | Validated topic summaries, interpretation labels, and resolved evidence references |
| `excerpts` | Bounded extracted source paragraphs with complete locators and hashes |
| `selected_evidence_ids` | Which narrative excerpts actually reached Gemini on a validated response |
| `warnings` | Extraction scope and amendment limitations |
| `parser_version` | Reproducible extraction policy version |

`REVIEWED` means at least one topic finding passed validation, not that all four
topics were fully audited. `NO_FINDINGS` means Gemini abstained despite receiving
excerpts. `UNAVAILABLE` means no narrative excerpts reached a successful review.
`AI_UNAVAILABLE` means the AI response failed or was rejected; excerpts may still
be returned as source material, but findings remain empty. On that path,
`selected_evidence_ids` is empty and is not an audit of attempted transmissions.
The object can be null when narrative retrieval was not requested, such as when
Gemini is not configured or a test gateway has no filing capability.

The current React/Vite frontend renders `analysis.annual_report` through its
central adapter and `AnnualReportReview`. It uses the existing Clash Display,
Satoshi, and Geist Mono fonts and color tokens. The section appears below the
valuation reasoning, before the source record:

- Add an “Annual report review” section containing available topic summaries.
- Show coverage and warnings beside the findings, including unreviewed topics.
- Let a reader expand the exact excerpt and open its direct filing URL.
- Render all model text and excerpts as plain text, never raw HTML.
- Keep narrative-review status separate from overall valuation and AI status.

The four topics remain visible even when only one has a finding. Findings require
resolvable, same-topic citations to selected excerpts. An overall AI fallback
suppresses narrative findings. Older APIs without this additive field display an
explicit unavailable message, not sample findings. Source links accept only HTTPS
SEC archive URLs, and all model text is rendered as inert React text.

Both the Render backend and Vercel frontend need this feature released. A frontend
deployment alone cannot make an older backend supply the new report. No new
frontend environment variables, fonts, or runtime dependencies are required.

## Caching, failure handling, and verification

Extracted contexts use a bounded, replaceable memory cache with the configured
cache TTL and entry count in production. Cache hits retain original retrieval
timestamps. Whole analyses still use the existing single-flight deduplication.
Raw filings use the SEC client's bounded cache. No persistent local disk is needed.

Failed extraction is not cached as a successful narrative context, and an otherwise
successful AI result with unavailable extraction is not stored in the completed
analysis cache. Later requests can retry narrative retrieval. Structured financial
facts and deterministic calculations remain cached independently.

Logs `annual_report_extracted`, `annual_report_unavailable`,
`gemini_context_prepared`, and `gemini_output_rejected` record safe status/counts,
policy identifiers, error types, or validation codes. They do not log source prose,
model output, prompts, or credentials. No new environment variables are required.

Regression tests use a clearly labeled synthetic filing and mocked providers.
They cover section boundaries, TOC duplication, hidden text, exact locators,
qualifications, proxy gaps, amendments, size limits, prompt injection, citations,
timeouts, caching, and real FastAPI serialization. They do not establish extraction
quality across all real issuers or live Gemini response latency.
