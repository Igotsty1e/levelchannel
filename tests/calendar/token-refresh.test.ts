import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ensureFreshAccessToken,
} from '@/lib/calendar/google/token-refresh'

// Module mocks. We control getGoogleIntegration / upsertGoogleIntegration
// / disconnectGoogleIntegration / refreshAccessToken / getGoogleCalendarOauthConfig
// per-test via mockResolvedValueOnce.

const mockGetIntegration = vi.fn()
const mockUpsertIntegration = vi.fn()
const mockDisconnect = vi.fn().mockResolvedValue(undefined)
const mockRefresh = vi.fn()
const mockGetConfig = vi.fn()

vi.mock('@/lib/calendar/integrations', () => ({
  getGoogleIntegration: (accountId: string) => mockGetIntegration(accountId),
  upsertGoogleIntegration: (input: unknown) => mockUpsertIntegration(input),
  disconnectGoogleIntegration: (accountId: string) => mockDisconnect(accountId),
}))

vi.mock('@/lib/calendar/google/oauth', () => ({
  refreshAccessToken: (...args: unknown[]) => mockRefresh(...args),
}))

vi.mock('@/lib/calendar/google/config', () => ({
  getGoogleCalendarOauthConfig: () => mockGetConfig(),
}))

const ACC = '11111111-1111-4111-8111-111111111111'
const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString() // +1h
const PAST = new Date(Date.now() - 60 * 60 * 1000).toISOString() // -1h

function activeIntegration(opts: {
  access?: string | null
  expiresAt?: string | null
  refreshToken?: string | null
}) {
  return {
    accountId: ACC,
    provider: 'google' as const,
    syncState: 'active' as const,
    epoch: '1',
    scope: 'cal',
    tokenExpiresAt: opts.expiresAt ?? FUTURE,
    readCalendarIds: ['primary'],
    writeCalendarId: 'primary',
    lastPulledAt: null,
    lastPushAt: null,
    lastReconnectedAt: null,
    lastError: null,
    channelId: null,
    channelResourceId: null,
    channelExpiresAt: null,
    channelToken: null,
    lastSeenMessageNumber: null,
    createdAt: '2026-05-14T00:00:00Z',
    updatedAt: '2026-05-14T00:00:00Z',
    accessToken: opts.access === undefined ? 'cached-token' : opts.access,
    refreshToken: opts.refreshToken === undefined ? 'r-token' : opts.refreshToken,
  }
}

beforeEach(() => {
  mockGetIntegration.mockReset()
  mockUpsertIntegration.mockReset()
  mockDisconnect.mockReset().mockResolvedValue(undefined)
  mockRefresh.mockReset()
  mockGetConfig.mockReset().mockReturnValue({
    clientId: 'id',
    clientSecret: 's',
    redirectUrl: 'https://lc/cb',
    stateSecret: 'x'.repeat(48),
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('ensureFreshAccessToken — forceRefresh flag (BCS-OP-ROLLOUT §4.6.1)', () => {
  it('without forceRefresh: returns cached token when not expired', async () => {
    mockGetIntegration.mockResolvedValueOnce(
      activeIntegration({ access: 'cached', expiresAt: FUTURE }),
    )

    const result = await ensureFreshAccessToken({ accountId: ACC })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.accessToken).toBe('cached')
      expect(result.refreshed).toBe(false)
    }
    // refreshAccessToken was NOT called.
    expect(mockRefresh).not.toHaveBeenCalled()
  })

  it('with forceRefresh: skips cached-token branch and refreshes even when not expired', async () => {
    mockGetIntegration
      .mockResolvedValueOnce(activeIntegration({ access: 'cached', expiresAt: FUTURE }))
      .mockResolvedValueOnce(activeIntegration({ access: 'refreshed-token' }))
    mockRefresh.mockResolvedValueOnce({
      ok: true,
      tokens: {
        accessToken: 'refreshed-token',
        refreshToken: null,
        expiresInSeconds: 3600,
        scope: 'cal',
      },
    })
    mockUpsertIntegration.mockResolvedValueOnce({ ok: true })

    const result = await ensureFreshAccessToken({
      accountId: ACC,
      forceRefresh: true,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.accessToken).toBe('refreshed-token')
      expect(result.refreshed).toBe(true)
    }
    expect(mockRefresh).toHaveBeenCalledTimes(1)
    expect(mockUpsertIntegration).toHaveBeenCalledTimes(1)
  })

  it('with forceRefresh: when refresh permanently fails (401), disconnects and returns permanent', async () => {
    mockGetIntegration.mockResolvedValueOnce(
      activeIntegration({ access: 'cached', expiresAt: FUTURE }),
    )
    mockRefresh.mockResolvedValueOnce({
      ok: false,
      error: { kind: 'http' as const, status: 401, body: 'invalid_grant' },
    })

    const result = await ensureFreshAccessToken({
      accountId: ACC,
      forceRefresh: true,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('permanent')
    expect(mockDisconnect).toHaveBeenCalledTimes(1)
    expect(mockDisconnect).toHaveBeenCalledWith(ACC)
  })

  it('with forceRefresh: transient refresh failure (5xx) does NOT disconnect, returns transient', async () => {
    mockGetIntegration.mockResolvedValueOnce(
      activeIntegration({ access: 'cached', expiresAt: FUTURE }),
    )
    mockRefresh.mockResolvedValueOnce({
      ok: false,
      error: { kind: 'http' as const, status: 503, body: 'unavailable' },
    })

    const result = await ensureFreshAccessToken({
      accountId: ACC,
      forceRefresh: true,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('transient')
    expect(mockDisconnect).not.toHaveBeenCalled()
  })

  it('without forceRefresh: expired token still triggers refresh (existing contract preserved)', async () => {
    mockGetIntegration
      .mockResolvedValueOnce(activeIntegration({ access: 'expired', expiresAt: PAST }))
      .mockResolvedValueOnce(activeIntegration({ access: 'refreshed-token' }))
    mockRefresh.mockResolvedValueOnce({
      ok: true,
      tokens: {
        accessToken: 'refreshed-token',
        refreshToken: null,
        expiresInSeconds: 3600,
        scope: 'cal',
      },
    })
    mockUpsertIntegration.mockResolvedValueOnce({ ok: true })

    const result = await ensureFreshAccessToken({ accountId: ACC })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.refreshed).toBe(true)
  })
})
