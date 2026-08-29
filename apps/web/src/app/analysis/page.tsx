import Link from "next/link";

import { TableScroll } from "@/components/analysis/table-scroll";

import { SiteHeader } from "@/components/site-header";
import { analysisFixtures, fixtureScenarios } from "@/fixtures/analysis";
import { buildAnalysisView } from "@/lib/analysis-view";
import { formatUsd, humanizeStatus } from "@/lib/format";

export const metadata = {
  title: "Fixture analyses — DCFLens",
  description: "Every fixture state the analysis page has to survive.",
};

/**
 * The fixture index. Each row is a state the analysis page must handle, so
 * this doubles as the manual QA checklist for the page.
 */
export default function AnalysisIndexPage() {
  return (
    <>
      <a className="skip-link" href="#content">Skip to content</a>
      <SiteHeader />
      <main className="analysis" id="content">
        <p className="fixture-notice" role="note">
          <strong>Fixture data.</strong> Illustrative figures only. Not research
          and not investment advice.
        </p>
        <div className="analysis__inner">
          <section className="fixture-index" aria-labelledby="fixture-index-title">
            <p className="section-index">Fixtures</p>
            <h1 id="fixture-index-title">Every state the page has to survive.</h1>
            <p className="fixture-index__lede">
              Each company below exercises a different combination of price
              availability, evidence quality, model coverage, and valuation
              result.
            </p>
            <TableScroll label="Fixture analyses">
              <table className="data-table">
                <caption>Fixture analyses and the state each one covers</caption>
                <thead>
                  <tr>
                    <th scope="col">Company</th>
                    <th scope="col">State covered</th>
                    <th scope="col" className="numeric">Estimate</th>
                    <th scope="col">Reading</th>
                  </tr>
                </thead>
                <tbody>
                  {fixtureScenarios.map((scenario) => {
                    const envelope = analysisFixtures[scenario.ticker];
                    const view = buildAnalysisView(envelope);
                    const valuation = envelope.analysis.finalValuation;
                    return (
                      <tr key={scenario.ticker}>
                        <th scope="row">
                          <Link href={`/analysis/${scenario.ticker}`}>
                            {envelope.companyName}{" "}
                            <span className="financial-value">{scenario.ticker}</span>
                          </Link>
                        </th>
                        <td>{scenario.state}</td>
                        <td className="numeric financial-value">
                          {formatUsd(valuation.intrinsicValuePerShare, valuation.currency)}
                        </td>
                        <td>
                          <span className={`status-label status-label--tone-${view.tone}`}>
                            {humanizeStatus(view.tone)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableScroll>
          </section>
        </div>
      </main>
    </>
  );
}
