import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchWithTimeout } from '@/lib/payments/cloudpayments-api'

// Wave 62 — fetchWithTimeout bounds the duration of every CP API
// call. Three call sites (`refundTransaction`, `chargeWithSavedToken`,
// `confirmThreeDs`) used a plain `fetch()` with no timeout; if CP
// is slow/hung, the request thread blocks indefinitely.

const ORIGINAL_FETCH = global.fetch

afterEach(() => {
  global.fetch = ORIGINAL_FETCH
  vi.unstubAllEnvs()
})

describe('fetchWithTimeout', () => {
  it('returns the response when fetch resolves before the timeout', async () => {
    global.fetch = vi.fn(
      async () =>
        new Response('{"ok":true}', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    ) as typeof global.fetch
    const res = await fetchWithTimeout('https://example.com', {
      timeoutMs: 1000,
    })
    expect(res.status).toBe(200)
  })

  it('aborts the fetch when the timeout fires first', async () => {
    // Fetch that never resolves on its own; the abort should kill it.
    global.fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      return await new Promise<Response>((resolve, reject) => {
        const signal = init?.signal
        if (signal) {
          signal.addEventListener('abort', () => {
            reject(signal.reason ?? new Error('aborted'))
          })
        }
        // No timer — relies on abort.
      })
    }) as typeof global.fetch

    const start = Date.now()
    await expect(
      fetchWithTimeout('https://example.com', { timeoutMs: 50 }),
    ).rejects.toThrow(/timed out after 50ms/)
    const elapsed = Date.now() - start
    // Fired close to the timeout — not stuck forever.
    expect(elapsed).toBeLessThan(1000)
  })

  it('respects CLOUDPAYMENTS_FETCH_TIMEOUT_MS env override when timeoutMs omitted', async () => {
    vi.stubEnv('CLOUDPAYMENTS_FETCH_TIMEOUT_MS', '40')
    global.fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      return await new Promise<Response>((resolve, reject) => {
        const signal = init?.signal
        if (signal) {
          signal.addEventListener('abort', () => {
            reject(signal.reason ?? new Error('aborted'))
          })
        }
      })
    }) as typeof global.fetch
    const start = Date.now()
    await expect(
      fetchWithTimeout('https://example.com', {}),
    ).rejects.toThrow(/timed out after 40ms/)
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(1000)
  })

  it('composes the timeout signal with a caller-supplied signal', async () => {
    // The caller-supplied signal aborts first; the helper should
    // surface that abort.
    const callerController = new AbortController()
    global.fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      return await new Promise<Response>((resolve, reject) => {
        const signal = init?.signal
        if (signal) {
          signal.addEventListener('abort', () => {
            reject(signal.reason ?? new Error('aborted'))
          })
        }
      })
    }) as typeof global.fetch

    setTimeout(() => callerController.abort(new Error('caller cancelled')), 20)
    await expect(
      fetchWithTimeout('https://example.com', {
        timeoutMs: 5000,
        signal: callerController.signal,
      }),
    ).rejects.toThrow(/caller cancelled/)
  })
})
