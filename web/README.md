# DCFLens — frontend

React + Vite + Tailwind + GSAP + Lenis. Built to the locked design system:
pitch black, Signal Green, Clash Display / Satoshi / Geist Mono.

Status: **phase 1 complete.** The two surfaces, the wipe transition, the adapter and
the batch gate are in, and the app screen is assembled: VerdictBanner, RangeBar, the
plain-English cards, TheNumbers, the "Why?" drawer and the four evidence blocks all
exist under `src/components/`. It is search-first — nothing is shown until the user
asks for a company — and it calls the live backend. Batch 2A is next.

```bash
npm install
npm run dev      # http://localhost:5173
./check.sh       # the batch gate — run after every batch
```

Or from the repo root, which now targets this app: `npm run dev`, `npm run build`,
`npm test`, `npm run check`. The superseded Next app under `apps/web` is still a
workspace, reachable as `npm run dev:legacy` / `npm run build:legacy`.

## The palette is not defined here

`src/styles/tokens.css` is a verbatim copy of the `:root` block in the design
mockup, and is the single source of truth. `tailwind.config.js` maps theme colours
to `var(--name)` and never to a hex. Do not retype a colour into a component.

## Data

`src/lib/useAnalysis.js` is the only thing in the app that loads an analysis.
Nothing else may fetch.

**It already fetches live.** There is no `USE_LIVE_API` flag and never was one — if
you are looking for a switch to flip, stop. `src/lib/adapter.js` is written: the API
returns the `AnalysisEnvelope`, `toView()` maps it to the `docs/API.md` v2 shape the
components read, and no component ever sees the raw envelope, whether it arrived over
the network or out of a mock.

The one rule about source selection: **an explicit `?mock=` in the URL always wins
over the network.** That is what keeps `check.sh` deterministic — a gate that depends
on Render's free tier waking up fails for reasons that have nothing to do with the
code. A ticker with no `?mock=` goes to the live API. Neither, and the default mock
stands in.

## The production API path

`fetch('/api/analyze/${ticker}')` is a same-origin *path* in both environments, and
the host is deliberately not in the bundle:

| | How `/api` reaches Render |
|---|---|
| dev | `vite.config.js` proxies `/api` to `https://dcflens-api.onrender.com` |
| production | `vercel.json` rewrites `/api/:path*` to the same host |

Both name the same origin, so there is no base-URL logic in the client and **CORS
never applies** — which matters, because the API's allowlist is exactly one origin
(`https://dcflens.vercel.app`). `localhost:5173` is refused with
`400 "Disallowed CORS origin"`; that is correct and must not be "fixed" by widening
the allowlist. The dev proxy is what makes local work.

**`vercel.json` is only read once the Vercel project's Root Directory is set to
`web`.** Until a human repoints it, the project still builds `apps/web` (the old
Next app) and `https://dcflens.vercel.app/api/analyze/AAPL` 404s. Setting the root
directory is the last step between the live API and a deployed frontend — see
`VERCEL.md`. This cannot be verified locally; it is checked in batch 4.

Render's free tier cold-starts; allow ~30s on the first call.

Two facts about the live API that shape the UI:

- **It carries no market price.** SEC/XBRL only. `docs/API.md` v3 froze the shape
  that closes this (`market_price` + `plausibility`), but the backend has not shipped
  the keys — so today there is no verdict word, no marker position and no margin of
  safety. A missing key must degrade exactly like `status: "UNAVAILABLE"`: branch on
  it, never default to zero. A fabricated price on a valuation tool is the worst bug
  this app could ship.
- **Gemini fails every call.** Every live response is `DETERMINISTIC_FALLBACK` /
  `provider_failure`. The AI-unavailable state is the current state, not an edge case.

## The batch gate

`./check.sh` builds, boots the dev server, and shoots three states, failing on any
console error:

| | State | URL |
|---|---|---|
| 1 | live MSFT envelope | `?mock=msft` |
| 2 | cannot-value | `?mock=novalue` |
| 3 | AI unavailable | `?mock=aapl&status=DETERMINISTIC_FALLBACK` |

Screenshots go to `.checks/<timestamp>/`. Keep them — comparing batch *n* to *n−1*
is how you spot the change nobody meant to make.

All three mocks are committed, `src/mocks/msft-live.json` included, so check 1 is no
longer provisional and `CHECK_STRICT=1` is safe to set.

`scripts/shoot.mjs` drives headless Chrome over the DevTools Protocol rather than
`--headless=new --screenshot`. The installed Chrome logs `console.error`,
`console.warn`, `console.log` and uncaught exceptions all at `INFO:CONSOLE` severity
on stderr, so the clean-console assertion — the point of the gate — cannot be made
from the log. CDP reports the real level.
