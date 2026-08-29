/* The left rail — `aside.rail` from the app screen of design/index.html.
 *
 * ── Seeded, and that is a deliberate divergence from the mockup ──────────────
 * design/index.html says, in as many words: "History only, and it starts EMPTY.
 * Rows appear as the user searches. Do not seed this." CLAUDE.md records the
 * caveat that came with that decision and left it open — a first-time visitor,
 * i.e. a judge, lands on an empty screen and must already know a ticker to get
 * anywhere.
 *
 * This build seeds five companies, on instruction, to close that cold start. The
 * rail is otherwise unchanged: still most-recent-first, still deduped, still
 * capped, and a company the user actually looks up still moves to the top. The
 * seeds are the starting contents of the history, not a separate decorated list.
 *
 * The gap is logged rather than hidden — see the parity report.
 */

const SEEDS = [
  { name: 'Apple', ticker: 'AAPL' },
  { name: 'Microsoft', ticker: 'MSFT' },
  { name: 'Nvidia', ticker: 'NVDA' },
  { name: 'Coca-Cola', ticker: 'KO' },
  { name: 'Costco', ticker: 'COST' },
]

/** The rail's starting contents. Copied, so a caller's splices can't reach these. */
export const seedHistory = () => SEEDS.map((s) => ({ ...s }))

/** Most recent first, deduped by ticker, capped at eight — the mockup's own
 *  pushHistory(), rewritten as a pure function so React owns the state. */
export function pushHistory(history, entry) {
  if (!entry?.ticker) return history
  return [entry, ...history.filter((h) => h.ticker !== entry.ticker)].slice(0, 8)
}

/** Look a ticker up in the rail, so a company arriving from the search field is
 *  named rather than shown as its own symbol. */
export const nameFor = (ticker) =>
  SEEDS.find((s) => s.ticker === ticker)?.name ?? null

export default function RecentRail({ history, active, onSelect, onHome }) {
  return (
    <aside className="rail">
      <div className="mark" onClick={onHome}>
        DCF<span>Lens</span>
      </div>
      <div className="railhead">Recent</div>

      {history.length === 0 ? (
        <div className="railempty">
          Nothing yet. The companies you look up will collect here.
        </div>
      ) : (
        history.map((h) => (
          <button
            key={h.ticker}
            type="button"
            className={`rowitem${h.ticker === active ? ' on' : ''}`}
            aria-current={h.ticker === active ? 'true' : undefined}
            onClick={() => onSelect(h)}
          >
            <b>{h.name}</b>
            <i>{h.ticker}</i>
          </button>
        ))
      )}
    </aside>
  )
}
