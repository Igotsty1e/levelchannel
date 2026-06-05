import { describe, expect, it } from 'vitest'

import {
  PATCH as patchHandler,
  GET as getHandler,
} from '@/app/api/account/profile/route'
import { POST as loginHandler } from '@/app/api/auth/login/route'
import { POST as registerHandler } from '@/app/api/auth/register/route'

import '../setup'
import { buildRequest, extractSessionCookie } from '../helpers'

async function registerAndLogin(email: string) {
  const password = 'StrongPassword123'
  const reg = await registerHandler(
    buildRequest('/api/auth/register', {
      body: { email, password, personalDataConsentAccepted: true },
    }),
  )
  expect(reg.status).toBe(200)
  const login = await loginHandler(
    buildRequest('/api/auth/login', { body: { email, password } }),
  )
  expect(login.status).toBe(200)
  const cookie = extractSessionCookie(login.headers.get('Set-Cookie'))
  expect(cookie).not.toBeNull()
  return cookie!
}

describe('GET/PATCH /api/account/profile', () => {
  it('returns null fields for a fresh account, then upserts on PATCH', async () => {
    const cookie = await registerAndLogin('profile-fresh@example.com')

    const initial = await getHandler(
      buildRequest('/api/account/profile', { cookie }),
    )
    expect(initial.status).toBe(200)
    const initialJson = await initial.json()
    expect(initialJson.profile.displayName).toBeNull()
    expect(initialJson.profile.timezone).toBeNull()

    const patched = await patchHandler(
      buildRequest('/api/account/profile', {
        method: 'PATCH',
        cookie,
        body: { displayName: 'Иван', timezone: 'Europe/Moscow' },
      }),
    )
    expect(patched.status).toBe(200)
    const patchedJson = await patched.json()
    expect(patchedJson.profile.displayName).toBe('Иван')
    expect(patchedJson.profile.timezone).toBe('Europe/Moscow')

    const reread = await getHandler(
      buildRequest('/api/account/profile', { cookie }),
    )
    const rereadJson = await reread.json()
    expect(rereadJson.profile.displayName).toBe('Иван')
  })

  it('PATCH with omitted key keeps current value, with explicit null clears', async () => {
    const cookie = await registerAndLogin('profile-keep@example.com')

    await patchHandler(
      buildRequest('/api/account/profile', {
        method: 'PATCH',
        cookie,
        body: { displayName: 'Иван', timezone: 'Europe/Moscow' },
      }),
    )

    // Omit displayName → keep, set timezone null → clear.
    const onlyTzNull = await patchHandler(
      buildRequest('/api/account/profile', {
        method: 'PATCH',
        cookie,
        body: { timezone: null },
      }),
    )
    const json = await onlyTzNull.json()
    expect(json.profile.displayName).toBe('Иван')
    expect(json.profile.timezone).toBeNull()
  })

  it('rejects unauthenticated requests', async () => {
    const res = await getHandler(buildRequest('/api/account/profile'))
    expect(res.status).toBe(401)
  })

  it('rejects an over-long display name', async () => {
    const cookie = await registerAndLogin('profile-long@example.com')
    const res = await patchHandler(
      buildRequest('/api/account/profile', {
        method: 'PATCH',
        cookie,
        body: { displayName: 'a'.repeat(61) },
      }),
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('displayName')
  })

  // calendar-onboarding-cleanup (2026-06-05) — timezone-clear gate while
  // calendar integration is active.
  it('refuses to clear timezone while Google Calendar integration is active', async () => {
    const { getAccountByEmail } = await import('@/lib/auth/accounts')
    const { upsertAccountProfile } = await import('@/lib/auth/profiles')
    const { upsertGoogleIntegration } = await import('@/lib/calendar/integrations')
    const { __resetCalendarEncryptionKeyCache } = await import('@/lib/calendar/encryption')

    // upsertGoogleIntegration requires CALENDAR_ENCRYPTION_KEY for the
    // pgcrypto round-trip. Pattern mirrors tests/integration/calendar/
    // integrations.test.ts.
    process.env.CALENDAR_ENCRYPTION_KEY = 'k'.repeat(48)
    __resetCalendarEncryptionKeyCache()

    const cookie = await registerAndLogin('profile-tz-clear@example.com')
    const account = await getAccountByEmail('profile-tz-clear@example.com')
    if (!account) throw new Error('expected account')
    const accountId = account.id

    await upsertAccountProfile(accountId, {
      displayName: 'TZ Clear Test',
      timezone: 'Europe/Moscow',
    })
    const integrationResult = await upsertGoogleIntegration({
      accountId,
      accessToken: 'A',
      refreshToken: 'R',
      scope: 'scope',
      tokenExpiresAt: new Date(Date.now() + 3600_000),
      readCalendarIds: ['primary'],
      writeCalendarId: 'primary',
      reason: 'initial_connect',
    })
    expect(integrationResult.ok).toBe(true)

    const res = await patchHandler(
      buildRequest('/api/account/profile', {
        method: 'PATCH',
        cookie,
        body: { timezone: null },
      }),
    )
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error).toBe('timezone_required_while_calendar_connected')
  })

  it('allows timezone clear when no calendar integration exists', async () => {
    const { getAccountByEmail } = await import('@/lib/auth/accounts')
    const { upsertAccountProfile } = await import('@/lib/auth/profiles')

    const cookie = await registerAndLogin('profile-tz-clear-ok@example.com')
    const account = await getAccountByEmail('profile-tz-clear-ok@example.com')
    if (!account) throw new Error('expected account')
    const accountId = account.id

    await upsertAccountProfile(accountId, {
      displayName: 'TZ Clear OK',
      timezone: 'Europe/Moscow',
    })

    const res = await patchHandler(
      buildRequest('/api/account/profile', {
        method: 'PATCH',
        cookie,
        body: { timezone: null },
      }),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.profile.timezone).toBeNull()
  })
})
