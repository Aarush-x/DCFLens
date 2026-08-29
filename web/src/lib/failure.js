/* Every way a request can fail that is NOT the designed refusal.
 *
 * ── The line this file draws ─────────────────────────────────────────────────
 * "We can't value this company reliably" is a PRODUCT STATE (non-negotiable #3):
 * we read the filings, and we won't publish a number we don't trust. The API
 * returns it as 422 — `missing_sec_data` or `calculation_error` — and it goes
 * through adapter.toView(), which is what builds the cannot-value screen.
 *
 * Everything else — a ticker that isn't a ticker, a company outside SEC coverage,
 * a rate limit, a service that isn't answering — is a FAILED REQUEST. It must
 * never borrow the refusal, because the refusal is a claim about the company and
 * these are claims about us. Each gets its own designed state instead of a stack
 * trace.
 *
 * Status codes are apps/api/app/main.py::_service_error_status, read off the
 * running service on 2026-08-30, not guessed:
 *
 *   400 invalid_ticker             -> unknown_ticker
 *   404 unsupported_ticker         -> unsupported
 *   422 missing_sec_data           -> NOT HERE. The refusal. adapter.toCannotValue.
 *   422 calculation_error          -> NOT HERE. Same.
 *   429 provider_rate_limit        -> rate_limited
 *   503 sec_provider_unavailable   -> unavailable
 *   5xx / network / timeout        -> unavailable
 */

/** The 422 pair. A body with one of these is a refusal, and the caller must hand
 *  it to toView() rather than to this module. */
export const REFUSAL_STATUS = 422

/** Copy for each failure kind. Sentences are the ones the batch specifies; they
 *  are split into headline and body because a display h1 carrying two sentences
 *  and a full stop reads as a paragraph set in 60px. */
export const FAILURES = {
  unknown_ticker: {
    headline: 'We don’t recognise that ticker',
    body: 'Tickers are one to five letters — AAPL, MSFT, KO. Check the spelling and try again.',
  },
  unsupported: {
    headline: 'We can’t look that one up yet',
    body: 'We read filings from the SEC, so we can only value companies listed in the US. That ticker isn’t in the SEC’s company index.',
  },
  rate_limited: {
    headline: 'Too many requests just now',
    body: 'Try again in a moment. The filing service limits how fast we can read from it, and we’d rather wait than send you a half-read answer.',
  },
  unavailable: {
    headline: 'The analysis service isn’t responding',
    body: 'This is a problem on our side, not a judgement about the company. Try the same company again in a moment.',
  },
}

/** Thrown by useAnalysis, rendered by RequestFailed. Carries everything the screen
 *  needs and nothing it has to re-derive. */
export class RequestFailure extends Error {
  constructor(kind, { detail = null, code = null, requestId = null, status = null } = {}) {
    const copy = FAILURES[kind] ?? FAILURES.unavailable
    super(copy.headline)
    this.name = 'RequestFailure'
    this.kind = FAILURES[kind] ? kind : 'unavailable'
    this.headline = copy.headline
    this.body = copy.body
    /* The server's own sentence. Shown as supporting detail, never as the
       headline — "not present in the SEC company mapping" is our vocabulary, not
       the reader's. The raw `code` is never rendered. */
    this.detail = detail
    this.code = code
    /* Kept so a failure during judging can still be traced back to a server log
       line. Rendered as a title attribute, not as visible text. */
    this.requestId = requestId
    this.status = status
  }
}

/**
 * Map an HTTP status and error body onto a failure kind.
 * 422 is deliberately absent — see the header. Callers must intercept it first.
 *
 * @param {number} status  HTTP status
 * @param {object} body    parsed `{ error: { code, message, request_id } }`, if any
 */
export function failureFor(status, body) {
  const err = body?.error ?? {}
  const kind =
    status === 400 ? 'unknown_ticker'
    : status === 404 ? 'unsupported'
    : status === 429 ? 'rate_limited'
    : 'unavailable'

  return new RequestFailure(kind, {
    detail: typeof err.message === 'string' && err.message.trim() ? err.message : null,
    code: typeof err.code === 'string' ? err.code : null,
    requestId: typeof err.request_id === 'string' ? err.request_id : null,
    status,
  })
}

/** A query the search field could not turn into a ticker at all — "Coca Cola",
 *  "the apple company". No round trip: we already know the answer, and a request
 *  we know will 400 is a request that spends the user's cold start for nothing. */
export const unresolvedQuery = (query) =>
  new RequestFailure('unknown_ticker', {
    detail: query ? `We read “${query}” as a company name, and we don’t keep a name-to-ticker index.` : null,
  })

/** Nothing came back at all — DNS, offline, CORS, a proxy that hung up, or our own
 *  abort after the timeout. Indistinguishable from the client's side, and the
 *  honest thing to say about all of them is the same. */
export const noResponse = (cause) =>
  new RequestFailure('unavailable', {
    detail: cause === 'timeout'
      ? 'The request ran past our time limit without an answer.'
      : null,
    status: null,
  })
