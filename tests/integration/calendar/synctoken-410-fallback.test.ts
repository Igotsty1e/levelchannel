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
import { drainPullJobs, enqueuePullJob } from '@/lib/calendar/pull-worker'
import { getDbPool } from '@/lib/db/pool'

import '../setup'

// BCS-DEF-7 Phase 2 §3.3 — 410-Gone fallback integration test.
//
// Boot pull worker against test DB; seed an integration with a stored
// syncToken. First fetch returns 410 → outcome = `retried`
// (sync_token_expired classified as transient by pull-worker's
// `isTransientHttpError`). The pull-runner has already null'd
// next_sync_token under the optimistic guard. Re-draining drives a
// fresh full-rewrite cycle that captures a new token. Bottom line:
// 410 is recoverable, the system self-heals on the next tick.

const TEST_KEY = 'k'.repeat(48)

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

async function connectAndSeedToken(
  accountId: string,
  token: string,
): Promise<void> {
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
  // Seed a stored token AND a recent last_pulled_at so the
  // active-teacher predicate's 24h gate is satisfied without
  // needing a booked slot.
  const pool = getDbPool()
  await pool.query(
    `update teacher_calendar_integrations
        set next_sync_token = $2,
            last_pulled_at = now()
      where account_id = $1`,
    [accountId, token],
  )
}

describe('BCS-DEF-7 Phase 2 — syncToken 410 fallback', () => {
  it('410 → outcome=retried + token cleared; re-drain → full-rewrite seeds fresh token', async () => {
    const teacherId = await makeTeacher('teacher-410-fallback@example.com')
    await connectAndSeedToken(teacherId, 'EXPIRED_TOKEN')
    await enqueuePullJob({
      teacherAccountId: teacherId,
      externalCalendarId: 'primary',
    })

    // First drain: Google returns 410 on the delta call.
    let firstCall = true
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) => {
        const u = String(url)
        if (firstCall) {
          firstCall = false
          // Must be the delta call (carries syncToken).
          expect(u).toContain('syncToken=EXPIRED_TOKEN')
          return {
            ok: false,
            status: 410,
            json: async () => ({}),
            text: async () => 'Sync token is no longer valid',
          } as unknown as Response
        }
        // Subsequent fetches should not happen in the same drain
        // (the failure short-circuits the job).
        throw new Error('unexpected second fetch in first drain')
      }),
    )
    const drain1 = await drainPullJobs({})
    expect(drain1.outcomes).toHaveLength(1)
    expect(drain1.outcomes[0].kind).toBe('retried')
    if (drain1.outcomes[0].kind === 'retried') {
      expect(drain1.outcomes[0].reason).toMatch(/sync_token_expired/)
    }

    // The pull-runner cleared the token under the guard.
    const meta1 = await getGoogleIntegrationMeta(teacherId)
    expect(meta1?.nextSyncToken).toBeNull()

    // Move the job back to "ready now" so we can drain it again
    // without waiting for the 1-minute backoff.
    await getDbPool().query(
      `update calendar_pull_jobs
          set next_run_at = now()
        where teacher_account_id = $1`,
      [teacherId],
    )

    // Second drain: Google returns a normal full-rewrite payload
    // with a fresh nextSyncToken.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) => {
        const u = String(url)
        // No syncToken on the URL — full-rewrite path.
        expect(u).not.toContain('syncToken=')
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              {
                id: 'FRESH_EVT',
                summary: 'Fresh',
                start: { dateTime: '2026-06-15T09:00:00Z' },
                end: { dateTime: '2026-06-15T10:00:00Z' },
              },
            ],
            nextSyncToken: 'NEW_TOKEN',
          }),
          text: async () => '',
        } as unknown as Response
      }),
    )
    const drain2 = await drainPullJobs({})
    expect(drain2.outcomes).toHaveLength(1)
    expect(drain2.outcomes[0].kind).toBe('succeeded')
    if (drain2.outcomes[0].kind === 'succeeded') {
      expect(drain2.outcomes[0].mode).toBe('full')
    }

    const meta2 = await getGoogleIntegrationMeta(teacherId)
    expect(meta2?.nextSyncToken).toBe('NEW_TOKEN')
  })
})
