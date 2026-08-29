# DeltaDCF to DCFLens deployment parity

## Reference provenance

The deployment comparison uses the local DeltaDCF checkout at `/Users/aarushmuralinathan/Documents/Frictionless AI/DeltaDcf`, inspected on 2026-08-29. It is on branch `chore/production-deployment` at HEAD `22e99fe` and contains modified and untracked deployment-hardening files. The table therefore describes that exact working tree, not a clean DeltaDCF release or a claim that its deployment was previously verified.

DCFLens remains an adaptation of the same operational pattern: one browser frontend on Vercel, one Dockerized FastAPI web service on Render, a root Blueprint, a dependency-free liveness route, runtime-only secrets, and an explicit browser-origin allowlist. Framework-specific and old-layout details are replaced.

## Deployment parity table

| DeltaDCF file or setting | DCFLens equivalent | Classification | What changed | Why it changed | How it was verified |
| --- | --- | --- | --- | --- | --- |
| Root `render.yaml` with one Docker web service | Root `render.yaml` with service `dcflens-api` | Adapt to new monorepo paths | `env: docker` became current `runtime: docker`; `dockerFilePath: backend/Dockerfile` became current `dockerfilePath: ./apps/api/Dockerfile`; product name changed; no region is forced. | DCFLens uses `apps/api`; current Render Blueprint syntax uses `runtime` and lowercase `dockerfilePath`. | Parsed as YAML; inspected as exactly one `type: web` and `runtime: docker` service; fields checked against the current Render Blueprint reference. |
| Root-context Docker build (`dockerContext: .`) | `dockerContext: .` | Copy with renamed values | Context shape is unchanged; the copy sources inside the Dockerfile use `apps/api`. | Both repositories need repository-root context for their source paths. | Compared `COPY` sources to the context and built with `docker build -f apps/api/Dockerfile ... .`. |
| DeltaDCF `plan: free` | DCFLens `plan: free` | Copy with renamed values | No structural change; docs now state prototype limitations. | Render currently supports `free` for web services, matching the requested prototype target. | Checked against current Render Blueprint and Free-instance documentation. |
| DeltaDCF `/health` Blueprint path | DCFLens `healthCheckPath: /health` | Copy with renamed values | Path and liveness semantics are preserved. | Render needs a fast process-health signal, not an upstream dependency probe. | Backend health tests prove `200` and no analysis-service initialization; container health was called directly. |
| DeltaDCF default shutdown behavior | `maxShutdownDelaySeconds: 30` and Uvicorn `timeout_graceful_shutdown=25` | Replace | DCFLens makes both platform and server drain bounds explicit. | An explicit five-second margin reduces the chance of Render escalating from `SIGTERM` to `SIGKILL`. | Entrypoint unit test asserts the Uvicorn value; local container stop checks signal handling and exit. |
| `backend/Dockerfile` on Python 3.11 slim with compiler/PDF packages and `curl` | `apps/api/Dockerfile` on `python:3.12-slim-bookworm` | Adapt to new monorepo paths | Uses the new source path, installs only API runtime requirements, omits unused compilers/PDF libraries/curl, copies only `app`, and keeps a fixed non-root UID/GID. | DCFLens currently has no native/PDF build dependency; the smaller surface is sufficient for its SEC and Gemini HTTP clients. | Root-context build, application import, image package/content inspection, Docker health, and numeric UID checks. |
| DeltaDCF shell Uvicorn command `uvicorn api:app --host 0.0.0.0 --port ${PORT}` | Docker `CMD ["python", "-m", "app"]` plus `app/__main__.py` | Adapt to new monorepo paths | Import target is `app.main:app`; Python reads and validates `PORT`; host remains `0.0.0.0`; local default remains `8000`. | Avoids shell interpolation while keeping Render's runtime port contract and the monorepo import path. | Runtime tests cover host, injected port, fallback, invalid ports, import target, and graceful timeout; container ran on a nondefault port. |
| DeltaDCF root `.dockerignore` | DCFLens root `.dockerignore` | Adapt to new monorepo paths | Rewrites `frontend`/`backend` exclusions to `apps/web`/`apps/api`; excludes all env files, Git, caches, tests, docs, packages, and frontend artifacts. | Render builds from root, but the API image must not receive unrelated monorepo or secret-bearing files. | Inspected effective image contents and searched for `.env` files and known placeholder values. |
| DeltaDCF `backend/api.py` health handler | `apps/api/app/main.py` health handler | Copy with renamed values | Response identifies `dcflens-api`; route remains dependency-free. | Product rename with the same safe liveness contract. | `test_health.py` monkeypatches service construction to fail if health touches SEC, Gemini, or caches. |
| DeltaDCF logging in `backend/api.py` | `apps/api/app/core/logging.py` plus middleware and handlers in `app/main.py` | Replace | Plain formatted logs become structured JSON; production clients receive sanitized envelopes and request IDs. | Render logs need machine-readable diagnosis without credentials, prompts, provider bodies, or client stack traces. | Backend API/error tests plus source audit of logger fields and production exception mapping. |
| DeltaDCF `backend/src/config.py` env parsing | `apps/api/app/core/settings.py` | Adapt to new monorepo paths | Keeps runtime configuration, adds bounded SEC/Gemini/cache values, validates exact origins, and derives only a project/team-scoped Vercel preview regex. | DCFLens has SEC-first ingestion, bounded caches, and stricter production configuration. | Settings and CORS tests cover exact origins, wildcard rejection, preview scoping, required production values, and bounds. |
| DeltaDCF `GOOGLE_API_KEY` and `CORS_ALLOWED_ORIGINS` Blueprint secrets | `GOOGLE_API_KEY`, `SEC_IDENTITY`, and `CORS_ALLOWED_ORIGINS` with `sync: false` | Adapt to new monorepo paths | Adds the honest SEC identity required by DCFLens; no value is committed for any dashboard-supplied item. | SEC EDGAR access needs contact identity; all sensitive or deployment-specific values belong in Render. | YAML inspection and repository secret-name/value scans; Docker build uses no build args. |
| DeltaDCF process/local-file behavior including temporary reports | Bounded in-memory SEC, deterministic, and completed-analysis caches; no report cache | Replace | Deployed cache cap is 16; no database, disk, or persistent local cache is configured. | Render's free filesystem is ephemeral and the 512 MB instance needs bounded retention. | Cache tests prove TTL/eviction/failure behavior; source audit found no disk-backed service cache; Blueprint has no disk/database. |
| DeltaDCF CORS list and optional broad deployment regex | Exact `CORS_ALLOWED_ORIGINS` plus paired project/team preview slugs | Adapt to new monorepo paths | Production `*` is rejected; optional preview regex is anchored to one DCFLens Vercel project and team. | A generic `vercel.app` regex would allow unrelated deployments. | Settings and API CORS tests cover exact production and scoped preview origins. |
| DeltaDCF `frontend/.env.example` with `VITE_API_URL` | `apps/web/.env.example` with `NEXT_PUBLIC_API_URL` | Replace | Variable and documentation use Next.js conventions; only the API origin is browser-visible. | Vite and Next.js expose environment variables differently. | URL-resolution tests cover local default, production requirement, normalization, and invalid URLs; public-prefix scan checks for secret names. |
| DeltaDCF URL handling in `frontend/src/App.jsx` | `apps/web/src/lib/api-url.ts` and `api-client.ts` | Replace | Central module validates and normalizes the URL, maps typed errors, performs bounded cold-start retry, supports cancellation, and suppresses duplicate submissions. Test-only environment injection was removed from the shipped client path. | DCFLens must handle Render wake-up without inventing a successful result, and the development fallback must be removable from production client chunks. | Frontend unit/integration tests plus production build; exact `http://localhost:8000` scan was clean. A bare framework-internal URL-parser token was separately identified. |
| DeltaDCF `frontend/vercel.json` SPA rewrite | No DCFLens `vercel.json` | Do not reuse | The catch-all rewrite is omitted. | Next.js App Router owns routing; a Vite SPA fallback is unnecessary and potentially harmful. | Repository search confirms no `vercel.json`; Vercel Root Directory and Next.js preset are documented and production build succeeds. |
| DeltaDCF README deployment sections | `README.md`, `docs/deployment-architecture.md`, and `docs/production-deployment.md` | Replace | Uses `apps/web`, `apps/api`, Next.js, `NEXT_PUBLIC_API_URL`, exact CORS, current Blueprint fields, ordered deployment, smoke test, and rollback. | The old instructions are coupled to Vite, `frontend`/`backend`, and DeltaDCF names. | Documentation link/path scan, command execution, HTTPS scan, and comparison against actual configuration. |

## Classification meaning

- **Copy with renamed values:** preserve the proven operational behavior while changing service identity.
- **Adapt to new monorepo paths:** retain the pattern but translate paths, imports, or configuration fields.
- **Replace:** implement the same production concern using DCFLens's framework or trust boundaries.
- **Do not reuse:** omit an artifact that conflicts with Next.js or the canonical root-context workflow.

## Key path translation

```text
DeltaDCF                              DCFLens
backend/                              apps/api/
backend/api.py                        apps/api/app/main.py
backend/Dockerfile                    apps/api/Dockerfile
frontend/                             apps/web/
frontend/src/App.jsx                  apps/web/src/app + apps/web/src/lib/
VITE_API_URL                          NEXT_PUBLIC_API_URL
api:app                               app.main:app
render.yaml                           render.yaml
```

## Deliberate non-parity

- DeltaDCF's Vite SPA rewrite is not copied into Next.js.
- DeltaDCF's broad optional Vercel preview regex is not copied; DCFLens derives a project/team-specific anchored rule.
- DeltaDCF's compiler, PDF libraries, report directory, and curl package are not installed because the current DCFLens API does not use them.
- DeltaDCF's deprecated `env` field and incorrectly cased `dockerFilePath` are not copied; DCFLens uses the current Blueprint names.
- DeltaDCF's dirty working tree is evidence of a pattern, not evidence that its image or deployment passed verification.
