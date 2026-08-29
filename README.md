# DCFLens

DCFLens is a planned evidence-first equity research and discounted cash flow application. This repository currently contains the product, architecture, trust, provenance, valuation, and deployment specifications. Application code has not been implemented.

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

## Status

- Documentation only
- No application packages or dependencies installed
- No deployment performed
- No remote repository changes made
