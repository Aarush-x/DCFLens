# DeltaDCF and DCFLens

## Reference reviewed

The primary reference is DeltaDCF `main` at commit `d13b2ea24a4a8446373b3bde51f86aab136f8f27`, inspected on 2026-08-29. The older local `chore/production-deployment` checkout was also inspected to identify which deployment patterns evolved before reaching current `main`.

## Summary

DCFLens retains DeltaDCF's transparent DCF, checklist, SEC-first approach, FastAPI container pattern, and production configuration discipline. It changes the frontend framework and directory layout, makes provenance a first-class data model, narrows AI authority, and prepares for durable, shareable analyses rather than process-local results.

## Comparison

| Area | DeltaDCF | DCFLens decision |
| --- | --- | --- |
| Repository | `frontend/` plus `backend/` | Monorepo with `apps/web`, `apps/api`, and optional `packages/shared` |
| Frontend | React 19 and Vite | Next.js App Router on Vercel |
| API | FastAPI entry in `backend/api.py` | Modular FastAPI app rooted at `apps/api/app/main.py` |
| Supported data | SEC primary, optional Alpha Vantage fallback | SEC primary; fallback policy unresolved and never silent |
| Normalization | Good alias, unit, annual-form, duration, and restatement logic; output reduces to plain values | Reuse algorithms but retain fact-level provenance and rejected candidates |
| DCF | Two 5-year stages, Gordon Growth terminal value, net debt, per-share result | Preserve as a reference scenario and pure engine; add scenario and provenance contracts |
| Checklist | Original 10 points; four quantitative checks implemented directly, AI handles full audit | Preserve all wording; define evidence and missing-data behavior for every item |
| AI | Gemini or development Ollama; validated bounded offsets can feed final valuation | Gemini is optional qualitative layer; baseline stays independent; AI scenario needs citations and explicit selection |
| Filing extraction | Labeled 10-K items and Exhibit 21, bounded text | Reuse selection but add stable locators, accessions, hashes, and parser version |
| Cache | Process-local TTL caches | Preserve TTL concepts; choose durable storage if analyses must be shareable |
| Deployment | Vite on Vercel, Docker FastAPI on Render | Next.js on Vercel, Docker FastAPI on Render with monorepo paths |
| CORS | Exact production origins, wildcard rejected | Reuse policy; decide preview-origin access explicitly |
| Health | External-dependency-free `/health` | Reuse contract and path |

## Reuse directly as concepts

- The unchanged checklist text.
- SEC identity requirement and direct Company Facts endpoints.
- Ticker normalization for class shares.
- Annual-form filtering and 250 to 450-day annual duration guard.
- Ordered concept aliases and latest-restatement selection.
- FCF definition, two-stage projection, terminal value, net debt, and per-share formulas.
- Non-root container, root Docker context, Render health path, and exact production CORS.
- Provider timeouts, safe download hosts, byte limits, cleanup, and typed errors.
- Separating base, adjustment, and final assumption display.

## Coupled to DeltaDCF

- `frontend/`, `backend/`, `api:app`, and Vite-specific `VITE_API_URL` paths and names.
- Vercel static output directory `dist` and any SPA rewrite assumptions.
- Docker `COPY backend/...` paths.
- S&P 500-only allowlist and USD-only response behavior.
- Process-local cache keys and synchronous request lifetime.
- The single module combining routes, data orchestration, AI, and response assembly.

## Redesign instead of copy

- Preserve evidence metadata through normalization.
- Use FastAPI models and generated frontend types rather than manually duplicated shapes.
- Use `NEXT_PUBLIC_API_BASE_URL` for the public backend origin.
- Configure Gemini model selection and record it per analysis.
- Require valid evidence IDs in AI output.
- Make `UNKNOWN` a first-class checklist status.
- Keep AI-proposed adjustments out of the default baseline and review the bounds.
- Decide persistence, job execution, cache coordination, and shareable result URLs before implementation.
