# Backend QA — 2026-08-30

Status: **DONE_WITH_CONCERNS**. Backend only; no frontend source or tests were changed or run. No GitHub push, remote merge, Render/Vercel dashboard change, or deployment was performed. The QA fixes and report are included together in a local commit at the user's request; pushing remains a manual user action.

Baseline: `606f771` on `main`. The only pre-existing untracked path was `docs/deployment-mapping 2.md`; it was not read, staged, moved, or changed.

## Verified results

| Check | Evidence |
| --- | --- |
| Original backend suite | 165 passed, one existing Starlette/httpx deprecation warning |
| New failure probes before fixes | First batch: 28 failed / 2 passed; second batch: 4 failed / 1 passed; final Gemini error-body probe: 1 failed / 9 passed |
| Final local backend suite | 209 passed, one warning, Python 3.14; 7.15 seconds |
| Docker Python runtime suite | 209 passed, one warning, Python 3.12; 7.18 seconds |
| Regression additions | 44 new cases, including one seeded probe evaluating 100 DCF assumption/input combinations |
| End-to-end backend fixture flow | SEC fixture → normalization → adaptive baseline → immutable checklist → DCF → evidence-bound mock AI → FastAPI JSON; `APPLIED`, citations retained, second request served without repeating SEC/AI work |
| Failure/fallback coverage | Timeout, 400/schema rejection, overload/retries, fabricated evidence, invalid fields, bounds, deterministic fallback and cache behavior covered by existing and new tests |
| Static/import checks | `compileall` and `git diff --check` pass; runtime `app.main` import resolves; installed Python requirements report no conflicts |
| Render configuration | Ruby YAML parser succeeds; one Docker service; context `.`, Dockerfile `./apps/api/Dockerfile`, health `/health`; no remote Blueprint validation claimed |
| Docker builds | Baseline and fixed images built with `docker build -f apps/api/Dockerfile ... .` |
| Fixed container | `python -m app`, `PORT=10092`, UID 10001, `/health` 200, malformed ticker 400 with allowed-origin CORS and matching request ID |
| Isolation/storage | Runtime container used `--network none`, `--read-only`, 512 MiB limit and temporary `/tmp`; liveness requires neither providers nor persistent disk |
| Image checks | No `.env*`, `.git`, tests or `node_modules` under `/app`; no Google key supplied; tracked backend/Blueprint scan found no Google-key/private-key signature |
| Memory | 37.82 MiB observed idle use for the fixed container; **not** a peak-load or full-SEC-payload memory certification |
| Shutdown | Fixed container exited 0 after SIGTERM, `OOMKilled=false`, Uvicorn logged application shutdown complete |

The container tests installed only test dependencies into a disposable `/tmp` virtual environment with access to the production image's installed packages. They did not add test dependencies to the production image or change dependency manifests. Provider calls in tests were mocked, not paid/live requests.

## Issues found and fixed

Severity reflects potential impact, not evidence that a production incident occurred. These are grouped defects, not a count of failed parameterized test cases.

| ID | Severity | Finding and root cause | Fix and regression evidence |
| --- | --- | --- | --- |
| BQA-01 | High | `/health` was a synchronous handler sharing the worker-thread pool with slow analyses; exhausting the pool blocked liveness. | Async liveness handler; test holds all thread capacity and still receives 200 within 0.5 seconds without initializing providers. |
| BQA-02 | Medium | Unhandled 500s were produced outside CORS/request-context middleware, losing the allowed origin and request-ID header. Browsers could see a network/CORS failure instead of the sanitized API error. | Handle ordinary exceptions inside request context; CORS wraps that response; test both allowed and unrelated origins and matching body/header IDs. |
| BQA-03 | High | JSON logging serialized full exception tracebacks, including exception messages, source lines and chained exception text that can contain provider credentials/prompts. | Log exception type and stack locations only; sentinel secrets in inner/outer exceptions must be absent while diagnostic frame locations remain. |
| BQA-04 | Medium | Startup accepted malformed SEC identities, header control characters, out-of-client-range TTL/timeouts, unsafe model names and invalid/wildcard-host CORS origins. Some then failed on first analysis. | Align runtime validation with client limits and identity rules; nine negative startup cases plus existing valid settings/CORS tests. Identity validation checks format, not whether an email is actually monitored. |
| BQA-05 | Medium | Reset/truncated SEC response bodies escaped the transport abstraction, bypassing bounded retries and the normal SEC-unavailable mapping. Errors while reading HTTP-error bodies had the same problem. | Catch network/HTTP read failures at the transport boundary; retry through existing client policy; explicit HTTP-error stream cleanup. Tests verify two attempts with a one-retry budget and immediate oversized-response rejection/stream closure. |
| BQA-06 | Medium | A company with one usable FCF year failed valuation because orchestration passed a one-element tuple to the DCF's minimum-two-observation stability check. | Keep that year's fact in normalized/adaptive evidence, omit optional DCF stability history, preserve the prior-backed valuation. Full fixture regression verifies a positive deterministic result and absent stability statistic. |
| BQA-07 | High | Independently taking the latest available debt, cash and shares could silently mix older annual values with newer FCF. | Require matching annual periods; bound current-share fallback to 0–120 days after fiscal year-end. Tests reject stale debt/cash/shares and exercise both fallback-window boundaries. |
| BQA-08 | Medium | Gemini consumed only the first response part, could treat thought text as the answer, crashed on null usage metadata, and omitted diagnostics for invalid/empty/oversized envelopes. A truncated HTTP-error body also escaped classification. | Concatenate non-thought text parts, tolerate unusable optional usage metadata, log safe failure classifications, and map interrupted HTTP reads. New tests cover multipart/thought/null metadata, five malformed/empty envelope variants, oversize, interrupted success bodies and truncated 503 error bodies. Existing strict Python validation remains authoritative. |
| BQA-09 | Medium | Ticker syntax validation occurred after lazy provider initialization; malformed input could return 500 if provider setup failed. | Validate syntax before dependency initialization; test forbids initialization and requires `invalid_ticker` 400. Also verified in the isolated Docker container. |
| BQA-10 | High | Checklist metric alignment used period end alone, allowing ratios between unequal annual duration windows. | Require matching non-null duration starts as well; mismatched gross-profit/revenue periods now yield `UNKNOWN`, not a false supportive margin. Original checklist wording/order and sector tests remain unchanged. |
| BQA-11 | Medium | Extreme but finite FCF histories overflowed intermediate range/mean arithmetic; adaptive CAGR could emit infinity in traces. Result JSON could contain non-finite values. | Compute the same stability formula using scaled values; explicitly reject non-finite adaptive growth with a domain error. Regression checks finite JSON and DCF decomposition/determinism across 100 seeded cases. DCF projection/discount/terminal formulas are unchanged. |
| BQA-12 | Low | Backend docs still said no API route existed and that the Blueprint configured a 30-second shutdown window. | Update trust/runtime docs to match implemented composition and actual Blueprint. Broader early product-spec drift remains noted below, not silently rewritten. |

One newly authored full-pipeline test initially supplied a malformed mock `disagreement_summary`; validation correctly rejected it. The mock was corrected to the existing contract. This was a QA fixture error, not an application defect, and is not counted above.

## Remaining issues and verification limits

1. **Existing test dependency warning:** Starlette deprecates its httpx-based TestClient path in favor of httpx2. Tests pass on both Python versions. A dependency migration was not performed or suppressed.
2. **No backend linter/type checker/coverage tool configured or installed:** Ruff, mypy and coverage were unavailable. Syntax compilation is not equivalent to linting/type checking, and no coverage percentage is claimed. No dependency-security vulnerability scan was run.
3. **Kluster unavailable:** only its failure-notification tool is registered; auto-review/dependency-review tools are not callable. No Kluster pass is claimed. Changes received direct diff inspection and regression tests instead.
4. **Live SEC/Gemini unverified:** no real API key/SEC identity used, no quota consumed, and no successful live model generation claimed. Current account quota, model capacity/503s, credentials, network egress and Render cold starts require separate live checks.
5. **Abuse/resource controls:** the public analysis route has no application-level inbound authentication/rate limit. SEC pacing, retries, per-ticker deduplication and bounded caches do not protect provider budgets against many distinct tickers. Capacity/load policy needs an explicit follow-up; it was not redesigned during QA.
6. **Memory/concurrency:** caches are entry-bounded rather than byte-budgeted and are process-local. No Redis/persistence dependency exists, but multi-instance deduplication, full SEC-payload peak memory, sustained traffic and draining a busy provider request at shutdown were not certified. Idle shutdown was verified.
7. **Feature/spec gaps:** production orchestration currently provides structured Company Facts and filing metadata, not 10-K narrative/Exhibit 21 evidence. Business diversity/subsidiary conclusions therefore cannot be verified from narrative through this route. The early product requirements also describe alternative scenarios and an explicit versioned supported universe; current implementation uses one final valuation and SEC ticker mapping rather than an S&P-500/versioned allowlist. These require product reconciliation, not a silent QA feature expansion.
8. **Financial coverage:** existing tests cover technology, retail, financial, utility and missing/conflicting SEC fixtures; checklist tests also cover healthcare and industrial examples. This does not establish accurate concept coverage or suitable DCF economics for every issuer/accounting structure.
9. **Security scope:** secret checks were pattern scans and image-content/config inspection, not proof that every possible secret format is absent from all Git history or image layers. Exception-payload redaction is tested; arbitrary future log messages still need careful handling.
10. **Frontend excluded:** no browser, layout, frontend unit/build, or live frontend integration QA was performed. Frontend code was not changed.

## Re-run local checks

From `/Users/aarushmuralinathan/Documents/DcfLens`:

```sh
apps/api/.venv/bin/python -m pytest apps/api/tests
apps/api/.venv/bin/python -m compileall -q apps/api/app apps/api/tests
git diff --check
docker build -f apps/api/Dockerfile -t dcflens-api:backend-qa-fixed .
```

Temporary runtime containers were stopped after checking shutdown. Local QA images remain for inspection. No files owned by the frontend collaborator were modified.

Reference checked for Gemini's content/parts response shape: [Google generateContent API](https://ai.google.dev/api/generate-content). Starlette middleware ordering was inspected in the installed package after its documentation endpoint failed to load.
