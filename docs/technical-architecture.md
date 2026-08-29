# Technical architecture

## System boundary

DCFLens separates four concerns: browser presentation, API orchestration, deterministic finance, and evidence-aware external adapters. The API owns all secrets and external provider calls. The web client renders typed results and never calls SEC or Gemini directly.

```text
Browser
  |
  | HTTPS JSON
  v
apps/web (Next.js on Vercel)
  |
  | NEXT_PUBLIC_API_URL
  v
apps/api (FastAPI in Docker on Render)
  |-- SEC adapter --------> SEC Company Facts and filings
  |-- normalization ------> canonical facts plus provenance
  |-- valuation engine ---> deterministic scenarios
  |-- checklist engine ---> rules plus evidence requirements
  `-- Gemini adapter -----> structured qualitative findings
```

## Repository layout

```text
DCFLens/
├── apps/
│   ├── web/
│   │   ├── src/app/                # Next.js App Router pages and layouts
│   │   ├── src/components/         # Added with analysis and evidence UI
│   │   ├── src/lib/                # Central URL config; future API client
│   │   ├── public/                 # Added when static assets exist
│   │   ├── .env.example
│   │   ├── next.config.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── api/
│       ├── app/
│       │   ├── main.py             # FastAPI application and middleware
│       │   ├── api/                # Versioned route modules
│       │   ├── core/               # Settings, logging, and error types
│       │   ├── data/               # SEC clients and normalization
│       │   ├── evidence/           # Provenance records and claim linking
│       │   ├── ai/                 # Gemini prompt, schema, and validation
│       │   └── valuation/          # DCF and checklist engines
│       ├── tests/
│       ├── .env.example
│       ├── Dockerfile
│       ├── pyproject.toml
│       ├── requirements.txt        # Production dependencies only
│       └── requirements-dev.txt    # Local tests and tooling
├── packages/                       # Deferred until a real shared contract exists
├── docs/
├── .dockerignore
├── package.json                    # JavaScript workspace commands
├── render.yaml
└── README.md
```

`packages/shared` is deferred in the scaffold because no shared contract exists yet. It should not contain Python business logic copied into TypeScript. It becomes justified for a versioned JSON Schema or OpenAPI-derived TypeScript types shared with `apps/web`. The FastAPI models remain the authoritative runtime contract.

## Component responsibilities

| Component | Owns | Must not own |
| --- | --- | --- |
| `apps/web` | Input, analysis state, scenario controls, evidence navigation | Provider secrets, DCF formulas, SEC normalization |
| API routes | Validation, authorization if added, response status, orchestration | Provider-specific parsing details |
| SEC adapter | HTTP identity, rate limits, raw SEC payloads | Valuation decisions |
| Normalizer | Concept aliases, units, periods, restatement selection | Model-generated interpretation |
| Valuation engine | Pure numeric calculation and guards | Network access or AI calls |
| Checklist engine | Rule evaluation and evidence requirements | Unvalidated model output |
| Gemini adapter | Prompt construction, structured output, retries, timeouts | Final authority over facts or baseline valuation |
| Evidence layer | Stable references, hashes, transformations, claim links | Rendering decisions |

## API shape

The first implementation should use a versioned boundary such as `POST /v1/analyses` and `GET /v1/analyses/{analysis_id}` if durable jobs are selected. A synchronous endpoint is acceptable only if measured latency fits Render and client limits. The decision is recorded as an unresolved risk in [deployment-architecture.md](deployment-architecture.md).

`GET /health` is a liveness check. If a separate readiness check is introduced, it may validate local configuration but must not call external providers.

## Reusable DeltaDCF patterns

- FastAPI plus Uvicorn behind a non-root Docker image.
- Root Docker build context with the backend Dockerfile below the root.
- SEC ticker normalization from dot to hyphen for class-share symbols.
- Company Facts concept aliases, annual-form filtering, duration filtering, and restatement selection.
- Strict production CORS and server-only secrets.
- Explicit SEC identity, timeouts, download limits, safe hosts, and typed provider errors.
- Pure DCF engine with guards and separate base, adjustment, and final values.

## Required redesigns

- Preserve provenance through normalization instead of reducing facts to bare floats.
- Replace the Vite frontend and SPA assumptions with Next.js App Router conventions.
- Split the large orchestration module into routes and domain services.
- Keep the baseline valuation independent from AI. Treat AI adjustments as an optional scenario, not the default answer.
- Replace process-local result identity with durable analysis records if shareable evidence URLs are a product requirement.
- Make the Gemini model name configuration-driven instead of embedding a single model identifier in code.

## Architectural constraints

- Domain functions are deterministic and have no network access.
- The DCF package has no route, provider, cache, environment, logging, or presentation dependency.
- External payloads enter through typed adapters.
- Provider text and model output are untrusted.
- API responses include schema versions.
- Evidence references survive caching and serialization.
- No browser-exposed environment variable may contain a credential.
