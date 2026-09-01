# Durable analysis and live-price caching

## Objective

DCFLens separates slow, filing-backed analysis from market data that changes
throughout the day. A completed analysis is reusable across users and Render
processes. A market quote is never stored inside that durable analysis.

```text
Browser IndexedDB -> FastAPI memory cache -> Postgres analysis snapshot
                                           |
Active page -> /api/market-context/{ticker} -> 60-second quote cache -> provider
```

## Analysis snapshots

When `DATABASE_URL` is configured, the API creates
`dcflens_analysis_snapshots` and stores validated `AnalysisCore` values as JSONB.
The value contains normalized SEC evidence, deterministic valuation, checklist,
annual-report review, bounded Gemini output, confidence, and provenance. It does
not contain `market_price` or price-relative `plausibility`.

The cache key combines ticker, `ANALYSIS_PIPELINE_VERSION`, and `GEMINI_MODEL`.
Bump the pipeline version whenever a prompt, parser, valuation policy, evidence
contract, or response schema changes. This avoids silently reading an analysis
created under incompatible rules.

Only a result with AI status `APPLIED` and an available annual-report extraction
becomes a durable completed snapshot. A transient provider fallback never
overwrites a previously validated snapshot.

## Daily revalidation without daily Gemini spend

`ANALYSIS_REFRESH_HOUR_UTC` defines the next daily revalidation boundary. The
default is 23:00 UTC. On the first request after that boundary, the API returns
the existing snapshot immediately and starts a bounded background check.

The check retrieves filing metadata and compares the latest accession number:

- Same accession: advance the next check time and make no Gemini request.
- New accession: retrieve and normalize SEC data, parse the annual report, run
  the deterministic domains, call Gemini once, validate the result, and replace
  the snapshot atomically.
- Provider failure: retain the last validated snapshot and log a sanitized
  refresh failure.

This is stale-while-revalidate behavior. It works without a paid scheduler. The
optional `python -m app.refresh` command can prewarm selected tickers from an
existing Render Workflow or another scheduler.

```bash
cd apps/api
DATABASE_URL='postgresql://...' \
REFRESH_TICKERS='AAPL,MSFT,NVDA' \
.venv/bin/python -m app.refresh
```

## Market context

`GET /api/market-context/{ticker}` returns only the quote and the inexpensive
price-relative plausibility calculation. The frontend calls it every 60 seconds
while the analysis tab is visible, pauses while hidden, and refreshes when the
tab becomes visible again. Quote failures never erase the last valid analysis.

The existing `GET /api/analyze/{ticker}` remains compatible and returns the
complete envelope for initial loads.

## Browser persistence

The Vite client stores up to 12 price-free analyses in IndexedDB for seven days.
On reopen it renders the saved analysis immediately, then checks the backend and
requests current market context. IndexedDB is a presentation cache only. The
server's Postgres snapshot remains authoritative.

## Free deployment

The implementation accepts any PostgreSQL connection URL. For a no-expiry free
prototype, create a Neon Free project, copy its pooled `postgresql://` connection
string into Render as `DATABASE_URL`, and keep the secret out of Git and Vercel.
Neon Free compute scales to zero while its Postgres storage remains durable.

Render Free Postgres is compatible but expires after 30 days. Render Free Key
Value is not sufficient for this requirement because it loses data on restart.
If `DATABASE_URL` is absent or temporarily unavailable, DCFLens safely falls
back to the existing bounded process-memory caches.

## Operational limits

- Postgres is a cache of reproducible public analysis, not a holder of API keys.
- Database connection strings and analysis payloads are never logged.
- Database failures do not break deterministic valuation or `/health`.
- `/health` never connects to Postgres, SEC, Gemini, or the quote provider.
- Two background filing refreshes may run concurrently per API process.
- The market quote remains independently bounded by its success and failure TTLs.
