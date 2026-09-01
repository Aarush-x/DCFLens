import Eyebrow from './ui/Eyebrow.jsx'
import './AnnualReportReview.css'

function gapFor(topic, status) {
  if (topic.coverage === 'PARTIAL_REFERENCE') return 'The filing refers to other documents. Governance coverage is incomplete.'
  if (status === 'AI_UNAVAILABLE') return 'No AI conclusion is available for this topic.'
  if (!topic.excerpts.length) return 'No usable passage was selected for this topic.'
  return 'No supported AI finding was returned for this topic.'
}

export default function AnnualReportReview({ report }) {
  return (
    <section className="annual-review av" aria-labelledby="annual-review-heading">
      <Eyebrow>Annual-report review</Eyebrow>
      <h2 id="annual-review-heading">What management says. What to question.</h2>
      <p className="annual-intro">Findings are interpretations, not independently verified facts.</p>
      {report && <>
        <div className="annual-topics">
          {report.topics.map((topic) => (
            <article className="annual-topic" key={topic.id} aria-labelledby={`annual-${topic.id}`}>
              <h3 id={`annual-${topic.id}`}>{topic.label}</h3>
              <span className="annual-label">{topic.summary ? 'AI interpretation' : 'Coverage gap'}</span>
              <p>{topic.summary || gapFor(topic, report.status)}</p>
              {topic.reason && <p className="annual-caveat">{topic.reason}</p>}
              <details>
                <summary>Know why<span className="srsronly">: {topic.label}</span></summary>
                <div className="annual-evidence">
                  <p className="annual-caveat">Selected source paragraphs only. Missing information is not evidence of misconduct.</p>
                  {!topic.excerpts.length && <p>No source excerpt is available.</p>}
                  {topic.excerpts.map((excerpt) => (
                    <div className="annual-excerpt" key={excerpt.id}>
                      <p className="annual-label">{excerpt.section} · {excerpt.cited ? 'Cited in this finding' : 'Extracted source only'}</p>
                      <blockquote>{excerpt.text}</blockquote>
                      {excerpt.url ? <a href={excerpt.url} target="_blank" rel="noopener noreferrer">Open SEC filing<span className="srsronly"> (opens in a new tab)</span></a>
                        : <p className="annual-caveat">A verified SEC filing link is unavailable.</p>}
                      <dl>
                        <dt>Accession</dt><dd>{excerpt.accession || 'Unavailable'}</dd>
                        <dt>Filed</dt><dd>{excerpt.filed || 'Unavailable'}</dd>
                        <dt>Retrieved</dt><dd>{excerpt.retrieved || 'Unavailable'}</dd>
                        <dt>Text locator</dt><dd>{excerpt.locator || 'Unavailable'}</dd>
                        <dt>Parser</dt><dd>{excerpt.parser || 'Unavailable'}</dd>
                        <dt>Document hash</dt><dd>{excerpt.hash || 'Unavailable'}</dd>
                      </dl>
                    </div>
                  ))}
                </div>
              </details>
            </article>
          ))}
        </div>
        <details className="annual-scope">
          <summary>What this review does not cover</summary>
          <p>This is a limited reading of selected annual-report passages, not a full annual-report audit. News, proxy statements and a complete subsidiary review are not included. It does not replace the ten-point checklist or calculate the valuation.</p>
          {report.warnings.length > 0 && <ul>{report.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul>}
        </details>
      </>}
    </section>
  )
}
