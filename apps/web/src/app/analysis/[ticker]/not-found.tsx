import Link from "next/link";

import { SiteHeader } from "@/components/site-header";
import { fixtureScenarios } from "@/fixtures/analysis";

export default function AnalysisNotFound() {
  return (
    <>
      <SiteHeader />
      <main className="state-page">
        <div className="state-page__inner">
          <p className="eyebrow">Nothing to show</p>
          <h1>We have not analysed that company.</h1>
          <p>
            This preview runs on fixture data, so only the companies below are
            available. Live SEC and model integration is deliberately not
            connected yet.
          </p>
          <ul className="plain-list plain-list--spaced">
            {fixtureScenarios.map((scenario) => (
              <li key={scenario.ticker}>
                <Link href={`/analysis/${scenario.ticker}`}>
                  <span className="financial-value">{scenario.ticker}</span> — {scenario.state}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </main>
    </>
  );
}
