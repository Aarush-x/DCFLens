import { StatusLabel } from "@/components/status-label";
import type { LiveAnalysisEnvelope, LiveEvidenceReference } from "@/lib/live-analysis-types";
import { formatDate, formatDateTime, formatRate, formatUsd } from "@/lib/format";

export function LiveAnalysisDocument({ envelope }: { envelope: LiveAnalysisEnvelope }) {
  const { analysis } = envelope;
  const valuation = analysis.finalValuation;
  const interval = valuation.sensitivityInterval;
  const currency = valuation.inputs.currency;

  return (
    <div className="analysis__inner live-analysis">
      {analysis.status === "DETERMINISTIC_FALLBACK" ? (
        <section className="request-notice request-notice--warning" aria-labelledby="ai-fallback-title">
          <p className="section-index">AI analysis unavailable</p>
          <h2 id="ai-fallback-title">The deterministic valuation is preserved.</h2>
          <p>
            Gemini did not contribute to this result. DCFLens kept the evidence-backed baseline and
            did not turn a provider failure into a failed valuation.
          </p>
          {analysis.fallbackReason ? <p className="request-notice__detail">{analysis.fallbackReason}</p> : null}
        </section>
      ) : null}

      <section className="verdict verdict--neutral" aria-labelledby="verdict-title">
        <p className="eyebrow">
          {envelope.companyName} · <span className="financial-value">{envelope.ticker}</span>
        </p>
        <h1 id="verdict-title">One evidence-backed estimate.</h1>
        <p className="verdict__detail">
          Based on the latest normalized SEC facts and the bounded assumptions shown below.
        </p>
        <dl className="verdict__figures">
          <div>
            <dt>Intrinsic value per share</dt>
            <dd className="financial-value verdict__estimate">
              {formatUsd(valuation.intrinsicValuePerShare, currency)}
            </dd>
            <p className="verdict__figure-note">One final valuation, not a buy or sell signal.</p>
          </div>
          <div>
            <dt>Assumption sensitivity</dt>
            <dd className="financial-value">
              {formatUsd(interval.lowerBoundPerShare, currency)} – {formatUsd(interval.upperBoundPerShare, currency)}
            </dd>
            <p className="verdict__figure-note">Not a probability or price forecast.</p>
          </div>
          <div>
            <dt>Confidence</dt>
            <dd>{analysis.confidence.level}</dd>
            <p className="verdict__figure-note">Evidence and model confidence, not outcome probability.</p>
          </div>
        </dl>
        <p className="disclaimer" role="note">
          Research output, not financial advice. No market price is guessed or supplied by the API.
        </p>
      </section>

      <section className="live-section" aria-labelledby="assumptions-title">
        <p className="section-index">01 / Valuation mechanics</p>
        <h2 id="assumptions-title">The assumptions behind the number.</h2>
        <dl className="live-metric-grid">
          <Metric label="Stage-one growth" value={formatRate(valuation.assumptions.stageOneGrowthRate)} />
          <Metric label="Stage-two growth" value={formatRate(valuation.assumptions.stageTwoGrowthRate)} />
          <Metric label="Terminal growth" value={formatRate(valuation.assumptions.terminalGrowthRate)} />
          <Metric label="Discount rate" value={formatRate(valuation.assumptions.discountRate)} />
          <Metric label="Starting free cash flow" value={formatUsd(valuation.inputs.startingFreeCashFlow, currency)} />
          <Metric label="Net debt" value={formatUsd(valuation.inputs.netDebt, currency)} />
          <Metric label="Enterprise value" value={formatUsd(valuation.decomposition.enterpriseValue, currency)} />
          <Metric label="Equity value" value={formatUsd(valuation.decomposition.equityValue, currency)} />
        </dl>
        <p className="live-section__note">
          Terminal value contributes {formatRate(valuation.terminalValue.concentration)} of enterprise value.
        </p>
      </section>

      <section className="live-section" aria-labelledby="checklist-title">
        <p className="section-index">02 / Original framework</p>
        <h2 id="checklist-title">The unchanged ten-point checklist.</h2>
        <ol className="checklist live-checklist">
          {analysis.deterministicChecklist.map((item) => (
            <li key={item.checklistNumber}>
              <span className="checklist__number financial-value">
                {String(item.checklistNumber).padStart(2, "0")}
              </span>
              <div className="checklist__finding">
                <h3>{item.checklistText}</h3>
                <p>{item.plainEnglishExplanation}</p>
                <EvidenceReferences references={item.evidenceReferences} />
              </div>
              <StatusLabel status={item.status} />
            </li>
          ))}
        </ol>
      </section>

      <section className="live-section" aria-labelledby="evidence-title">
        <p className="section-index">03 / Evidence and model</p>
        <h2 id="evidence-title">What the analysis could support.</h2>
        <p className="live-section__lede">{analysis.confidence.explanation}</p>
        {analysis.evidenceAssessment.length > 0 ? (
          <ul className="evidence-assessment-list">
            {analysis.evidenceAssessment.map((assessment) => (
              <li key={`${assessment.claimType}:${assessment.statement}`}>
                <div>
                  <p className="ledger-label">{assessment.claimType} · {assessment.support.replaceAll("_", " ")}</p>
                  <p>{assessment.statement}</p>
                </div>
                <EvidenceReferences references={assessment.evidenceReferences} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="live-section__note">No qualitative evidence assessments were returned.</p>
        )}
        <p className="live-section__note">{analysis.disagreement.summary}</p>
      </section>

      <section className="live-section live-filing" aria-labelledby="filing-title">
        <p className="section-index">04 / Source record</p>
        <h2 id="filing-title">Direct filing provenance.</h2>
        {envelope.latestFiling ? (
          <dl>
            <div><dt>Filing</dt><dd>{envelope.latestFiling.filingForm}</dd></div>
            <div><dt>Period</dt><dd className="financial-value">{formatDate(envelope.latestFiling.reportDate)}</dd></div>
            <div><dt>Filed</dt><dd className="financial-value">{formatDate(envelope.latestFiling.filingDate)}</dd></div>
            <div><dt>Accession</dt><dd className="financial-value">{envelope.latestFiling.accessionNumber}</dd></div>
            <div><dt>SEC retrieval</dt><dd className="financial-value">{formatDateTime(envelope.secRetrievedAt)}</dd></div>
          </dl>
        ) : (
          <p className="live-section__note">The API did not return filing metadata.</p>
        )}
        {envelope.latestFiling?.filingUrl ? (
          <a className="text-link" href={envelope.latestFiling.filingUrl} rel="noreferrer" target="_blank">
            Open the SEC filing <span className="visually-hidden">(opens in a new tab)</span>
          </a>
        ) : null}
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd className="financial-value">{value}</dd></div>;
}

function EvidenceReferences({ references }: { references: LiveEvidenceReference[] }) {
  const usable = references.filter((reference) => reference.sourceUrl);
  if (usable.length === 0) {
    return <p className="citation citation--empty">No direct filing citation was returned for this statement.</p>;
  }
  return (
    <ul className="citation">
      {usable.map((reference) => (
        <li key={reference.evidenceId}>
          <a href={reference.sourceUrl} rel="noreferrer" target="_blank">
            {reference.filingForm ?? "SEC filing"} · {reference.xbrlConcept ?? reference.description ?? "evidence"}
            <span className="visually-hidden"> (opens in a new tab)</span>
          </a>
          <span className="citation__id financial-value">{reference.evidenceId}</span>
        </li>
      ))}
    </ul>
  );
}
