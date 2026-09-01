# Deployment architecture

## Target topology

```text
User browser
    |
    v
Vercel: apps/web (Next.js)
    |
    | HTTPS to NEXT_PUBLIC_API_URL
    v
Render: apps/api (Docker web service)
    |-- SEC EDGAR
    |-- Google Gemini
    `-- PostgreSQL analysis snapshots (optional)
```

The Vercel and Render projects remain separately deployable. `render.yaml` lives at the repository root. Render builds `apps/api/Dockerfile` with the repository root as Docker context. Vercel uses `apps/web` as its Root Directory.

## Render backend

The repository-root Blueprint retains the useful DeltaDCF shape:

- `runtime: docker`
- `dockerContext: .`
- `dockerfilePath: ./apps/api/Dockerfile`
- `healthCheckPath: /health`
- `maxShutdownDelaySeconds: 30`
- `autoDeployTrigger: checksPass`
- `plan: free`, currently supported for Render web services and appropriate only for this prototype

The container uses a supported Python 3.12 slim Bookworm base, installs only runtime dependencies, copies only the API application, and runs as a non-root user. Its `python -m app` entry point imports `app.main:app`, binds `0.0.0.0`, respects Render's `PORT`, and defaults to port `8000`. The Docker health check uses the Python standard library rather than installing `curl` only for health checks.

Render sends `SIGTERM` during replacement and waits up to the Blueprint's 30-second shutdown delay. Uvicorn's 25-second graceful-shutdown timeout drains ordinary in-flight work while leaving a five-second process-exit margin. The deployed cache cap is 16 entries per bounded cache, lower than the development default, to limit retained SEC documents and analysis objects on the free web service's 512 MB instance. This is a prototype capacity choice, not a production load target.

### Backend environment contract

The service implements `APP_ENV`, `LOG_LEVEL`, `PORT`, `SEC_IDENTITY`, `SEC_TIMEOUT_SECONDS`, `SEC_MAX_RETRIES`, `GOOGLE_API_KEY`, `GEMINI_MODEL`, `GEMINI_TIMEOUT_SECONDS`, `CORS_ALLOWED_ORIGINS`, optional project-scoped Vercel preview slugs, `CACHE_TTL_SECONDS`, and `CACHE_MAX_ENTRIES`.

| Variable | Exposure | Production rule |
| --- | --- | --- |
| `APP_ENV` | Server | Must be `production`. |
| `LOG_LEVEL` | Server | Defaults to `INFO`; must validate accepted levels. |
| `PORT` | Server | Injected by Render; local default `8000`. |
| `SEC_IDENTITY` | Server | Required and must contain an application name plus monitored email. |
| `AI_PROVIDER` | Server | Explicit production provider, initially `gemini`. No implicit local fallback. |
| `GEMINI_MODEL` | Server | Required or have a reviewed default; model changes must be observable. |
| `GEMINI_TIMEOUT_SECONDS` | Server | Per-attempt I/O timeout; defaults to 45 seconds, range 1–120, capped by remaining budget. |
| `GEMINI_TOTAL_TIMEOUT_SECONDS` | Server | Shared scheduling budget across models and retries; defaults to 75 seconds, range 1–120. |
| `GEMINI_MAX_RETRIES` | Server | Delayed transient retries per model; default 2, range 0–3, subject to the eight-request ceiling. |
| `GEMINI_BACKOFF_SECONDS` | Server | Initial exponential backoff; default 1 second, range 0.1–10, plus up to 0.25 seconds jitter. |
| `GOOGLE_API_KEY` | Secret | Required only when Gemini is enabled. Never logged or returned. |
| `CORS_ALLOWED_ORIGINS` | Server | Required exact comma-separated origins. Wildcard rejected. |
| `CORS_VERCEL_PREVIEW_PROJECT` / `CORS_VERCEL_PREVIEW_TEAM` | Server | Optional paired slugs used to derive one anchored project/team preview-origin regex. |
| `CACHE_TTL_SECONDS` / `CACHE_MAX_ENTRIES` | Server | Bound each process-local cache. |
| `DATABASE_URL` | Secret | Optional PostgreSQL URL for durable price-free analysis snapshots. |
| `ANALYSIS_PIPELINE_VERSION` | Server | Version cache compatibility when prompts, parsers, formulas, or schemas change. |
| `ANALYSIS_REFRESH_HOUR_UTC` | Server | Daily filing-accession check boundary, default `23`. |
| `DATABASE_CONNECT_TIMEOUT_SECONDS` | Server | Bound durable-cache connection attempts, default `5`. |
| `SEC_TIMEOUT_SECONDS` / `SEC_MAX_RETRIES` | Server | Bound SEC latency and retry attempts. |
| `EXTERNAL_REQUEST_TIMEOUT_SECONDS` | Server | Positive bounded integer. |
| `MAX_REPORT_BYTES` | Server | Positive bounded integer. |
| `EVIDENCE_RETENTION_DAYS` | Server | Required if durable evidence storage is selected. |

An Alpha Vantage fallback is not assumed for DCFLens. If retained, `ALPHA_VANTAGE_API_KEY` and the exact fallback conditions must be documented and visible in results.

## Vercel frontend

Vercel should set the project Root Directory to `apps/web`. Next.js supplies its own routing and output behavior, so the DeltaDCF SPA rewrite file must not be copied.

`NEXT_PUBLIC_API_URL` is the only planned browser-visible service URL. Production builds fail when it is absent. All `NEXT_PUBLIC_*` values are public bundle data; provider credentials are forbidden.

Preview deployments require a CORS decision. The safest default is to permit only the production frontend origin. If previews need live API access, use a narrowly anchored allowlist or a controlled preview proxy. Do not copy permissive wildcard or broad regex behavior.

## Health and readiness

`GET /health` returns a small stable body such as `{"status":"ok"}` and must not call SEC, Gemini, a database, or object storage. It proves that the process can serve HTTP.

The API keeps bounded in-memory caches and per-process duplicate suppression as
its L1. When `DATABASE_URL` is configured, validated price-free analyses are
also stored as JSONB and survive Render restarts and scale-to-zero. Database
failures degrade to L1 rather than breaking analysis. The local filesystem
remains unused because it is ephemeral. See [caching.md](caching.md).

A future `GET /ready` may verify local configuration and required internal connections. External provider outages should appear in analysis errors and observability, not make every instance fail liveness.

## CORS

- Parse a comma-separated list into normalized origins without trailing slashes.
- Reject `*` in production.
- Use exact origins by default.
- Set `allow_credentials=False` unless browser credentials are deliberately introduced.
- Permit only implemented methods and headers.
- Test allowed, disallowed, preview, and trailing-slash cases.

## Build and verification contract

Before deployment is considered ready, CI should run:

1. Backend unit and API tests with all external services mocked.
2. Frontend type check, lint, tests, and production build using a non-secret placeholder API URL.
3. Docker build from repository root.
4. Container start followed by `/health` verification.
5. Secret and dependency scans appropriate to the repository.

The scaffold phase executes these checks locally where tooling is available. They become required CI gates when CI is introduced; passing scaffold checks is not proof of a deployed system.

## Rollback model

- Vercel: promote the last known-good deployment.
- Render: roll back to the last known-good image or Git revision.
- Configuration: record environment changes separately from code releases.
- Schemas: keep API response schema versions backward compatible during rollback windows.
- Evidence: never delete evidence merely because application code rolls back.

## Unresolved deployment risks

- Synchronous SEC plus Gemini processing may exceed practical request limits. Choose synchronous, job-based, or hybrid execution after measuring latency.
- Render instances have ephemeral disks. Durable analysis and evidence URLs require an external persistence decision.
- In-memory caches reset on restart and do not coordinate across instances.
- Vercel preview origins and Render CORS need an explicit access policy.
- Provider quotas, cold starts, retries, and concurrency limits need load targets. The Blueprint currently pins the free plan, which sleeps when idle and is not a reviewed capacity decision.
- Render documents Free instances as preview/hobby infrastructure rather than production infrastructure. A paid instance, measured request latency, and a durable/shared cache remain prerequisites for a production service-level objective.
