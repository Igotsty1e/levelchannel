import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { POST as webhookHandler } from '@/app/api/calendar/google/webhook/route'
import {
  createAccount,
  grantAccountRole,
  normalizeAccountEmail,
} from '@/lib/auth/accounts'
import { hashPassword } from '@/lib/auth/password'
import { upsertAccountProfile } from '@/lib/auth/profiles'
import { setupChannelForIntegration } from '@/lib/calendar/channel-renewer'
import { __resetCalendarEncryptionKeyCache } from '@/lib/calendar/encryption'
import { __resetGoogleCalendarOauthConfigCache } from '@/lib/calendar/google/config'
import { upsertGoogleIntegration } from '@/lib/calendar/integrations'
import { getDbPool } from '@/lib/db/pool'

import '../setup'

// AUDIT-SEC-4 (2026-05-17) — pins the channel_token at-rest
// encryption surface end-to-end:
//
//   1. Dual-write: setupChannelForIntegration writes BOTH plaintext
//      and pgp_sym_encrypt(channel_token, key) on the same row.
//   2. Webhook accepts a row written through the dual-write path
//      (uses the encrypted branch via pgp_sym_decrypt_either).
//   3. Webhook accepts a legacy row with ONLY plaintext (Phase A
//      coalesce fallback).
//   4. Webhook accepts a Phase-B row with ONLY encrypted column.
//
// Plus the regression anchor: WRONG header value silent-drops on
// every shape — the constant-time compare contract carries over.

const TEST_KEY = 'k'.repeat(48)

function watchResponse(opts: { resourceId?: string }): Response {
  const expiration = Date.now() + 6 * 24 * 60 * 60_000
  return {
    ok: true,
    status: 200,
    json: async () => ({
      kind: 'api#channel',
      id: 'ignored',
      resourceId: opts.resourceId ?? 'res_sec4',
      expiration: String(expiration),
    }),
    text: async () =>
      JSON.stringify({
        kind: 'api#channel',
        resourceId: opts.resourceId ?? 'res_sec4',
        expiration: String(expiration),
      }),
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
  delete process.env.CALENDAR_ENCRYPTION_KEY_OLD
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
  await upsertGoogleIntegration({
    accountId: account.id,
    accessToken: 'AT',
    refreshToken: 'RT',
    scope: 's',
    tokenExpiresAt: new Date(Date.now() + 3600_000),
    readCalendarIds: ['primary'],
    writeCalendarId: 'primary',
    reason: 'initial_connect',
  })
  return account.id
}

function webhookReq(headers: Record<string, string>): Request {
  return new Request('https://lc.test/api/calendar/google/webhook', {
    method: 'POST',
    headers,
  })
}

describe('AUDIT-SEC-4 channel_token encryption — dual-write + decrypt-aware read', () => {
  it('dual-writes channel_token AND channel_token_enc on setupChannelForIntegration', async () => {
    const accountId = await makeTeacher('sec4-dual@example.com')
    vi.stubGlobal('fetch', vi.fn(async () => watchResponse({ resourceId: 'res_dual' })))

    const r = await setupChannelForIntegration({
      accountId,
      externalCalendarId: 'primary',
    })
    expect(r.ok).toBe(true)

    const row = await getDbPool().query(
      `select channel_token,
              channel_token_enc,
              pgp_sym_decrypt(channel_token_enc, $2::text) as decrypted
         from teacher_calendar_integrations
        where account_id = $1`,
      [accountId, TEST_KEY],
    )
    expect(row.rows[0].channel_token).toBeTruthy()
    expect(row.rows[0].channel_token_enc).toBeTruthy()
    // The load-bearing assertion: the encrypted column round-trips
    // back to the exact plaintext column value. A regression that
    // drops the pgp_sym_encrypt clause from the UPDATE breaks this.
    expect(row.rows[0].decrypted).toBe(row.rows[0].channel_token)
  })

  it('webhook accepts a row written through the dual-write path (encrypted branch)', async () => {
    const accountId = await makeTeacher('sec4-webhook-dual@example.com')
    vi.stubGlobal('fetch', vi.fn(async () => watchResponse({ resourceId: 'res_webhook_dual' })))

    const r = await setupChannelForIntegration({
      accountId,
      externalCalendarId: 'primary',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return

    // Read back what the renewer minted so we can echo the header
    // Google would send.
    const pool = getDbPool()
    const seeded = await pool.query(
      `select channel_id, channel_token from teacher_calendar_integrations where account_id = $1`,
      [accountId],
    )
    const channelId = String(seeded.rows[0].channel_id)
    const channelToken = String(seeded.rows[0].channel_token)

    // Force the webhook to take the encrypted branch by nulling the
    // plaintext column. This is the post-Phase-B shape and proves
    // the decrypt-aware SELECT works.
    await pool.query(
      `update teacher_calendar_integrations
          set channel_token = null
        where account_id = $1`,
      [accountId],
    )

    const res = await webhookHandler(
      webhookReq({
        'x-goog-channel-id': channelId,
        'x-goog-channel-token': channelToken,
        'x-goog-resource-id': 'res_webhook_dual',
        'x-goog-resource-state': 'exists',
        'x-goog-message-number': '1',
      }),
    )
    expect(res.status).toBe(200)

    const after = await pool.query(
      `select last_seen_message_number from teacher_calendar_integrations where account_id = $1`,
      [accountId],
    )
    expect(Number(after.rows[0].last_seen_message_number)).toBe(1)
  })

  it('webhook accepts a legacy row with ONLY plaintext channel_token (Phase A coalesce fallback)', async () => {
    const accountId = await makeTeacher('sec4-plaintext-only@example.com')

    // Phase-A legacy row shape: channel_token set, channel_token_enc null.
    const pool = getDbPool()
    await pool.query(
      `update teacher_calendar_integrations
          set channel_id = 'lc-legacy',
              channel_resource_id = 'res_legacy',
              channel_token = 'legacy-plain-token-32bytes-padding',
              channel_token_enc = null,
              channel_expires_at = now() + interval '1 day'
        where account_id = $1`,
      [accountId],
    )

    const res = await webhookHandler(
      webhookReq({
        'x-goog-channel-id': 'lc-legacy',
        'x-goog-channel-token': 'legacy-plain-token-32bytes-padding',
        'x-goog-resource-id': 'res_legacy',
        'x-goog-resource-state': 'exists',
        'x-goog-message-number': '1',
      }),
    )
    expect(res.status).toBe(200)

    const after = await pool.query(
      `select last_seen_message_number from teacher_calendar_integrations where account_id = $1`,
      [accountId],
    )
    expect(Number(after.rows[0].last_seen_message_number)).toBe(1)
  })

  it('webhook accepts a Phase-B row with ONLY channel_token_enc', async () => {
    const accountId = await makeTeacher('sec4-encrypted-only@example.com')

    // Phase-B post-null-out shape: channel_token null, channel_token_enc set.
    const pool = getDbPool()
    await pool.query(
      `update teacher_calendar_integrations
          set channel_id = 'lc-phaseb',
              channel_resource_id = 'res_phaseb',
              channel_token = null,
              channel_token_enc = pgp_sym_encrypt('phaseb-token-32bytes-padding-here', $2),
              channel_expires_at = now() + interval '1 day'
        where account_id = $1`,
      [accountId, TEST_KEY],
    )

    const res = await webhookHandler(
      webhookReq({
        'x-goog-channel-id': 'lc-phaseb',
        'x-goog-channel-token': 'phaseb-token-32bytes-padding-here',
        'x-goog-resource-id': 'res_phaseb',
        'x-goog-resource-state': 'exists',
        'x-goog-message-number': '1',
      }),
    )
    expect(res.status).toBe(200)

    const after = await pool.query(
      `select last_seen_message_number from teacher_calendar_integrations where account_id = $1`,
      [accountId],
    )
    expect(Number(after.rows[0].last_seen_message_number)).toBe(1)
  })

  it('webhook silent-drops a wrong header value on a Phase-B encrypted-only row', async () => {
    // Anti-probe regression anchor: the constant-time compare
    // contract holds on the new encrypted branch.
    const accountId = await makeTeacher('sec4-wrong-token@example.com')
    const pool = getDbPool()
    await pool.query(
      `update teacher_calendar_integrations
          set channel_id = 'lc-wrong',
              channel_resource_id = 'res_wrong',
              channel_token = null,
              channel_token_enc = pgp_sym_encrypt('right-token-32bytes-padding-here!', $2),
              channel_expires_at = now() + interval '1 day'
        where account_id = $1`,
      [accountId, TEST_KEY],
    )

    const res = await webhookHandler(
      webhookReq({
        'x-goog-channel-id': 'lc-wrong',
        'x-goog-channel-token': 'WRONG-token-32bytes-padding-here!',
        'x-goog-resource-id': 'res_wrong',
        'x-goog-resource-state': 'exists',
        'x-goog-message-number': '1',
      }),
    )
    expect(res.status).toBe(200)

    const after = await pool.query(
      `select last_seen_message_number from teacher_calendar_integrations where account_id = $1`,
      [accountId],
    )
    // Wrong token → silent drop → last_seen_message_number stays null.
    expect(after.rows[0].last_seen_message_number).toBeNull()
  })

  it('setupChannelForIntegration fails closed when CALENDAR_ENCRYPTION_KEY is unset (no orphan Google channel)', async () => {
    const accountId = await makeTeacher('sec4-no-key@example.com')
    delete process.env.CALENDAR_ENCRYPTION_KEY
    __resetCalendarEncryptionKeyCache()

    // If the guard fires correctly, fetch must NEVER be called — no
    // orphan Google channel is created.
    const fetchSpy = vi.fn(async () => watchResponse({ resourceId: 'res_should_not_happen' }))
    vi.stubGlobal('fetch', fetchSpy)

    const r = await setupChannelForIntegration({
      accountId,
      externalCalendarId: 'primary',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('config_missing')
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
