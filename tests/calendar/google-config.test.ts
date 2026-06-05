import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  GOOGLE_CALENDAR_OAUTH_SCOPES,
  __resetGoogleCalendarOauthConfigCache,
  getGoogleCalendarOauthConfig,
} from '@/lib/calendar/google/config'

describe('getGoogleCalendarOauthConfig', () => {
  beforeEach(() => {
    delete process.env.GOOGLE_CALENDAR_CLIENT_ID
    delete process.env.GOOGLE_CALENDAR_CLIENT_SECRET
    delete process.env.GOOGLE_CALENDAR_REDIRECT_URL
    delete process.env.GOOGLE_OAUTH_STATE_SECRET
    __resetGoogleCalendarOauthConfigCache()
  })
  afterEach(() => {
    delete process.env.GOOGLE_CALENDAR_CLIENT_ID
    delete process.env.GOOGLE_CALENDAR_CLIENT_SECRET
    delete process.env.GOOGLE_CALENDAR_REDIRECT_URL
    delete process.env.GOOGLE_OAUTH_STATE_SECRET
    __resetGoogleCalendarOauthConfigCache()
  })

  it('returns null in dev when env is missing', () => {
    expect(
      getGoogleCalendarOauthConfig({ NODE_ENV: 'development' } as NodeJS.ProcessEnv),
    ).toBeNull()
  })

  it('throws in production when any env var is missing', () => {
    expect(() =>
      getGoogleCalendarOauthConfig({
        NODE_ENV: 'production',
        GOOGLE_CALENDAR_CLIENT_ID: 'id',
        GOOGLE_CALENDAR_CLIENT_SECRET: 'secret',
        GOOGLE_CALENDAR_REDIRECT_URL: 'https://example.com/api/teacher/calendar/google/callback',
        // GOOGLE_OAUTH_STATE_SECRET missing
      } as NodeJS.ProcessEnv),
    ).toThrow(/GOOGLE_OAUTH_STATE_SECRET/)
  })

  it('throws when state secret is below 32 char floor', () => {
    expect(() =>
      getGoogleCalendarOauthConfig({
        NODE_ENV: 'development',
        GOOGLE_CALENDAR_CLIENT_ID: 'id',
        GOOGLE_CALENDAR_CLIENT_SECRET: 'secret',
        GOOGLE_CALENDAR_REDIRECT_URL: 'https://example.com/api/teacher/calendar/google/callback',
        GOOGLE_OAUTH_STATE_SECRET: 'short',
      } as NodeJS.ProcessEnv),
    ).toThrow(/at least 32 characters/i)
  })

  it('throws when redirect URL is not http(s)', () => {
    expect(() =>
      getGoogleCalendarOauthConfig({
        NODE_ENV: 'development',
        GOOGLE_CALENDAR_CLIENT_ID: 'id',
        GOOGLE_CALENDAR_CLIENT_SECRET: 'secret',
        GOOGLE_CALENDAR_REDIRECT_URL: 'ftp://example.com/api/teacher/calendar/google/callback',
        GOOGLE_OAUTH_STATE_SECRET: 'x'.repeat(40),
      } as NodeJS.ProcessEnv),
    ).toThrow(/http\(s\)/i)
  })

  it('returns the validated config when all envs are set', () => {
    const config = getGoogleCalendarOauthConfig({
      NODE_ENV: 'development',
      GOOGLE_CALENDAR_CLIENT_ID: 'my-client-id',
      GOOGLE_CALENDAR_CLIENT_SECRET: 'my-secret',
      GOOGLE_CALENDAR_REDIRECT_URL: 'https://example.com/api/teacher/calendar/google/callback',
      GOOGLE_OAUTH_STATE_SECRET: 'state-secret-state-secret-state-secret-',
    } as NodeJS.ProcessEnv)
    expect(config).not.toBeNull()
    expect(config!.clientId).toBe('my-client-id')
    expect(config!.clientSecret).toBe('my-secret')
    expect(config!.redirectUrl).toBe('https://example.com/api/teacher/calendar/google/callback')
    expect(config!.stateSecret.length).toBeGreaterThanOrEqual(32)
  })

  it('exposes a minimum scope list (no calendar.readonly)', () => {
    expect(GOOGLE_CALENDAR_OAUTH_SCOPES).toContain(
      'https://www.googleapis.com/auth/calendar.events',
    )
    expect(GOOGLE_CALENDAR_OAUTH_SCOPES).toContain(
      'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
    )
    expect(GOOGLE_CALENDAR_OAUTH_SCOPES).not.toContain(
      'https://www.googleapis.com/auth/calendar.readonly',
    )
  })
})
