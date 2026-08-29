# DCFLens — frontend

React + Vite + Tailwind + GSAP + Lenis. Built to the locked design system:
pitch black, Signal Green, Clash Display / Satoshi / Geist Mono.

Status: **batch 1A shell**. The two surfaces, the wipe transition, the data hook and
the batch gate exist. The components that fill the app screen (VerdictBanner, range
bar, plain-English cards) are batch 1B and are not written yet — an empty shell is
the expected output.

```bash
npm install
npm run dev      # http://localhost:5173
./check.sh       # the batch gate — run after every batch
```

## The palette is not defined here

`src/styles/tokens.css` is a verbatim copy of the `:root` block in the design
mockup, and is the single source of truth. `tailwind.config.js` maps theme colours
to `var(--name)` and never to a hex. Do not retype a colour into a component.

## Data

`src/lib/useAnalysis.js` is the only thing in the app that loads an analysis.
Nothing else may fetch.

It serves the committed mocks today. The live API returns a different shape — the
`AnalysisEnvelope`, not `docs/API.md` — so the swap is: capture the envelope, write
`src/lib/adapter.js`, flip `USE_LIVE_API`, uncomment the two `toView` lines. That is
batch 1A.2.

```bash
curl https://dcflens-api.onrender.com/api/analyze/MSFT > src/mocks/msft-live.json
```

`vite.config.js` proxies `/api` to that host in dev, so `fetch('/api/analyze/MSFT')`
works same-origin with no CORS. **There is no production equivalent yet** — deploying
without a rewrite means every fetch 404s. Render's free tier cold-starts; allow ~30s
on the first call.

Two facts about the live API that shape the UI:

- **It carries no market price.** SEC/XBRL only. Without a price there is no verdict
  word, no marker position and no margin of safety. Return `price: null` and branch
  on it — never default to zero. A fabricated price on a valuation tool is the worst
  bug this app could ship.
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

Check 1 is **PROVISIONAL** until `src/mocks/msft-live.json` is committed (1A.2); it
shoots the payload-unavailable state instead of a fabricated response. Set
`CHECK_STRICT=1` to make a missing mock a hard failure once it lands.

`scripts/shoot.mjs` drives headless Chrome over the DevTools Protocol rather than
`--headless=new --screenshot`. The installed Chrome logs `console.error`,
`console.warn`, `console.log` and uncaught exceptions all at `INFO:CONSOLE` severity
on stderr, so the clean-console assertion — the point of the gate — cannot be made
from the log. CDP reports the real level.
