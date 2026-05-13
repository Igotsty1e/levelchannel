import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createAccount,
  grantAccountRole,
  normalizeAccountEmail,
} from '@/lib/auth/accounts'
import { hashPassword } from '@/lib/auth/password'
import { upsertAccountProfile } from '@/lib/auth/profiles'
import {
  renewExpiringChannels,
  setupChannelForIntegration,
} from '@/lib/calendar/channel-renewer'
import { __resetCalendarEncryptionKeyCache } from '@/lib/calendar/encryption'
import { __resetGoogleCalendarOauthConfigCache } from '@/lib/calendar/google/config'
import { upsertGoogleIntegration } from '@/lib/calendar/integrations'
import { getDbPool } from '@/lib/db/pool'

import '../setup'

const TEST_KEY = 'k'.repeat(48)

function watchResponse(opts: {
  resourceId?: string
  expirationMsFromNow?: number
  status?: number
}): Response {
  const status = opts.status ?? 200
  const ok = status >= 200 && status < 300
  if (!ok) {
    return {
      ok: false,
      status,
      json: async () => ({ error: { message: 'watch failed' } }),
      text: async () => 'watch failed',
    } as unknown as Response
  }
  const expiration =
    Date.now() + (opts.expirationMsFromNow ?? 6 * 24 * 60 * 60_000)
  return {
    ok: true,
    status: 200,
    json: async () => ({
      kind: 'api#channel',
      id: 'ignored', // server-determined; we keep the client-supplied id
      resourceId: opts.resourceId ?? 'res_abc',
      expiration: String(expiration),
    }),
    text: async () =>
      JSON.stringify({
        kind: 'api#channel',
        resourceId: opts.resourceId ?? 'res_abc',
        expiration: String(expiration),
      }),
  } as unknown as Response
}

function emptyOkResponse(): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({}),
    text: async () => '{}',
  } as unknown as Response
}

beforeEach(() => {
  process.env.CALENDAR_ENCRYPTION_KEY = TEST_KEY
  process.env.GOOGLE_CALENDAR_CLIENT_ID = 'cid'
  process.env.GOOGLE_CALENDAR_CLIENT_SECRET = 'csec'
  process.env.GOOGLE_CALENDAR_REDIRECT_URL =
    'https://lc.test/api/teacher/calendar/google/callback'
  process.env.GOOGLE_OAUTH_STATE_SECRET = 'state-secret-' + 'x'.repeat(40)
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

async function makeTeacher(email: string): Promise<string> {
  const account = await createAccount({
    email: normalizeAccountEmail(email),
    passwordHash: await hashPassword('StrongPassword123'),
  })
  await grantAccountRole(account.id, 'teacher', null)
  await upsertAccountProfile(account.id, {
    displayName: 'T',
    timezone: 'Europe/Moscow',
    locale: 'ru',
  })
  return account.id
}

async function connect(accountId: string): Promise<void> {
  await upsertGoogleIntegration({
    accountId,
    accessToken: 'AT',
    refreshToken: 'RT',
    scope: 's',
    tokenExpiresAt: new Date(Date.now() + 3600_000),
    readCalendarIds: ['primary'],
    writeCalendarId: 'primary',
    reason: 'initial_connect',
  })
}

describe('setupChannelForIntegration', () => {
  it('happy path: watchChannel succeeds, channel triple persisted', async () => {
    const accountId = await makeTeacher('ch-happy@example.com')
    await connect(accountId)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        watchResponse({ resourceId: 'res_happy', expirationMsFromNow: 6 * 24 * 60 * 60_000 }),
      ),
    )
    const r = await setupChannelForIntegration({
      accountId,
      externalCalendarId: 'primary',
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.channelId).toMatch(/^lc-/)
      expect(r.resourceId).toBe('res_happy')
      expect(new Date(r.expiresAt).getTime()).toBeGreaterThan(Date.now())
    }

    const row = await getDbPool().query(
      `select channel_id, channel_resource_id, channel_token, channel_expires_at, last_seen_message_number
         from teacher_calendar_integrations where account_id = $1`,
      [accountId],
    )
    expect(row.rows[0].channel_id).toMatch(/^lc-/)
    expect(row.rows[0].channel_resource_id).toBe('res_happy')
    expect(row.rows[0].channel_token).toBeTruthy()
    expect(row.rows[0].last_seen_message_number).toBeNull()
  })

  it('stops the prior channel after the new one is hot', async () => {
    const accountId = await makeTeacher('ch-rotate@example.com')
    await connect(accountId)
    const pool = getDbPool()
    // Seed a prior channel triple to simulate the rotation case.
    await pool.query(
      `update teacher_calendar_integrations
          set channel_id = 'lc-old', channel_resource_id = 'res_old',
              channel_token = 'old-token-padding', channel_expires_at = now() + interval '1 day'
        where account_id = $1`,
      [accountId],
    )
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) => {
        const u = String(url)
        calls.push(u)
        if (u.includes('/channels/stop')) return emptyOkResponse()
        return watchResponse({ resourceId: 'res_new' })
      }),
    )
    const r = await setupChannelForIntegration({
      accountId,
      externalCalendarId: 'primary',
    })
    expect(r.ok).toBe(true)
    // Both endpoints hit: events/watch + channels/stop.
    expect(calls.some((u) => u.includes('events/watch'))).toBe(true)
    expect(calls.some((u) => u.includes('channels/stop'))).toBe(true)

    const row = await pool.query(
      `select channel_id, channel_resource_id from teacher_calendar_integrations where account_id = $1`,
      [accountId],
    )
    expect(row.rows[0].channel_id).not.toBe('lc-old')
    expect(row.rows[0].channel_resource_id).toBe('res_new')
  })

  it('refuses on missing integration', async () => {
    const r = await setupChannelForIntegration({
      accountId: '99999999-9999-9999-9999-999999999999',
      externalCalendarId: 'primary',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('integration_missing')
  })

  it('refuses on disconnected integration', async () => {
    const accountId = await makeTeacher('ch-disc@example.com')
    await connect(accountId)
    await getDbPool().query(
      `update teacher_calendar_integrations set sync_state = 'disconnected' where account_id = $1`,
      [accountId],
    )
    const r = await setupChannelForIntegration({
      accountId,
      externalCalendarId: 'primary',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('integration_disconnected')
  })

  it('refuses with watch_failed when Google rejects channels.watch', async () => {
    const accountId = await makeTeacher('ch-fail@example.com')
    await connect(accountId)
    vi.stubGlobal('fetch', vi.fn(async () => watchResponse({ status: 400 })))
    const r = await setupChannelForIntegration({
      accountId,
      externalCalendarId: 'primary',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('watch_failed')

    // Integration row was NOT mutated when watch failed.
    const row = await getDbPool().query(
      `select channel_id from teacher_calendar_integrations where account_id = $1`,
      [accountId],
    )
    expect(row.rows[0].channel_id).toBeNull()
  })

  it('refuses when oauth env is missing (config_missing)', async () => {
    const accountId = await makeTeacher('ch-cfg@example.com')
    await connect(accountId)
    delete process.env.GOOGLE_CALENDAR_CLIENT_ID
    __resetGoogleCalendarOauthConfigCache()
    const r = await setupChannelForIntegration({
      accountId,
      externalCalendarId: 'primary',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('config_missing')
  })
})

describe('renewExpiringChannels', () => {
  it('renews integrations whose channel expires soon', async () => {
    const accountId = await makeTeacher('renew-1@example.com')
    await connect(accountId)
    await getDbPool().query(
      `update teacher_calendar_integrations
          set channel_id = 'lc-soon', channel_resource_id = 'res_soon',
              channel_token = 'tok', channel_expires_at = now() + interval '1 hour'
        where account_id = $1`,
      [accountId],
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) => {
        const u = String(url)
        if (u.includes('/channels/stop')) return emptyOkResponse()
        return watchResponse({ resourceId: 'res_renewed' })
      }),
    )
    const r = await renewExpiringChannels({})
    expect(r.attempted).toBeGreaterThanOrEqual(1)
    expect(r.renewed).toBeGreaterThanOrEqual(1)

    const row = await getDbPool().query(
      `select channel_resource_id from teacher_calendar_integrations where account_id = $1`,
      [accountId],
    )
    expect(row.rows[0].channel_resource_id).toBe('res_renewed')
  })

  it('skips disconnected integrations', async () => {
    const accountId = await makeTeacher('renew-disc@example.com')
    await connect(accountId)
    await getDbPool().query(
      `update teacher_calendar_integrations
          set sync_state = 'disconnected',
              channel_id = 'lc-old', channel_resource_id = 'res_old',
              channel_expires_at = now() + interval '1 hour'
        where account_id = $1`,
      [accountId],
    )
    vi.stubGlobal('fetch', vi.fn(async () => watchResponse({})))
    const r = await renewExpiringChannels({})
    // No integration matched the sweep query (sync_state filter).
    const details = r.details.filter((d) => d.accountId === accountId)
    expect(details).toHaveLength(0)
  })

  it('also catches integrations with no channel yet (channel_expires_at is null)', async () => {
    const accountId = await makeTeacher('renew-null@example.com')
    await connect(accountId)
    // After connect, channel_expires_at is null by default. Sweep
    // should pick it up.
    vi.stubGlobal('fetch', vi.fn(async () => watchResponse({})))
    const r = await renewExpiringChannels({})
    expect(r.attempted).toBeGreaterThanOrEqual(1)
  })

  it('records failures without stopping the sweep', async () => {
    const a1 = await makeTeacher('renew-fail-a@example.com')
    const a2 = await makeTeacher('renew-fail-b@example.com')
    await connect(a1)
    await connect(a2)
    let call = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) => {
        const u = String(url)
        if (u.includes('/channels/stop')) return emptyOkResponse()
        call++
        return call === 1
          ? watchResponse({ status: 500 })
          : watchResponse({ resourceId: 'res_b_ok' })
      }),
    )
    const r = await renewExpiringChannels({})
    expect(r.attempted).toBeGreaterThanOrEqual(2)
    expect(r.failed).toBeGreaterThanOrEqual(1)
    expect(r.renewed).toBeGreaterThanOrEqual(1)
  })
})
