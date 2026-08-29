# FastAPI service layer

## Endpoints

`GET /health` is a process-liveness endpoint. It returns `200` with only the service name and status. It does not initialize the analysis service and never calls SEC EDGAR, Gemini, a cache, a database, or another provider.

`GET /api/analyze/{ticker}` validates and normalizes the ticker, retrieves SEC Company Facts and submissions metadata, normalizes annual facts with claim-level evidence, builds deterministic adaptive assumptions, evaluates the unchanged ten-point checklist, calculates one DCF valuation and its sensitivity interval, and then optionally applies validated Gemini adjustments. The response includes latest filing metadata and every evidence reference carried by the domain results. A separate filing route is not currently justified because the analysis response already exposes accession-specific filing metadata and claim-level evidence URLs.

Gemini absence, timeout, rate limiting, malformed output, or provider failure preserves a successful deterministic valuation. The response `analysis.status` is `DETERMINISTIC_FALLBACK`, and `analysis.fallback_reason` distinguishes the outcome. Provider failures are logged without credentials, response bodies, or prompts.

## Error contract

Errors use a stable envelope with `error.code`, a sanitized `error.message`, and `error.request_id`. The mappings are deliberately distinct:

| Condition | HTTP | Code |
| --- | ---: | --- |
| Malformed ticker | 400 | `invalid_ticker` |
| Ticker absent from SEC mapping | 404 | `unsupported_ticker` |
| Required SEC facts absent or unsupported | 422 | `missing_sec_data` |
| Deterministic inputs cannot produce a valid DCF | 422 | `calculation_error` |
| SEC rate limit | 429 | `provider_rate_limit` |
| SEC transport or upstream failure | 503 | `sec_provider_unavailable` |
| Unexpected application failure | 500 | `internal_error` |

Production responses never include stack traces. JSON logs retain the request ID, safe error code, status, latency, and exception type for diagnosis. Full prompts, provider response bodies, API keys, and SEC identity values are not logged.

## CORS

`CORS_ALLOWED_ORIGINS` is a comma-separated list of exact HTTP or HTTPS origins. Development defaults to `http://localhost:3000`. Production requires at least one explicit origin and rejects `*`.

After Vercel assigns the production domain, set Render's `CORS_ALLOWED_ORIGINS` to that exact origin, for example `https://dcflens.vercel.app`, and restart the API. If preview access is needed, set both `CORS_VERCEL_PREVIEW_PROJECT` and `CORS_VERCEL_PREVIEW_TEAM`. The API derives an anchored regex limited to that project/team pair; it does not allow arbitrary `vercel.app` sites. Leave both preview variables unset when previews do not need API access.

## Cache and concurrency model

Three bounded TTL caches are separate: normalized SEC company data; provider-independent baseline, checklist, and DCF results; and completed AI-applied analysis responses. Transient Gemini fallbacks are never placed in the completed-analysis cache, so a later request can retry Gemini while reusing deterministic work. A per-ticker single-flight gate coalesces concurrent analysis requests in one process.

The prototype caches are in memory. They are cleared on restart, are not shared between Render instances, and cannot provide cross-instance duplicate suppression. Render's local filesystem is ephemeral and is not used as a cache. The cache boundary is a small `get`/`set` protocol, so Redis can replace the memory implementation without changing SEC normalization, the valuation engine, adaptive baselines, checklist rules, or Gemini validation.

## Runtime

Local execution remains `cd apps/api && python -m uvicorn app.main:app --host 0.0.0.0 --port 8000`. The Docker image starts with `python -m app`; `app.__main__` binds `0.0.0.0`, reads Render's `PORT`, and defaults to `8000` locally. Both paths import the same `app.main:app` object.
