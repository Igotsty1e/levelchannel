import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { POST as webhookHandler } from '@/app/api/calendar/google/webhook/route'
import {
  createAccount,
  grantAccountRole,
  normalizeAccountEmail,
} from '@/lib/auth/accounts'
import { hashPassword } from '@/lib/auth/password'
import { upsertAccountProfile } from '@/lib/auth/profiles'
import { __resetCalendarEncryptionKeyCache } from '@/lib/calendar/encryption'
import { upsertGoogleIntegration } from '@/lib/calendar/integrations'
import { getDbPool } from '@/lib/db/pool'

import '../setup'

const TEST_KEY = 'k'.repeat(48)
const CHANNEL_TOKEN = 'channel-token-32-byte-random-here-padding'
const CHANNEL_ID = 'ch_test_001'
const RESOURCE_ID = 'res_test_001'

beforeEach(() => {
  process.env.CALENDAR_ENCRYPTION_KEY = TEST_KEY
  __resetCalendarEncryptionKeyCache()
})
afterEach(() => {
  delete process.env.CALENDAR_ENCRYPTION_KEY
  __resetCalendarEncryptionKeyCache()
})

async function makeTeacherWithChannel(opts: {
  email: string
  readCalendarIds?: string[]
  channelExpiresInMs?: number
  syncState?: 'active' | 'degraded' | 'disconnected'
}): Promise<string> {
  const account = await createAccount({
    email: normalizeAccountEmail(opts.email),
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
    readCalendarIds: opts.readCalendarIds ?? ['primary'],
    writeCalendarId: 'primary',
    reason: 'initial_connect',
  })
  // Stamp channel fields directly — upsert doesn't take them yet
  // (channels.watch is BCS-D.4 territory).
  const pool = getDbPool()
  const expiresInMs = opts.channelExpiresInMs ?? 6 * 24 * 60 * 60_000
  await pool.query(
    `update teacher_calendar_integrations
        set channel_id = $2, channel_resource_id = $3, channel_token = $4,
            channel_expires_at = now() + ($5 || ' milliseconds')::interval,
            sync_state = $6
      where account_id = $1`,
    [account.id, CHANNEL_ID, RESOURCE_ID, CHANNEL_TOKEN, String(expiresInMs), opts.syncState ?? 'active'],
  )
  return account.id
}

function webhookReq(headers: Record<string, string>): Request {
  return new Request('https://lc.test/api/calendar/google/webhook', {
    method: 'POST',
    headers,
  })
}

async function countPullJobs(accountId: string): Promise<number> {
  const r = await getDbPool().query(
    'select count(*)::int as n from calendar_pull_jobs where teacher_account_id = $1',
    [accountId],
  )
  return Number(r.rows[0].n)
}

async function readLastSeen(accountId: string): Promise<number | null> {
  const r = await getDbPool().query(
    'select last_seen_message_number from teacher_calendar_integrations where account_id = $1',
    [accountId],
  )
  const v = r.rows[0]?.last_seen_message_number
  return v === null || v === undefined ? null : Number(v)
}

describe('POST /api/calendar/google/webhook', () => {
  it('happy path: enqueues pull job + bumps last_seen', async () => {
    const accountId = await makeTeacherWithChannel({
      email: 'wh-happy@example.com',
    })
    const res = await webhookHandler(
      webhookReq({
        'x-goog-channel-id': CHANNEL_ID,
        'x-goog-channel-token': CHANNEL_TOKEN,
        'x-goog-resource-id': RESOURCE_ID,
        'x-goog-resource-state': 'update',
        'x-goog-message-number': '5',
      }),
    )
    expect(res.status).toBe(200)
    expect(await countPullJobs(accountId)).toBe(1)
    expect(await readLastSeen(accountId)).toBe(5)
  })

  it('wrong channel_token → silent 200, no enqueue, no last_seen bump', async () => {
    const accountId = await makeTeacherWithChannel({
      email: 'wh-wrongtok@example.com',
    })
    const res = await webhookHandler(
      webhookReq({
        'x-goog-channel-id': CHANNEL_ID,
        'x-goog-channel-token': 'wrong-token-padding-padding-padding',
        'x-goog-resource-id': RESOURCE_ID,
        'x-goog-resource-state': 'update',
        'x-goog-message-number': '5',
      }),
    )
    expect(res.status).toBe(200)
    expect(await countPullJobs(accountId)).toBe(0)
    expect(await readLastSeen(accountId)).toBe(null)
  })

  it('wrong resource_id → silent 200, no enqueue', async () => {
    const accountId = await makeTeacherWithChannel({
      email: 'wh-wrongres@example.com',
    })
    const res = await webhookHandler(
      webhookReq({
        'x-goog-channel-id': CHANNEL_ID,
        'x-goog-channel-token': CHANNEL_TOKEN,
        'x-goog-resource-id': 'WRONG_RES',
        'x-goog-resource-state': 'update',
        'x-goog-message-number': '5',
      }),
    )
    expect(res.status).toBe(200)
    expect(await countPullJobs(accountId)).toBe(0)
  })

  it('unknown channel_id → silent 200, no enqueue', async () => {
    const res = await webhookHandler(
      webhookReq({
        'x-goog-channel-id': 'ch_does_not_exist',
        'x-goog-channel-token': CHANNEL_TOKEN,
        'x-goog-resource-id': RESOURCE_ID,
        'x-goog-resource-state': 'update',
        'x-goog-message-number': '5',
      }),
    )
    expect(res.status).toBe(200)
  })

  it('replay (msg# <= last_seen) → silent 200, no enqueue', async () => {
    const accountId = await makeTeacherWithChannel({
      email: 'wh-replay@example.com',
    })
    await getDbPool().query(
      `update teacher_calendar_integrations set last_seen_message_number = 10 where account_id = $1`,
      [accountId],
    )
    const res = await webhookHandler(
      webhookReq({
        'x-goog-channel-id': CHANNEL_ID,
        'x-goog-channel-token': CHANNEL_TOKEN,
        'x-goog-resource-id': RESOURCE_ID,
        'x-goog-resource-state': 'update',
        'x-goog-message-number': '7',
      }),
    )
    expect(res.status).toBe(200)
    expect(await countPullJobs(accountId)).toBe(0)
    expect(await readLastSeen(accountId)).toBe(10) // unchanged
  })

  it('sync handshake (resource_state=sync) bumps msg# but does NOT enqueue', async () => {
    const accountId = await makeTeacherWithChannel({
      email: 'wh-sync@example.com',
    })
    const res = await webhookHandler(
      webhookReq({
        'x-goog-channel-id': CHANNEL_ID,
        'x-goog-channel-token': CHANNEL_TOKEN,
        'x-goog-resource-id': RESOURCE_ID,
        'x-goog-resource-state': 'sync',
        'x-goog-message-number': '1',
      }),
    )
    expect(res.status).toBe(200)
    expect(await countPullJobs(accountId)).toBe(0)
    expect(await readLastSeen(accountId)).toBe(1)
  })

  it('multi-calendar teacher: enqueues a pull job per read_calendar_id', async () => {
    const accountId = await makeTeacherWithChannel({
      email: 'wh-multi@example.com',
      readCalendarIds: ['primary', 'work@x.com', 'personal@x.com'],
    })
    const res = await webhookHandler(
      webhookReq({
        'x-goog-channel-id': CHANNEL_ID,
        'x-goog-channel-token': CHANNEL_TOKEN,
        'x-goog-resource-id': RESOURCE_ID,
        'x-goog-resource-state': 'update',
        'x-goog-message-number': '2',
      }),
    )
    expect(res.status).toBe(200)
    expect(await countPullJobs(accountId)).toBe(3)
  })

  it('disconnected integration: bump msg# but no enqueue', async () => {
    const accountId = await makeTeacherWithChannel({
      email: 'wh-disc@example.com',
      syncState: 'disconnected',
    })
    const res = await webhookHandler(
      webhookReq({
        'x-goog-channel-id': CHANNEL_ID,
        'x-goog-channel-token': CHANNEL_TOKEN,
        'x-goog-resource-id': RESOURCE_ID,
        'x-goog-resource-state': 'update',
        'x-goog-message-number': '2',
      }),
    )
    expect(res.status).toBe(200)
    expect(await countPullJobs(accountId)).toBe(0)
    expect(await readLastSeen(accountId)).toBe(2)
  })

  it('missing required header → silent 200', async () => {
    const accountId = await makeTeacherWithChannel({
      email: 'wh-missing@example.com',
    })
    const res = await webhookHandler(
      webhookReq({
        'x-goog-channel-id': CHANNEL_ID,
        // missing channel-token, resource-id, etc.
        'x-goog-message-number': '5',
      }),
    )
    expect(res.status).toBe(200)
    expect(await countPullJobs(accountId)).toBe(0)
  })

  it('invalid msg# (non-integer / zero / negative) → silent 200', async () => {
    const accountId = await makeTeacherWithChannel({
      email: 'wh-badnum@example.com',
    })
    for (const bad of ['nope', '0', '-1', '1.5']) {
      const res = await webhookHandler(
        webhookReq({
          'x-goog-channel-id': CHANNEL_ID,
          'x-goog-channel-token': CHANNEL_TOKEN,
          'x-goog-resource-id': RESOURCE_ID,
          'x-goog-resource-state': 'update',
          'x-goog-message-number': bad,
        }),
      )
      expect(res.status).toBe(200)
    }
    expect(await countPullJobs(accountId)).toBe(0)
  })

  it('disallowed resource_state silently dropped', async () => {
    const accountId = await makeTeacherWithChannel({
      email: 'wh-badstate@example.com',
    })
    const res = await webhookHandler(
      webhookReq({
        'x-goog-channel-id': CHANNEL_ID,
        'x-goog-channel-token': CHANNEL_TOKEN,
        'x-goog-resource-id': RESOURCE_ID,
        'x-goog-resource-state': 'unknown_state',
        'x-goog-message-number': '3',
      }),
    )
    expect(res.status).toBe(200)
    expect(await countPullJobs(accountId)).toBe(0)
  })
})
