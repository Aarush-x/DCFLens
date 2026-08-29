import { useEffect, useState } from 'react'

/* The only place in the app that loads an analysis. Nothing else may fetch.
 *
 * Today it serves the committed mocks. When 1A.2 lands `src/lib/adapter.js`,
 * flip USE_LIVE_API to true and uncomment the two adapter lines below — the
 * live response is the AnalysisEnvelope, and toView() is what turns it into the
 * shape components read. No component ever sees the raw envelope.
 */

// import { toView } from './adapter.js'   // ← 1A.2
const USE_LIVE_API = false

/* Lazy glob, so a mock that has not been committed yet (msft-live.json is
   owned by 1A.2) is simply absent rather than a build error. */
const FILES = import.meta.glob('../mocks/*.json')

const MOCKS = {
  aapl: '../mocks/aapl.json',
  novalue: '../mocks/xyz-novalue.json',
  msft: '../mocks/msft-live.json',
}

export const DEFAULT_MOCK = 'aapl'

/** Read the check-harness overrides off the URL: ?mock=novalue&status=DETERMINISTIC_FALLBACK */
export function readParams(search = window.location.search) {
  const q = new URLSearchParams(search)
  return {
    mock: q.get('mock') || DEFAULT_MOCK,
    ticker: q.get('ticker') || null,
    status: q.get('status') || null,
    view: q.get('view') || null,
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
        if (USE_LIVE_API && ticker) {
          const res = await fetch(`/api/analyze/${ticker}`)
          const body = await res.json()
          if (!res.ok) throw new Error(body?.detail || `HTTP ${res.status}`)
          // data = toView(body)                                  // ← 1A.2
          data = body
        } else {
          data = await loadMock(params.mock)
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
