# Render Workflow demo

This is an optional **separate Workflow service**, not a replacement for the
FastAPI web service. No frontend changes or public trigger endpoint are needed.
The dashboard runs `analyze_company` with a ticker, using the same SEC ingestion,
normalization, deterministic valuation, immutable checklist, and bounded Gemini
analysis as the API. It returns the full analysis and provenance as JSON.

## Fastest deployment path (manual)

1. Push the local changes to GitHub after reviewing them. Do not force-push if
   your friend's commits arrive; integrate those commits first.
2. In Render, select **New > Workflow**, linking `Aarush-x/DCFLens`, branch `main`.
3. Name: `dcflens-analysis`. Language: **Docker**. Region: same as the API.
4. Leave Root Directory empty (repository root). Docker build context: `.`.
   Dockerfile Path: `apps/api/Dockerfile.workflows`.
5. **Start Command: `python -m app.workflow`**. Set this explicitly even though
   the Dockerfile has a CMD: Render's Workflow creation form requires it.
   Do not use Uvicorn, a PORT setting, or an HTTP health check here.
6. Add environment variables below to this NEW workflow service. Values from
   `dcflens-api` do not automatically transfer to another service.
7. Click **Deploy Workflow**, wait for task registration, then open **Tasks >
   analyze_company > Start Task**. Enter the JSON array **`["AAPL"]`**.
8. Inspect the run's logs and result. Confirm `result.ticker`,
   `result.analysis.final_valuation.intrinsic_value_per_share`, the sensitivity
   interval, original checklist, and evidence references. Show `ai_status`
   honestly: `APPLIED` or `DETERMINISTIC_FALLBACK` with its reason.
9. Save screenshots of the Workflow task, completed run, logs, and JSON result
   for the demo. Prize eligibility still depends on the organizer's rules.

Official setup: [Your First Workflow](https://render.com/docs/workflows-tutorial).
Render [does not support Workflows in Blueprints yet](https://render.com/docs/workflows),
so root `render.yaml` intentionally remains unchanged.

## Environment (new Workflow service only)

| Variable | Value / purpose |
| --- | --- |
| `APP_ENV` | `production` |
| `SEC_IDENTITY` | `DCFLens your-real-monitored-email@your-domain.com`; replace with your actual contact |
| `GOOGLE_API_KEY` | Your Gemini secret, entered only in Render Environment; optional for deterministic-only valuation |
| `GEMINI_MODEL` | `gemini-3.5-flash`, or your verified available model |
| `GEMINI_TIMEOUT_SECONDS` | `45` per-attempt I/O timeout |
| `GEMINI_TOTAL_TIMEOUT_SECONDS` | `75` shared scheduling budget |
| `GEMINI_MAX_RETRIES` | `2` delayed retries per model |
| `GEMINI_BACKOFF_SECONDS` | `1` initial backoff, doubled per retry plus jitter |
| `SEC_TIMEOUT_SECONDS` | `15` |
| `SEC_MAX_RETRIES` | `2` |
| `CACHE_MAX_ENTRIES` | `16` |
| `CACHE_TTL_SECONDS` | `900` |
| `LOG_LEVEL` | `INFO` (workflow startup deliberately fixes logging at INFO) |
| `CORS_ALLOWED_ORIGINS` | `https://dcflens.vercel.app` |

CORS is unused by this non-HTTP worker but required by the reused production
Settings validator. Keeping that validator unchanged avoids weakening the API.
No `RENDER_API_KEY` is required for dashboard-triggered execution. Render supplies
its SDK socket/mode variables; do not set them yourself. Never put credentials
into ticker input, task results, Docker build arguments, or public frontend vars.

## Demo behavior and cost controls

- One real task, `analyze_company(ticker)`, Standard plan, 300-second timeout,
  **zero workflow retries**. Existing bounded SEC/Gemini retries still apply.
- One task invocation calls the existing pipeline once. No fan-out or scheduled
  loop. Trigger one ticker at a time to keep SEC traffic and spend controlled.
- Missing SEC data/unsupported ticker/configuration failure fails the task with
  a safe error code. Logs include ticker, error type/code, completion duration,
  AI status and fallback reason, never raw prompts or keys.
- Gemini failure preserves the real deterministic result. A completed Workflow
  does not imply Gemini succeeded; check `ai_status`. No production fixture mode.
- Memory caches live only inside a task process, not across task runs. Duplicate
  dashboard clicks create separate billed runs; no cross-run deduplication.
- Timeout is enforced by Render, not by calling the Python function directly.
- Task input/result retention is managed by Render, not local persistent disk.
  Results contain public filing evidence, not provider secrets.
- Standard's listed compute rate is $0.20/hour: a five-minute attempt is about
  $0.017 in compute, excluding Gemini, retention and bandwidth. This is not an
  account spending cap. Check the dashboard: Render announced Starter/Standard
  migration to usage-based Flex on September 1, 2026.

See [pricing](https://render.com/docs/workflows-limits) and
[pricing transition](https://render.com/blog/upcoming-changes-to-workflows-pricing).

## Local verification

From the DCFLens repository root:

```sh
apps/api/.venv/bin/python -m pip install -r apps/api/requirements-workflows.txt
apps/api/.venv/bin/python -m pytest apps/api/tests
docker build -f apps/api/Dockerfile.workflows -t dcflens-workflow:demo .
docker run --rm --network none dcflens-workflow:demo python -c \
  'import os; from app.workflow import app; print(app); print("uid", os.getuid())'
```

Workflow tests use the actual SDK with stubbed external providers and synthetic
financial fixtures. They are offline verification, not proof of live Gemini or
SEC access. The ordinary API dependency set skips this optional test module;
install `requirements-workflows.txt` to run it.

Do not run `python -m app.workflow` bare outside Render: the SDK needs its
managed runtime socket. Docker import checks and SDK callback tests validate
local wiring, not hosted provisioning. Deployment and one live AAPL run remain
manual verification steps. Workflows do not eliminate Gemini quota/503 failures.

To stop demo activity, stop submitting runs and cancel outstanding runs from
the Workflow dashboard. The existing website remains on the original API path.
To roll back this addition, remove the separate Workflow service after saving
demo evidence; no FastAPI or frontend rollback is needed.

## Verification recorded August 30, 2026

- 222 backend tests passed on local Python 3.14 and in the workflow image on
  Python 3.12, including 13 workflow cases. The existing Starlette/httpx
  deprecation warning remains; it is not a workflow failure.
- Actual Render SDK 1.0.1 registered the task through the module entry point
  with its registration callback intercepted locally. No provider secrets or
  external network calls were needed. Task execution tests used the real SDK
  executor with fixture SEC/Gemini providers, not a fake SDK.
- Docker build from `.` passed. Offline, read-only container import passed as
  UID 10001; application image had no `.env`, `.git`, or tests. No runtime key
  was supplied. The image does not copy frontend sources.
- Python compilation, dependency consistency (`pip check`), and whitespace
  checks passed. Test dependencies were installed only in the disposable test
  container, not added to the production Dockerfile.
- Kluster review/dependency tools were unavailable. No Kluster approval is
  claimed. Changes were manually inspected alongside the automated checks.
- No live Render registration/run, live SEC/Gemini call, dashboard update, or
  remote push was performed. Those remain the operator's demo smoke test.
