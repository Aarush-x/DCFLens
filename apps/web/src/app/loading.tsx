export default function Loading() {
  return (
    <main className="state-page" aria-busy="true" aria-live="polite">
      <div className="state-page__inner">
        <p className="eyebrow">Preparing research note</p>
        <h1>Reading the evidence trail.</h1>
        <div className="loading-lines" aria-hidden="true"><span /><span /><span /></div>
        <p>Normalizing facts and calculating the deterministic valuation.</p>
      </div>
    </main>
  );
}
