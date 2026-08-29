# DeltaDCF deployment mapping

## Reference scope

This mapping uses DeltaDCF `main` commit `d13b2ea24a4a8446373b3bde51f86aab136f8f27`. Every required deployment artifact and behavior was inspected. Classifications use only the four requested labels.

## File-by-file mapping

| DeltaDCF source | Observed behavior | DCFLens equivalent | Classification | Decision |
| --- | --- | --- | --- | --- |
| `render.yaml` | Root Blueprint, Docker runtime, root context, `./backend/Dockerfile`, `/health`, checks-pass deploys, server variables | `/render.yaml` | Adapt to new monorepo paths | Keeps the Blueprint shape, renames the service, uses `./apps/api/Dockerfile`, and declares deployment-supplied secrets with `sync: false`. Region is intentionally left to the Render default. |
| `backend/Dockerfile` | Python 3.11 slim, non-root user, root-context copies, stdlib health check, Uvicorn CMD | `/apps/api/Dockerfile` | Adapt to new monorepo paths | Retains non-root and health patterns with a supported Python 3.12 slim base, production-only requirements, new copy paths, and the `app.main:app` import. |
| `.dockerignore` | Excludes Git, env files, virtualenvs, frontend, tests, reports, caches, dev requirements, README, and Blueprint | `/.dockerignore` | Adapt to new monorepo paths | Rewrite paths for `apps/web` and `apps/api`. Exclude all environment files from the image context, including examples; keep examples versioned in Git. |
| `backend/.dockerignore` | Backend-local ignore for builds launched from the backend directory | No planned equivalent | Do not reuse | DCFLens defines repository-root Docker context as canonical. A second ignore file would imply an unsupported build path. |
| Docker startup command | `exec uvicorn api:app --host 0.0.0.0 --port ${PORT:-8000}` | `CMD ["python", "-m", "app"]` in `/apps/api/Dockerfile` plus `/apps/api/app/__main__.py` | Adapt to new monorepo paths | The Python entry point imports `app.main:app`, binds `0.0.0.0`, reads Render's `PORT`, and defaults to `8000`; it avoids shell interpolation while preserving the monorepo import path. |
| `GET /health` in `backend/api.py` | Returns `{"status":"ok"}` without external calls; Render and Docker use it | `GET /health` in `/apps/api/app/main.py` | Copy with renamed values | Preserve the path and simple liveness semantics. Rename application metadata only. |
| `backend/.env.example` | Documents app mode, logging, port, Gemini, optional Alpha Vantage, provider selection, CORS, Ollama, SEC identity, timeouts, download size, reports path | `/apps/api/.env.example` | Adapt to new monorepo paths | Retains the server-only variables used by the scaffold. Add model-selection, timeout, or fallback variables only with those features; never include real secrets. |
| `backend/settings.py` | Cleans env input, validates provider, rejects production auto/Ollama and wildcard CORS, parses positive integers | `/apps/api/app/core/settings.py` | Adapt to new monorepo paths | Reuses validation principles in an immutable settings model. The scaffold requires production SEC identity and exact CORS; provider credentials become mandatory only when their feature is enabled. |
| CORS in `backend/api.py` | Exact origin list, no credentials, GET only, limited headers | `/apps/api/app/main.py` middleware | Copy with renamed values | Preserve least privilege. Expand methods or headers only when the implemented API requires them. Add preview-origin tests. |
| `frontend/.env.example` | Public `VITE_API_URL` pointing to backend | `/apps/web/.env.example` | Replace | Use `NEXT_PUBLIC_API_URL`. Explain that it is public and contains no secrets. |
| API URL handling in `frontend/src/App.jsx` | Requires production URL, dev localhost fallback, strips trailing slashes, encodes ticker, 120-second abort, maps status errors | `/apps/web/src/lib/api-url.ts`, with a future API client beside it | Replace | Reimplement with Next.js environment and fetch conventions. The scaffold centralizes URL validation now; add encoding, cancellation, and typed HTTP errors with the first API client. |
| Vercel configuration | No `frontend/vercel.json`; README configures Root Directory `frontend`, Vite build, and `dist` output | Vercel project Root Directory `apps/web`; optional root config only if justified | Replace | Next.js needs no SPA rewrite or `dist` output. Use framework auto-detection and document monorepo root settings. |
| README deployment sections | Vite and backend local setup, env tables, build commands, Render/Vercel topology, production variables, limitations | `/README.md` plus `/docs/deployment-architecture.md` | Replace | Keep README as a concise entry point. Put exact Next.js, FastAPI, Docker, Render, Vercel, verification, and rollback details in deployment docs once implemented. |

## Key path translation

```text
DeltaDCF                              DCFLens
backend/                              apps/api/
backend/api.py                        apps/api/app/main.py
backend/Dockerfile                    apps/api/Dockerfile
frontend/                             apps/web/
frontend/src/App.jsx                  apps/web/src/app + apps/web/src/lib/api-url.ts
frontend/.env.example                 apps/web/.env.example
VITE_API_URL                          NEXT_PUBLIC_API_URL
api:app                               app.main:app
render.yaml                           render.yaml
```

## What the classification means in practice

- **Copy with renamed values:** preserve behavior and security properties while changing product identifiers.
- **Adapt to new monorepo paths:** retain the operational pattern but edit paths, import targets, and context assumptions.
- **Replace:** the old artifact is framework-specific or too coupled to reproduce safely.
- **Do not reuse:** the artifact would introduce a conflicting or unsupported workflow.

## Verification contract

The mapping and scaffold are not deployment proof. Validation must cover root-context Docker build, non-root execution, `PORT` binding, container and Render `/health`, exact CORS, production configuration failure modes, Next.js production build, Vercel-to-Render API calls, rollback steps, and secret absence from browser bundles. Checks that require Docker or deployed services remain open until those environments are available.
