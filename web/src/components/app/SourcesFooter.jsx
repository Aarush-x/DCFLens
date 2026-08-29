/* `footer.sources` from design/index.html.
 *
 * The mockup hardcodes two lines — "SEC EDGAR — Apple 10-K (FY2025)" and
 * "Yahoo Finance — price & financials". Here the list is whatever the adapter
 * put on `sources`, and there is a reason the second one will not appear: the
 * service makes no quote call, so claiming Yahoo as a source would assert
 * provenance we do not have, on the very page that has no price. See the
 * sourcesFor() note in src/lib/adapter.js.
 *
 * Renders nothing when we cited nothing, rather than an empty rule across the page.
 */
export default function SourcesFooter({ sources }) {
  const items = (Array.isArray(sources) ? sources : []).filter((s) => s?.label)
  if (!items.length) return null

  return (
    <footer className="sources">
      <span>Sources</span>
      {items.map((s) =>
        s.url ? (
          <a key={s.label} href={s.url} target="_blank" rel="noreferrer">{s.label}</a>
        ) : (
          <span key={s.label}>{s.label}</span>
        ),
      )}
    </footer>
  )
}
