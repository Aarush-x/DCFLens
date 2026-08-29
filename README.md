# DCFLens

DCFLens is an evidence-first equity research and discounted cash flow application. The repository contains a production-oriented monorepo scaffold, deterministic DCF engine, adaptive baseline policy, SEC ingestion and normalization, immutable checklist engine, and an evidence-bound Gemini qualitative-analysis domain service. Filing-section extraction, API-route integration, and the product frontend workflow are not implemented yet.

The design uses a monorepo with a Next.js frontend in `apps/web`, a Dockerized FastAPI backend in `apps/api`, an optional `packages/shared` package for generated or cross-runtime contracts, and repository-level deployment configuration.

## Documentation

| Document | Purpose |
| --- | --- |
| [Product requirements](docs/product-requirements.md) | Users, outcomes, scope, non-goals, and acceptance criteria |
| [Technical architecture](docs/technical-architecture.md) | Components, boundaries, proposed repository layout, and design decisions |
| [Data flow](docs/data-flow.md) | Request, ingestion, normalization, valuation, AI, and response flow |
| [Deployment architecture](docs/deployment-architecture.md) | Vercel, Render, Docker, configuration, health checks, and rollback model |
| [Valuation methodology](docs/valuation-methodology.md) | Deterministic DCF formulas, assumptions, scenarios, and validation rules |
| [DCF engine contract](docs/dcf-engine.md) | Implemented formulas, units, validation, decomposition, and assumption sensitivity |
| [Adaptive baseline](docs/adaptive-baseline.md) | Versioned sector priors, company-specific assumption formulas, fallbacks, and traces |
| [Checklist engine](docs/checklist-engine.md) | Immutable ten-item contract, deterministic rules, sector context, and evidence behavior |
| [SEC ingestion contract](docs/sec-ingestion.md) | EDGAR access, pacing, retries, caching, normalization, and fact-level provenance |
| [AI trust boundaries](docs/ai-trust-boundaries.md) | What Gemini may do, what it may not do, and required safeguards |
| [Gemini trust model](docs/trust-model.md) | Implemented structured-output, evidence, adjustment, fallback, and confidence contract |
| [FastAPI service layer](docs/api-service.md) | Analyze endpoint, errors, CORS, caching, concurrency, logging, and runtime behavior |
| [Frontend/backend integration](docs/frontend-backend-integration.md) | API URL resolution, cold-start recovery, cancellation, UI states, and deployment configuration |
| [Evidence provenance](docs/evidence-provenance.md) | Source identity, locators, transformation records, and claim citation rules |
| [DeltaDCF 10-point checklist](docs/deltadcf-checklist.md) | The reference checklist preserved unchanged |
| [DeltaDCF comparison](docs/deltadcf-comparison.md) | Reusable patterns, coupled details, and DCFLens redesigns |
| [Deployment mapping](docs/deployment-mapping.md) | File-by-file DeltaDCF to DCFLens classification |
| [Production deployment runbook](docs/production-deployment.md) | Verified parity, configuration checks, exact dashboard order, smoke test, and rollback |

## Reference baseline

The original design review used DeltaDCF `main` at commit `d13b2ea24a4a8446373b3bde51f86aab136f8f27`. The production-parity pass on 2026-08-29 separately inspected the local DeltaDCF `chore/production-deployment` working tree at HEAD `22e99fe`, including its uncommitted deployment files. DeltaDCF is a reference, not a code template or proof of deployment. Its checklist and deterministic valuation concepts are retained; its Vite layout, path assumptions, synchronous orchestration, process-local caches, and weak evidence locators are not adopted unchanged.

## Repository structure

```text
apps/web/       Next.js TypeScript frontend for Vercel
apps/api/       FastAPI backend and root-context Dockerfile for Render
docs/           Product and engineering specifications
render.yaml     Render Blueprint for the API service
```

`packages/shared` is intentionally deferred until an OpenAPI-derived schema or another real cross-runtime contract exists.

## Local development

Prerequisites: Node.js 20.9 or newer, Python 3.12 or newer, Docker, and `make`.

```bash
make install       # Install web and isolated API development dependencies
make dev-web       # Start Next.js on http://localhost:3000
make dev-api       # Start FastAPI on http://localhost:8000
make lint          # Lint the frontend
make typecheck     # Type-check the frontend
make test          # Run frontend and backend tests
NEXT_PUBLIC_API_URL=https://api.example.invalid make build-web
                   # Build the frontend with an explicit non-secret API origin
make docker-build  # Build dcflens-api from the monorepo root
make docker-run    # Run the API container on port 8000
make health        # Call GET /health
```

Copy example environment files only when local overrides are needed:

```bash
cp apps/web/.env.example apps/web/.env.local
cp apps/api/.env.example apps/api/.env
```

The API loads `apps/api/.env` for local development. Docker excludes every `.env` file, and deployed values must come from Render's environment configuration.

Start the backend and frontend in separate terminals:

```bash
# Terminal 1, from the repository root
make dev-api

# Terminal 2, from the repository root
make dev-web
```

Open `http://localhost:3000`, enter a ticker, and the browser calls
`http://localhost:8000` through the centralized API client. Next.js uses this
localhost origin only outside production. Vercel Production and Preview builds
must set `NEXT_PUBLIC_API_URL` to the Render API origin. The page displays an
explicit configuration error if the production variable is absent.

The client checks `GET /health` before analysis. A sleeping Render free-tier
service stays in a bounded, recoverable “Backend waking up” state. Once healthy,
the UI changes to “Analysis running” for `GET /api/analyze/{ticker}`. Provider,
SEC, rate-limit, unsupported-ticker, timeout, and configuration outcomes remain
distinct, and a retry keeps the last valid result visible.

## Deployment scaffold

- Vercel project Root Directory: `apps/web`
- Render Blueprint: repository-root `render.yaml`
- Render Docker context: repository root
- Render Dockerfile: `apps/api/Dockerfile`
- Liveness endpoint: `GET /health`
- No database and no `vercel.json`
- Bounded 30-second Render shutdown window with a 25-second Uvicorn drain timeout

## Current status

- Next.js and FastAPI scaffolds plus a route-independent deterministic DCF engine
- SEC EDGAR client and annual financial-fact normalizer with claim-level evidence
- Centralized frontend API URL validation
- Production-oriented Docker and Render configuration
- Gemini structured-output client and domain orchestration with strict Python validation and deterministic fallback
- FastAPI `GET /api/analyze/{ticker}` orchestration with sanitized errors, structured logs, bounded caches, and duplicate suppression
- The Next.js analysis route is connected to FastAPI through one bounded,
  cancellable client with Render cold-start recovery and sanitized error mapping
- No deployment performed
- No remote repository changes made
