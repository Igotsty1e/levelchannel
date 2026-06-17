// 2026-06-17 — учеричные list-helpers для /cabinet/lessons (Wave B).
// Аналог lib/scheduling/slots/teacher-lesson-history.ts.
//
// Privacy invariant: WHERE learner_account_id = $1 — всегда первым.

import { getDbPool } from '@/lib/db/pool'

import type { LessonSlot } from './types'
import { rowToSlot } from './internal'

export type LearnerLessonHistoryFilter = {
  fromIso?: string | null
  toIso?: string | null
  status?:
    | 'completed'
    | 'no_show_learner'
    | 'no_show_teacher'
    | 'cancelled'
    | 'booked'
    | null
  unpaidOnly?: boolean
  limit?: number
  offset?: number
}

export type LearnerLessonHistoryRow = LessonSlot & {
  isPaid: boolean
}

export async function listLearnerLessonHistory(
  learnerAccountId: string,
  filter: LearnerLessonHistoryFilter = {},
): Promise<LearnerLessonHistoryRow[]> {
  const pool = getDbPool()
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 500)
  const offset = Math.max(filter.offset ?? 0, 0)
  const params: unknown[] = [learnerAccountId, limit, offset]
  const where: string[] = [`s.learner_account_id = $1`]
  if (filter.fromIso) {
    params.push(filter.fromIso)
    where.push(`s.start_at >= $${params.length}`)
  }
  if (filter.toIso) {
    params.push(filter.toIso)
    where.push(`s.start_at < $${params.length}`)
  }
  if (filter.status) {
    params.push(filter.status)
    where.push(`s.status = $${params.length}`)
  }
  const sql = `
    select s.id, s.teacher_account_id, s.start_at, s.duration_minutes,
           s.status, s.learner_account_id, s.booked_at, s.cancelled_at,
           s.cancelled_by_account_id, s.cancellation_reason, s.marked_at,
           s.tariff_id, s.notes,
           s.events, s.created_at, s.updated_at,
           ta.email as teacher_email,
           t.slug as tariff_slug,
           t.title_ru as tariff_title_ru,
           t.amount_kopecks as tariff_amount_kopecks,
           exists (
             select 1
               from payment_claim_items pci
               join payment_claims pc on pc.id = pci.claim_id
              where pci.slot_id = s.id and pc.status = 'confirmed'
           ) as is_paid
      from lesson_slots s
      join accounts ta on ta.id = s.teacher_account_id
      left join pricing_tariffs t on t.id = s.tariff_id
     where ${where.join(' and ')}
     order by s.start_at desc
     limit $2 offset $3`
  const r = await pool.query(sql, params)
  let rows = r.rows.map((row) => ({
    ...rowToSlot(row, {
      teacherEmail: row.teacher_email ? String(row.teacher_email) : null,
      tariffSlug: row.tariff_slug ? String(row.tariff_slug) : null,
      tariffTitleRu: row.tariff_title_ru ? String(row.tariff_title_ru) : null,
      tariffAmountKopecks:
        row.tariff_amount_kopecks !== null && row.tariff_amount_kopecks !== undefined
          ? Number(row.tariff_amount_kopecks)
          : null,
    }),
    isPaid: Boolean(row.is_paid),
  }))
  if (filter.unpaidOnly) {
    rows = rows.filter((r) => !r.isPaid && r.status === 'booked')
  }
  return rows
}
