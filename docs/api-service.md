# FastAPI service layer

## Endpoints

`GET /health` is a process-liveness endpoint. It returns `200` with only the service name and status. It does not initialize the analysis service and never calls SEC EDGAR, Gemini, a cache, a database, or another provider.

`GET /api/analyze/{ticker}` validates and normalizes the ticker, retrieves SEC Company Facts and submissions metadata, normalizes annual facts with claim-level evidence, builds deterministic adaptive assumptions, evaluates the unchanged ten-point checklist, calculates one DCF valuation and its sensitivity interval, and then optionally applies validated Gemini adjustments. The response includes latest filing metadata and every evidence reference carried by the domain results. A separate filing route is not currently justified because the analysis response already exposes accession-specific filing metadata and claim-level evidence URLs.

`GET /api/market-context/{ticker}` reuses the cached price-free analysis and
returns only `market_price` plus the cheap price-relative `plausibility`
assessment. It does not rerun SEC normalization, deterministic valuation, annual
report parsing, or Gemini when a memory or durable analysis snapshot exists.

Gemini absence, timeout, rate limiting, malformed output, or provider failure preserves a successful deterministic valuation. The response `analysis.status` is `DETERMINISTIC_FALLBACK`, and `analysis.fallback_reason` distinguishes the outcome. Provider failures are logged without credentials, response bodies, or prompts.

### Diagnosing Gemini on Render

`provider_timeout` with `http_status: null` means the client did not get a complete
response in time, or its scheduling budget expired. It does **not** establish an
invalid API key or a rate limit. HTTP 429 / `RESOURCE_EXHAUSTED` identifies quota
or rate limiting; `API_KEY_INVALID`, HTTP 401, or HTTP 403 identifies credential
or permission problems. HTTP 503 / `UNAVAILABLE` is provider unavailability.
See [Google's retry guidance](https://ai.google.dev/gemini-api/docs/troubleshooting).
Billing can change quota, but cannot guarantee a fix for timeouts or overload.

Keep `GOOGLE_API_KEY` only in Render's environment, not code or frontend variables.
The API web service and Workflow have separate environments. Check both if using
both. Use these backend-only recovery settings:

```dotenv
GEMINI_MODEL=gemini-3.5-flash
GEMINI_TIMEOUT_SECONDS=45
GEMINI_TOTAL_TIMEOUT_SECONDS=75
GEMINI_MAX_RETRIES=2
GEMINI_BACKOFF_SECONDS=1
LOG_LEVEL=INFO
```

Existing Render environment overrides such as `GEMINI_TIMEOUT_SECONDS=30` take
precedence over the new code default. Update the API service and, separately,
the Workflow environment if using both. Saving changes requires a restart or
redeployment of the affected service. The Workflow uses the same client recovery
logic, without adding whole-task retries. Its startup already logs at INFO.

The 75-second budget is shared across models, not 75 seconds for each attempt.
The primary has a 45-second scheduling window and reserves 30 seconds for the
fallback by default. Short failures retry with 1s then 2s delays plus jitter;
a full 45s timeout switches to fallback immediately. Bounds and exact semantics
are in [AI trust boundaries](ai-trust-boundaries.md#bounded-gemini-recovery).
The browser currently has a 90-second analysis-request deadline. SEC retrieval,
valuation, quote retrieval, and response transmission also take time, so 75s of
AI recovery can still exceed the browser deadline on an uncached request.
Raising the total budget requires coordinating browser/proxy deadlines, or using
the existing Workflow path for longer-running analysis. No frontend deadlines
are changed by this backend patch. Retries may create additional billable model
requests even if the client timed out waiting for the previous response.

After deploying the fix, refresh one ticker and filter **Application logs** for
`gemini_`. Group events by `gemini_call_id`. A timeout alone is not the final
outcome: look for a subsequent retry, `gemini_trying_reviewed_fallback_model`, and
success, or the service's `analysis_completed_with_deterministic_fallback`.
`connection_or_headers` cannot distinguish DNS, TLS, and model processing;
`response_body` means headers arrived but body reading failed. Only a response
with `analysis.status: APPLIED` proves domain validation accepted the AI output.
`/health` deliberately does not test Gemini.
Failure logs now include `request_duration_ms`, `duration_scope`, configured and
effective timeout, and the remaining budget. `duration_scope=attempt` excludes
earlier requests/backoff; `generation` includes them when scheduling is exhausted.
Only safe diagnostics are logged, not API keys, prompts, or generated text.

The default qualitative workload is now `compact-v1`: up to 16 intact evidence
items, three assumption decisions, at most three evidence assessments and three
checklist comments, and a 4,096-token output allowance. Both reviewed Gemini 3.5
models use minimal thinking. There is no additional environment toggle; deploy
the updated code to the API service and Workflow to use this policy. Find
`gemini_context_prepared` to verify selected/omitted counts and prompt size, and
`gemini_request_started` to verify `max_output_tokens: 4096` and
`thinking_level: MINIMAL`. See [the compact-review contract](ai-trust-boundaries.md#compact-qualitative-review-compact-v1).
Only `analysis.status: APPLIED` confirms that Gemini output passed validation.
Reduced workload does not guarantee availability or turn a failed call into a
successful one. The complete original ten-point checklist still runs in Python.

When 10-K excerpts are available, the same call uses `compact-narrative-v1` and
adds a separate `analysis.annual_report` object. Its findings, extraction coverage,
and source excerpts are described in [annual-report analysis](annual-report-analysis.md).
The evidence-byte and output-token limits are unchanged; filing retrieval adds
latency and can fail independently of Company Facts.

For a small diagnostic from the API service's Render Shell (`/app`, if Shell is
available on your plan), run the following. It reads the existing environment
without displaying the key. This makes real generation requests and can incur
Gemini charges, including bounded retries. Do not paste keys into the command.
It does not call SEC or certify a full valuation; it checks a small structured
request using the actual client and shows the model attempted in the logs.

```sh
python - <<'PY'
import json
import os
from app.ai.gemini import GeminiClient, GeminiClientConfig, GeminiProviderError
from app.ai.models import ProviderRequest
from app.core.logging import configure_logging

configure_logging("INFO")
key = os.environ.get("GOOGLE_API_KEY", "").strip()
if not key:
    print(json.dumps({"probe_status": "GOOGLE_API_KEY_missing"}))
    raise SystemExit(2)
try:
    client = GeminiClient(GeminiClientConfig(
        api_key=key,
        model=os.environ.get("GEMINI_MODEL") or "gemini-3.5-flash",
        timeout_seconds=float(os.environ.get("GEMINI_TIMEOUT_SECONDS") or "45"),
        total_timeout_seconds=float(os.environ.get("GEMINI_TOTAL_TIMEOUT_SECONDS") or "75"),
        max_retries=int(os.environ.get("GEMINI_MAX_RETRIES") or "2"),
        backoff_seconds=float(os.environ.get("GEMINI_BACKOFF_SECONDS") or "1"),
    ))
    text = client.generate(ProviderRequest(
        "Return only the requested JSON. No explanation.",
        'Return {"ok":true}.',
        {"type": "object", "properties": {"ok": {"type": "boolean"}},
         "required": ["ok"], "additionalProperties": False},
    ))
    status = "passed" if json.loads(text) == {"ok": True} else "unexpected_json"
    print(json.dumps({"probe_status": status}))
except GeminiProviderError as exc:
    print(json.dumps({"probe_status": "failed", "reason": exc.fallback_reason,
                      "http_status": exc.http_status}))
    raise SystemExit(1) from None
except ValueError:
    print(json.dumps({"probe_status": "invalid_configuration_or_json"}))
    raise SystemExit(1) from None
PY
```

Then run one real analysis from the website. A passing small probe proves that
at least one logged model answered in that environment; a larger analysis may
still time out or fail evidence validation. If it does, retain the correlated
Gemini log sequence and final fallback reason, not your API key. Local simulated
tests cannot certify the deployed key, Google capacity, billing tier, or quota.

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

Production responses never include stack traces. Sanitized internal errors retain request-ID and configured CORS headers, including browser-readable `X-Request-ID` and `Retry-After`. JSON exception logs retain exception type and stack locations (file, function, line), but omit exception messages, source lines, locals, and exception-chain payloads, which may contain secrets or prompts.

Ticker syntax is checked before analysis dependencies initialize. The health handler runs asynchronously so it does not wait for the worker-thread capacity used by blocking analyses.

## Annual valuation input alignment

Debt and cash must share the latest annual FCF period end. Diluted average shares must share its start and end dates. Missing aligned inputs return `missing_sec_data`; an older year's balance or share count is never silently substituted. If diluted shares are absent, current outstanding shares remain an explicit fallback, restricted to observations dated from fiscal year-end through 120 days afterward. This is a conservative application selection bound, not a claim about SEC filing deadlines. The original source references and dates remain unchanged.

A single available FCF year can still support a prior-backed valuation. Its source fact remains available to adaptive coverage and evidence, but the DCF's optional historical-stability input is empty because a range statistic needs two observations. No extra history is manufactured.

Production startup validates SEC identity using the SEC client's own rules, rejects control characters and invalid CORS ports/wildcard hostnames, bounds cache TTL to 1–86,400 seconds and Gemini timeout to 1–120 seconds, and validates the model identifier before any provider call.

## CORS

`CORS_ALLOWED_ORIGINS` is a comma-separated list of exact HTTP or HTTPS origins. Development defaults to `http://localhost:3000`. Production requires at least one explicit origin and rejects `*`.

After Vercel assigns the production domain, set Render's `CORS_ALLOWED_ORIGINS` to that exact origin, for example `https://dcflens.vercel.app`, and restart the API. If preview access is needed, set both `CORS_VERCEL_PREVIEW_PROJECT` and `CORS_VERCEL_PREVIEW_TEAM`. The API derives an anchored regex limited to that project/team pair; it does not allow arbitrary `vercel.app` sites. Leave both preview variables unset when previews do not need API access.

## Cache and concurrency model

Normalized SEC data, provider-independent calculations, completed AI-applied
analysis, annual-report parsing, and quotes have separate bounded memory caches.
Transient Gemini fallbacks are never placed in the completed-analysis cache, so
a later request can retry Gemini while reusing deterministic work. A per-ticker
single-flight gate coalesces concurrent analysis requests in one process.

When `DATABASE_URL` is set, validated price-free `AnalysisCore` values are also
stored in PostgreSQL JSONB. This L2 survives Render sleep, restart, and deploy.
At the configured daily UTC boundary, the first request returns the existing
snapshot and starts a bounded filing-accession check. An unchanged filing only
advances the next check. A changed filing regenerates and replaces the snapshot
after validation. PostgreSQL failures degrade to the L1 memory cache and never
enter the valuation domain. Full behavior is documented in [caching.md](caching.md).

## Runtime

Local execution remains `cd apps/api && python -m uvicorn app.main:app --host 0.0.0.0 --port 8000`. The Docker image starts with `python -m app`; `app.__main__` binds `0.0.0.0`, reads Render's `PORT`, and defaults to `8000` locally. Both paths import the same `app.main:app` object.

The Docker entry point gives Uvicorn 25 seconds to drain in-flight requests after `SIGTERM`. The repository does not configure a Render shutdown-delay override; platform termination behavior must be verified separately. The service runs one Uvicorn process so bounded process-local caches and duplicate suppression do not multiply within the prototype container.
