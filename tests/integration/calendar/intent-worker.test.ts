import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  createAccount,
  grantAccountRole,
  normalizeAccountEmail,
} from '@/lib/auth/accounts'
import { hashPassword } from '@/lib/auth/password'
import { upsertAccountProfile } from '@/lib/auth/profiles'
import { __resetCalendarEncryptionKeyCache } from '@/lib/calendar/encryption'
import {
  drainIntents,
  insertPostCancelIntent,
  reviveBlockedIntents,
} from '@/lib/calendar/intent-worker'
import { upsertGoogleIntegration } from '@/lib/calendar/integrations'
import { getDbPool } from '@/lib/db/pool'

import '../setup'

const TEST_KEY = 'k'.repeat(48)

beforeEach(() => {
  process.env.CALENDAR_ENCRYPTION_KEY = TEST_KEY
  __resetCalendarEncryptionKeyCache()
})
afterEach(() => {
  delete process.env.CALENDAR_ENCRYPTION_KEY
  __resetCalendarEncryptionKeyCache()
})

async function makeTeacher(email: string): Promise<string> {
  const a = await createAccount({
    email: normalizeAccountEmail(email),
    passwordHash: await hashPassword('StrongPassword123'),
  })
  await grantAccountRole(a.id, 'teacher', null)
  await upsertAccountProfile(a.id, {
    displayName: 'T',
    timezone: 'Europe/Moscow',
    locale: 'ru',
  })
  return a.id
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

async function cancelledSlot(
  teacherId: string,
  startIso: string,
  externalEventId: string | null = null,
): Promise<string> {
  const pool = getDbPool()
  const r = await pool.query(
    `insert into lesson_slots (id, teacher_account_id, start_at, duration_minutes,
                                status, cancelled_at, external_event_id, external_calendar_id)
     values (gen_random_uuid(), $1, $2::timestamptz, 60, 'cancelled', now(), $3, $4)
     returning id`,
    [
      teacherId,
      startIso,
      externalEventId,
      externalEventId ? 'primary' : null,
    ],
  )
  return String(r.rows[0].id)
}

describe('drainIntents — post_cancel_push', () => {
  it('happy path: active integration → enqueues delete push, intent succeeded', async () => {
    const teacher = await makeTeacher('i-happy@example.com')
    await connect(teacher)
    const slot = await cancelledSlot(
      teacher,
      '2026-11-01T10:00:00Z',
      'evt-bound',
    )
    await insertPostCancelIntent(getDbPool(), slot)

    const { outcomes } = await drainIntents({})
    expect(outcomes[0].kind).toBe('succeeded')

    const pushJobs = await getDbPool().query(
      `select kind, status from calendar_push_jobs where slot_id = $1`,
      [slot],
    )
    expect(pushJobs.rows).toHaveLength(1)
    expect(pushJobs.rows[0].kind).toBe('delete')
    expect(pushJobs.rows[0].status).toBe('pending')
  })

  it('no integration + no external_event_id → no_op success', async () => {
    const teacher = await makeTeacher('i-noop@example.com')
    // no connect, no external_event_id
    const slot = await cancelledSlot(teacher, '2026-11-02T10:00:00Z')
    await insertPostCancelIntent(getDbPool(), slot)
    const { outcomes } = await drainIntents({})
    expect(outcomes[0].kind).toBe('no_op')
  })

  it('disconnected integration → blocked_integration, retried in 1h', async () => {
    const teacher = await makeTeacher('i-blocked@example.com')
    await connect(teacher)
    await getDbPool().query(
      `update teacher_calendar_integrations set sync_state = 'disconnected' where account_id = $1`,
      [teacher],
    )
    const slot = await cancelledSlot(
      teacher,
      '2026-11-03T10:00:00Z',
      'evt-bound',
    )
    await insertPostCancelIntent(getDbPool(), slot)
    const { outcomes } = await drainIntents({})
    expect(outcomes[0].kind).toBe('blocked_integration')

    const intentRow = await getDbPool().query(
      `select status, next_run_at from slot_lifecycle_intents where slot_id = $1`,
      [slot],
    )
    expect(intentRow.rows[0].status).toBe('blocked_integration')
    expect(
      new Date(String(intentRow.rows[0].next_run_at)).getTime(),
    ).toBeGreaterThan(Date.now() + 30 * 60_000) // ~1h
  })

  it('cancels any pending create job for same slot (cancelled_by_dependent)', async () => {
    const teacher = await makeTeacher('i-cbd@example.com')
    await connect(teacher)
    const slot = await cancelledSlot(
      teacher,
      '2026-11-04T10:00:00Z',
      'evt-bound',
    )
    // Pre-seed a pending create job.
    await getDbPool().query(
      `insert into calendar_push_jobs (slot_id, teacher_account_id, kind, payload, status, next_run_at)
       values ($1, $2, 'create', '{}'::jsonb, 'pending', now())`,
      [slot, teacher],
    )
    await insertPostCancelIntent(getDbPool(), slot)
    await drainIntents({})

    const jobs = await getDbPool().query(
      `select kind, status from calendar_push_jobs where slot_id = $1 order by kind`,
      [slot],
    )
    const create = jobs.rows.find((j) => j.kind === 'create')
    const del = jobs.rows.find((j) => j.kind === 'delete')
    expect(create?.status).toBe('cancelled_by_dependent')
    expect(del?.status).toBe('pending')
  })

  it('slot not cancelled (e.g. cancel rolled back) → terminal_failure', async () => {
    const teacher = await makeTeacher('i-uncanc@example.com')
    await connect(teacher)
    const pool = getDbPool()
    const r = await pool.query(
      `insert into lesson_slots (id, teacher_account_id, start_at, duration_minutes, status,
                                  learner_account_id, booked_at)
       values (gen_random_uuid(), $1, $2::timestamptz, 60, 'booked', $1, now())
       returning id`,
      [teacher, '2026-11-05T10:00:00Z'],
    )
    const slot = String(r.rows[0].id)
    await insertPostCancelIntent(pool, slot)
    const { outcomes } = await drainIntents({})
    expect(outcomes[0].kind).toBe('terminal_failure')
  })

  it('insertPostCancelIntent is idempotent (ON CONFLICT DO NOTHING)', async () => {
    const teacher = await makeTeacher('i-idem@example.com')
    const slot = await cancelledSlot(teacher, '2026-11-06T10:00:00Z')
    const pool = getDbPool()
    await insertPostCancelIntent(pool, slot)
    await insertPostCancelIntent(pool, slot)
    const r = await pool.query(
      `select count(*)::int as n from slot_lifecycle_intents where slot_id = $1`,
      [slot],
    )
    expect(r.rows[0].n).toBe(1)
  })
})

describe('reviveBlockedIntents', () => {
  it('flips blocked_integration → pending when integration is actionable again', async () => {
    const teacher = await makeTeacher('rev-1@example.com')
    await connect(teacher)
    const slot = await cancelledSlot(
      teacher,
      '2026-11-07T10:00:00Z',
      'evt-bound',
    )
    const pool = getDbPool()
    await pool.query(
      `insert into slot_lifecycle_intents (slot_id, kind, status, next_run_at)
       values ($1, 'post_cancel_push', 'blocked_integration', now() + interval '1 hour')`,
      [slot],
    )
    // Make integration look freshly-pulled.
    await pool.query(
      `update teacher_calendar_integrations set sync_state = 'active', last_pulled_at = now() where account_id = $1`,
      [teacher],
    )
    const r = await reviveBlockedIntents()
    expect(r.revived).toBeGreaterThanOrEqual(1)
    const intentRow = await pool.query(
      `select status from slot_lifecycle_intents where slot_id = $1`,
      [slot],
    )
    expect(intentRow.rows[0].status).toBe('pending')
  })

  it('does not revive when integration is still disconnected', async () => {
    const teacher = await makeTeacher('rev-stuck@example.com')
    await connect(teacher)
    await getDbPool().query(
      `update teacher_calendar_integrations set sync_state = 'disconnected' where account_id = $1`,
      [teacher],
    )
    const slot = await cancelledSlot(teacher, '2026-11-08T10:00:00Z')
    await getDbPool().query(
      `insert into slot_lifecycle_intents (slot_id, kind, status, next_run_at)
       values ($1, 'post_cancel_push', 'blocked_integration', now() + interval '1 hour')`,
      [slot],
    )
    const r = await reviveBlockedIntents()
    expect(r.revived).toBe(0)
  })
})
