import { AnalysisExperience } from "@/components/analysis/analysis-experience";
import { SiteHeader } from "@/components/site-header";

export async function generateMetadata({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  const normalizedTicker = ticker.trim().toUpperCase();
  return {
    title: `${normalizedTicker} analysis — DCFLens`,
    description: `One evidence-backed valuation for ${normalizedTicker}, with assumptions and filing references shown.`,
  };
}

export default async function AnalysisPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  const normalizedTicker = ticker.trim().toUpperCase();

  return (
    <>
      <a className="skip-link" href="#content">Skip to content</a>
      <SiteHeader />
      <main className="analysis" id="content">
        <AnalysisExperience ticker={normalizedTicker} />
      </main>

      <footer className="site-footer">
        <div className="page-grid site-footer__inner">
          <p>Sources: SEC EDGAR · Live API response</p>
          <p>Deterministic DCF · Evidence-bound AI · Not investment advice</p>
        </div>
      </footer>
    </>
  );
}
