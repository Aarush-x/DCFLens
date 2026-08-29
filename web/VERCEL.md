# Deploying `web/` to Vercel

`vercel.json` in this directory does one job: it makes `/api/*` in production mean
the same thing it means in dev.

## Why a rewrite and not an env var

`src/lib/useAnalysis.js` calls `fetch('/api/analyze/AAPL')` — a relative, same-origin
path. That is deliberate:

- **No CORS.** The browser never learns the API is on another origin, so there is no
  preflight and no `Access-Control-Allow-Origin` to keep in sync between Render and
  Vercel.
- **No host in the bundle.** Nothing in `dist/` names `onrender.com`. Moving the API
  is a change to `vercel.json` and `vite.config.js`, not a rebuild of the client.

`vite.config.js` provides the dev half of that (its `server.proxy`). It is a Vite
dev-server feature and does not exist in a production build, which is what this file
is for. **Both must point at the same origin** — if you move the API, change both.

## Wiring it up

Vercel currently builds `apps/web` (the superseded Next.js frontend). For this file
to be read at all, the project's **Root Directory must be set to `web`** — a
`vercel.json` outside the root directory is ignored.

| Setting | Value |
|---|---|
| Root Directory | `web` |
| Framework Preset | Vite |
| Build Command | `npm run build` (default) |
| Output Directory | `dist` (default) |

## Cold starts

The API is on Render's free tier and sleeps when idle, so the first request after a
quiet spell takes about 30 seconds to wake the container. Nothing here can shorten
that; the client absorbs it — `LoadingNarration.jsx` narrates the wait, and
`useAnalysis.js` allows 90 seconds before giving up. Vercel's rewrite is a proxy
hop, not a serverless function, so its own timeout is not the binding constraint.
