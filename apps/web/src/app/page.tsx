import { getApiBaseUrl } from "@/lib/api-url";

export default function HomePage() {
  const apiBaseUrl = getApiBaseUrl();

  return (
    <main>
      <section className="shell" aria-labelledby="page-title">
        <p className="eyebrow">DCFLens scaffold</p>
        <h1 id="page-title">Evidence before conclusions.</h1>
        <p className="lede">
          The monorepo, deployment boundary, and configuration guardrails are in
          place. Valuation and filing analysis arrive in the next phase.
        </p>
        <dl className="status-grid">
          <div>
            <dt>Web</dt>
            <dd>Next.js on Vercel</dd>
          </div>
          <div>
            <dt>API</dt>
            <dd>{apiBaseUrl}</dd>
          </div>
          <div>
            <dt>Backend</dt>
            <dd>FastAPI on Render</dd>
          </div>
        </dl>
      </section>
    </main>
  );
}
