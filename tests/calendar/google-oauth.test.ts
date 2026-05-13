import { describe, expect, it, vi } from 'vitest'

import type { GoogleCalendarOauthConfig } from '@/lib/calendar/google/config'
import {
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
} from '@/lib/calendar/google/oauth'

const config: GoogleCalendarOauthConfig = {
  clientId: 'my-client-id',
  clientSecret: 'my-secret',
  redirectUrl: 'https://lc.example.com/api/teacher/calendar/google/callback',
  stateSecret: 'x'.repeat(48),
}

describe('buildAuthorizationUrl', () => {
  it('targets the Google consent endpoint with required params', () => {
    const url = new URL(buildAuthorizationUrl(config, 'STATE_TOKEN'))
    expect(url.origin + url.pathname).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth',
    )
    expect(url.searchParams.get('client_id')).toBe('my-client-id')
    expect(url.searchParams.get('redirect_uri')).toBe(config.redirectUrl)
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('prompt')).toBe('consent')
    expect(url.searchParams.get('state')).toBe('STATE_TOKEN')
  })

  it('requests the minimum scope set (events + calendarList.readonly)', () => {
    const url = new URL(buildAuthorizationUrl(config, 'S'))
    const scopes = url.searchParams.get('scope')?.split(' ') ?? []
    expect(scopes).toContain('https://www.googleapis.com/auth/calendar.events')
    expect(scopes).toContain(
      'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
    )
    expect(scopes).not.toContain(
      'https://www.googleapis.com/auth/calendar.readonly',
    )
  })
})

function mockFetch(response: {
  ok: boolean
  status?: number
  json?: () => Promise<unknown>
  text?: () => Promise<string>
}): typeof fetch {
  const fn = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      ({
        ok: response.ok,
        status: response.status ?? (response.ok ? 200 : 400),
        json: response.json ?? (async () => ({})),
        text: response.text ?? (async () => ''),
      }) as unknown as Response,
  )
  return fn as unknown as typeof fetch
}

describe('exchangeCodeForTokens', () => {
  it('shapes a successful token response', async () => {
    const fetchImpl = mockFetch({
      ok: true,
      json: async () => ({
        access_token: 'AT',
        refresh_token: 'RT',
        expires_in: 3600,
        scope: 'https://www.googleapis.com/auth/calendar.events',
        token_type: 'Bearer',
      }),
    })
    const result = await exchangeCodeForTokens(config, 'AUTH_CODE', fetchImpl)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.tokens.accessToken).toBe('AT')
      expect(result.tokens.refreshToken).toBe('RT')
      expect(result.tokens.expiresInSeconds).toBe(3600)
      expect(result.tokens.tokenType).toBe('Bearer')
    }
  })

  it('returns http error when Google rejects', async () => {
    const fetchImpl = mockFetch({
      ok: false,
      status: 400,
      text: async () => '{"error":"invalid_grant"}',
    })
    const result = await exchangeCodeForTokens(config, 'BAD_CODE', fetchImpl)
    expect(result.ok).toBe(false)
    if (!result.ok && result.error.kind === 'http') {
      expect(result.error.status).toBe(400)
      expect(result.error.body).toContain('invalid_grant')
    }
  })

  it('returns shape error when response lacks access_token', async () => {
    const fetchImpl = mockFetch({
      ok: true,
      json: async () => ({ expires_in: 3600 }),
    })
    const result = await exchangeCodeForTokens(config, 'X', fetchImpl)
    expect(result.ok).toBe(false)
    if (!result.ok && result.error.kind === 'shape') {
      expect(result.error.message).toMatch(/access_token/)
    }
  })

  it('returns shape error when expires_in is missing or non-positive', async () => {
    const fetchImpl = mockFetch({
      ok: true,
      json: async () => ({ access_token: 'AT', expires_in: 0 }),
    })
    const result = await exchangeCodeForTokens(config, 'X', fetchImpl)
    expect(result.ok).toBe(false)
    if (!result.ok && result.error.kind === 'shape') {
      expect(result.error.message).toMatch(/expires_in/)
    }
  })

  it('returns network error on fetch throw', async () => {
    const fetchImpl = (async () => {
      throw new Error('connect ETIMEDOUT')
    }) as unknown as typeof fetch
    const result = await exchangeCodeForTokens(config, 'X', fetchImpl)
    expect(result.ok).toBe(false)
    if (!result.ok && result.error.kind === 'network') {
      expect(result.error.message).toMatch(/ETIMEDOUT/)
    }
  })
})

describe('refreshAccessToken', () => {
  it('returns null refreshToken when Google omits it (typical refresh)', async () => {
    const fetchImpl = mockFetch({
      ok: true,
      json: async () => ({
        access_token: 'NEW_AT',
        expires_in: 3600,
        scope: 'https://www.googleapis.com/auth/calendar.events',
        token_type: 'Bearer',
        // refresh_token intentionally omitted
      }),
    })
    const result = await refreshAccessToken(config, 'STORED_RT', fetchImpl)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.tokens.accessToken).toBe('NEW_AT')
      expect(result.tokens.refreshToken).toBeNull()
    }
  })

  it('preserves new refresh token when Google rotates it', async () => {
    const fetchImpl = mockFetch({
      ok: true,
      json: async () => ({
        access_token: 'NEW_AT',
        refresh_token: 'ROTATED_RT',
        expires_in: 3600,
        token_type: 'Bearer',
      }),
    })
    const result = await refreshAccessToken(config, 'STORED_RT', fetchImpl)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.tokens.refreshToken).toBe('ROTATED_RT')
    }
  })
})
