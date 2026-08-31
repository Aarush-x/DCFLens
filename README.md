# DCFLens

**One ticker. One valuation. Every assumption explained and every conclusion traced to evidence.**

DCFLens turns SEC filings into an inspectable stock valuation. Enter a supported US company ticker to explore its financial facts, a two-stage discounted cash flow estimate, the original DeltaDCF ten-point checklist, and evidence-backed qualitative analysis from Gemini.

The calculations run in Python, independently of AI. Gemini can suggest bounded changes to growth and discount-rate assumptions, but it cannot rewrite historical facts or valuation formulas. If AI is unavailable, DCFLens preserves the deterministic valuation and explains the fallback.

[Open DCFLens](https://dcflens.vercel.app) · [GitHub repository](https://github.com/Aarush-x/DCFLens)

## What you can explore

- **An evidence-backed valuation:** projected cash flows, terminal value, enterprise value, equity value, and intrinsic value per share.
- **Company-specific assumptions:** deterministic baselines derived from financial history, cash-flow stability, maturity, and versioned sector priors.
- **Transparent AI adjustments:** baseline, adjustment, final assumption, rationale, supporting evidence, and valuation impact.
- **Assumption sensitivity:** a range around one final valuation, not named bull/base/bear scenarios or a probability interval.
- **The original ten-point checklist:** unchanged wording and order, with sector-aware applicability and `SUPPORTS`, `WEAKENS`, `MONITOR`, `UNKNOWN`, or `NOT_APPLICABLE` results.
- **Traceable financial facts:** SEC concepts, units, fiscal periods, filing information, transformations, and source references travel with normalized data.
- **Progressive detail:** a plain-English view with a deeper “Why?” layer for assumptions, calculations, and evidence.
- **Market-price context when available:** a separate quote and plausibility assessment. An unavailable quote is not replaced with a fabricated price.

## How it works

```text
Ticker
  -> SEC issuer resolution, Company Facts, and filing metadata
  -> Annual financial-fact normalization with evidence references
  -> Deterministic adaptive baseline, DCF, and ten-point checklist
  -> Optional Gemini review with Python-enforced validation
  -> Final valuation, sensitivity, explanations, and evidence
```

SEC ingestion handles missing data, alternative XBRL concepts, comparative periods, amendments, and restatements. Requests use an honest User-Agent, pacing, bounded retries, timeouts, and memory caches.

Gemini reviews a compact subset of up to 16 intact evidence items. It returns three assumption decisions, one to three evidence assessments, and up to three checklist comments. The full ten-item checklist still runs deterministically. Omitted evidence is not treated as adverse evidence, and every AI claim must reference an evidence ID actually supplied to the model.

## Repository structure

```text
web/                          Current React/Vite frontend
apps/web/                     Earlier Next.js/TypeScript frontend, retained as legacy
apps/api/app/                 FastAPI service and backend domain modules
apps/api/tests/               Backend unit and integration tests
apps/api/Dockerfile           Render API image
apps/api/Dockerfile.workflows  Separate Render Workflow image
docs/                         Methodology, contracts, architecture, and runbooks
render.yaml                   Render Blueprint for the API web service
Makefile                      Local development and Docker commands
```

Root npm commands target `web/`. The earlier Next.js app is available through the `*:legacy` scripts. `packages/shared` is not currently needed and has not been introduced.

Some architecture documents describe the original Next.js design. For the current frontend, use the root scripts, `web/vite.config.js`, and `web/vercel.json` as the configuration reference.

## Run locally

Use Node.js 24, Python 3.12 or newer, npm, and `make`. Docker is optional unless you want to test deployment images.

From the repository root:

```bash
npm ci
make install-api
cp -n apps/api/.env.example apps/api/.env
```

Edit `apps/api/.env` before requesting live analyses:

- Set `SEC_IDENTITY` to your application name and a real, monitored contact email.
- Set `GOOGLE_API_KEY` for Gemini analysis. Without it, deterministic analysis remains available when sufficient SEC data exists.
- Keep secrets in this local environment file, never in source code or public frontend variables.

Start the backend in one terminal:

```bash
make dev-api
```

Start the current frontend in another terminal:

```bash
DCFLENS_API=http://localhost:8000 npm run dev
```

Open `http://localhost:5173`. The Vite development proxy forwards `/api` requests to the local backend. Without `DCFLENS_API`, the development proxy targets the hosted Render API.

Check the backend directly:

```bash
curl --fail http://localhost:8000/health
curl --fail http://localhost:8000/api/analyze/AAPL
```

`GET /health` checks process liveness only. It does not call SEC or Gemini and does not prove those providers are available.

### Environment configuration

The complete backend example is [apps/api/.env.example](apps/api/.env.example).

| Variable | Purpose |
| --- | --- |
| `SEC_IDENTITY` | Application name and monitored contact email for SEC access |
| `GOOGLE_API_KEY` | Server-only Gemini credential |
| `GEMINI_MODEL` | Primary model; the current default is `gemini-3.5-flash` |
| `GEMINI_TIMEOUT_SECONDS` | Per-attempt I/O timeout, default `45` seconds |
| `GEMINI_TOTAL_TIMEOUT_SECONDS` | Shared scheduling budget across models and retries, default `75` seconds |
| `GEMINI_MAX_RETRIES` | Delayed transient retries per model, default `2` |
| `GEMINI_BACKOFF_SECONDS` | Initial retry backoff, default `1` second, with exponential growth and jitter |
| `APP_ENV` | `development` locally; `production` on Render |
| `CORS_ALLOWED_ORIGINS` | Explicit comma-separated browser-origin allowlist |
| `CACHE_TTL_SECONDS` | Process-local cache lifetime, default `900` seconds |
| `CACHE_MAX_ENTRIES` | Cache size bound; the API Blueprint sets `16` |
| `LOG_LEVEL` | Use `INFO` for operational diagnostics |
| `ALPHAVANTAGE_API_KEY` | Optional server-only key; Alpha Vantage primary with Yahoo fallback, or Yahoo alone when absent |
| `PORT` | Render-injected listen port; Docker defaults to `8000` |

The current Vite frontend calls same-origin `/api` paths and does not use `NEXT_PUBLIC_API_URL`. That variable belongs to the legacy Next.js frontend only. Neither frontend should receive SEC or Gemini credentials.

Quotes use Alpha Vantage first when configured, then Yahoo on a rate limit,
request failure, missing listing or invalid response. A rate-limited primary is
skipped for five minutes across tickers. Each provider retains its bounded timeout
and retry policy; successful quotes keep their actual source and timestamps and
are cached for `MARKET_QUOTE_TTL_SECONDS` (60 seconds by default). If both feeds
fail, the API returns an explicit unavailable reason and the UI displays it.
`MARKET_QUOTE_ENABLED=false` disables both feeds. These are latest available
quotes, not a guaranteed realtime stream: Alpha Vantage's default `GLOBAL_QUOTE`
is [updated at the end of the trading day](https://www.alphavantage.co/documentation/#latestprice).
Yahoo uses a minimal browser User-Agent by default; `MARKET_QUOTE_USER_AGENT`
can override it. Provider quotas and hosting-IP restrictions can still prevent
quotes from being returned, even when the application is configured correctly.

### Legacy Next.js frontend

To work on `apps/web` instead:

```bash
cp -n apps/web/.env.example apps/web/.env.local
npm run dev:legacy
```

It runs on `http://localhost:3000`. Local API requests may default to `http://localhost:8000`; production builds require `NEXT_PUBLIC_API_URL`.

## Tests and builds

From the repository root:

```bash
npm test
npm run lint
npm run build
apps/api/.venv/bin/python -m pytest apps/api/tests
```

Backend tests cover valuation math, adaptive assumptions, SEC normalization, provenance, checklist invariants, AI validation and fallback, caching, concurrency, settings, and HTTP behavior. Controlled inputs and provider doubles make these tests repeatable, but they do not certify live provider availability.

Workflow tests require the optional dependencies in `apps/api/requirements-workflows.txt`. See the [Workflow runbook](docs/render-workflow-demo.md) for installation and Docker verification.

For the legacy frontend, use `npm run test:legacy`, `npm run lint:legacy`, and `npm run typecheck:legacy`. The existing `make typecheck` target references a missing npm script; use the explicit legacy command instead.

## Deployment

### FastAPI on Render

The repository-root `render.yaml` defines the Docker API service. Its build context is the repository root, its Dockerfile is `apps/api/Dockerfile`, and its health-check path is `/health`.

The container runs as a non-root user. `python -m app` starts `app.main:app`, binds to `0.0.0.0`, respects `PORT`, and configures graceful shutdown. Environment files and frontend sources are excluded from the application image.

To build and run it locally using your backend environment file:

```bash
docker build -f apps/api/Dockerfile -t dcflens-api .
docker run --rm --env-file apps/api/.env -e PORT=8000 -p 8000:8000 dcflens-api
```

Enter production secrets in Render's environment settings. Use `APP_ENV=production` and an explicit `CORS_ALLOWED_ORIGINS` allowlist. Do not use a production wildcard or embed credentials in Docker build arguments.

### Current frontend on Vercel

- Root Directory: `web`
- Framework preset: Vite
- Build command: `npm run build`
- Output directory: `dist`
- API routing: `web/vercel.json` rewrites `/api/:path*` to the Render backend.

If the backend URL changes, update the rewrite destination and development proxy configuration. The legacy Next.js deployment instead uses Root Directory `apps/web`, the Next.js preset, and `NEXT_PUBLIC_API_URL`.

## Render Workflows

DCFLens has an optional, separate Render Workflow. Its `analyze_company` task runs the same backend pipeline outside a browser request and returns the full analysis as JSON.

This gives a demo or operator a tracked task run with input, execution logs, completion status, and inspectable output. It does not replace the web API or automatically connect the website to background jobs.

The Workflow uses `apps/api/Dockerfile.workflows`, repository-root build context, and `python -m app.workflow`. Configure its environment separately from the API service. The SDK entry point needs Render's managed runtime and is not a standalone local web server.

For a dashboard demo, start `analyze_company` with arguments `["AAPL"]`. In the output:

- `result.analysis.final_valuation` contains the valuation.
- `result.analysis` contains assumptions, sensitivity, checklist results, and evidence.
- `ai_status` tells you whether AI was `APPLIED` or the deterministic fallback was used.

A succeeded task does not necessarily mean Gemini succeeded. The task has a 300-second timeout and no whole-task retries; bounded SEC and Gemini retries still apply. Separate task runs do not share an analysis cache or deduplication boundary.

See the [Render Workflow demo guide](docs/render-workflow-demo.md) for setup, task arguments, environment variables, and operational limits.

## Reliability and current limits

- Gemini timeouts, quota limits, unavailable models, and rejected output can produce `DETERMINISTIC_FALLBACK`. Only `analysis.status: APPLIED` confirms that AI output passed validation.
- Bounded retries and a reviewed fallback model reduce transient failures but cannot guarantee availability. A timeout is not, by itself, evidence of an invalid key or rate limit.
- Inspect Render logs filtered by `gemini_` and correlate entries by `gemini_call_id`. Diagnostics include model, request size, timeout, duration, and failure phase without logging keys or full prompts.
- The current browser analysis deadline is 90 seconds. Cold starts, SEC retrieval, and AI recovery can exceed it. The Workflow is a separate option for longer-running tasks.
- Caches are bounded and process-local. They do not depend on persistent Render disk and are not shared across replicas or Workflow runs.
- Issuer support depends on SEC coverage and usable financial inputs. This is not a guarantee of support for every US stock or every business type.
- The live AI pipeline currently reviews structured financial-fact summaries, not a complete 10-K narrative or subsidiary audit.
- Missing SEC inputs or market quotes remain explicit. Sample UI fixtures are for development and testing, not a substitute for failed live analyses.

See [API diagnostics and error contracts](docs/api-service.md) for troubleshooting.

## Documentation

| Topic | Reference |
| --- | --- |
| Product and architecture | [Requirements](docs/product-requirements.md), [architecture](docs/technical-architecture.md), [data flow](docs/data-flow.md) |
| Valuation | [DCF engine](docs/dcf-engine.md), [methodology](docs/valuation-methodology.md), [adaptive baseline](docs/adaptive-baseline.md) |
| SEC and evidence | [Ingestion](docs/sec-ingestion.md), [provenance](docs/evidence-provenance.md) |
| Checklist | [Original ten items](docs/deltadcf-checklist.md), [checklist engine](docs/checklist-engine.md) |
| AI safeguards | [Trust model](docs/trust-model.md), [AI boundaries](docs/ai-trust-boundaries.md) |
| Backend and Workflows | [API service](docs/api-service.md), [Workflow demo](docs/render-workflow-demo.md) |
| Frontend | [Current frontend](web/README.md), [legacy integration](docs/frontend-backend-integration.md) |
| Deployment history | [Architecture](docs/deployment-architecture.md), [runbook](docs/production-deployment.md), [DeltaDCF mapping](docs/deployment-mapping.md) |
| DeltaDCF reference | [Comparison](docs/deltadcf-comparison.md) |

Older design and deployment documents retain historical Next.js and release-verification context. They should not be read as a fresh audit of hosted services or as instructions to deploy the current Vite app from `apps/web`.

## Research, not financial advice

DCFLens is a research and educational tool. A DCF is sensitive to its assumptions, and evidence may be incomplete. Confidence describes data support and analytical robustness, not the probability of a future stock price. Read the primary filings and apply your own judgment.
