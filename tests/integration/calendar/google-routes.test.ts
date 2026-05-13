import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GET as callbackHandler } from '@/app/api/teacher/calendar/google/callback/route'
import { POST as disconnectHandler } from '@/app/api/teacher/calendar/google/disconnect/route'
import { POST as startHandler } from '@/app/api/teacher/calendar/google/start/route'
import {
  createAccount,
  grantAccountRole,
  normalizeAccountEmail,
} from '@/lib/auth/accounts'
import { hashPassword } from '@/lib/auth/password'
import { upsertAccountProfile } from '@/lib/auth/profiles'
import { __resetCalendarEncryptionKeyCache } from '@/lib/calendar/encryption'
import { __resetGoogleCalendarOauthConfigCache } from '@/lib/calendar/google/config'
import { generateOauthState } from '@/lib/calendar/google/state'
import {
  getGoogleIntegration,
  getGoogleIntegrationMeta,
} from '@/lib/calendar/integrations'
import { createSession, SESSION_COOKIE_NAME } from '@/lib/auth/sessions'

import '../setup'
import { buildRequest } from '../helpers'

const TEST_PRIMARY_KEY = 'k'.repeat(48)
const TEST_OAUTH_STATE_SECRET = 'oauth-state-secret-test-' + 'x'.repeat(40)

beforeEach(() => {
  process.env.CALENDAR_ENCRYPTION_KEY = TEST_PRIMARY_KEY
  process.env.GOOGLE_CALENDAR_CLIENT_ID = 'test-client-id'
  process.env.GOOGLE_CALENDAR_CLIENT_SECRET = 'test-client-secret'
  process.env.GOOGLE_CALENDAR_REDIRECT_URL =
    'https://lc.test/api/teacher/calendar/google/callback'
  process.env.GOOGLE_OAUTH_STATE_SECRET = TEST_OAUTH_STATE_SECRET
  __resetCalendarEncryptionKeyCache()
  __resetGoogleCalendarOauthConfigCache()
})

afterEach(() => {
  delete process.env.CALENDAR_ENCRYPTION_KEY
  delete process.env.GOOGLE_CALENDAR_CLIENT_ID
  delete process.env.GOOGLE_CALENDAR_CLIENT_SECRET
  delete process.env.GOOGLE_CALENDAR_REDIRECT_URL
  delete process.env.GOOGLE_OAUTH_STATE_SECRET
  __resetCalendarEncryptionKeyCache()
  __resetGoogleCalendarOauthConfigCache()
  vi.unstubAllGlobals()
})

async function makeTeacher(opts: {
  email: string
  emailVerified?: boolean
  timezone?: string
  role?: 'teacher' | 'admin' | null
}): Promise<{ accountId: string; cookie: string }> {
  const account = await createAccount({
    email: normalizeAccountEmail(opts.email),
    passwordHash: await hashPassword('StrongPassword123'),
  })
  if (opts.emailVerified !== false) {
    const { markAccountVerified } = await import('@/lib/auth/accounts')
    await markAccountVerified(account.id)
  }
  if (opts.role !== null) {
    await grantAccountRole(account.id, opts.role ?? 'teacher', null)
  }
  await upsertAccountProfile(account.id, {
    displayName: 'T',
    timezone: opts.timezone ?? 'Europe/Moscow',
    locale: 'ru',
  })
  const { cookieValue } = await createSession({ accountId: account.id })
  return {
    accountId: account.id,
    cookie: `${SESSION_COOKIE_NAME}=${cookieValue}`,
  }
}

describe('POST /api/teacher/calendar/google/start', () => {
  it('returns authorizationUrl for an authenticated teacher', async () => {
    const t = await makeTeacher({ email: 't-start-ok@example.com' })
    const res = await startHandler(
      buildRequest('/api/teacher/calendar/google/start', {
        cookie: t.cookie,
        body: {},
      }),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(typeof json.authorizationUrl).toBe('string')
    const url = new URL(json.authorizationUrl)
    expect(url.origin + url.pathname).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth',
    )
    expect(url.searchParams.get('client_id')).toBe('test-client-id')
    expect(url.searchParams.get('state')).toBeTruthy()
  })

  it('rejects unauthenticated callers with 401', async () => {
    const res = await startHandler(
      buildRequest('/api/teacher/calendar/google/start', { body: {} }),
    )
    expect([401, 403]).toContain(res.status)
  })

  it('rejects non-teacher (learner) with 403', async () => {
    const t = await makeTeacher({
      email: 't-start-wrong-role@example.com',
      role: null,
    })
    const res = await startHandler(
      buildRequest('/api/teacher/calendar/google/start', {
        cookie: t.cookie,
        body: {},
      }),
    )
    expect(res.status).toBe(403)
  })

  it('returns 503 when oauth env is missing', async () => {
    delete process.env.GOOGLE_CALENDAR_CLIENT_ID
    __resetGoogleCalendarOauthConfigCache()
    const t = await makeTeacher({ email: 't-start-noconf@example.com' })
    const res = await startHandler(
      buildRequest('/api/teacher/calendar/google/start', {
        cookie: t.cookie,
        body: {},
      }),
    )
    expect(res.status).toBe(503)
    expect((await res.json()).error).toMatch(/oauth/)
  })
})

describe('GET /api/teacher/calendar/google/callback', () => {
  function googleTokenFetchMock(payload: Record<string, unknown>) {
    const mock = vi.fn(async () =>
      ({
        ok: true,
        status: 200,
        json: async () => payload,
        text: async () => JSON.stringify(payload),
      }) as unknown as Response,
    )
    vi.stubGlobal('fetch', mock)
    return mock
  }

  it('happy path: state ok → exchanges code → upserts integration → 302 to settings?connected=1', async () => {
    const t = await makeTeacher({ email: 't-cb-ok@example.com' })
    const state = generateOauthState({
      accountId: t.accountId,
      secret: TEST_OAUTH_STATE_SECRET,
    })

    googleTokenFetchMock({
      access_token: 'AT',
      refresh_token: 'RT',
      expires_in: 3600,
      scope: 'https://www.googleapis.com/auth/calendar.events',
      token_type: 'Bearer',
    })

    const res = await callbackHandler(
      buildRequest(
        `/api/teacher/calendar/google/callback?code=AUTH&state=${encodeURIComponent(state)}`,
        { cookie: t.cookie },
      ),
    )
    expect(res.status).toBe(302)
    const loc = res.headers.get('Location') ?? ''
    expect(loc).toContain('/teacher/settings/calendar')
    expect(loc).toContain('connected=1')

    const read = await getGoogleIntegration(t.accountId)
    expect(read).not.toBeNull()
    expect(read?.syncState).toBe('active')
    expect(read?.accessToken).toBe('AT')
    expect(read?.refreshToken).toBe('RT')
    expect(read?.writeCalendarId).toBe('primary')
  })

  it('redirects to settings?error=state_invalid when state belongs to a different account', async () => {
    const teacherA = await makeTeacher({ email: 't-cb-stateA@example.com' })
    const teacherB = await makeTeacher({ email: 't-cb-stateB@example.com' })
    // State minted for teacherA, callback presents teacherB's cookie.
    const stateForA = generateOauthState({
      accountId: teacherA.accountId,
      secret: TEST_OAUTH_STATE_SECRET,
    })
    const res = await callbackHandler(
      buildRequest(
        `/api/teacher/calendar/google/callback?code=AUTH&state=${encodeURIComponent(stateForA)}`,
        { cookie: teacherB.cookie },
      ),
    )
    expect(res.status).toBe(302)
    const loc = res.headers.get('Location') ?? ''
    expect(loc).toContain('error=state_invalid')
    // No integration row was created on teacherB or teacherA.
    expect(await getGoogleIntegrationMeta(teacherA.accountId)).toBeNull()
    expect(await getGoogleIntegrationMeta(teacherB.accountId)).toBeNull()
  })

  it('redirects to settings?error=consent_denied when Google reports the user cancelled', async () => {
    const t = await makeTeacher({ email: 't-cb-denied@example.com' })
    const res = await callbackHandler(
      buildRequest(
        '/api/teacher/calendar/google/callback?error=access_denied',
        { cookie: t.cookie },
      ),
    )
    expect(res.status).toBe(302)
    expect(res.headers.get('Location') ?? '').toContain(
      'error=consent_denied',
    )
  })

  it('redirects to /login when no session cookie is present', async () => {
    const t = await makeTeacher({ email: 't-cb-nosession@example.com' })
    const state = generateOauthState({
      accountId: t.accountId,
      secret: TEST_OAUTH_STATE_SECRET,
    })
    const res = await callbackHandler(
      buildRequest(
        `/api/teacher/calendar/google/callback?code=AUTH&state=${encodeURIComponent(state)}`,
      ),
    )
    expect(res.status).toBe(302)
    expect(res.headers.get('Location') ?? '').toContain('/login')
  })

  it('rate-limited callback redirects (not JSON 429) — Codex C.3b review fix', async () => {
    const t = await makeTeacher({ email: 't-cb-rate@example.com' })
    const state = generateOauthState({
      accountId: t.accountId,
      secret: TEST_OAUTH_STATE_SECRET,
    })
    googleTokenFetchMock({
      access_token: 'AT',
      refresh_token: 'RT',
      expires_in: 3600,
      token_type: 'Bearer',
    })

    // Burn through the rate-limit bucket. enforceRateLimit returns the
    // 429 JSON response after 30 requests within the window. Anything
    // past that should redirect, not JSON-dead-end the browser.
    const url = `/api/teacher/calendar/google/callback?code=AUTH&state=${encodeURIComponent(state)}`
    let lastRes: Response | null = null
    for (let i = 0; i < 35; i++) {
      lastRes = await callbackHandler(
        buildRequest(url, { cookie: t.cookie }),
      )
    }
    // The final response — well past the limit — must be a redirect,
    // not a JSON 429.
    expect(lastRes).not.toBeNull()
    expect([302, 303]).toContain(lastRes!.status)
    const loc = lastRes!.headers.get('Location') ?? ''
    // Either the rate_limited redirect or the natural happy-path redirect
    // (if the bucket happened to reset between calls — TTL-dependent).
    // Both are acceptable; what we forbid is a 429 JSON body.
    expect(loc).toContain('/teacher/settings/calendar')
  })

  it('redirects to settings?error=no_refresh_token when Google omits it (shouldn\'t happen on initial consent)', async () => {
    const t = await makeTeacher({ email: 't-cb-noRT@example.com' })
    const state = generateOauthState({
      accountId: t.accountId,
      secret: TEST_OAUTH_STATE_SECRET,
    })
    googleTokenFetchMock({
      access_token: 'AT',
      // refresh_token intentionally omitted
      expires_in: 3600,
      token_type: 'Bearer',
    })
    const res = await callbackHandler(
      buildRequest(
        `/api/teacher/calendar/google/callback?code=AUTH&state=${encodeURIComponent(state)}`,
        { cookie: t.cookie },
      ),
    )
    expect(res.status).toBe(302)
    expect(res.headers.get('Location') ?? '').toContain(
      'error=no_refresh_token',
    )
    expect(await getGoogleIntegrationMeta(t.accountId)).toBeNull()
  })
})

describe('POST /api/teacher/calendar/google/disconnect', () => {
  it('clears tokens + flips sync_state for a connected teacher', async () => {
    const t = await makeTeacher({ email: 't-dc-ok@example.com' })
    // Seed an integration directly via the lib so we don't need the
    // whole callback flow to set it up.
    const { upsertGoogleIntegration } = await import(
      '@/lib/calendar/integrations'
    )
    await upsertGoogleIntegration({
      accountId: t.accountId,
      accessToken: 'AT',
      refreshToken: 'RT',
      scope: 's',
      tokenExpiresAt: new Date(Date.now() + 3600_000),
      readCalendarIds: ['primary'],
      writeCalendarId: 'primary',
      reason: 'initial_connect',
    })

    const res = await disconnectHandler(
      buildRequest('/api/teacher/calendar/google/disconnect', {
        cookie: t.cookie,
        body: {},
      }),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ ok: true, disconnected: true })

    const meta = await getGoogleIntegrationMeta(t.accountId)
    expect(meta?.syncState).toBe('disconnected')
  })

  it('returns disconnected=false when there was nothing to disconnect', async () => {
    const t = await makeTeacher({ email: 't-dc-nothing@example.com' })
    const res = await disconnectHandler(
      buildRequest('/api/teacher/calendar/google/disconnect', {
        cookie: t.cookie,
        body: {},
      }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, disconnected: false })
  })

  it('rejects non-teacher with 403', async () => {
    const t = await makeTeacher({
      email: 't-dc-wrong-role@example.com',
      role: null,
    })
    const res = await disconnectHandler(
      buildRequest('/api/teacher/calendar/google/disconnect', {
        cookie: t.cookie,
        body: {},
      }),
    )
    expect(res.status).toBe(403)
  })
})
