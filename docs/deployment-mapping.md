# DeltaDCF deployment mapping

## Reference scope

This mapping uses DeltaDCF `main` commit `d13b2ea24a4a8446373b3bde51f86aab136f8f27`. Every required deployment artifact and behavior was inspected. Classifications use only the four requested labels.

## File-by-file mapping

| DeltaDCF source | Observed behavior | DCFLens equivalent | Classification | Decision |
| --- | --- | --- | --- | --- |
| `render.yaml` | Root Blueprint, Docker runtime, root context, `./backend/Dockerfile`, `/health`, checks-pass deploys, server variables | `/render.yaml` | Adapt to new monorepo paths | Keep the Blueprint shape. Rename service and change Dockerfile to `./apps/api/Dockerfile`. Review plan, region, and secret set before implementation. |
| `backend/Dockerfile` | Python 3.11 slim, non-root user, root-context copies, stdlib health check, Uvicorn CMD | `/apps/api/Dockerfile` | Adapt to new monorepo paths | Retain non-root and health patterns. Change copy paths and startup import to `app.main:app`; pin runtime and dependency strategy. |
| `.dockerignore` | Excludes Git, env files, virtualenvs, frontend, tests, reports, caches, dev requirements, README, and Blueprint | `/.dockerignore` | Adapt to new monorepo paths | Rewrite paths for `apps/web` and `apps/api`. Keep `.env.example`. Ensure required workspace metadata is not accidentally excluded. |
| `backend/.dockerignore` | Backend-local ignore for builds launched from the backend directory | No planned equivalent | Do not reuse | DCFLens defines repository-root Docker context as canonical. A second ignore file would imply an unsupported build path. |
| Docker startup command | `exec uvicorn api:app --host 0.0.0.0 --port ${PORT:-8000}` | CMD in `/apps/api/Dockerfile` | Adapt to new monorepo paths | Use `exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}`. Preserve signal forwarding and Render port injection. |
| `GET /health` in `backend/api.py` | Returns `{"status":"ok"}` without external calls; Render and Docker use it | `GET /health` in `/apps/api/app/main.py` | Copy with renamed values | Preserve the path and simple liveness semantics. Rename application metadata only. |
| `backend/.env.example` | Documents app mode, logging, port, Gemini, optional Alpha Vantage, provider selection, CORS, Ollama, SEC identity, timeouts, download size, reports path | `/apps/api/.env.example` | Adapt to new monorepo paths | Retain server-only conventions and validation. Add `GEMINI_MODEL`; omit Ollama or fallback variables unless in product scope; never include real secrets. |
| `backend/settings.py` | Cleans env input, validates provider, rejects production auto/Ollama and wildcard CORS, parses positive integers | `/apps/api/app/core/settings.py` | Adapt to new monorepo paths | Reuse validation principles in a typed settings model. Require production SEC identity, CORS, and provider-specific secrets. |
| CORS in `backend/api.py` | Exact origin list, no credentials, GET only, limited headers | `/apps/api/app/main.py` middleware | Copy with renamed values | Preserve least privilege. Expand methods or headers only when the implemented API requires them. Add preview-origin tests. |
| `frontend/.env.example` | Public `VITE_API_URL` pointing to backend | `/apps/web/.env.example` | Replace | Use `NEXT_PUBLIC_API_BASE_URL`. Explain that it is public and contains no secrets. |
| API URL handling in `frontend/src/App.jsx` | Requires production URL, dev localhost fallback, strips trailing slashes, encodes ticker, 120-second abort, maps status errors | `/apps/web/lib/api-client.ts` | Replace | Reimplement with Next.js environment and fetch conventions. Retain URL normalization, encoding, cancellation, typed errors, and build-time production validation. |
| Vercel configuration | No `frontend/vercel.json`; README configures Root Directory `frontend`, Vite build, and `dist` output | Vercel project Root Directory `apps/web`; optional root config only if justified | Replace | Next.js needs no SPA rewrite or `dist` output. Use framework auto-detection and document monorepo root settings. |
| README deployment sections | Vite and backend local setup, env tables, build commands, Render/Vercel topology, production variables, limitations | `/README.md` plus `/docs/deployment-architecture.md` | Replace | Keep README as a concise entry point. Put exact Next.js, FastAPI, Docker, Render, Vercel, verification, and rollback details in deployment docs once implemented. |

## Key path translation

```text
DeltaDCF                              DCFLens
backend/                              apps/api/
backend/api.py                        apps/api/app/main.py
backend/Dockerfile                    apps/api/Dockerfile
frontend/                             apps/web/
frontend/src/App.jsx                  apps/web/app + apps/web/lib/api-client.ts
frontend/.env.example                 apps/web/.env.example
VITE_API_URL                          NEXT_PUBLIC_API_BASE_URL
api:app                               app.main:app
render.yaml                           render.yaml
```

## What the classification means in practice

- **Copy with renamed values:** preserve behavior and security properties while changing product identifiers.
- **Adapt to new monorepo paths:** retain the operational pattern but edit paths, import targets, and context assumptions.
- **Replace:** the old artifact is framework-specific or too coupled to reproduce safely.
- **Do not reuse:** the artifact would introduce a conflicting or unsupported workflow.

## Verification required after implementation

The mapping is a design decision, not deployment proof. The eventual implementation must verify root-context Docker build, non-root execution, `PORT` binding, container and Render `/health`, exact CORS, production configuration failure modes, Next.js production build, Vercel-to-Render API calls, rollback steps, and secret absence from browser bundles.
