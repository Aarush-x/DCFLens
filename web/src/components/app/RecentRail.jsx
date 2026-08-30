/* The left rail — `aside.rail` from the app screen of design/index.html.
 *
 * ── History only, and it starts empty ────────────────────────────────────────
 * 1C.1 is explicit: "The sidebar is HISTORY ONLY and starts EMPTY. Do not seed
 * it. It fills as the user searches... not a placeholder list, not five greyed
 * examples." An earlier build seeded Apple/Microsoft/Nvidia/Coca-Cola/Costco to
 * close the cold start. That did not remove the mockup's example chips, it moved
 * them into the rail — the one place the prompt ruled out. They are gone.
 *
 * The cold start those seeds were meant to solve is real and is NOT solved here:
 * a first-time visitor lands on an empty screen and must already know a ticker.
 * 1C.1 accepts that trade-off in as many words, and CLAUDE.md records where the
 * fix belongs if the demo needs one — a hint UNDER THE FIELD, not rows in here.
 * A hint is an offer; a populated sidebar is a claim about the user's history,
 * and on a first visit that claim is false.
 *
 * ── It survives a reload ─────────────────────────────────────────────────────
 * A rail that fills from use has to remember, or it resets to empty on every
 * visit and can never become the thing it is for. localStorage, capped and
 * deduped by exactly the rule pushHistory applies in memory.
 *
 * Every access is wrapped. Storage throws outright in a private window and when
 * a browser is set to block site data, and it can hand back anything at all —
 * a half-written array, a payload from an older shape. None of that may take
 * the app down on boot: the rail degrades to "no history", which is a state it
 * already renders, and the user loses a convenience rather than the product.
 */

/** Bumped if the stored shape ever changes, so old data is ignored rather than
 *  parsed into something half-valid. */
const KEY = 'dcflens.history.v1'

/** 1C.1: "Cap it at ~8". Applied on write AND on read — a file edited by hand,
 *  or written by an older build, does not get to grow the rail without limit. */
const CAP = 8

/* Ticker → the name we show. The mirror of AppScreen's BY_NAME, and the reason
   it exists is the same: the SEC registrant name is "COSTCO WHOLESALE CORP /NEW",
   which is worse to read than "Costco". This is a naming table, NOT history —
   nothing in here reaches the rail until the user looks that company up. */
const KNOWN_NAMES = {
  AAPL: 'Apple',
  MSFT: 'Microsoft',
  NVDA: 'Nvidia',
  KO: 'Coca-Cola',
  COST: 'Costco',
}

/** One stored row, or null. A row is only worth keeping if it can be clicked,
 *  and that needs a ticker; the name is optional because the API fills it in. */
function validEntry(raw) {
  const ticker = typeof raw?.ticker === 'string' ? raw.ticker.trim() : ''
  if (!ticker) return null
  const name = typeof raw?.name === 'string' && raw.name.trim() ? raw.name.trim() : ticker
  return { ticker, name }
}

/**
 * The rail's starting contents: whatever the last visit left, or nothing.
 *
 * Passed to useState as an initialiser, so it runs once on mount rather than on
 * every render. Anything unreadable is treated as no history at all — see the
 * header on why this never throws.
 */
export function loadHistory() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) ?? '[]')
    if (!Array.isArray(parsed)) return []
    const seen = new Set()
    const rows = []
    for (const raw of parsed) {
      const entry = validEntry(raw)
      if (!entry || seen.has(entry.ticker)) continue
      seen.add(entry.ticker)
      rows.push(entry)
      if (rows.length === CAP) break
    }
    return rows
  } catch {
    return []
  }
}

/** Write the rail back. Silent on failure: a full quota or a blocked store costs
 *  the user their history next visit, and there is nothing to say about it now
 *  that would not be noise on a screen about a company. */
export function saveHistory(history) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(history.slice(0, CAP)))
  } catch {
    /* storage unavailable or full — the in-memory rail still works */
  }
}

/** Most recent first, deduped by ticker, capped at eight — the mockup's own
 *  pushHistory(), rewritten as a pure function so React owns the state. */
export function pushHistory(history, entry) {
  if (!entry?.ticker) return history
  return [entry, ...history.filter((h) => h.ticker !== entry.ticker)].slice(0, CAP)
}

/** Look a ticker up so a company arriving from the search field is named rather
 *  than shown as its own symbol. Unknown tickers return null and the row shows
 *  its symbol until the response arrives with the real name — AppScreen fills it
 *  in then, rather than guessing at one now. */
export const nameFor = (ticker) => KNOWN_NAMES[ticker] ?? null

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
