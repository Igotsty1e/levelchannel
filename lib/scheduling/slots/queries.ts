// Wave 39: read-only DB queries extracted from slots.ts.
// No mutations, no billing.

import { getDbPool } from '@/lib/db/pool'

import { UUID_PATTERN, rowToSlot } from './internal'
import type { LessonSlot, SlotStatus } from './types'

export async function listOpenFutureSlots(params: {
  teacherAccountId?: string | null
  fromIso?: string
  toIso?: string
  limit?: number
}): Promise<LessonSlot[]> {
  const pool = getDbPool()
  const limit = Math.min(Math.max(params.limit ?? 200, 1), 500)
  const args: unknown[] = [params.fromIso ?? new Date().toISOString()]
  let where = `status = 'open' and start_at >= $1`
  if (params.toIso) {
    args.push(params.toIso)
    where += ` and start_at <= $${args.length}`
  }
  if (params.teacherAccountId) {
    args.push(params.teacherAccountId)
    where += ` and teacher_account_id = $${args.length}`
  }
  args.push(limit)
  const result = await pool.query(
    `select s.id, s.teacher_account_id, s.start_at, s.duration_minutes,
            s.status, s.learner_account_id, s.booked_at, s.cancelled_at,
            s.cancelled_by_account_id, s.cancellation_reason, s.marked_at,
            s.tariff_id, s.notes,
            s.events, s.created_at, s.updated_at,
            ta.email as teacher_email,
            t.slug as tariff_slug,
            t.title_ru as tariff_title_ru,
            t.amount_kopecks as tariff_amount_kopecks
       from lesson_slots s
       join accounts ta on ta.id = s.teacher_account_id
       left join pricing_tariffs t on t.id = s.tariff_id
      where ${where}
      order by s.start_at asc
      limit $${args.length}`,
    args,
  )
  return result.rows.map((r) =>
    rowToSlot(r, {
      teacherEmail: r.teacher_email ? String(r.teacher_email) : null,
      tariffSlug: r.tariff_slug ? String(r.tariff_slug) : null,
      tariffTitleRu: r.tariff_title_ru ? String(r.tariff_title_ru) : null,
      tariffAmountKopecks:
        r.tariff_amount_kopecks !== null && r.tariff_amount_kopecks !== undefined
          ? Number(r.tariff_amount_kopecks)
          : null,
    }),
  )
}

// Phase 7+: cabinet view for users holding the `teacher` role.
// Returns slots they're teaching ordered by start_at desc so upcoming
// + recent past are visible. Read-only — teachers don't yet self-
// manage their schedule (operator manages /admin/slots).
export async function listSlotsAsTeacher(
  teacherAccountId: string,
  limit = 50,
): Promise<LessonSlot[]> {
  const pool = getDbPool()
  const result = await pool.query(
    `select s.id, s.teacher_account_id, s.start_at, s.duration_minutes,
            s.status, s.learner_account_id, s.booked_at, s.cancelled_at,
            s.cancelled_by_account_id, s.cancellation_reason, s.marked_at,
            s.tariff_id, s.notes,
            s.events, s.created_at, s.updated_at,
            ta.email as teacher_email,
            la.email as learner_email,
            t.slug as tariff_slug,
            t.title_ru as tariff_title_ru,
            t.amount_kopecks as tariff_amount_kopecks
       from lesson_slots s
       join accounts ta on ta.id = s.teacher_account_id
       left join accounts la on la.id = s.learner_account_id
       left join pricing_tariffs t on t.id = s.tariff_id
      where s.teacher_account_id = $1
      order by s.start_at desc
      limit $2`,
    [teacherAccountId, Math.min(Math.max(limit, 1), 200)],
  )
  return result.rows.map((r) =>
    rowToSlot(r, {
      teacherEmail: r.teacher_email ? String(r.teacher_email) : null,
      learnerEmail: r.learner_email ? String(r.learner_email) : null,
      tariffSlug: r.tariff_slug ? String(r.tariff_slug) : null,
      tariffTitleRu: r.tariff_title_ru ? String(r.tariff_title_ru) : null,
      tariffAmountKopecks:
        r.tariff_amount_kopecks !== null && r.tariff_amount_kopecks !== undefined
          ? Number(r.tariff_amount_kopecks)
          : null,
    }),
  )
}

export async function listSlotsForLearner(
  learnerAccountId: string,
  limit = 50,
): Promise<LessonSlot[]> {
  const pool = getDbPool()
  const result = await pool.query(
    `select s.id, s.teacher_account_id, s.start_at, s.duration_minutes,
            s.status, s.learner_account_id, s.booked_at, s.cancelled_at,
            s.cancelled_by_account_id, s.cancellation_reason, s.marked_at,
            s.tariff_id, s.notes,
            s.events, s.created_at, s.updated_at,
            ta.email as teacher_email,
            t.slug as tariff_slug,
            t.title_ru as tariff_title_ru,
            t.amount_kopecks as tariff_amount_kopecks
       from lesson_slots s
       join accounts ta on ta.id = s.teacher_account_id
       left join pricing_tariffs t on t.id = s.tariff_id
      where s.learner_account_id = $1
      order by s.start_at desc
      limit $2`,
    [learnerAccountId, Math.min(Math.max(limit, 1), 200)],
  )
  return result.rows.map((r) =>
    rowToSlot(r, {
      teacherEmail: r.teacher_email ? String(r.teacher_email) : null,
      tariffSlug: r.tariff_slug ? String(r.tariff_slug) : null,
      tariffTitleRu: r.tariff_title_ru ? String(r.tariff_title_ru) : null,
      tariffAmountKopecks:
        r.tariff_amount_kopecks !== null && r.tariff_amount_kopecks !== undefined
          ? Number(r.tariff_amount_kopecks)
          : null,
    }),
  )
}

export async function listAllSlotsForAdmin(params: {
  status?: SlotStatus | 'all'
  fromIso?: string
  toIso?: string
  limit?: number
}): Promise<LessonSlot[]> {
  const pool = getDbPool()
  const limit = Math.min(Math.max(params.limit ?? 200, 1), 500)
  const args: unknown[] = []
  const clauses: string[] = []
  if (params.status && params.status !== 'all') {
    args.push(params.status)
    clauses.push(`s.status = $${args.length}`)
  }
  if (params.fromIso) {
    args.push(params.fromIso)
    clauses.push(`s.start_at >= $${args.length}`)
  }
  if (params.toIso) {
    args.push(params.toIso)
    clauses.push(`s.start_at <= $${args.length}`)
  }
  const where = clauses.length ? `where ${clauses.join(' and ')}` : ''
  args.push(limit)
  const result = await pool.query(
    `select s.id, s.teacher_account_id, s.start_at, s.duration_minutes,
            s.status, s.learner_account_id, s.booked_at, s.cancelled_at,
            s.cancelled_by_account_id, s.cancellation_reason, s.marked_at,
            s.tariff_id, s.notes,
            s.events, s.created_at, s.updated_at,
            ta.email as teacher_email,
            la.email as learner_email,
            t.slug as tariff_slug,
            t.title_ru as tariff_title_ru,
            t.amount_kopecks as tariff_amount_kopecks
       from lesson_slots s
       join accounts ta on ta.id = s.teacher_account_id
       left join accounts la on la.id = s.learner_account_id
       left join pricing_tariffs t on t.id = s.tariff_id
       ${where}
       order by s.start_at asc
       limit $${args.length}`,
    args,
  )
  return result.rows.map((r) =>
    rowToSlot(r, {
      teacherEmail: r.teacher_email ? String(r.teacher_email) : null,
      learnerEmail: r.learner_email ? String(r.learner_email) : null,
      tariffSlug: r.tariff_slug ? String(r.tariff_slug) : null,
      tariffTitleRu: r.tariff_title_ru ? String(r.tariff_title_ru) : null,
      tariffAmountKopecks:
        r.tariff_amount_kopecks !== null && r.tariff_amount_kopecks !== undefined
          ? Number(r.tariff_amount_kopecks)
          : null,
    }),
  )
}

// Wave A — calendar range query. Required teacherId, exact MSK-week
// range. Caller (route handler) is responsible for auth (which teacher
// the session can request — see `pickActiveCalendarRole` in
// lib/calendar/types.ts) and DTO projection per role.
export async function listSlotsForCalendarRange(params: {
  teacherId: string
  fromIso: string
  toIso: string
}): Promise<LessonSlot[]> {
  if (!UUID_PATTERN.test(params.teacherId)) return []
  const pool = getDbPool()
  const result = await pool.query(
    `select s.id, s.teacher_account_id, s.start_at, s.duration_minutes,
            s.status, s.learner_account_id, s.booked_at, s.cancelled_at,
            s.cancelled_by_account_id, s.cancellation_reason, s.marked_at,
            s.tariff_id, s.notes,
            s.events, s.created_at, s.updated_at,
            ta.email as teacher_email,
            la.email as learner_email,
            t.slug as tariff_slug,
            t.title_ru as tariff_title_ru,
            t.amount_kopecks as tariff_amount_kopecks
       from lesson_slots s
       join accounts ta on ta.id = s.teacher_account_id
       left join accounts la on la.id = s.learner_account_id
       left join pricing_tariffs t on t.id = s.tariff_id
      where s.teacher_account_id = $1
        and s.start_at >= $2
        and s.start_at < $3
      order by s.start_at asc`,
    [params.teacherId, params.fromIso, params.toIso],
  )
  return result.rows.map((r) =>
    rowToSlot(r, {
      teacherEmail: r.teacher_email ? String(r.teacher_email) : null,
      learnerEmail: r.learner_email ? String(r.learner_email) : null,
      tariffSlug: r.tariff_slug ? String(r.tariff_slug) : null,
      tariffTitleRu: r.tariff_title_ru ? String(r.tariff_title_ru) : null,
      tariffAmountKopecks:
        r.tariff_amount_kopecks !== null && r.tariff_amount_kopecks !== undefined
          ? Number(r.tariff_amount_kopecks)
          : null,
    }),
  )
}

export async function getSlotById(id: string): Promise<LessonSlot | null> {
  if (!UUID_PATTERN.test(id)) return null
  const pool = getDbPool()
  const result = await pool.query(
    `select id, teacher_account_id, start_at, duration_minutes,
            status, learner_account_id, booked_at, cancelled_at,
            cancelled_by_account_id, cancellation_reason, marked_at,
            tariff_id, notes, events, created_at, updated_at
       from lesson_slots where id = $1`,
    [id],
  )
  return result.rows[0] ? rowToSlot(result.rows[0]) : null
}
