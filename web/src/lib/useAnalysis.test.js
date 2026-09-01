/* The network layer under useAnalysis: cancellation, the timeout, and the one retry.
 *
 * ── Why these are worth testing when nothing else here is ────────────────────
 * Every other failure in this app is visible the moment it happens. These three are
 * not: a request that keeps running after nobody wants it, a request that never
 * ends, and a retry that quietly turns into a loop are all invisible from the
 * screen. They show up as a demo that stalls, which is the one moment there is no
 * time to debug.
 *
 * The rules being pinned:
 *   1. A cancelled run throws Cancelled and never becomes an error screen.
 *   2. Aborting stops the request itself, not just the answer.
 *   3. Network errors and 503 get exactly ONE more attempt.
 *   4. 400 / 404 / 429 get none — they are designed refusals, and re-asking is
 *      just making the same answer arrive twice.
 *   5. A timeout gets none either. It has already spent ninety seconds.
 *   6. 422 is not a failure at all; it is the refusal, and comes back as a body.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { analyze, marketContext, RETRY_AFTER_MS, TIMEOUT_MS } from './useAnalysis.js'
import { REFUSAL_STATUS } from './failure.js'

/** A fetch stub that answers a scripted list of outcomes, one per call, and
 *  records the signal it was handed so a test can see the request really was
 *  cancelled rather than merely ignored. */
function stubFetch(...outcomes) {
  const calls = []
  const fetch = vi.fn((url, init) => {
    calls.push({ url, signal: init.signal })
    const outcome = outcomes[calls.length - 1] ?? outcomes[outcomes.length - 1]
    return outcome(init.signal)
  })
  vi.stubGlobal('fetch', fetch)
  return calls
}

/** A response the real fetch would give: status, and a JSON body. */
const responds = (status, body = {}) => () =>
  Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) })

/** The connection failing outright — offline, DNS, or a container not yet listening. */
const drops = () => () => Promise.reject(new TypeError('Failed to fetch'))

/** A request that never answers, and rejects the way fetch does when aborted. */
const hangs = () => (signal) =>
  new Promise((_, reject) => {
    signal.addEventListener('abort', () => {
      const err = new Error('aborted')
      err.name = 'AbortError'
      reject(err)
    })
  })

/* Every retry sleeps for RETRY_AFTER_MS and every attempt carries a 90s clock.
   Real time would make this suite slower than the whole rest of it put together. */
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/** Turn a promise into its outcome, so a test can assert on a rejection without
 *  wrapping every case in try/catch. Attaches handlers and nothing else — the
 *  clock stays the caller's to drive. */
const outcome = (promise) => promise.then((value) => ({ value }), (error) => ({ error }))

/** Run `analyze` to completion, letting every pending timer fire. Timers are
 *  advanced rather than awaited so the 90s timeout is reachable in milliseconds.
 *  Cancellation tests do NOT use this: they need to act while the run is still in
 *  flight, and this would have run the clock out before they got the chance. */
async function run(ticker = 'AAPL', signal = new AbortController().signal) {
  const settled = outcome(analyze(ticker, signal))
  await vi.advanceTimersByTimeAsync(TIMEOUT_MS + RETRY_AFTER_MS * 2)
  return settled
}

describe('a request that succeeds', () => {
  it('asks once and returns the body', async () => {
    const calls = stubFetch(responds(200, { analysis: { ticker: 'AAPL' } }))
    const { value, error } = await run()
    expect(error).toBeUndefined()
    expect(value).toEqual({ analysis: { ticker: 'AAPL' } })
    expect(calls).toHaveLength(1)
  })

  it('encodes the ticker into the path rather than trusting it', async () => {
    const calls = stubFetch(responds(200, {}))
    await run('BRK.B')
    expect(calls[0].url).toBe('/api/analyze/BRK.B')
  })
})

describe('the independent market context', () => {
  it('requests only the lightweight market endpoint', async () => {
    const body = {
      ticker: 'AAPL',
      market_price: { status: 'AVAILABLE', quote: { price: 181 } },
      plausibility: { level: 'SOUND' },
    }
    const calls = stubFetch(responds(200, body))

    const result = await marketContext('AAPL', new AbortController().signal)

    expect(result).toEqual(body)
    expect(calls[0].url).toBe('/api/market-context/AAPL')
  })

  it('cancels a quote refresh when the analysis screen is left', async () => {
    const controller = new AbortController()
    const calls = stubFetch(hangs())
    const settled = outcome(marketContext('AAPL', controller.signal))

    await vi.advanceTimersByTimeAsync(10)
    controller.abort()

    const { error } = await settled
    expect(calls[0].signal.aborted).toBe(true)
    expect(error.name).toBe('Cancelled')
  })
})

describe('the refusal is not a failure', () => {
  it('returns a 422 body for the adapter to render', async () => {
    const body = { error: { code: 'missing_sec_data' } }
    const calls = stubFetch(responds(REFUSAL_STATUS, body))
    const { value, error } = await run()
    expect(error).toBeUndefined()
    expect(value).toEqual(body)
    // A refusal is an answer. Asking again would only get the same one.
    expect(calls).toHaveLength(1)
  })
})

describe('the single retry', () => {
  it('asks again after a dropped connection, and keeps the second answer', async () => {
    const calls = stubFetch(drops(), responds(200, { analysis: { ticker: 'MSFT' } }))
    const { value, error } = await run('MSFT')
    expect(error).toBeUndefined()
    expect(value).toEqual({ analysis: { ticker: 'MSFT' } })
    expect(calls).toHaveLength(2)
  })

  /* 502 and 504 matter as much as 503 and were nearly missed. Neither the dev
     proxy nor Vercel's rewrite passes a dropped upstream connection through as a
     network error — the browser is handed a 502. Measured against a stub that
     destroys the socket mid-cold-start. A client retrying only on 503 would never
     retry the case the retry exists for. */
  const gateway = [
    [503, 'the service saying the SEC provider was not ready'],
    [502, 'a proxy that never reached a waking container'],
    [504, 'a proxy that gave up waiting on one'],
  ]

  for (const [status, why] of gateway) {
    it(`asks again after ${status} — ${why}`, async () => {
      const calls = stubFetch(responds(status, { error: {} }), responds(200, { analysis: {} }))
      const { error } = await run()
      expect(error).toBeUndefined()
      expect(calls).toHaveLength(2)
    })
  }

  it('gives up after the second attempt — once, not until', async () => {
    const calls = stubFetch(drops(), drops(), drops())
    const { error } = await run()
    expect(calls).toHaveLength(2)
    expect(error.name).toBe('RequestFailure')
    expect(error.kind).toBe('unavailable')
  })

  it('gives up after a second 502 rather than hammering a waking container', async () => {
    const calls = stubFetch(responds(502, {}))
    const { error } = await run()
    expect(calls).toHaveLength(2)
    expect(error.kind).toBe('unavailable')
  })
})

describe('what is never retried', () => {
  /* Each of these is the service giving an answer. Re-sending it spends another
     cold start to be told the same thing. */
  const designed = [
    [400, 'unknown_ticker'],
    [404, 'unsupported'],
    [429, 'rate_limited'],
    /* 500 is our own service answering badly. That is an answer — retrying gets
       it twice. Only the gateway statuses mean "never reached the service". */
    [500, 'unavailable'],
  ]

  for (const [status, kind] of designed) {
    it(`asks once on ${status} and shows the ${kind} screen`, async () => {
      const calls = stubFetch(responds(status, { error: { code: 'x', message: 'nope' } }))
      const { error } = await run()
      expect(calls).toHaveLength(1)
      expect(error.kind).toBe(kind)
    })
  }

  it('does not retry a timeout — ninety seconds is already spent', async () => {
    const calls = stubFetch(hangs())
    const { error } = await run()
    expect(calls).toHaveLength(1)
    expect(error.kind).toBe('unavailable')
    expect(error.detail).toMatch(/time limit/)
  })
})

describe('cancellation', () => {
  it('aborts the request itself, not just the answer', async () => {
    const controller = new AbortController()
    const calls = stubFetch(hangs())
    const settled = outcome(analyze('AAPL', controller.signal))

    await vi.advanceTimersByTimeAsync(10)
    expect(calls[0].signal.aborted).toBe(false)

    controller.abort()
    const { error } = await settled
    /* The signal handed to fetch really was pulled — this is the whole point. The
       old `live` flag discarded the ANSWER and left the request running, so a
       judge switching tickers three times stacked three ninety-second calls
       against a host that was still waking up for the first. */
    expect(calls[0].signal.aborted).toBe(true)
    expect(error.name).toBe('Cancelled')
  })

  it('never surfaces as a failure screen', async () => {
    const controller = new AbortController()
    stubFetch(hangs())
    const settled = outcome(analyze('AAPL', controller.signal))

    await vi.advanceTimersByTimeAsync(10)
    controller.abort()
    const { error } = await settled

    // No headline and no body: nothing for RequestFailed to render, which is
    // correct. Nobody was waiting for this answer.
    expect(error.name).toBe('Cancelled')
    expect(error.headline).toBeUndefined()
    expect(error.kind).toBeUndefined()
  })

  it('sends nothing at all if the run was already abandoned', async () => {
    const controller = new AbortController()
    controller.abort()
    const calls = stubFetch(responds(200, {}))
    const { error } = await outcome(analyze('AAPL', controller.signal))
    expect(calls).toHaveLength(0)
    expect(error.name).toBe('Cancelled')
  })

  it('cuts the gap before a retry short instead of outliving the run', async () => {
    const controller = new AbortController()
    const calls = stubFetch(drops(), responds(200, {}))
    const settled = outcome(analyze('AAPL', controller.signal))

    // Far enough in for the first attempt to have failed, not far enough for the
    // retry to have been sent.
    await vi.advanceTimersByTimeAsync(RETRY_AFTER_MS / 4)
    expect(calls).toHaveLength(1)

    controller.abort()
    const { error } = await settled

    // The pause did not simply run its course and fire the retry anyway.
    await vi.advanceTimersByTimeAsync(RETRY_AFTER_MS * 2)
    expect(calls).toHaveLength(1)
    expect(error.name).toBe('Cancelled')
  })
})
