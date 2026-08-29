# Frontend/backend integration

## Boundary

The browser has one API boundary: `apps/web/src/lib/api-client.ts`. Components
do not construct backend URLs or call `fetch` directly. The client normalizes the
public API origin, checks liveness, requests an analysis, converts FastAPI's
snake_case JSON keys to the frontend representation, validates the minimum
success contract, and maps safe backend errors to explicit UI states.

The frontend sends only `Accept: application/json`. Fetch credentials are
explicitly omitted. `GOOGLE_API_KEY`, `SEC_IDENTITY`, Gemini prompts, and all
other provider configuration remain server-only Render variables and must never
appear in a `NEXT_PUBLIC_*` variable.

## Environment resolution

- Local development defaults to `http://localhost:8000` when
  `NEXT_PUBLIC_API_URL` is empty.
- Vercel Production and Preview builds require `NEXT_PUBLIC_API_URL`.
- The value must be an absolute HTTP or HTTPS URL without credentials, query,
  or fragment. Trailing slashes are removed centrally.
- The final Render URL is deployment configuration, never committed source.
- `NEXT_PUBLIC_API_URL` is embedded by Next.js at build time. Changing it
  requires a new Vercel build.

Example local override in `apps/web/.env.local`:

```dotenv
NEXT_PUBLIC_API_URL=http://localhost:8000
```

No override is required when the API uses the default local port.

## Request lifecycle

1. The analysis page starts in `Backend waking up`.
2. The client calls `GET /health` with an eight-second per-attempt timeout.
3. Network and timeout failures retry at bounded 1, 2, 4, and 6 second delays,
   for at most five health attempts.
4. A successful health response changes the UI to `Analysis running`.
5. `GET /api/analyze/{ticker}` has a bounded 90-second timeout and is not
   automatically duplicated. The backend already performs per-ticker
   single-flight suppression.
6. Navigation, unmounting, or a replacement request aborts the browser request.

The warm-up window is intentionally separate from analysis. A healthy API that
reports missing SEC data is not mislabeled as a Render cold start.

## User-visible outcomes

| Condition | UI treatment |
| --- | --- |
| Render has not answered health | Backend waking up, with bounded retries |
| Health succeeded and analysis is pending | Analysis running |
| Gemini fallback in a successful response | AI unavailable; deterministic valuation preserved |
| `missing_sec_data` or `sec_provider_unavailable` | SEC data unavailable |
| `invalid_ticker` or `unsupported_ticker` | Unsupported ticker |
| `provider_rate_limit` | Provider rate limit, retaining `Retry-After` metadata |
| `calculation_error` | Valuation unavailable for the returned facts |
| Missing production URL | Frontend configuration error |
| Timeout, malformed success, or unknown response | Explicit failure; no fixture or fabricated success |

A manual refresh preserves the last valid analysis while the replacement
request is waking or running. If the refresh fails, the valid result remains
visible beside the failure notice.

## Production configuration

1. Deploy the Render service and verify `GET /health`.
2. In the Vercel project whose Root Directory is `apps/web`, set
   `NEXT_PUBLIC_API_URL` to the Render service origin for Production and any
   Preview environments that should use it.
3. In Render, add the exact Vercel production origin to
   `CORS_ALLOWED_ORIGINS`. For scoped preview access, configure the existing
   `CORS_VERCEL_PREVIEW_PROJECT` and `CORS_VERCEL_PREVIEW_TEAM` pair.
4. Rebuild Vercel after changing the public API URL.

Do not add the Render URL to source code and do not use wildcard production
CORS origins.
