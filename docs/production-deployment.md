# Production deployment runbook

## Scope

This runbook adapts the working DeltaDCF deployment pattern to the DCFLens monorepo. It does not deploy either service and does not replace the established Vercel plus Render architecture.

The deployment reference inspected on 2026-08-29 is the local DeltaDCF checkout at `/Users/aarushmuralinathan/Documents/Frictionless AI/DeltaDcf`, branch `chore/production-deployment`, HEAD `22e99fe`, including its uncommitted deployment-hardening files. Those files are a reference snapshot, not a verified release. DCFLens verification is independent and recorded below.

## Production configuration

### Render backend

- Import the repository-root `render.yaml` as a Blueprint.
- The Blueprint creates one Docker web service named `dcflens-api`; it creates no database or disk.
- Docker build context is the repository root (`.`), and the Dockerfile is `./apps/api/Dockerfile`.
- `plan: free` is supported for web services at the time of verification and is suitable only for this prototype. Free services have constrained memory, spin down when idle, and use an ephemeral filesystem.
- `GET /health` is the liveness path. It initializes no SEC, Gemini, analysis, or cache dependency.
- Render supplies `PORT`; `python -m app` binds it on `0.0.0.0` and defaults to `8000` for local Docker use.
- Render sends `SIGTERM`. The Blueprint allows 30 seconds, while Uvicorn drains for at most 25 seconds before completing shutdown.
- Set `GOOGLE_API_KEY`, `SEC_IDENTITY`, and `CORS_ALLOWED_ORIGINS` in Render. They are declared with `sync: false` and have no repository values.
- Keep `CORS_ALLOWED_ORIGINS` to exact HTTPS frontend origins. Never use `*` in production.

The deployed cache cap is 16 entries per bounded in-memory cache. This constrains retained SEC documents and completed analyses on the prototype's small instance. Restarts and scale-out lose or split cache state; no code path treats the container filesystem as persistent storage. Introduce a shared cache adapter before relying on cache continuity or cross-instance request suppression.

### Vercel frontend

- Import the same GitHub repository as a Vercel project.
- Set Root Directory to `apps/web`.
- Select the Next.js framework preset.
- Use the existing package scripts; no `vercel.json` is required.
- Set `NEXT_PUBLIC_API_URL` to the deployed Render service origin using HTTPS and no trailing slash, path, query, credentials, or fragment.
- `NEXT_PUBLIC_API_URL` is public browser configuration. Do not create any `NEXT_PUBLIC_*` variable for Gemini, SEC identity, tokens, credentials, or prompts.
- Production and any preview environment that calls Render must define `NEXT_PUBLIC_API_URL` and must be rebuilt after it changes.

## Exact manual deployment order

1. Push the repository to GitHub.
2. Create the Render service from `render.yaml`.
3. Add backend secrets in Render: `GOOGLE_API_KEY`, an honest monitored `SEC_IDENTITY`, and an initial exact `CORS_ALLOWED_ORIGINS` value. If the final Vercel origin is not known yet, use only an intentional temporary origin and replace it at step 9.
4. Deploy and verify the Render `GET /health` URL returns `2xx` over HTTPS.
5. Create or import the Vercel project from the same repository.
6. Set Vercel Root Directory to `apps/web` and confirm the Next.js framework preset.
7. Add `NEXT_PUBLIC_API_URL` using the HTTPS Render service origin.
8. Deploy the Vercel frontend.
9. Add the final Vercel production origin, including `https://` and no trailing slash, to Render's `CORS_ALLOWED_ORIGINS`.
10. Redeploy the Render backend so the exact production CORS allowlist is active.
11. Run a production smoke test with one supported S&P 500 ticker.

Do not reverse steps 7 and 4: the frontend should not be built against an unverified or guessed backend URL. Do not broaden CORS to bridge steps 3 through 9.

## Production smoke test

1. Request the Render `/health` URL and confirm `2xx` plus the safe `dcflens-api` service body.
2. Open the Vercel production URL in a clean browser session.
3. Analyze one supported S&P 500 ticker, for example `AAPL`.
4. Confirm the UI distinguishes backend wake-up from analysis execution.
5. Confirm a real result contains the filing metadata, evidence references, deterministic valuation, sensitivity interval, checklist, and explicit AI status. Do not accept fixture data or a fabricated success.
6. Inspect browser network requests: the origin must be the configured HTTPS Render URL, and no Gemini key or SEC identity may be sent by the browser.
7. Inspect Render logs by request ID for sanitized structured events and confirm no prompt, provider response body, or credential is logged.

## Verification record

The preparation commit must not be treated as deployed production proof. The following local checks completed on 2026-08-29:

- `render.yaml` parsed successfully and asserted one Docker web service, root context, `./apps/api/Dockerfile`, free plan, `/health`, 30-second shutdown, no database, and three value-free `sync: false` settings.
- Backend: 137 tests passed. One Starlette deprecation warning from the installed test client remains; it does not affect the container's runtime dependencies.
- Frontend: lint passed, TypeScript passed, 172 tests passed, and the Next.js 16.3.3 production build completed with `NEXT_PUBLIC_API_URL=https://dcflens-api.example.invalid`.
- The exact DCFLens development fallback `http://localhost:8000` was absent from production client chunks after the environment-resolution fix. A bare `localhost` token remains inside a Next.js-bundled URL parser; it is framework code and is not an API destination or DCFLens configuration. No secret-like `NEXT_PUBLIC_*` name was present.
- Docker built `dcflens-api:deployment-parity` from context `.` using `apps/api/Dockerfile`. The effective build context was 2.65 KB, demonstrating that unrelated monorepo files were excluded.
- The resulting image digest was `sha256:dcb2dfeab92d54db9cf15b8442fe85b01a7c67e1e181c92ffaae0df496e8ad6b`, with local size 50,189,117 bytes.
- A production-configured container bound `0.0.0.0` on injected port `8765`; `GET /health` returned HTTP 200; `from app.main import app` printed `DCFLens API`.
- The process ran as `uid=10001(appuser)` and `gid=10001(appgroup)`. Image config and `/app` inspection found no `.env`, Gemini key, SEC identity value, or CORS deployment value.
- Idle local Docker usage after health was 38.32 MiB with two PIDs. This is a startup baseline, not a peak-analysis memory benchmark.
- `docker stop --timeout 10` completed in 0.37 seconds, demonstrating graceful `SIGTERM` handling without escalation to the timeout.

The local verification uses only placeholder values such as `https://dcflens-web.example` and `DCFLens deployment-check@example.com`. It does not exercise SEC or Gemini and does not contain a real credential.

Still unverified locally: Render's remote Blueprint validator/API, an actual Render cold start, Vercel's dashboard settings, live SEC/Gemini calls from the image, peak memory under concurrent analysis, and the end-to-end production smoke test. Those checks require the manual deployment steps and are intentionally not represented as complete.

## Rollback

- Vercel: promote the last known-good deployment rather than rebuilding a different artifact.
- Render: roll back to a known-good Git revision or image and restore the matching environment configuration.
- After either rollback, repeat `/health`, exact-origin CORS, browser API-origin, and one-ticker smoke checks.
- In-memory cache loss during rollback is expected. No user or evidence data may depend on the container filesystem.
