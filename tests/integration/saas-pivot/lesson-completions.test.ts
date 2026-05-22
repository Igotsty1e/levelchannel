import { describe, expect, it } from 'vitest'

import { getDbPool } from '@/lib/db/pool'
import {
  CancelAfterCompletionError,
  cancelSlot,
} from '@/lib/scheduling/slots'
import {
  LessonCompletionEligibilityError,
  markLessonCompleted,
} from '@/lib/teacher-ledger/mark-lesson-completed'

import '../setup'

// SAAS-PIVOT Epic 5A Day 5A — lesson_completions integration tests.
//
// Plan: docs/plans/saas-pivot-master.md §2.6 + §5 Day 5A.
//
// Covers:
//   - Forward trigger flips slot status on insert (completed /
//     no_show_learner).
//   - Reverse trigger flips slot status back to booked on delete.
//   - 48h immutability gate (BEFORE DELETE trigger).
//   - Settlement guard (BEFORE DELETE trigger).
//   - Earnings guard (BEFORE DELETE trigger).
//   - Helper anti-spoof (teacherId mismatch).
//   - Helper future-slot rejection.
//   - Helper idempotency (second call → created=false).
//   - cancelSlot rejects when status is completed / no_show_learner.
//   - cancel works again after un-mark (delete completion).

async function freshAccount(prefix: string): Promise<string> {
  const email =
    `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`.toLowerCase()
  const result = await getDbPool().query<{ id: string }>(
    `insert into accounts (email, password_hash)
     values ($1, 'fake-hash-for-test')
     returning id`,
    [email],
  )
  return result.rows[0].id
}

// Insert a booked, past-ended lesson_slot for the (teacher, learner)
// pair. The CHECK constraint on start_at refuses past values, so we
// INSERT a future-band slot and then UPDATE-stamp it into the past.
async function freshPastBookedSlot(
  teacherId: string,
  learnerId: string,
  tariffAmountKopecks: number = 150000,
): Promise<string> {
  const pool = getDbPool()
  // Tariff for the amount snapshot.
  const tariff = await pool.query<{ id: string }>(
    `insert into pricing_tariffs (slug, title_ru, amount_kopecks, duration_minutes)
     values ('saas5a-' || floor(random()*1e9)::text, 'SaaS-5A test tariff', $1, 60)
     returning id`,
    [tariffAmountKopecks],
  )
  // Pick a unique future minute to dodge the (teacher, start_at) unique
  // constraint across tests.
  const futureMs = Date.now() + 60 * 60_000 * (1 + Math.floor(Math.random() * 1000))
  const futureBand = new Date(futureMs)
  // Snap to 30-min boundary + MSK band (06:00-22:00). Use the same
  // 7-day-ahead anchor pattern as helpers.futureSlotIso; here we
  // simplify with a fixed +7d 12:00 MSK slot then shift by random
  // hour within band so multiple inserts don't collide.
  const today = new Date()
  const slotMsk = new Date(
    Date.UTC(
      today.getUTCFullYear(),
      today.getUTCMonth(),
      today.getUTCDate() + 7,
      // 06:00-22:00 MSK = 03:00-19:00 UTC. Pick within.
      3 + Math.floor(Math.random() * 16),
      Math.random() < 0.5 ? 0 : 30,
      0,
      0,
    ),
  )
  // 30-min duplicate guard: add (teacherId+random) salt minutes.
  const inserted = await pool.query<{ id: string }>(
    `insert into lesson_slots
       (teacher_account_id, start_at, duration_minutes, status,
        learner_account_id, booked_at, tariff_id)
     values ($1, $2, 60, 'booked', $3, now(), $4)
     returning id`,
    [teacherId, slotMsk.toISOString(), learnerId, tariff.rows[0].id],
  )
  // Now backdate the slot so end_at <= now(). The CHECK on start_at
  // only fires for the INSERT statement (`now()` is STABLE), and the
  // domain-invariants in mig 0031 reject out-of-band start_at on
  // UPDATE as well — so we land it at MSK 21:30 on the last business
  // day (a fixed past-band valid value) minus a fresh random day
  // offset so each test row gets a unique past slot.
  const pastMs = Date.now() - 24 * 60 * 60_000
  const pastAnchor = new Date(pastMs)
  pastAnchor.setUTCMinutes(30, 0, 0)
  // MSK 18:30 UTC = 21:30 MSK (within 06-22 band on a 30-min boundary).
  const pastUtc = new Date(
    Date.UTC(
      pastAnchor.getUTCFullYear(),
      pastAnchor.getUTCMonth(),
      pastAnchor.getUTCDate(),
      18,
      30,
      0,
      0,
    ),
  )
  // Use distinct minute-offsets to avoid (teacher, start_at) collision.
  pastUtc.setUTCMinutes(
    pastUtc.getUTCMinutes() - 30 * Math.floor(Math.random() * 200),
  )
  // Disable the domain-invariants trigger for the backdating UPDATE.
  // The lesson_slots row was validated on INSERT; the test backdate is
  // a fixture-only operation. We use SET session_replication_role
  // briefly so the CHECK is not re-evaluated.
  await pool.query(`set session session_replication_role = 'replica'`)
  try {
    await pool.query(
      `update lesson_slots set start_at = $2, duration_minutes = 60 where id = $1`,
      [inserted.rows[0].id, pastUtc.toISOString()],
    )
  } finally {
    await pool.query(`set session session_replication_role = 'origin'`)
  }
  return inserted.rows[0].id
}

describe('SAAS-PIVOT Day 5A — lesson_completions schema + triggers', () => {
  it('forward trigger: insert (was_no_show=false) flips slot status to completed', async () => {
    const teacherId = await freshAccount('5a-teacher-fwd')
    const learnerId = await freshAccount('5a-learner-fwd')
    const slotId = await freshPastBookedSlot(teacherId, learnerId)

    const pool = getDbPool()
    const client = await pool.connect()
    try {
      await client.query('begin')
      const result = await markLessonCompleted(client, {
        slotId,
        teacherId,
        wasNoShow: false,
        markedByAccountId: teacherId,
      })
      expect(result.created).toBe(true)
      await client.query('commit')
    } finally {
      client.release()
    }

    const slotStatus = await pool.query<{ status: string }>(
      `select status from lesson_slots where id = $1`,
      [slotId],
    )
    expect(slotStatus.rows[0].status).toBe('completed')
  })

  it('forward trigger: was_no_show=true flips slot status to no_show_learner', async () => {
    const teacherId = await freshAccount('5a-teacher-nshow')
    const learnerId = await freshAccount('5a-learner-nshow')
    const slotId = await freshPastBookedSlot(teacherId, learnerId)

    const pool = getDbPool()
    const client = await pool.connect()
    try {
      await client.query('begin')
      await markLessonCompleted(client, {
        slotId,
        teacherId,
        wasNoShow: true,
        markedByAccountId: teacherId,
      })
      await client.query('commit')
    } finally {
      client.release()
    }

    const slotStatus = await pool.query<{ status: string }>(
      `select status from lesson_slots where id = $1`,
      [slotId],
    )
    expect(slotStatus.rows[0].status).toBe('no_show_learner')
  })

  it('reverse trigger: delete completion flips slot status back to booked', async () => {
    const teacherId = await freshAccount('5a-teacher-rev')
    const learnerId = await freshAccount('5a-learner-rev')
    const slotId = await freshPastBookedSlot(teacherId, learnerId)
    const pool = getDbPool()
    const client = await pool.connect()
    let completionId: string
    try {
      await client.query('begin')
      const r = await markLessonCompleted(client, {
        slotId,
        teacherId,
        wasNoShow: false,
        markedByAccountId: teacherId,
      })
      completionId = r.completionId
      await client.query('commit')
    } finally {
      client.release()
    }

    await pool.query(`delete from lesson_completions where id = $1`, [
      completionId!,
    ])
    const slotStatus = await pool.query<{ status: string }>(
      `select status from lesson_slots where id = $1`,
      [slotId],
    )
    expect(slotStatus.rows[0].status).toBe('booked')
  })

  it('BEFORE DELETE: immutable_at set → trigger blocks delete', async () => {
    const teacherId = await freshAccount('5a-teacher-imm')
    const learnerId = await freshAccount('5a-learner-imm')
    const slotId = await freshPastBookedSlot(teacherId, learnerId)
    const pool = getDbPool()
    const client = await pool.connect()
    let completionId: string
    try {
      await client.query('begin')
      const r = await markLessonCompleted(client, {
        slotId,
        teacherId,
        wasNoShow: false,
        markedByAccountId: teacherId,
      })
      completionId = r.completionId
      await client.query('commit')
    } finally {
      client.release()
    }
    // Stamp immutable_at — emulate the 48h retention sweep.
    await pool.query(
      `update lesson_completions set immutable_at = now() where id = $1`,
      [completionId!],
    )
    await expect(
      pool.query(`delete from lesson_completions where id = $1`, [completionId!]),
    ).rejects.toThrow(/lesson_completions: immutability passed/)
  })

  it('BEFORE DELETE: settlement coverage → trigger blocks delete', async () => {
    const teacherId = await freshAccount('5a-teacher-stl')
    const learnerId = await freshAccount('5a-learner-stl')
    const slotId = await freshPastBookedSlot(teacherId, learnerId, 200000)
    const pool = getDbPool()
    const client = await pool.connect()
    let completionId: string
    try {
      await client.query('begin')
      const r = await markLessonCompleted(client, {
        slotId,
        teacherId,
        wasNoShow: false,
        markedByAccountId: teacherId,
      })
      completionId = r.completionId
      await client.query('commit')
    } finally {
      client.release()
    }
    // Manually insert a settlement + coverage row.
    const settlement = await pool.query<{ id: string }>(
      `insert into lesson_settlements
         (learner_account_id, teacher_id, amount_kopecks)
       values ($1, $2, 100000)
       returning id`,
      [learnerId, teacherId],
    )
    await pool.query(
      `insert into lesson_settlement_completions
         (settlement_id, completion_id, amount_kopecks)
       values ($1, $2, 100000)`,
      [settlement.rows[0].id, completionId!],
    )
    await expect(
      pool.query(`delete from lesson_completions where id = $1`, [completionId!]),
    ).rejects.toThrow(/settlement exists/)
  })

  it('BEFORE DELETE: teacher_earnings.related_completion_id → trigger blocks delete', async () => {
    const teacherId = await freshAccount('5a-teacher-earn')
    const learnerId = await freshAccount('5a-learner-earn')
    const slotId = await freshPastBookedSlot(teacherId, learnerId, 200000)
    const pool = getDbPool()
    const client = await pool.connect()
    let completionId: string
    try {
      await client.query('begin')
      const r = await markLessonCompleted(client, {
        slotId,
        teacherId,
        wasNoShow: false,
        markedByAccountId: teacherId,
      })
      completionId = r.completionId
      await client.query('commit')
    } finally {
      client.release()
    }
    await pool.query(
      `insert into teacher_earnings
         (teacher_account_id, kind, amount_net, related_completion_id)
       values ($1, 'accrued', 1500.00, $2)`,
      [teacherId, completionId!],
    )
    await expect(
      pool.query(`delete from lesson_completions where id = $1`, [completionId!]),
    ).rejects.toThrow(/earnings accrued/)
  })

  it('markLessonCompleted: wrong teacherId → eligibility error', async () => {
    const teacherId = await freshAccount('5a-teacher-spoof')
    const otherTeacherId = await freshAccount('5a-teacher-spoof-other')
    const learnerId = await freshAccount('5a-learner-spoof')
    const slotId = await freshPastBookedSlot(teacherId, learnerId)

    const pool = getDbPool()
    const client = await pool.connect()
    try {
      await client.query('begin')
      await expect(
        markLessonCompleted(client, {
          slotId,
          teacherId: otherTeacherId,
          wasNoShow: false,
          markedByAccountId: otherTeacherId,
        }),
      ).rejects.toThrow(LessonCompletionEligibilityError)
      await client.query('rollback')
    } finally {
      client.release()
    }
  })

  it('markLessonCompleted: future slot (end_at > now) → eligibility error', async () => {
    const teacherId = await freshAccount('5a-teacher-future')
    const learnerId = await freshAccount('5a-learner-future')
    const pool = getDbPool()
    const tariff = await pool.query<{ id: string }>(
      `insert into pricing_tariffs (slug, title_ru, amount_kopecks, duration_minutes)
       values ('saas5a-future-' || floor(random()*1e9)::text, 'fut', 150000, 60)
       returning id`,
    )
    // 2 days in the future, 12:00 UTC = 15:00 MSK (within band).
    const future = new Date(Date.now() + 2 * 24 * 60 * 60_000)
    future.setUTCHours(12, 0, 0, 0)
    // 30-min align
    future.setUTCMinutes(Math.random() < 0.5 ? 0 : 30, 0, 0)
    const slotResult = await pool.query<{ id: string }>(
      `insert into lesson_slots
         (teacher_account_id, start_at, duration_minutes, status,
          learner_account_id, booked_at, tariff_id)
       values ($1, $2, 60, 'booked', $3, now(), $4)
       returning id`,
      [teacherId, future.toISOString(), learnerId, tariff.rows[0].id],
    )

    const client = await pool.connect()
    try {
      await client.query('begin')
      await expect(
        markLessonCompleted(client, {
          slotId: slotResult.rows[0].id,
          teacherId,
          wasNoShow: false,
          markedByAccountId: teacherId,
        }),
      ).rejects.toThrow(LessonCompletionEligibilityError)
      await client.query('rollback')
    } finally {
      client.release()
    }
  })

  it('markLessonCompleted: second call same slot → created=false (idempotent)', async () => {
    const teacherId = await freshAccount('5a-teacher-idem')
    const learnerId = await freshAccount('5a-learner-idem')
    const slotId = await freshPastBookedSlot(teacherId, learnerId)
    const pool = getDbPool()

    let first: { completionId: string; created: boolean }
    let second: { completionId: string; created: boolean }
    const client1 = await pool.connect()
    try {
      await client1.query('begin')
      first = await markLessonCompleted(client1, {
        slotId,
        teacherId,
        wasNoShow: false,
        markedByAccountId: teacherId,
      })
      await client1.query('commit')
    } finally {
      client1.release()
    }
    const client2 = await pool.connect()
    try {
      await client2.query('begin')
      second = await markLessonCompleted(client2, {
        slotId,
        teacherId,
        wasNoShow: false,
        markedByAccountId: teacherId,
      })
      await client2.query('commit')
    } finally {
      client2.release()
    }
    expect(first!.created).toBe(true)
    expect(second!.created).toBe(false)
    expect(second!.completionId).toBe(first!.completionId)
    // Only one row in the table.
    const count = await pool.query<{ c: string }>(
      `select count(*)::text as c from lesson_completions where slot_id = $1`,
      [slotId],
    )
    expect(Number(count.rows[0].c)).toBe(1)
  })

  it('cancelSlot on status=completed → throws CancelAfterCompletionError', async () => {
    const teacherId = await freshAccount('5a-teacher-cxcompl')
    const learnerId = await freshAccount('5a-learner-cxcompl')
    const slotId = await freshPastBookedSlot(teacherId, learnerId)
    const pool = getDbPool()
    const client = await pool.connect()
    try {
      await client.query('begin')
      await markLessonCompleted(client, {
        slotId,
        teacherId,
        wasNoShow: false,
        markedByAccountId: teacherId,
      })
      await client.query('commit')
    } finally {
      client.release()
    }
    await expect(
      cancelSlot(slotId, teacherId, 'admin reason', 'admin'),
    ).rejects.toThrow(CancelAfterCompletionError)
  })

  it('cancelSlot works after un-mark (delete completion → status=booked)', async () => {
    const teacherId = await freshAccount('5a-teacher-uncx')
    const learnerId = await freshAccount('5a-learner-uncx')
    const slotId = await freshPastBookedSlot(teacherId, learnerId)
    const pool = getDbPool()
    const client = await pool.connect()
    let completionId: string
    try {
      await client.query('begin')
      const r = await markLessonCompleted(client, {
        slotId,
        teacherId,
        wasNoShow: false,
        markedByAccountId: teacherId,
      })
      completionId = r.completionId
      await client.query('commit')
    } finally {
      client.release()
    }
    // un-mark
    await pool.query(`delete from lesson_completions where id = $1`, [completionId!])
    // cancel should now work
    const cancelled = await cancelSlot(slotId, teacherId, 'now-cancelling', 'admin')
    expect(cancelled).not.toBeNull()
    expect(cancelled!.status).toBe('cancelled')
  })
})
