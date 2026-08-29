import Link from "next/link";

import { EvidenceLink } from "@/components/evidence-link";
import { SiteHeader } from "@/components/site-header";
import { StatusLabel } from "@/components/status-label";
import { TickerForm } from "@/components/ticker-form";
import { fixtureAnalysis, fixtureScenarios } from "@/fixtures/analysis";
import {
  formatCompactUsd,
  formatDate,
  formatRate,
  formatShares,
  formatUsd,
} from "@/lib/format";

export default function HomePage() {
  const envelope = fixtureAnalysis;
  const { analysis, evidence, facts, latestFiling } = envelope;
  const valuation = analysis.finalValuation;
  const interval = valuation.sensitivityInterval;
  const baseline = analysis.deterministicBaseline;
  const firstEvidence = evidence[0];

  const conceptFor = (evidenceId: string | undefined) =>
    evidenceId === undefined
      ? "—"
      : (evidence.find((item) => item.evidenceId === evidenceId)?.xbrlConcept ?? "—");

  const assumptionRows = baseline.traces.map((trace) => ({
    label: trace.label,
    value: formatRate(trace.finalBaseline),
    period: periodFor(trace.assumption, baseline.assumptions.stageOneYears, baseline.assumptions.stageTwoYears),
    explanation: trace.plainEnglishExplanation,
  }));

  return (
    <>
      <a className="skip-link" href="#content">Skip to content</a>
      <SiteHeader />
      <main id="content">
        <section className="hero page-grid" id="top" aria-labelledby="hero-title">
          <div className="hero__copy">
            <p className="eyebrow">Independent valuation · fixture research note</p>
            <h1 id="hero-title">One ticker. One valuation.</h1>
            <p className="hero__lede">
              DCFLens turns public filings into a deterministic intrinsic value,
              then shows exactly which facts and assumptions moved the result.
            </p>
            <div className="hero__actions">
              <Link className="button button--primary" href={`/analysis/${envelope.ticker}`}>
                Open the {envelope.ticker} analysis
              </Link>
              <a className="text-link" href="#method">Read the method</a>
            </div>
          </div>

          <aside className="research-ledger" aria-label="Fixture valuation summary">
            <div className="research-ledger__masthead">
              <div>
                <p className="ledger-label">Research note 001</p>
                <h2>{envelope.ticker}</h2>
              </div>
              <p>FY{facts[0]?.fiscalYear}</p>
            </div>
            <dl className="valuation-readout">
              <div className="valuation-readout__primary">
                <dt>Intrinsic value / share</dt>
                <dd className="financial-value">
                  {formatUsd(valuation.intrinsicValuePerShare, valuation.currency)}
                </dd>
              </div>
              <div>
                <dt>Sensitivity interval</dt>
                <dd className="financial-value">
                  {formatUsd(interval.lowerBoundPerShare, valuation.currency)}&ndash;
                  {formatUsd(interval.upperBoundPerShare, valuation.currency)}
                </dd>
              </div>
              <div>
                <dt>Terminal value share</dt>
                <dd className="financial-value">{formatRate(valuation.terminalValue.concentration)}</dd>
              </div>
            </dl>
            <p className="ledger-footnote">
              Illustrative fixture values, not investment advice. The interval
              expresses assumption sensitivity, not probability.
            </p>
          </aside>
        </section>

        <section className="section page-grid" id="method" aria-labelledby="method-title">
          <div className="section-heading">
            <p className="section-index">01 / Assumptions</p>
            <div>
              <h2 id="method-title">Every assumption explained.</h2>
              <p>Deterministic baselines replace universal growth shortcuts. Each rate carries observations, priors, modifiers, bounds, and evidence.</p>
            </div>
          </div>
          <div className="assumption-table" role="table" aria-label="DCF assumptions">
            <div className="table-row table-row--head" role="row">
              <span role="columnheader">Assumption</span><span role="columnheader">Baseline</span><span role="columnheader">Period</span><span role="columnheader">Why</span>
            </div>
            {assumptionRows.map((assumption) => (
              <div className="table-row" role="row" key={assumption.label}>
                <strong role="cell">{assumption.label}</strong>
                <span className="financial-value" role="cell">{assumption.value}</span>
                <span role="cell">{assumption.period}</span>
                <span role="cell">{assumption.explanation}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="section section--ink" aria-labelledby="journey-title">
          <div className="page-grid">
            <div className="section-heading section-heading--light">
              <p className="section-index">02 / Data flow</p>
              <div><h2 id="journey-title">From filing to valuation.</h2><p>The research trail remains inspectable from the raw SEC claim to the final per-share value.</p></div>
            </div>
            <ol className="journey-list">
              {[
                ["01", "Retrieve", "Latest relevant 10-K and Company Facts"],
                ["02", "Normalize", "Annual facts with claim-level provenance"],
                ["03", "Baseline", "Bounded, sector-aware deterministic assumptions"],
                ["04", "Calculate", "Two-stage DCF with machine-readable workings"],
                ["05", "Explain", "Evidence-bound interpretation and caveats"],
              ].map(([number, title, description]) => (
                <li key={number}><span className="journey-list__number financial-value">{number}</span><h3>{title}</h3><p>{description}</p></li>
              ))}
            </ol>
          </div>
        </section>

        <section className="section page-grid" id="evidence" aria-labelledby="evidence-title">
          <div className="section-heading">
            <p className="section-index">03 / Provenance</p>
            <div><h2 id="evidence-title">Every conclusion traced to evidence.</h2><p>A claim keeps its provider, filing, period, XBRL concept, unit, transformation, and retrieval context. A generic annual-report link is never enough.</p></div>
          </div>
          <div className="evidence-layout">
            <dl className="fact-ledger">
              {facts.map((fact) => (
                <div key={fact.metric}>
                  <dt>{fact.label}</dt>
                  <dd>
                    <span className="financial-value">
                      {fact.unit === "shares" ? formatShares(fact.value) : formatCompactUsd(fact.value, fact.unit)}
                    </span>
                    <span>{conceptFor(fact.evidenceIds[0])}</span>
                  </dd>
                </div>
              ))}
            </dl>
            <aside className="source-record" aria-label="Example evidence reference">
              <p className="ledger-label">Evidence reference</p>
              <p className="source-record__id financial-value">{firstEvidence.evidenceId}</p>
              <dl>
                <div><dt>Provider</dt><dd>{firstEvidence.provider}</dd></div>
                <div><dt>Accession</dt><dd className="financial-value">{latestFiling.accessionNumber}</dd></div>
                <div><dt>Filed</dt><dd className="financial-value">{formatDate(latestFiling.filingDate)}</dd></div>
              </dl>
              <EvidenceLink evidenceId={firstEvidence.evidenceId} href={firstEvidence.sourceUrl}>Open direct filing evidence</EvidenceLink>
            </aside>
          </div>
        </section>

        <section className="section page-grid" id="checklist" aria-labelledby="checklist-title">
          <div className="section-heading">
            <p className="section-index">04 / Quality lens</p>
            <div><h2 id="checklist-title">The original ten-point checklist.</h2><p>The wording and order remain unchanged. Sector context changes only applicability, evidence, and interpretation—never the framework.</p></div>
          </div>
          <ol className="checklist">
            {analysis.deterministicChecklist.map((item) => (
              <li key={item.checklistNumber}>
                <span className="checklist__number financial-value">{String(item.checklistNumber).padStart(2, "0")}</span>
                <div className="checklist__finding">
                  <h3>{item.checklistText}</h3>
                  <p>{item.plainEnglishExplanation}</p>
                </div>
                <StatusLabel status={item.status} />
              </li>
            ))}
          </ol>
        </section>

        <section className="section page-grid" aria-labelledby="explanation-title">
          <div className="section-heading">
            <p className="section-index">05 / Two depths</p>
            <div><h2 id="explanation-title">Plain English, then &ldquo;Know why.&rdquo;</h2><p>Read the conclusion quickly, or inspect the technical basis without losing the link between the two.</p></div>
          </div>
          <div className="explanation-pair">
            <article>
              <p className="ledger-label">Plain English</p>
              <h3>The answer first, in words a beginner can act on.</h3>
              <p>One estimate, the range around it, today&rsquo;s price beside it, and what would have to be true for any of it to hold.</p>
            </article>
            <article>
              <p className="ledger-label">Know why</p>
              <h3>{formatRate(valuation.terminalValue.concentration)} of enterprise value comes from the terminal value.</h3>
              <p>Open the assumptions, the year-by-year arithmetic, and every filing reference behind them.</p>
            </article>
          </div>
        </section>

        <section className="final-cta" id="analyze" aria-labelledby="analyze-title">
          <div className="page-grid final-cta__inner">
            <div>
              <p className="section-index">Begin a research note</p>
              <h2 id="analyze-title">What company do you want to understand?</h2>
              <p>
                This preview runs on fixture data covering{" "}
                {fixtureScenarios.length} analysis states. Live SEC and model
                integration is intentionally deferred.
              </p>
            </div>
            <TickerForm />
          </div>
        </section>
      </main>
      <footer className="site-footer"><div className="page-grid site-footer__inner"><p>DCFLens · Evidence-first valuation research</p><p>Fixture data · Not investment advice</p></div></footer>
    </>
  );
}

function periodFor(assumption: string, stageOneYears: number, stageTwoYears: number): string {
  switch (assumption) {
    case "stage_one_growth_rate":
      return `Years 1–${stageOneYears}`;
    case "stage_two_growth_rate":
      return `Years ${stageOneYears + 1}–${stageOneYears + stageTwoYears}`;
    case "terminal_growth_rate":
      return `Year ${stageOneYears + stageTwoYears + 1} onward`;
    default:
      return "All years";
  }
}
