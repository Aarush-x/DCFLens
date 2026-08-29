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
   first request of a session pays ~30s to wake the container before the analysis
   itself even starts; 90s leaves room for a cold start plus a slow SEC read
   without leaving a judge staring at a screen that will never resolve. The dev
   proxy is given more than this (vite.config.js) so that OUR timeout is the one
   that fires and the message is the same in dev and production. */
const TIMEOUT_MS = 90_000

/**
 * The one network call in the app.
 *
 * Returns the parsed body for anything the adapter can render — a 200 envelope, or
 * a 422 refusal, which is a designed product state and not a failure (non-negotiable
 * #3). Throws a RequestFailure for everything else, so the screen shows designed
 * copy instead of a stack trace. See src/lib/failure.js for the taxonomy.
 */
async function analyze(ticker) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  let res
  try {
    res = await fetch(`/api/analyze/${encodeURIComponent(ticker)}`, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    })
  } catch (err) {
    // Offline, DNS, a proxy that hung up, or our own abort. All indistinguishable
    // from here, and all honestly described as "not responding".
    throw noResponse(err?.name === 'AbortError' ? 'timeout' : 'network')
  } finally {
    clearTimeout(timer)
  }

  // A gateway error page, or a proxy that answered HTML. Not JSON, so there is no
  // error body to read and nothing to classify beyond the status.
  let body = null
  try {
    body = await res.json()
  } catch {
    if (res.ok) throw noResponse('network')
    throw failureFor(res.status, null)
  }

  // 200, or the refusal. Both are the adapter's to render.
  if (res.ok || res.status === REFUSAL_STATUS) return body

  throw failureFor(res.status, body)
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
    let live = true
    const params = readParams()

    async function run() {
      setState({ data: null, loading: true, error: null })
      try {
        let data
        if (ticker && !params.mockExplicit) {
          data = toView(await analyze(ticker))
        } else {
          data = asView(await loadMock(params.mock))
        }

        // Mocks carry no AI status; the envelope does. Default OK, URL wins,
        // so the AI-unavailable state is reachable without editing code.
        data = { ...data, aiStatus: params.status || data.aiStatus || 'OK' }

        if (live) setState({ data, loading: false, error: null })
      } catch (err) {
        if (live) setState({ data: null, loading: false, error: err })
      }
    }

    run()
    return () => { live = false }
  }, [ticker])

  return state
}
