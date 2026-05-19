import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { POST as adminCancelHandler } from '@/app/api/admin/slots/[id]/cancel/route'
import { POST as dismissConflictHandler } from '@/app/api/admin/slots/[id]/dismiss-conflict/route'
import { POST as loginHandler } from '@/app/api/auth/login/route'
import { POST as registerHandler } from '@/app/api/auth/register/route'
import {
  countAdminConflicts,
  isAuditTablePresent,
  listAdminConflicts,
} from '@/lib/admin/conflict-feed'
import {
  createAccount,
  getAccountByEmail,
  grantAccountRole,
  markAccountVerified,
  normalizeAccountEmail,
} from '@/lib/auth/accounts'
import { hashPassword } from '@/lib/auth/password'
import { upsertAccountProfile } from '@/lib/auth/profiles'
import { getDbPool } from '@/lib/db/pool'

import '../setup'
import { buildRequest, extractSessionCookie, futureSlotIso } from '../helpers'

// BCS-DEF-2 — integration tests for the conflict-feed dashboard.
//
// Plan: docs/plans/conflict-feed.md §4.5 (round-3 SIGN-OFF, 2026-05-19).
//
// Coverage (per §4.5):
//   * listAdminConflicts filter shape (status='booked', 30-day window,
//     cross-teacher ORDER BY).
//   * countAdminConflicts matches list + ignores cancelled-stale rows.
//   * dismiss-conflict happy path + auth + reason invariant + atomic
//     UPDATE + audit row.
//   * dismiss-conflict 42P01 SAVEPOINT recovery (canary for round-1
//     BLOCKER#1 closure).
//   * cancel + fromConflict happy path (status + stamp cleared + audit row).
//   * cancel + fromConflict + 42P01 (cleanup-TX SAVEPOINT recovery).
//   * cancel WITHOUT fromConflict — no audit row, no stamp-clearing
//     (regression — old caller behavior preserved).
//   * Schema CHECK rejects unknown action values.
//   * Migration-pending probe response shape.

const SLOT_ADMIN_ACTIONS_DDL = `
  create table if not exists slot_admin_actions (
    id uuid primary key default gen_random_uuid(),
    slot_id uuid not null references lesson_slots(id) on delete cascade,
    operator_account_id uuid not null references accounts(id) on delete restrict,
    action text not null check (action in (
      'dismiss-conflict',
      'cancel-from-conflict'
    )),
    reason text null,
    payload jsonb null,
    performed_at timestamptz not null default now()
  );

  create index if not exists slot_admin_actions_slot_idx
    on slot_admin_actions (slot_id, performed_at desc);
  create index if not exists slot_admin_actions_operator_idx
    on slot_admin_actions (operator_account_id, performed_at desc);
  create index if not exists lesson_slots_external_conflict_admin_idx
    on lesson_slots (external_conflict_at desc)
    where external_conflict_at is not null
      and status = 'booked';
`

// The shared truncate in tests/integration/setup.ts doesn't list
// slot_admin_actions (migration 0062 lands after the harness was
// written). Each test starts with the table re-created from the
// migration DDL inline — so a `drop table` test scenario remains
// reversible.
beforeEach(async () => {
  await getDbPool().query(SLOT_ADMIN_ACTIONS_DDL)
  await getDbPool().query(
    `truncate table slot_admin_actions restart identity cascade`,
  )
})

afterEach(async () => {
  // Always re-create the table so the next test's `beforeEach` is
  // idempotent even if a test dropped it.
  await getDbPool().query(SLOT_ADMIN_ACTIONS_DDL)
})

async function makeAdmin(prefix: string): Promise<{ cookie: string; accountId: string }> {
  const email = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
  await registerHandler(
    buildRequest('/api/auth/register', {
      body: { email, password: 'StrongPassword123', personalDataConsentAccepted: true },
    }),
  )
  const acc = await getAccountByEmail(email)
  await markAccountVerified(acc!.id)
  await grantAccountRole(acc!.id, 'admin', null)
  const login = await loginHandler(
    buildRequest('/api/auth/login', { body: { email, password: 'StrongPassword123' } }),
  )
  return {
    cookie: extractSessionCookie(login.headers.get('Set-Cookie'))!,
    accountId: acc!.id,
  }
}

async function makeLearner(
  prefix: string,
): Promise<{ cookie: string; accountId: string }> {
  const email = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
  await registerHandler(
    buildRequest('/api/auth/register', {
      body: { email, password: 'StrongPassword123', personalDataConsentAccepted: true },
    }),
  )
  const acc = await getAccountByEmail(email)
  await markAccountVerified(acc!.id)
  const login = await loginHandler(
    buildRequest('/api/auth/login', { body: { email, password: 'StrongPassword123' } }),
  )
  return {
    cookie: extractSessionCookie(login.headers.get('Set-Cookie'))!,
    accountId: acc!.id,
  }
}

async function makeTeacher(prefix: string): Promise<string> {
  const email = normalizeAccountEmail(
    `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`,
  )
  const account = await createAccount({
    email,
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

type SeedSlotOpts = {
  teacherId: string
  learnerId?: string | null
  status?: 'booked' | 'open' | 'cancelled'
  conflictAt?: Date | null
  startAtIso?: string
  durationMinutes?: number
  conflictKind?: string | null
  calId?: string | null
  eventId?: string | null
}

let slotNonce = 0
async function seedSlot(opts: SeedSlotOpts): Promise<string> {
  slotNonce += 1
  const pool = getDbPool()
  const startAt = opts.startAtIso ?? futureSlotIso(60 * 24 + slotNonce * 30)
  const r = await pool.query(
    `insert into lesson_slots
       (id, teacher_account_id, start_at, duration_minutes, status,
        learner_account_id, booked_at,
        external_conflict_at, external_conflict_kind,
        conflict_source_calendar_id, conflict_source_event_id)
     values (gen_random_uuid(), $1, $2::timestamptz, $3, $4,
             $5, case when $4 = 'booked' then now() else null end,
             $6::timestamptz, $7, $8, $9)
     returning id`,
    [
      opts.teacherId,
      startAt,
      opts.durationMinutes ?? 60,
      opts.status ?? 'booked',
      opts.learnerId ?? opts.teacherId,
      opts.conflictAt ? opts.conflictAt.toISOString() : null,
      opts.conflictKind ?? (opts.conflictAt ? 'post_book_overlap' : null),
      opts.calId ?? (opts.conflictAt ? 'primary' : null),
      opts.eventId ?? (opts.conflictAt ? `evt-${slotNonce}` : null),
    ],
  )
  return String(r.rows[0].id)
}

async function getSlotRow(slotId: string) {
  const r = await getDbPool().query(
    `select status, external_conflict_at, external_conflict_kind,
            conflict_source_calendar_id, conflict_source_event_id,
            events
       from lesson_slots
      where id = $1`,
    [slotId],
  )
  return r.rows[0]
}

async function countAuditRows(opts: { slotId?: string; action?: string }) {
  const where: string[] = []
  const params: unknown[] = []
  if (opts.slotId) {
    params.push(opts.slotId)
    where.push(`slot_id = $${params.length}`)
  }
  if (opts.action) {
    params.push(opts.action)
    where.push(`action = $${params.length}`)
  }
  const sql = `select count(*)::int as n from slot_admin_actions${where.length ? ` where ${where.join(' and ')}` : ''}`
  const r = await getDbPool().query(sql, params)
  return Number(r.rows[0]?.n ?? 0)
}

describe('lib/admin/conflict-feed.ts — listAdminConflicts', () => {
  it('returns only booked slots with non-null external_conflict_at in the window', async () => {
    const teacherId = await makeTeacher('cf-list-1')
    // Booked + stamped → included.
    const includedId = await seedSlot({
      teacherId,
      conflictAt: new Date(),
    })
    // Booked + no stamp → excluded.
    await seedSlot({ teacherId, conflictAt: null })
    // Cancelled + still-stamped (zombie row simulating pre-wave data)
    // → excluded by status filter.
    await seedSlot({
      teacherId,
      status: 'cancelled',
      conflictAt: new Date(),
    })

    const conflicts = await listAdminConflicts({
      since: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    })
    const ids = conflicts.map((c) => c.slotId)
    expect(ids).toEqual([includedId])
  })

  it('30-day window excludes older stamps; window=null returns all-time', async () => {
    const teacherId = await makeTeacher('cf-list-2')
    const oldStamp = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000)
    const oldId = await seedSlot({ teacherId, conflictAt: oldStamp })
    const freshId = await seedSlot({ teacherId, conflictAt: new Date() })

    const windowed = await listAdminConflicts({
      since: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    })
    expect(windowed.map((c) => c.slotId)).toEqual([freshId])

    const all = await listAdminConflicts({ since: null })
    expect(all.map((c) => c.slotId).sort()).toEqual([freshId, oldId].sort())
  })

  it('an OPEN slot with a stamp manually injected is excluded by the status filter', async () => {
    const teacherId = await makeTeacher('cf-list-3')
    // Detector never stamps open slots in production; this test
    // documents that the dashboard never surfaces such a row even if
    // someone bypasses the detector.
    const slotId = await seedSlot({
      teacherId,
      status: 'open',
      learnerId: null,
      conflictAt: new Date(),
    })
    const list = await listAdminConflicts({ since: null })
    expect(list.find((c) => c.slotId === slotId)).toBeUndefined()
  })
})

describe('lib/admin/conflict-feed.ts — countAdminConflicts', () => {
  it('matches the list count and excludes cancelled-but-stamped rows', async () => {
    const teacherId = await makeTeacher('cf-count-1')
    await seedSlot({ teacherId, conflictAt: new Date() })
    await seedSlot({ teacherId, conflictAt: new Date() })
    // Cancelled-stamped (zombie) — must be excluded.
    await seedSlot({
      teacherId,
      status: 'cancelled',
      conflictAt: new Date(),
    })

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const n = await countAdminConflicts({ since })
    const list = await listAdminConflicts({ since })
    expect(n).toBe(2)
    expect(list.length).toBe(2)
  })
})

describe('POST /api/admin/slots/[id]/dismiss-conflict', () => {
  it('anonymous → 401', async () => {
    const teacherId = await makeTeacher('cf-anon')
    const slotId = await seedSlot({ teacherId, conflictAt: new Date() })
    const res = await dismissConflictHandler(
      buildRequest(`/api/admin/slots/${slotId}/dismiss-conflict`, {
        body: { reason: 'test' },
        headers: { 'Idempotency-Key': `idem-${Date.now()}-anon` },
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    expect(res.status).toBe(401)
  })

  it('learner → 403', async () => {
    const teacherId = await makeTeacher('cf-learner-teacher')
    const slotId = await seedSlot({ teacherId, conflictAt: new Date() })
    const learner = await makeLearner('cf-learner')
    const res = await dismissConflictHandler(
      buildRequest(`/api/admin/slots/${slotId}/dismiss-conflict`, {
        cookie: learner.cookie,
        body: { reason: 'test reason' },
        headers: { 'Idempotency-Key': `idem-${Date.now()}-l` },
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    expect(res.status).toBe(403)
  })

  it('reason missing → 400 reason_required', async () => {
    const admin = await makeAdmin('cf-reason-required')
    const teacherId = await makeTeacher('cf-reason-required-teacher')
    const slotId = await seedSlot({ teacherId, conflictAt: new Date() })
    const res = await dismissConflictHandler(
      buildRequest(`/api/admin/slots/${slotId}/dismiss-conflict`, {
        cookie: admin.cookie,
        body: { reason: '' },
        headers: { 'Idempotency-Key': `idem-${Date.now()}-rr` },
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('reason_required')
  })

  it('happy path clears the 4 columns, writes audit row + slot.events entry', async () => {
    const admin = await makeAdmin('cf-happy')
    const teacherId = await makeTeacher('cf-happy-teacher')
    const conflictAt = new Date()
    const slotId = await seedSlot({
      teacherId,
      conflictAt,
      conflictKind: 'post_book_overlap',
      calId: 'cal-123',
      eventId: 'evt-456',
    })

    const res = await dismissConflictHandler(
      buildRequest(`/api/admin/slots/${slotId}/dismiss-conflict`, {
        cookie: admin.cookie,
        body: { reason: 'разрулил вручную с учителем' },
        headers: { 'Idempotency-Key': `idem-${Date.now()}-h` },
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    expect(res.status).toBe(200)

    const row = await getSlotRow(slotId)
    expect(row.external_conflict_at).toBeNull()
    expect(row.external_conflict_kind).toBeNull()
    expect(row.conflict_source_calendar_id).toBeNull()
    expect(row.conflict_source_event_id).toBeNull()

    const events = Array.isArray(row.events) ? row.events : []
    const dismissedEvent = events.find(
      (e: unknown) =>
        typeof e === 'object' &&
        e !== null &&
        (e as { type?: string }).type === 'slot.conflict_dismissed',
    )
    expect(dismissedEvent).toBeDefined()

    const auditRows = await getDbPool().query(
      `select action, reason, operator_account_id, payload
         from slot_admin_actions
        where slot_id = $1`,
      [slotId],
    )
    expect(auditRows.rows.length).toBe(1)
    expect(auditRows.rows[0].action).toBe('dismiss-conflict')
    expect(auditRows.rows[0].reason).toBe('разрулил вручную с учителем')
    expect(String(auditRows.rows[0].operator_account_id)).toBe(admin.accountId)
    expect(auditRows.rows[0].payload).toMatchObject({
      pre_conflict_kind: 'post_book_overlap',
      pre_cal_id: 'cal-123',
      pre_event_id: 'evt-456',
    })
  })

  it('already-cleared slot → 404 not_found_or_no_conflict (no audit row)', async () => {
    const admin = await makeAdmin('cf-already')
    const teacherId = await makeTeacher('cf-already-teacher')
    // No conflict stamp on this booked slot.
    const slotId = await seedSlot({ teacherId, conflictAt: null })
    const res = await dismissConflictHandler(
      buildRequest(`/api/admin/slots/${slotId}/dismiss-conflict`, {
        cookie: admin.cookie,
        body: { reason: 'attempt anyway' },
        headers: { 'Idempotency-Key': `idem-${Date.now()}-ac` },
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    expect(res.status).toBe(404)
    expect(await countAuditRows({ slotId })).toBe(0)
  })

  it('sequential same-key replay does not write a second audit row', async () => {
    const admin = await makeAdmin('cf-idem')
    const teacherId = await makeTeacher('cf-idem-teacher')
    const slotId = await seedSlot({ teacherId, conflictAt: new Date() })
    const key = `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`

    const first = await dismissConflictHandler(
      buildRequest(`/api/admin/slots/${slotId}/dismiss-conflict`, {
        cookie: admin.cookie,
        body: { reason: 'first attempt' },
        headers: { 'Idempotency-Key': key },
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    expect(first.status).toBe(200)

    const second = await dismissConflictHandler(
      buildRequest(`/api/admin/slots/${slotId}/dismiss-conflict`, {
        cookie: admin.cookie,
        body: { reason: 'first attempt' },
        headers: { 'Idempotency-Key': key },
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    expect(second.status).toBe(200)
    // The atomic UPDATE returns 0 rows on the replay (stamp already
    // cleared); the audit INSERT is gated on result.rows.length > 0
    // — but the idempotency cache returns the original 200 body.
    // Either way: exactly one audit row.
    expect(await countAuditRows({ slotId })).toBe(1)
  })

  it('race: two operators with different keys — atomic UPDATE serializes; one 404s', async () => {
    const adminA = await makeAdmin('cf-raceA')
    const adminB = await makeAdmin('cf-raceB')
    const teacherId = await makeTeacher('cf-race-teacher')
    const slotId = await seedSlot({ teacherId, conflictAt: new Date() })

    const resA = await dismissConflictHandler(
      buildRequest(`/api/admin/slots/${slotId}/dismiss-conflict`, {
        cookie: adminA.cookie,
        body: { reason: 'A acts first' },
        headers: { 'Idempotency-Key': `idem-${Date.now()}-A` },
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    const resB = await dismissConflictHandler(
      buildRequest(`/api/admin/slots/${slotId}/dismiss-conflict`, {
        cookie: adminB.cookie,
        body: { reason: 'B races' },
        headers: { 'Idempotency-Key': `idem-${Date.now()}-B` },
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    const statuses = [resA.status, resB.status].sort()
    expect(statuses).toEqual([200, 404])
    // Exactly one audit row.
    expect(await countAuditRows({ slotId, action: 'dismiss-conflict' })).toBe(1)
  })

  it('42P01 SAVEPOINT recovery: drop slot_admin_actions → UPDATE still commits', async () => {
    const admin = await makeAdmin('cf-42p01')
    const teacherId = await makeTeacher('cf-42p01-teacher')
    const slotId = await seedSlot({ teacherId, conflictAt: new Date() })

    // Drop the audit table to simulate deploy-before-migrate.
    await getDbPool().query(`drop table if exists slot_admin_actions`)

    try {
      const res = await dismissConflictHandler(
        buildRequest(`/api/admin/slots/${slotId}/dismiss-conflict`, {
          cookie: admin.cookie,
          body: { reason: 'still works without audit table' },
          headers: { 'Idempotency-Key': `idem-${Date.now()}-42p` },
        }),
        { params: Promise.resolve({ id: slotId }) },
      )
      expect(res.status).toBe(200)

      const row = await getSlotRow(slotId)
      // The UPDATE committed even though the audit INSERT raised 42P01.
      expect(row.external_conflict_at).toBeNull()
      // isAuditTablePresent agrees.
      expect(await isAuditTablePresent()).toBe(false)
    } finally {
      // afterEach re-creates the table.
    }
  })
})

describe('POST /api/admin/slots/[id]/cancel — fromConflict branch', () => {
  it('cancel + fromConflict: status flips, stamps cleared, audit row written', async () => {
    const admin = await makeAdmin('cf-cancel-happy')
    const teacherId = await makeTeacher('cf-cancel-teacher')
    const slotId = await seedSlot({
      teacherId,
      conflictAt: new Date(),
      conflictKind: 'post_book_overlap',
      calId: 'cal-xyz',
      eventId: 'evt-xyz',
    })

    const res = await adminCancelHandler(
      buildRequest(`/api/admin/slots/${slotId}/cancel`, {
        cookie: admin.cookie,
        body: { reason: 'оператор отменил из ленты', fromConflict: true },
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    expect(res.status).toBe(200)

    const row = await getSlotRow(slotId)
    expect(String(row.status)).toBe('cancelled')
    expect(row.external_conflict_at).toBeNull()
    expect(row.external_conflict_kind).toBeNull()

    // events jsonb gets the canonical slot.cancelled entry from
    // cancelSlot() (in-TX with the status flip).
    const events = Array.isArray(row.events) ? row.events : []
    expect(
      events.find(
        (e: unknown) =>
          typeof e === 'object' &&
          e !== null &&
          (e as { type?: string }).type === 'slot.cancelled',
      ),
    ).toBeDefined()

    // Secondary audit row written.
    expect(await countAuditRows({ slotId, action: 'cancel-from-conflict' })).toBe(1)
  })

  it('cancel + fromConflict missing reason → 400 reason_required (slot still booked)', async () => {
    const admin = await makeAdmin('cf-cancel-no-reason')
    const teacherId = await makeTeacher('cf-cancel-no-reason-teacher')
    const slotId = await seedSlot({ teacherId, conflictAt: new Date() })

    const res = await adminCancelHandler(
      buildRequest(`/api/admin/slots/${slotId}/cancel`, {
        cookie: admin.cookie,
        body: { fromConflict: true },
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('reason_required')

    // Slot is STILL booked + stamped.
    const row = await getSlotRow(slotId)
    expect(String(row.status)).toBe('booked')
    expect(row.external_conflict_at).not.toBeNull()
  })

  it('cancel WITHOUT fromConflict — no audit row, no stamp clearing (regression)', async () => {
    const admin = await makeAdmin('cf-cancel-old')
    const teacherId = await makeTeacher('cf-cancel-old-teacher')
    const slotId = await seedSlot({
      teacherId,
      conflictAt: new Date(),
    })

    const res = await adminCancelHandler(
      buildRequest(`/api/admin/slots/${slotId}/cancel`, {
        cookie: admin.cookie,
        body: { reason: 'обычный кэнсел' },
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    expect(res.status).toBe(200)
    const row = await getSlotRow(slotId)
    expect(String(row.status)).toBe('cancelled')
    // Old-caller contract: stamp is NOT cleared post-commit.
    expect(row.external_conflict_at).not.toBeNull()
    // No audit row.
    expect(await countAuditRows({ slotId })).toBe(0)
  })

  it('cancel + fromConflict + audit table missing (42P01): cancel + stamp-clear still succeed', async () => {
    const admin = await makeAdmin('cf-cancel-42p')
    const teacherId = await makeTeacher('cf-cancel-42p-teacher')
    const slotId = await seedSlot({ teacherId, conflictAt: new Date() })

    await getDbPool().query(`drop table if exists slot_admin_actions`)
    try {
      const res = await adminCancelHandler(
        buildRequest(`/api/admin/slots/${slotId}/cancel`, {
          cookie: admin.cookie,
          body: { reason: 'cancel via dashboard', fromConflict: true },
        }),
        { params: Promise.resolve({ id: slotId }) },
      )
      // Cancel itself committed.
      expect(res.status).toBe(200)
      const row = await getSlotRow(slotId)
      expect(String(row.status)).toBe('cancelled')
      // Cleanup TX cleared the stamp (UPDATE half committed; audit
      // INSERT recovered via SAVEPOINT).
      expect(row.external_conflict_at).toBeNull()
    } finally {
      // afterEach re-creates the table.
    }
  })

  it('countAdminConflicts is 0 after a booked-stamped row is cancel-from-conflict-ed', async () => {
    const admin = await makeAdmin('cf-pin-blocker3')
    const teacherId = await makeTeacher('cf-pin-blocker3-teacher')
    const slotId = await seedSlot({ teacherId, conflictAt: new Date() })

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    expect(await countAdminConflicts({ since })).toBe(1)

    const res = await adminCancelHandler(
      buildRequest(`/api/admin/slots/${slotId}/cancel`, {
        cookie: admin.cookie,
        body: { reason: 'closes round-1 BLOCKER#3 e2e', fromConflict: true },
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    expect(res.status).toBe(200)
    // The stamp was cleared by the cleanup TX → badge decrements.
    expect(await countAdminConflicts({ since })).toBe(0)
  })
})

describe('slot_admin_actions schema CHECK', () => {
  it('rejects an unknown action value (e.g. move-from-conflict)', async () => {
    const teacherId = await makeTeacher('cf-check')
    const adminAccountId = (await makeAdmin('cf-check-admin')).accountId
    const slotId = await seedSlot({ teacherId, conflictAt: new Date() })

    await expect(
      getDbPool().query(
        `insert into slot_admin_actions
           (slot_id, operator_account_id, action, reason)
         values ($1, $2, 'move-from-conflict', 'should reject')`,
        [slotId, adminAccountId],
      ),
    ).rejects.toMatchObject({ code: '23514' }) // CHECK violation.
  })
})

describe('isAuditTablePresent', () => {
  it('returns true when migration 0062 has been applied', async () => {
    expect(await isAuditTablePresent()).toBe(true)
  })

  it('returns false when the table is missing', async () => {
    await getDbPool().query(`drop table if exists slot_admin_actions`)
    try {
      expect(await isAuditTablePresent()).toBe(false)
    } finally {
      // afterEach re-creates the table.
    }
  })
})
