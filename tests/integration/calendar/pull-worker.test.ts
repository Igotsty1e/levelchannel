import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createAccount,
  grantAccountRole,
  normalizeAccountEmail,
} from '@/lib/auth/accounts'
import { hashPassword } from '@/lib/auth/password'
import { upsertAccountProfile } from '@/lib/auth/profiles'
import { __resetCalendarEncryptionKeyCache } from '@/lib/calendar/encryption'
import { __resetGoogleCalendarOauthConfigCache } from '@/lib/calendar/google/config'
import {
  getGoogleIntegrationMeta,
  upsertGoogleIntegration,
} from '@/lib/calendar/integrations'
import {
  drainPullJobs,
  enqueuePullJob,
} from '@/lib/calendar/pull-worker'
import { getDbPool } from '@/lib/db/pool'

import '../setup'

const TEST_KEY = 'k'.repeat(48)

function eventsListResponse(items: unknown[]): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ items }),
    text: async () => JSON.stringify({ items }),
  } as unknown as Response
}

function tokenResponse(body: Record<string, unknown>, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

beforeEach(() => {
  process.env.CALENDAR_ENCRYPTION_KEY = TEST_KEY
  process.env.GOOGLE_CALENDAR_CLIENT_ID = 'cid'
  process.env.GOOGLE_CALENDAR_CLIENT_SECRET = 'csec'
  process.env.GOOGLE_CALENDAR_REDIRECT_URL =
    'https://lc.test/api/teacher/calendar/google/callback'
  process.env.GOOGLE_OAUTH_STATE_SECRET = 'oauth-state-' + 'x'.repeat(32)
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
  const r = await upsertGoogleIntegration({
    accountId,
    accessToken: 'AT',
    refreshToken: 'RT',
    scope: 's',
    tokenExpiresAt: new Date(Date.now() + 3600_000),
    readCalendarIds: ['primary'],
    writeCalendarId: 'primary',
    reason: 'initial_connect',
  })
  expect(r.ok).toBe(true)
}

describe('drainPullJobs', () => {
  it('happy path: claims pending, runs pull, marks succeeded', async () => {
    const teacherId = await makeTeacher('worker-happy@example.com')
    await connect(teacherId)
    await enqueuePullJob({
      teacherAccountId: teacherId,
      externalCalendarId: 'primary',
    })

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        eventsListResponse([
          {
            id: 'E',
            start: { dateTime: '2026-07-01T09:00:00Z' },
            end: { dateTime: '2026-07-01T10:00:00Z' },
          },
        ]),
      ),
    )
    const { outcomes } = await drainPullJobs({})
    expect(outcomes).toHaveLength(1)
    expect(outcomes[0].kind).toBe('succeeded')

    const pool = getDbPool()
    const job = await pool.query(
      'select status from calendar_pull_jobs where teacher_account_id=$1',
      [teacherId],
    )
    expect(job.rows[0].status).toBe('succeeded')
    const meta = await getGoogleIntegrationMeta(teacherId)
    expect(meta?.lastPulledAt).not.toBeNull()
  })

  it('skips when no pending jobs', async () => {
    const { outcomes } = await drainPullJobs({})
    expect(outcomes).toEqual([])
  })

  it('retries on Google 5xx (transient per plan §4.7) — Codex D.complete fix', async () => {
    const teacherId = await makeTeacher('worker-5xx@example.com')
    await connect(teacherId)
    await enqueuePullJob({
      teacherAccountId: teacherId,
      externalCalendarId: 'primary',
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: false,
            status: 503,
            text: async () => 'unavailable',
            json: async () => ({}),
          }) as unknown as Response,
      ),
    )
    const { outcomes } = await drainPullJobs({})
    expect(outcomes).toHaveLength(1)
    expect(outcomes[0].kind).toBe('retried')
  })

  it('retries on Google 429 quota throttle', async () => {
    const teacherId = await makeTeacher('worker-429@example.com')
    await connect(teacherId)
    await enqueuePullJob({
      teacherAccountId: teacherId,
      externalCalendarId: 'primary',
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: false,
            status: 429,
            text: async () => 'rate limit',
            json: async () => ({}),
          }) as unknown as Response,
      ),
    )
    const { outcomes } = await drainPullJobs({})
    expect(outcomes[0].kind).toBe('retried')
  })

  it('terminal_failure on permanent HTTP 4xx (e.g. 404 calendar gone)', async () => {
    const teacherId = await makeTeacher('worker-404@example.com')
    await connect(teacherId)
    await enqueuePullJob({
      teacherAccountId: teacherId,
      externalCalendarId: 'gone',
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: false,
            status: 404,
            text: async () => 'not found',
            json: async () => ({}),
          }) as unknown as Response,
      ),
    )
    const { outcomes } = await drainPullJobs({})
    expect(outcomes[0].kind).toBe('terminal_failure')
  })

  it('terminal_failure on expired refresh_token (permanent path), integration flipped to disconnected', async () => {
    const teacherId = await makeTeacher('worker-perm@example.com')
    await connect(teacherId)
    const pool = getDbPool()
    // Force the integration to look expired.
    await pool.query(
      `update teacher_calendar_integrations set token_expires_at = now() - interval '1 hour' where account_id = $1`,
      [teacherId],
    )
    await enqueuePullJob({
      teacherAccountId: teacherId,
      externalCalendarId: 'primary',
    })

    // First fetch will be Google token refresh — return 400.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => tokenResponse({ error: 'invalid_grant' }, 400)),
    )
    const { outcomes } = await drainPullJobs({})
    expect(outcomes[0].kind).toBe('terminal_failure')

    const meta = await getGoogleIntegrationMeta(teacherId)
    expect(meta?.syncState).toBe('disconnected')
  })

  it('retries (schedules pending again) on transient (network) failure inside MAX_ATTEMPTS', async () => {
    const teacherId = await makeTeacher('worker-retry@example.com')
    await connect(teacherId)
    await enqueuePullJob({
      teacherAccountId: teacherId,
      externalCalendarId: 'primary',
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ETIMEDOUT')
      }),
    )
    const { outcomes } = await drainPullJobs({})
    expect(outcomes).toHaveLength(1)
    expect(outcomes[0].kind).toBe('retried')

    const pool = getDbPool()
    const job = await pool.query(
      'select status, attempts, next_run_at from calendar_pull_jobs where teacher_account_id=$1',
      [teacherId],
    )
    expect(job.rows[0].status).toBe('pending')
    expect(Number(job.rows[0].attempts)).toBe(1)
    // next_run_at pushed into the future
    expect(new Date(String(job.rows[0].next_run_at)).getTime()).toBeGreaterThan(
      Date.now(),
    )
  })

  it('refresh path: refresh succeeds → pull succeeds; new access_token persisted', async () => {
    const teacherId = await makeTeacher('worker-refresh@example.com')
    await connect(teacherId)
    const pool = getDbPool()
    await pool.query(
      `update teacher_calendar_integrations set token_expires_at = now() - interval '1 hour' where account_id = $1`,
      [teacherId],
    )
    await enqueuePullJob({
      teacherAccountId: teacherId,
      externalCalendarId: 'primary',
    })

    let callCount = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) => {
        callCount++
        const u = String(url)
        if (u.includes('oauth2.googleapis.com/token')) {
          return tokenResponse({
            access_token: 'NEW_AT',
            expires_in: 3600,
            token_type: 'Bearer',
            scope: 's',
          })
        }
        return eventsListResponse([])
      }),
    )
    const { outcomes } = await drainPullJobs({})
    expect(outcomes[0].kind).toBe('succeeded')
    expect(callCount).toBeGreaterThanOrEqual(2)
  })
})

describe('enqueuePullJob', () => {
  it('inserts a pending job', async () => {
    const teacherId = await makeTeacher('enq-1@example.com')
    await connect(teacherId)
    const r = await enqueuePullJob({
      teacherAccountId: teacherId,
      externalCalendarId: 'primary',
    })
    expect(r.upserted).toBe(true)
  })

  it('upgrades priority + pulls next_run_at forward on conflict (Codex D.complete fix)', async () => {
    const teacherId = await makeTeacher('enq-2@example.com')
    await connect(teacherId)
    const pool = getDbPool()

    // First enqueue: priority=0, push next_run_at far into the future
    // to simulate a job in backoff.
    await enqueuePullJob({
      teacherAccountId: teacherId,
      externalCalendarId: 'primary',
      priority: 0,
    })
    await pool.query(
      `update calendar_pull_jobs set next_run_at = now() + interval '20 minutes' where teacher_account_id = $1`,
      [teacherId],
    )

    // Webhook-style realtime enqueue: priority=2. Must upgrade priority
    // AND pull next_run_at forward.
    const r2 = await enqueuePullJob({
      teacherAccountId: teacherId,
      externalCalendarId: 'primary',
      priority: 2,
    })
    expect(r2.upserted).toBe(true)

    const after = await pool.query(
      'select priority, next_run_at from calendar_pull_jobs where teacher_account_id = $1',
      [teacherId],
    )
    expect(Number(after.rows[0].priority)).toBe(2)
    expect(new Date(String(after.rows[0].next_run_at)).getTime()).toBeLessThan(
      Date.now() + 60_000,
    )
  })
})
