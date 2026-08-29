import { notFound } from "next/navigation";

import { KnowWhy } from "@/components/analysis/know-why";
import {
  DisagreementCallout,
  PlainAssessment,
  PlainNarrativeSection,
} from "@/components/analysis/plain-english";
import { VerdictBanner } from "@/components/analysis/verdict-banner";
import { SiteHeader } from "@/components/site-header";
import { fixtureTickers, getAnalysisFixture } from "@/fixtures/analysis";
import { buildAnalysisView } from "@/lib/analysis-view";
import { formatDate } from "@/lib/format";

export function generateStaticParams() {
  return fixtureTickers.map((ticker) => ({ ticker }));
}

export async function generateMetadata({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  const envelope = getAnalysisFixture(ticker);
  if (envelope === null) {
    return { title: "Not analysed — DCFLens" };
  }
  return {
    title: `${envelope.companyName} (${envelope.ticker}) — DCFLens`,
    description: `One valuation for ${envelope.companyName}, with every assumption and filing reference shown. Fixture data, not investment advice.`,
  };
}

export default async function AnalysisPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  const envelope = getAnalysisFixture(ticker);

  if (envelope === null) {
    notFound();
  }

  const view = buildAnalysisView(envelope);

  return (
    <>
      <a className="skip-link" href="#content">Skip to content</a>
      <SiteHeader />
      <main className="analysis" id="content">
        <p className="fixture-notice" role="note">
          <strong>Fixture data.</strong> Every figure on this page is
          illustrative and was not taken from a filing. The filing links are
          real so they can be checked. This is not research and not investment
          advice.
        </p>

        <div className="analysis__inner">
          <VerdictBanner envelope={envelope} view={view} />
          <DisagreementCallout view={view} />
          <PlainAssessment envelope={envelope} view={view} />
          <PlainNarrativeSection envelope={envelope} view={view} />
          <KnowWhy envelope={envelope} view={view} />
        </div>
      </main>

      <footer className="site-footer">
        <div className="page-grid site-footer__inner">
          <p>
            Sources: SEC EDGAR · {envelope.latestFiling.form}{" "}
            <span className="financial-value">{envelope.latestFiling.accessionNumber}</span>, filed{" "}
            {formatDate(envelope.latestFiling.filingDate)}
          </p>
          <p>
            <span className="financial-value">{envelope.methodologyVersion}</span> ·{" "}
            <span className="financial-value">{envelope.analysisVersion}</span> · Fixture data · Not
            investment advice
          </p>
        </div>
      </footer>
    </>
  );
}
