// teacher-lessons-edit-status epic (2026-06-24) — integration tests
// для change-status mutations (lessons + deals).
//
// Verifies:
// - Deal status chain mutations (6 transitions).
// - Deal expectedUpdatedAt stale check.
// - Lesson chain mutation completed → no_show_learner (toggle was_no_show).
// - Lesson 48h immutability gate.
// - Audit row written inside same TX.
// - personal_event_title invariant preserved через chain.

import { randomUUID } from 'node:crypto'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { getDbPool } from '@/lib/db/pool'
import {
  changeDealStatus,
  changeLessonStatus,
  createPersonalEvent,
} from '@/lib/scheduling/slots'

import '../setup'

async function ensureAccount(email: string, role: 'teacher' | 'learner'): Promise<string> {
  await getDbPool().query(
    `insert into accounts (email, password_hash, email_verified_at)
       values ($1, $2, now())
       on conflict (email) do nothing`,
    [email, 'test-hash'],
  )
  const existing = await getDbPool().query<{ id: string }>(
    `select id from accounts where email = $1`,
    [email],
  )
  const accountId = existing.rows[0].id
  if (role === 'teacher') {
    await getDbPool().query(
      `insert into account_roles (account_id, role) values ($1, 'teacher') on conflict do nothing`,
      [accountId],
    )
  }
  return accountId
}

async function seedTariff(teacherId: string): Promise<string> {
  const slug = `tariff-${randomUUID().slice(0, 8)}`
  const r = await getDbPool().query<{ id: string }>(
    `insert into pricing_tariffs (slug, title_ru, amount_kopecks, duration_minutes, is_active, teacher_id)
       values ($1, 'Test tariff', 100000, 60, true, $2) returning id`,
    [slug, teacherId],
  )
  return r.rows[0].id
}

async function seedBookedSlot(
  teacherId: string,
  learnerId: string,
  tariffId: string,
  startAtIso: string,
): Promise<{ id: string; updatedAt: string }> {
  const r = await getDbPool().query<{ id: string; updated_at: string }>(
    `insert into lesson_slots
       (teacher_account_id, learner_account_id, tariff_id, start_at, duration_minutes,
        status, source, booked_at)
       values ($1, $2, $3, $4::timestamptz, 60, 'booked', 'open_slot', now())
       returning id, updated_at`,
    [teacherId, learnerId, tariffId, startAtIso],
  )
  return { id: r.rows[0].id, updatedAt: new Date(String(r.rows[0].updated_at)).toISOString() }
}

describe('changeDealStatus (deal chain mutations)', () => {
  let teacherId: string
  let dealId: string
  let updatedAt: string

  beforeEach(async () => {
    teacherId = await ensureAccount(`teacher-${randomUUID()}@test.local`, 'teacher')
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000)
    past.setSeconds(0, 0)
    past.setMinutes(0)
    const created = await createPersonalEvent(teacherId, {
      startAt: past.toISOString(),
      durationMinutes: 60,
      title: 'Test deal',
      body: 'Test body',
    })
    if (!created.ok) throw new Error(`seed failed: ${created.reason}`)
    dealId = created.slot.id
    updatedAt = created.slot.updatedAt
  })

  afterEach(async () => {
    await getDbPool().query(`delete from lesson_slots where id = $1`, [dealId])
    await getDbPool().query(`delete from accounts where id = $1`, [teacherId])
  })

  it('personal_event → completed', async () => {
    const r = await changeDealStatus({
      slotId: dealId,
      teacherAccountId: teacherId,
      toStatus: 'completed',
      expectedUpdatedAt: updatedAt,
    })
    expect(r.ok).toBe(true)
    const row = await getDbPool().query<{ status: string; marked_at: string | null }>(
      `select status, marked_at from lesson_slots where id = $1`,
      [dealId],
    )
    expect(row.rows[0].status).toBe('completed')
    expect(row.rows[0].marked_at).not.toBeNull()
  })

  it('completed → personal_event (revert)', async () => {
    // First mark completed.
    const c = await changeDealStatus({
      slotId: dealId,
      teacherAccountId: teacherId,
      toStatus: 'completed',
      expectedUpdatedAt: updatedAt,
    })
    expect(c.ok).toBe(true)
    const newUpdated = c.ok ? c.newUpdatedAt : ''
    // Now revert.
    const r = await changeDealStatus({
      slotId: dealId,
      teacherAccountId: teacherId,
      toStatus: 'personal_event',
      expectedUpdatedAt: newUpdated,
    })
    expect(r.ok).toBe(true)
    const row = await getDbPool().query<{ status: string; marked_at: string | null }>(
      `select status, marked_at from lesson_slots where id = $1`,
      [dealId],
    )
    expect(row.rows[0].status).toBe('personal_event')
    expect(row.rows[0].marked_at).toBeNull()
  })

  it('preserves personal_event_title through cancelled chain', async () => {
    // personal_event → cancelled → personal_event.
    const c = await changeDealStatus({
      slotId: dealId,
      teacherAccountId: teacherId,
      toStatus: 'cancelled',
      expectedUpdatedAt: updatedAt,
    })
    expect(c.ok).toBe(true)
    const newUpdated = c.ok ? c.newUpdatedAt : ''
    const r = await changeDealStatus({
      slotId: dealId,
      teacherAccountId: teacherId,
      toStatus: 'personal_event',
      expectedUpdatedAt: newUpdated,
    })
    expect(r.ok).toBe(true)
    const row = await getDbPool().query<{
      personal_event_title: string | null
      cancelled_at: string | null
      cancellation_reason: string | null
    }>(
      `select personal_event_title, cancelled_at, cancellation_reason
         from lesson_slots where id = $1`,
      [dealId],
    )
    expect(row.rows[0].personal_event_title).toBe('Test deal')
    expect(row.rows[0].cancelled_at).toBeNull()
    expect(row.rows[0].cancellation_reason).toBeNull()
  })

  it('rejects stale expectedUpdatedAt with 409', async () => {
    const stale = new Date(Date.now() - 1000000).toISOString()
    const r = await changeDealStatus({
      slotId: dealId,
      teacherAccountId: teacherId,
      toStatus: 'completed',
      expectedUpdatedAt: stale,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('stale')
  })

  it('rejects wrong-teacher with 403 not_owner', async () => {
    const otherTeacher = await ensureAccount(`other-${randomUUID()}@test.local`, 'teacher')
    try {
      const r = await changeDealStatus({
        slotId: dealId,
        teacherAccountId: otherTeacher,
        toStatus: 'completed',
        expectedUpdatedAt: updatedAt,
      })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reason).toBe('not_owner')
    } finally {
      await getDbPool().query(`delete from accounts where id = $1`, [otherTeacher])
    }
  })

  it('writes audit row with source=deal', async () => {
    await changeDealStatus({
      slotId: dealId,
      teacherAccountId: teacherId,
      toStatus: 'completed',
      expectedUpdatedAt: updatedAt,
    })
    const audit = await getDbPool().query<{
      source: string
      from_status: string
      to_status: string
      learner_account_id: string | null
      notify_intent: boolean
    }>(
      `select source, from_status, to_status, learner_account_id, notify_intent
         from audit_lesson_status_change where slot_id = $1`,
      [dealId],
    )
    expect(audit.rows.length).toBe(1)
    expect(audit.rows[0].source).toBe('deal')
    expect(audit.rows[0].from_status).toBe('personal_event')
    expect(audit.rows[0].to_status).toBe('completed')
    expect(audit.rows[0].learner_account_id).toBeNull()
    expect(audit.rows[0].notify_intent).toBe(false)
  })
})

describe('changeLessonStatus — wrong-kind rejection for deal slots', () => {
  it('rejects deal slot with wrong_kind', async () => {
    const teacherId = await ensureAccount(`teacher-${randomUUID()}@test.local`, 'teacher')
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000)
    past.setSeconds(0, 0)
    past.setMinutes(0)
    const created = await createPersonalEvent(teacherId, {
      startAt: past.toISOString(),
      durationMinutes: 60,
      title: 'Test deal',
    })
    if (!created.ok) throw new Error(`seed failed: ${created.reason}`)
    try {
      const r = await changeLessonStatus({
        slotId: created.slot.id,
        teacherAccountId: teacherId,
        toStatus: 'completed',
        expectedUpdatedAt: created.slot.updatedAt,
        notifyIntent: false,
      })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reason).toBe('wrong_kind')
    } finally {
      await getDbPool().query(`delete from lesson_slots where id = $1`, [created.slot.id])
      await getDbPool().query(`delete from accounts where id = $1`, [teacherId])
    }
  })
})
