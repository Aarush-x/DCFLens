# DCFLens

DCFLens is an evidence-first equity research and discounted cash flow application. The repository now contains the production-oriented monorepo scaffold and the product, architecture, trust, provenance, valuation, and deployment specifications. Valuation and filing-analysis features have not been implemented yet.

The design uses a monorepo with a Next.js frontend in `apps/web`, a Dockerized FastAPI backend in `apps/api`, an optional `packages/shared` package for generated or cross-runtime contracts, and repository-level deployment configuration.

## Documentation

| Document | Purpose |
| --- | --- |
| [Product requirements](docs/product-requirements.md) | Users, outcomes, scope, non-goals, and acceptance criteria |
| [Technical architecture](docs/technical-architecture.md) | Components, boundaries, proposed repository layout, and design decisions |
| [Data flow](docs/data-flow.md) | Request, ingestion, normalization, valuation, AI, and response flow |
| [Deployment architecture](docs/deployment-architecture.md) | Vercel, Render, Docker, configuration, health checks, and rollback model |
| [Valuation methodology](docs/valuation-methodology.md) | Deterministic DCF formulas, assumptions, scenarios, and validation rules |
| [AI trust boundaries](docs/ai-trust-boundaries.md) | What Gemini may do, what it may not do, and required safeguards |
| [Evidence provenance](docs/evidence-provenance.md) | Source identity, locators, transformation records, and claim citation rules |
| [DeltaDCF 10-point checklist](docs/deltadcf-checklist.md) | The reference checklist preserved unchanged |
| [DeltaDCF comparison](docs/deltadcf-comparison.md) | Reusable patterns, coupled details, and DCFLens redesigns |
| [Deployment mapping](docs/deployment-mapping.md) | File-by-file DeltaDCF to DCFLens classification |

## Reference baseline

The design was derived from DeltaDCF `main` at commit `d13b2ea24a4a8446373b3bde51f86aab136f8f27`, inspected on 2026-08-29. DeltaDCF is a reference, not a code template. Its checklist and deterministic valuation concepts are retained; its Vite layout, path assumptions, synchronous orchestration, process-local caches, and weak evidence locators are not adopted unchanged.

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

Next.js uses `http://localhost:8000` only as the development fallback. Vercel production and preview deployments must set `NEXT_PUBLIC_API_URL`. Production builds fail clearly when it is missing.

## Deployment scaffold

- Vercel project Root Directory: `apps/web`
- Render Blueprint: repository-root `render.yaml`
- Render Docker context: repository root
- Render Dockerfile: `apps/api/Dockerfile`
- Liveness endpoint: `GET /health`
- No database and no `vercel.json`

## Current status

- Next.js and FastAPI scaffolds only
- Centralized frontend API URL validation
- Production-oriented Docker and Render configuration
- No valuation, SEC ingestion, Gemini, or evidence pipeline implementation
- No deployment performed
- No remote repository changes made
