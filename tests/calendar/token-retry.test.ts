import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  tryRefreshOnce,
  withTokenRetry,
  type CallResult,
} from '@/lib/calendar/token-retry'

// Module-level mocks for ensureFreshAccessToken + disconnectGoogleIntegration.
// We control them per-test via mockResolvedValueOnce / mockImplementationOnce.
const mockEnsureFresh = vi.fn()
const mockDisconnect = vi.fn().mockResolvedValue(undefined)

vi.mock('@/lib/calendar/google/token-refresh', () => ({
  ensureFreshAccessToken: (opts: { accountId: string; forceRefresh?: boolean }) =>
    mockEnsureFresh(opts),
}))

vi.mock('@/lib/calendar/integrations', () => ({
  disconnectGoogleIntegration: (accountId: string) => mockDisconnect(accountId),
}))

const ACC = '11111111-1111-4111-8111-111111111111'

function freshOk(token: string) {
  return {
    ok: true,
    accessToken: token,
    integration: {
      accountId: ACC,
      writeCalendarId: 'primary',
      readCalendarIds: ['primary'],
    } as never,
    refreshed: false,
  }
}

beforeEach(() => {
  mockEnsureFresh.mockReset()
  mockDisconnect.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('withTokenRetry', () => {
  it('returns immediately on first-call success — no second ensureFreshAccessToken, no disconnect', async () => {
    mockEnsureFresh.mockResolvedValueOnce(freshOk('access-1'))

    const exec = vi.fn(async (token: string, _i: unknown): Promise<CallResult<{ n: number }>> => {
      expect(token).toBe('access-1')
      return { ok: true, value: { n: 42 } }
    })

    const result = await withTokenRetry<{ n: number }>(ACC, exec)
    expect(result).toEqual({ ok: true, value: { n: 42 } })
    expect(mockEnsureFresh).toHaveBeenCalledTimes(1)
    expect(exec).toHaveBeenCalledTimes(1)
    expect(mockDisconnect).not.toHaveBeenCalled()
  })

  it('surfaces non-401 failures without retry and without disconnect', async () => {
    mockEnsureFresh.mockResolvedValueOnce(freshOk('access-1'))

    const exec = vi.fn(async (): Promise<CallResult<unknown>> => ({
      ok: false,
      auth401: false,
      raw: { kind: 'http', status: 500 },
    }))

    const result = await withTokenRetry(ACC, exec)
    expect(result).toEqual({
      ok: false,
      auth401: false,
      raw: { kind: 'http', status: 500 },
    })
    expect(mockEnsureFresh).toHaveBeenCalledTimes(1)
    expect(exec).toHaveBeenCalledTimes(1)
    expect(mockDisconnect).not.toHaveBeenCalled()
  })

  it('on 1st 401 force-refreshes and retries; success on retry → returns ok, no disconnect', async () => {
    mockEnsureFresh
      .mockResolvedValueOnce(freshOk('stale-token'))
      .mockResolvedValueOnce(freshOk('fresh-token'))

    let call = 0
    const exec = vi.fn(async (token: string): Promise<CallResult<{ ok: true }>> => {
      call++
      if (call === 1) {
        expect(token).toBe('stale-token')
        return { ok: false, auth401: true, raw: { status: 401 } }
      }
      expect(token).toBe('fresh-token')
      return { ok: true, value: { ok: true } }
    })

    const result = await withTokenRetry(ACC, exec)
    expect(result).toEqual({ ok: true, value: { ok: true } })
    expect(mockEnsureFresh).toHaveBeenCalledTimes(2)
    expect(mockEnsureFresh.mock.calls[1][0]).toMatchObject({
      accountId: ACC,
      forceRefresh: true,
    })
    expect(mockDisconnect).not.toHaveBeenCalled()
  })

  it('on TWO consecutive 401s → flips integration to disconnected', async () => {
    mockEnsureFresh
      .mockResolvedValueOnce(freshOk('stale-token'))
      .mockResolvedValueOnce(freshOk('also-stale-grant-dead'))

    const exec = vi.fn(async (): Promise<CallResult<unknown>> => ({
      ok: false,
      auth401: true,
      raw: { status: 401 },
    }))

    const result = await withTokenRetry(ACC, exec)
    expect(result).toEqual({
      ok: false,
      auth401: true,
      raw: { status: 401 },
    })
    expect(mockDisconnect).toHaveBeenCalledTimes(1)
    expect(mockDisconnect).toHaveBeenCalledWith(ACC)
  })

  it('on 1st 401 then ensureFreshAccessToken returns permanent — does NOT double-disconnect', async () => {
    // First fresh: ok with stale token.
    // Second fresh (force-refresh): permanent failure (ensureFresh
    // already does its own disconnect internally).
    mockEnsureFresh
      .mockResolvedValueOnce(freshOk('stale-token'))
      .mockResolvedValueOnce({
        ok: false,
        reason: 'permanent',
        detail: 'refresh_token revoked',
      })

    const exec = vi.fn(async (): Promise<CallResult<unknown>> => ({
      ok: false,
      auth401: true,
      raw: { status: 401 },
    }))

    const result = await withTokenRetry(ACC, exec)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.auth401).toBe(false)
      expect((result.raw as { reason?: string }).reason).toBe('permanent')
    }
    // ensureFreshAccessToken already disconnected; we must NOT
    // call disconnect again.
    expect(mockDisconnect).not.toHaveBeenCalled()
  })

  it('surfaces integration_missing on first ensureFreshAccessToken failure', async () => {
    mockEnsureFresh.mockResolvedValueOnce({
      ok: false,
      reason: 'integration_missing',
    })

    const exec = vi.fn()
    const result = await withTokenRetry(ACC, exec)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.auth401).toBe(false)
    expect(exec).not.toHaveBeenCalled()
    expect(mockDisconnect).not.toHaveBeenCalled()
  })
})

describe('tryRefreshOnce', () => {
  it('on first-call success — single ensureFreshAccessToken, no disconnect', async () => {
    mockEnsureFresh.mockResolvedValueOnce(freshOk('access-1'))

    const exec = vi.fn(async (): Promise<CallResult<{ stopped: boolean }>> => ({
      ok: true,
      value: { stopped: true },
    }))

    const result = await tryRefreshOnce(ACC, exec)
    expect(result).toEqual({ ok: true, value: { stopped: true } })
    expect(mockEnsureFresh).toHaveBeenCalledTimes(1)
    expect(mockDisconnect).not.toHaveBeenCalled()
  })

  it('on 1st 401 force-refreshes and retries — does NOT disconnect even on second 401', async () => {
    // This is the channel-renewer stopChannel-of-old special case:
    // the NEW channel is already authoritative on our side, so
    // disconnecting would self-break. tryRefreshOnce never disconnects.
    mockEnsureFresh
      .mockResolvedValueOnce(freshOk('stale-token'))
      .mockResolvedValueOnce(freshOk('fresh-but-google-says-no'))

    const exec = vi.fn(async (): Promise<CallResult<unknown>> => ({
      ok: false,
      auth401: true,
      raw: { status: 401 },
    }))

    const result = await tryRefreshOnce(ACC, exec)
    expect(result).toEqual({
      ok: false,
      auth401: true,
      raw: { status: 401 },
    })
    expect(mockEnsureFresh).toHaveBeenCalledTimes(2)
    expect(mockEnsureFresh.mock.calls[1][0]).toMatchObject({
      accountId: ACC,
      forceRefresh: true,
    })
    // Crucially: NO disconnect even on 2nd 401.
    expect(mockDisconnect).not.toHaveBeenCalled()
  })

  it('on 1st 401 then ensureFreshAccessToken permanent — does NOT disconnect (consistent with withTokenRetry)', async () => {
    mockEnsureFresh
      .mockResolvedValueOnce(freshOk('stale-token'))
      .mockResolvedValueOnce({
        ok: false,
        reason: 'permanent',
        detail: 'refresh_token revoked',
      })

    const exec = vi.fn(async (): Promise<CallResult<unknown>> => ({
      ok: false,
      auth401: true,
      raw: { status: 401 },
    }))

    const result = await tryRefreshOnce(ACC, exec)
    expect(result.ok).toBe(false)
    expect(mockDisconnect).not.toHaveBeenCalled()
  })
})
