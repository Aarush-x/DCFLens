import { useEffect, useState } from 'react'

/* The only place in the app that loads an analysis. Nothing else may fetch.
 *
 * ── Which source, and why ────────────────────────────────────────────────────
 * An explicit `?mock=` in the URL ALWAYS wins. That is what check.sh drives, and
 * it has to be deterministic: a gate that depends on Render's free tier waking up
 * is a gate that fails for reasons that have nothing to do with the code.
 *
 * Otherwise a ticker goes to the live API, so the rail and the search field
 * actually work. With neither, the default mock stands in — which is what
 * `?view=app&state=result` renders for the parity capture.
 *
 * The live response is the AnalysisEnvelope, and toView() (1A.2) is what turns it
 * into the docs/API.md v2 shape components read. No component ever sees the raw
 * envelope, whichever door it came through.
 */

import { toView } from './adapter.js'
import { failureFor, noResponse, REFUSAL_STATUS } from './failure.js'

/* Lazy glob, so a mock that is not committed is simply absent rather than a
   build error. */
const FILES = import.meta.glob('../mocks/*.json')

const MOCKS = {
  aapl: '../mocks/aapl.json',
  novalue: '../mocks/xyz-novalue.json',
  msft: '../mocks/msft-live.json',
}

export const DEFAULT_MOCK = 'aapl'

/** Read the check-harness overrides off the URL:
 *  ?view=app&state=result&mock=novalue&status=DETERMINISTIC_FALLBACK&ticker=MSFT
 *
 *  `mockExplicit` is the one that matters: it separates "the caller asked for this
 *  mock" from "nothing was asked for, so `mock` fell back to the default". Only the
 *  first may override the live API. */
export function readParams(search = window.location.search) {
  const q = new URLSearchParams(search)
  const mock = q.get('mock')
  return {
    mock: mock || DEFAULT_MOCK,
    mockExplicit: Boolean(mock),
    ticker: q.get('ticker') || null,
    status: q.get('status') || null,
    view: q.get('view') || null,
    // design/index.html's own capture parameter: the app opens on search unless
    // this says otherwise.
    state: q.get('state') || null,
  }
}

async function loadMock(name) {
  const path = MOCKS[name]
  if (!path) throw new Error(`Unknown mock "${name}" — expected one of ${Object.keys(MOCKS).join(', ')}`)
  const loader = FILES[path]
  if (!loader) {
    // Not a crash: msft-live.json arrives with 1A.2. Surface it, don't fake it.
    throw new Error(`Mock "${name}" (${path}) is not committed yet`)
  }
  const mod = await loader()
  return mod.default ?? mod
}

/* How long we will wait before calling it. Render's free tier sleeps, and the
   first request of a session pays ~21s (measured) to wake the container before the
   analysis itself even starts; 90s leaves room for a cold start plus a slow SEC
   read without leaving a judge staring at a screen that will never resolve. The
   dev proxy is given more than this (vite.config.js) so that OUR timeout is the
   one that fires and the message is the same in dev and production. */
export const TIMEOUT_MS = 90_000

/* How long to wait before the one retry. Long enough that a container which was
   still binding its port has moved on, short enough that a judge does not notice
   it. See RETRY_STATUS below for what is retried, and what deliberately is not. */
export const RETRY_AFTER_MS = 1_200

/* Not a failure state — it means the effect that started this run was cleaned up
   (the ticker changed, or the screen went away). Nothing should be rendered for
   it, so it is thrown to unwind the run and swallowed at the top. */
class Cancelled extends Error {
  constructor() {
    super('cancelled')
    this.name = 'Cancelled'
  }
}

/** setTimeout that a cancellation can cut short, so the gap before a retry does
 *  not outlive the run that scheduled it. */
function pause(ms, signal) {
  return new Promise((resolve, reject) => {
    const done = () => {
      clearTimeout(id)
      signal.removeEventListener('abort', onAbort)
    }
    const onAbort = () => {
      done()
      reject(new Cancelled())
    }
    const id = setTimeout(() => {
      done()
      resolve()
    }, ms)
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * One attempt. Returns the parsed body for anything the adapter can render — a 200
 * envelope, or a 422 refusal, which is a designed product state and not a failure
 * (non-negotiable #3). Throws a RequestFailure for everything else, so the screen
 * shows designed copy instead of a stack trace (src/lib/failure.js), or a Cancelled
 * if the run was abandoned.
 *
 * Failures that are worth one more ask carry `retryable`; analyze() reads it.
 */
async function attempt(ticker, signal) {
  if (signal.aborted) throw new Cancelled()

  /* A controller per attempt, chained to the run's. The run's signal cancels;
     this one also carries our own timeout, and `timedOut` is what tells the two
     apart once fetch has rejected with the same AbortError for both. */
  const controller = new AbortController()
  const relay = () => controller.abort()
  signal.addEventListener('abort', relay, { once: true })
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, TIMEOUT_MS)

  let res
  try {
    res = await fetch(`/api/analyze/${encodeURIComponent(ticker)}`, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    })
  } catch (err) {
    if (err?.name === 'AbortError') {
      // Our clock ran out — a real failure, and not one to ask again about.
      if (timedOut) throw noResponse('timeout')
      // The caller walked away. Say nothing.
      throw new Cancelled()
    }
    // Offline, DNS, or a proxy that hung up on a container still waking. Honestly
    // described as "not responding", and worth exactly one more try.
    throw retryable(noResponse('network'))
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', relay)
  }

  // A gateway error page, or a proxy that answered HTML. Not JSON, so there is no
  // error body to read and nothing to classify beyond the status.
  let body = null
  try {
    body = await res.json()
  } catch {
    if (signal.aborted) throw new Cancelled()
    if (res.ok) throw retryable(noResponse('network'))
    throw classify(res.status, null)
  }

  // 200, or the refusal. Both are the adapter's to render.
  if (res.ok || res.status === REFUSAL_STATUS) return body

  throw classify(res.status, body)
}

/* Which statuses are worth one more ask.
 *
 * 503 is the service's own `sec_provider_unavailable` — "not ready yet" rather
 * than "no". 502 and 504 are the two ways a PROXY reports that it never got an
 * answer out of the service at all, and both are the cold start's real signature:
 * neither dev's vite proxy nor Vercel's rewrite passes a dropped upstream
 * connection through to us as a network error, so a client that only retried on a
 * network error would never once retry the case it was written for. Measured
 * against a stub that drops the connection: the browser sees 502, not a failure to
 * fetch.
 *
 * 500 is deliberately NOT here. That is our own service answering, badly — an
 * answer, and asking again just gets it twice. Nor is anything in the 4xx range:
 * 400, 404 and 429 are designed refusals (src/lib/failure.js), and 422 never
 * reaches this function at all. */
const RETRY_STATUS = new Set([502, 503, 504])

const classify = (status, body) => {
  const failure = failureFor(status, body)
  return RETRY_STATUS.has(status) ? retryable(failure) : failure
}

const retryable = (failure) => Object.assign(failure, { retryable: true })

/**
 * The one network call in the app, with its single retry.
 *
 * Exported for src/lib/useAnalysis.test.js. Nothing outside this module and that
 * test may call it — the hook is still the only door into the API (see the header).
 */
export async function analyze(ticker, signal) {
  try {
    return await attempt(ticker, signal)
  } catch (err) {
    if (err instanceof Cancelled || !err?.retryable) throw err
    await pause(RETRY_AFTER_MS, signal)
    // Whatever comes back this time stands, retryable or not. Once, not until.
    return attempt(ticker, signal)
  }
}

/* The seam (1A.2). msft-live.json is a raw AnalysisEnvelope; aapl.json and
   xyz-novalue.json are already in docs/API.md v2 shape. Anything envelope-shaped —
   or an error body — goes through toView, so no component ever sees the raw
   envelope, whether it arrived over the network or out of a mock. */
const isEnvelope = (d) => Boolean(d && typeof d === 'object' && (d.analysis || d.error))
const asView = (d) => (isEnvelope(d) ? toView(d) : d)

/**
 * @param {string|null} ticker  null → whatever ?mock= selects
 * @returns {{ data: object|null, loading: boolean, error: Error|null }}
 */
export function useAnalysis(ticker) {
  const [state, setState] = useState({ data: null, loading: true, error: null })

  useEffect(() => {
    /* One controller per run. Cleanup aborts it, which does two things the old
       `live` flag could not: it stops the request itself rather than only
       discarding the answer, and it cuts short the gap before a retry. Switching
       tickers quickly used to pile in-flight requests up against a sleeping host,
       each one still waiting out its ninety seconds after nobody wanted it. */
    const run = new AbortController()
    const params = readParams()

    async function load() {
      setState({ data: null, loading: true, error: null })
      try {
        let data
        if (ticker && !params.mockExplicit) {
          data = toView(await analyze(ticker, run.signal))
        } else {
          data = asView(await loadMock(params.mock))
        }

        // Mocks carry no AI status; the envelope does. Default OK, URL wins,
        // so the AI-unavailable state is reachable without editing code.
        data = { ...data, aiStatus: params.status || data.aiStatus || 'OK' }

        if (!run.signal.aborted) setState({ data, loading: false, error: null })
      } catch (err) {
        /* An abandoned run renders nothing. Leaving the screen on whatever it was
           showing is right: the next run has already set it to loading, and a
           cancellation is not something that happened to the user. */
        if (run.signal.aborted || err instanceof Cancelled) return
        setState({ data: null, loading: false, error: err })
      }
    }

    load()
    return () => run.abort()
  }, [ticker])

  return state
}
