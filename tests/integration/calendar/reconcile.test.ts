import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  createAccount,
  grantAccountRole,
  normalizeAccountEmail,
} from '@/lib/auth/accounts'
import { hashPassword } from '@/lib/auth/password'
import { upsertAccountProfile } from '@/lib/auth/profiles'
import { __resetCalendarEncryptionKeyCache } from '@/lib/calendar/encryption'
import { type FetchEventOutcome } from '@/lib/calendar/google/pull'
import { upsertGoogleIntegration } from '@/lib/calendar/integrations'
import {
  runReconcileSweep,
  type ReconcileFetchImpl,
} from '@/lib/calendar/reconcile-runner'
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

async function connect(accountId: string): Promise<string> {
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
  if (!r.ok) throw new Error(`upsert failed: ${r.error.code}`)
  // Read back the epoch — we stamp it on slots we seed.
  const row = await getDbPool().query(
    `select epoch from teacher_calendar_integrations where account_id = $1`,
    [accountId],
  )
  return String(row.rows[0].epoch)
}

type SeedSlotOpts = {
  teacherId: string
  status: 'booked' | 'cancelled'
  externalEventId: string
  externalCalendarId?: string
  integrationEpoch: string | null
  startOffsetDays?: number
  lastReconciledAt?: string | null
  externalSyncFailedAt?: string | null
}

function alignedMskStartAt(offsetDays: number, mskHour = 10): string {
  // Slot CHECKs require: start_at minute aligned to :00/:30 MSK,
  // hour in [6, 22) MSK, and start + duration < MSK midnight.
  // We use MSK 10:00:00 by default — comfortably inside the band.
  const target = new Date(Date.now() + offsetDays * 24 * 60 * 60_000)
  // MSK = UTC+3, so UTC hour = MSK hour - 3. UTC seconds + minutes = 0.
  target.setUTCHours(mskHour - 3, 0, 0, 0)
  return target.toISOString()
}

async function seedSlot(opts: SeedSlotOpts): Promise<string> {
  const startOffsetDays = opts.startOffsetDays ?? 7
  const startAt = alignedMskStartAt(startOffsetDays)
  // Two-step: insert minimally valid row, then patch external columns +
  // status. Keeps the (booked → learner_account_id NOT NULL) CHECK
  // and the (external_event_id ⇔ external_calendar_id) CHECK happy.
  const insR = await getDbPool().query(
    `insert into lesson_slots (id, teacher_account_id, start_at,
                               duration_minutes, status)
     values (gen_random_uuid(), $1::uuid, $2::timestamptz, 60, 'open')
     returning id`,
    [opts.teacherId, startAt],
  )
  const slotId = String(insR.rows[0].id)
  // booked path needs learner_account_id (CHECK constraint); cancelled
  // path leaves it null (INSERT default). Run as two separate UPDATEs
  // to keep each SQL statement small + every param's type unambiguous.
  if (opts.status === 'booked') {
    await getDbPool().query(
      `update lesson_slots
          set status = 'booked',
              learner_account_id = $1::uuid,
              booked_at = now(),
              external_calendar_id = $2::text,
              external_event_id = $3::text,
              integration_epoch = $4::text,
              last_reconciled_at = $5::timestamptz,
              external_sync_failed_at = $6::timestamptz
        where id = $7::uuid`,
      [
        opts.teacherId,
        opts.externalCalendarId ?? 'primary',
        opts.externalEventId,
        opts.integrationEpoch,
        opts.lastReconciledAt,
        opts.externalSyncFailedAt,
        slotId,
      ],
    )
  } else {
    await getDbPool().query(
      `update lesson_slots
          set status = 'cancelled',
              cancelled_at = now(),
              external_calendar_id = $1::text,
              external_event_id = $2::text,
              integration_epoch = $3::text,
              last_reconciled_at = $4::timestamptz,
              external_sync_failed_at = $5::timestamptz
        where id = $6::uuid`,
      [
        opts.externalCalendarId ?? 'primary',
        opts.externalEventId,
        opts.integrationEpoch,
        opts.lastReconciledAt,
        opts.externalSyncFailedAt,
        slotId,
      ],
    )
  }
  return slotId
}

type FakeEventMap = Record<string, FetchEventOutcome>

function makeFetcher(map: FakeEventMap): ReconcileFetchImpl {
  return async (opts) => {
    const outcome = map[opts.eventId]
    if (!outcome) {
      throw new Error(
        `fake fetcher had no mapping for event ${opts.eventId}`,
      )
    }
    return outcome
  }
}

function googleEvent(opts: {
  id: string
  status?: 'confirmed' | 'cancelled' | 'tentative'
  lcEpoch?: string
}): FetchEventOutcome {
  return {
    ok: true,
    event: {
      id: opts.id,
      status: opts.status ?? 'confirmed',
      start: { dateTime: '2026-06-01T10:00:00Z' },
      end: { dateTime: '2026-06-01T11:00:00Z' },
      extendedProperties: opts.lcEpoch
        ? { shared: { lc_epoch: opts.lcEpoch, lc_origin: 'levelchannel' } }
        : undefined,
    },
  }
}

async function readSlot(id: string) {
  const r = await getDbPool().query(
    `select external_event_id, external_calendar_id, integration_epoch,
            last_reconciled_at, external_sync_failed_at, status
       from lesson_slots where id = $1`,
    [id],
  )
  return r.rows[0] as {
    external_event_id: string | null
    external_calendar_id: string | null
    integration_epoch: string | null
    last_reconciled_at: string | null
    external_sync_failed_at: string | null
    status: string
  }
}

async function countPushJobs(slotId: string): Promise<number> {
  const r = await getDbPool().query(
    `select count(*)::int as n from calendar_push_jobs
      where slot_id = $1 and kind = 'delete'`,
    [slotId],
  )
  return Number(r.rows[0].n)
}

describe('runReconcileSweep — booked branches', () => {
  it('booked + 200 + epoch match → healthy: bumps reconciled_at, leaves binding', async () => {
    const t = await makeTeacher('rec1@example.com')
    const epoch = await connect(t)
    const slot = await seedSlot({
      teacherId: t,
      status: 'booked',
      externalEventId: 'evt-healthy',
      integrationEpoch: epoch,
    })
    const fetcher = makeFetcher({
      'evt-healthy': googleEvent({ id: 'evt-healthy', lcEpoch: epoch }),
    })

    const res = await runReconcileSweep({ fetchEventImpl: fetcher })

    expect(res.picked).toBe(1)
    expect(res.outcomes).toEqual({ healthy: 1 })
    const after = await readSlot(slot)
    expect(after.external_event_id).toBe('evt-healthy')
    expect(after.last_reconciled_at).not.toBeNull()
    expect(after.external_sync_failed_at).toBeNull()
  })

  it('booked + 200 + epoch mismatch → orphan_self: bumps reconciled_at, leaves binding', async () => {
    const t = await makeTeacher('rec2@example.com')
    const epoch = await connect(t)
    const slot = await seedSlot({
      teacherId: t,
      status: 'booked',
      externalEventId: 'evt-orphan',
      integrationEpoch: epoch,
    })
    const fetcher = makeFetcher({
      'evt-orphan': googleEvent({
        id: 'evt-orphan',
        lcEpoch: 'totally-different-epoch',
      }),
    })

    const res = await runReconcileSweep({ fetchEventImpl: fetcher })

    expect(res.outcomes).toEqual({ orphan_self: 1 })
    const after = await readSlot(slot)
    expect(after.external_event_id).toBe('evt-orphan')
    expect(after.integration_epoch).toBe(epoch)
    expect(after.last_reconciled_at).not.toBeNull()
  })

  it('booked + 404 → unbinds + sets external_sync_failed_at', async () => {
    const t = await makeTeacher('rec3@example.com')
    const epoch = await connect(t)
    const slot = await seedSlot({
      teacherId: t,
      status: 'booked',
      externalEventId: 'evt-gone',
      integrationEpoch: epoch,
    })
    const fetcher = makeFetcher({
      'evt-gone': { ok: false, reason: 'not_found' },
    })

    const res = await runReconcileSweep({ fetchEventImpl: fetcher })

    expect(res.outcomes).toEqual({ unbound_after_sync_failure: 1 })
    const after = await readSlot(slot)
    expect(after.external_event_id).toBeNull()
    expect(after.external_calendar_id).toBeNull()
    expect(after.integration_epoch).toBeNull()
    expect(after.external_sync_failed_at).not.toBeNull()
  })

  it('booked + 200 status=cancelled (Google tombstone) → unbinds + sets sync_failed_at', async () => {
    const t = await makeTeacher('rec4@example.com')
    const epoch = await connect(t)
    const slot = await seedSlot({
      teacherId: t,
      status: 'booked',
      externalEventId: 'evt-tombstone',
      integrationEpoch: epoch,
    })
    const fetcher = makeFetcher({
      'evt-tombstone': googleEvent({
        id: 'evt-tombstone',
        status: 'cancelled',
        lcEpoch: epoch,
      }),
    })

    const res = await runReconcileSweep({ fetchEventImpl: fetcher })

    expect(res.outcomes).toEqual({ unbound_after_sync_failure: 1 })
    const after = await readSlot(slot)
    expect(after.external_event_id).toBeNull()
    expect(after.external_sync_failed_at).not.toBeNull()
  })
})

describe('runReconcileSweep — cancelled branches', () => {
  it('cancelled + 200 + no prior job → enqueues delete push job', async () => {
    const t = await makeTeacher('rec5@example.com')
    const epoch = await connect(t)
    const slot = await seedSlot({
      teacherId: t,
      status: 'cancelled',
      externalEventId: 'evt-still-there',
      integrationEpoch: epoch,
    })
    const fetcher = makeFetcher({
      'evt-still-there': googleEvent({
        id: 'evt-still-there',
        lcEpoch: epoch,
      }),
    })

    const res = await runReconcileSweep({ fetchEventImpl: fetcher })

    expect(res.outcomes).toEqual({ cancel_reenqueued: 1 })
    expect(await countPushJobs(slot)).toBe(1)
    const after = await readSlot(slot)
    expect(after.last_reconciled_at).not.toBeNull()
  })

  it('cancelled + 200 + already-pending push job → skipped/inflight, no new job', async () => {
    const t = await makeTeacher('rec6@example.com')
    const epoch = await connect(t)
    const slot = await seedSlot({
      teacherId: t,
      status: 'cancelled',
      externalEventId: 'evt-inflight',
      integrationEpoch: epoch,
    })
    // Pre-seed a pending delete push job.
    await getDbPool().query(
      `insert into calendar_push_jobs
         (slot_id, teacher_account_id, kind, payload, status)
       values ($1, $2, 'delete', '{"write_calendar_id":"primary"}'::jsonb,
               'pending')`,
      [slot, t],
    )

    const fetcher = makeFetcher({
      'evt-inflight': googleEvent({ id: 'evt-inflight', lcEpoch: epoch }),
    })

    const res = await runReconcileSweep({ fetchEventImpl: fetcher })

    expect(res.outcomes).toEqual({
      'cancel_gate_skipped:inflight': 1,
    })
    expect(await countPushJobs(slot)).toBe(1) // pre-seeded only
  })

  it('cancelled + 404 → drift resolved: unbinds, no sync_failed flag', async () => {
    const t = await makeTeacher('rec7@example.com')
    const epoch = await connect(t)
    const slot = await seedSlot({
      teacherId: t,
      status: 'cancelled',
      externalEventId: 'evt-drift-gone',
      integrationEpoch: epoch,
    })

    const fetcher = makeFetcher({
      'evt-drift-gone': { ok: false, reason: 'not_found' },
    })

    const res = await runReconcileSweep({ fetchEventImpl: fetcher })

    expect(res.outcomes).toEqual({ unbound_after_drift_resolved: 1 })
    const after = await readSlot(slot)
    expect(after.external_event_id).toBeNull()
    expect(after.external_calendar_id).toBeNull()
    expect(after.integration_epoch).toBeNull()
    expect(after.external_sync_failed_at).toBeNull()
  })
})

describe('runReconcileSweep — transient failures', () => {
  it('skips on rate_limited without bumping reconciled_at', async () => {
    const t = await makeTeacher('rec8@example.com')
    const epoch = await connect(t)
    const slot = await seedSlot({
      teacherId: t,
      status: 'booked',
      externalEventId: 'evt-429',
      integrationEpoch: epoch,
    })
    const fetcher = makeFetcher({
      'evt-429': { ok: false, reason: 'rate_limited' },
    })

    const res = await runReconcileSweep({ fetchEventImpl: fetcher })

    expect(res.outcomes).toEqual({ skipped_rate_limited: 1 })
    const after = await readSlot(slot)
    expect(after.external_event_id).toBe('evt-429') // binding intact
    expect(after.last_reconciled_at).toBeNull() // NOT bumped
  })

  it('skips on server_error and surfaces the status code in detail', async () => {
    const t = await makeTeacher('rec9@example.com')
    const epoch = await connect(t)
    const slot = await seedSlot({
      teacherId: t,
      status: 'booked',
      externalEventId: 'evt-503',
      integrationEpoch: epoch,
    })
    const fetcher = makeFetcher({
      'evt-503': { ok: false, reason: 'server_error', status: 503 },
    })

    const res = await runReconcileSweep({ fetchEventImpl: fetcher })

    expect(res.outcomes).toEqual({ skipped_server_error: 1 })
    expect(res.details[0]?.outcome).toEqual({
      kind: 'skipped_server_error',
      status: 503,
    })
    const after = await readSlot(slot)
    expect(after.last_reconciled_at).toBeNull()
  })
})

describe('runReconcileSweep — bounded ordering', () => {
  it('respects the LIMIT and prioritises cancelled-with-binding first', async () => {
    const t = await makeTeacher('rec10@example.com')
    const epoch = await connect(t)

    const booked1 = await seedSlot({
      teacherId: t,
      status: 'booked',
      externalEventId: 'evt-b1',
      integrationEpoch: epoch,
      startOffsetDays: 9,
    })
    const cancelled = await seedSlot({
      teacherId: t,
      status: 'cancelled',
      externalEventId: 'evt-c',
      integrationEpoch: epoch,
      startOffsetDays: 12,
    })
    const booked2 = await seedSlot({
      teacherId: t,
      status: 'booked',
      externalEventId: 'evt-b2',
      integrationEpoch: epoch,
      startOffsetDays: 11,
    })

    const fetcher = makeFetcher({
      'evt-b1': googleEvent({ id: 'evt-b1', lcEpoch: epoch }),
      'evt-b2': googleEvent({ id: 'evt-b2', lcEpoch: epoch }),
      'evt-c': googleEvent({ id: 'evt-c', lcEpoch: epoch }),
    })

    const res = await runReconcileSweep({ limit: 2, fetchEventImpl: fetcher })

    expect(res.picked).toBe(2)
    // Cancelled is sort-key 0 so it's always in the first batch.
    const pickedIds = res.details.map((d) => d.slotId)
    expect(pickedIds).toContain(cancelled)
    // Then booked1 (earlier start) before booked2.
    expect(pickedIds).toContain(booked1)
    expect(pickedIds).not.toContain(booked2)
  })
})
