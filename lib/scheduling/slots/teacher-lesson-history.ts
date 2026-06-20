// Wave-2 lesson-history (2026-06-16) — read-side queries для
// `/teacher` (home card + dedicated history page).
//
// Privacy invariant (paranoia H-2): все запросы стартуют с
// `WHERE teacher_account_id = $1`. Filters только ON TOP — никакого
// способа обойти scope через query param.
//
// Read-only — без транзакций, без advisory locks.

import { getSlotPaymentSources, type SlotPaymentSource } from '@/lib/billing/paid-state'
import { getDbPool } from '@/lib/db/pool'

import { SLOT_COLUMNS, rowToSlot } from './internal'
import type { LessonSlot } from './types'

export type LessonHistoryFilter = {
  fromIso?: string | null
  toIso?: string | null
  learnerAccountId?: string | null
  status?:
    | 'completed'
    | 'no_show_learner'
    | 'no_show_teacher'
    | 'cancelled'
    | 'booked'
    | null
  unmarkedOnly?: boolean
  limit?: number
  offset?: number
}

export type LessonHistoryRow = LessonSlot & {
  /** true if `lesson_completions` row already exists for this slot. */
  isMarked: boolean
  /** post-deploy bug bash 2026-06-19 (Bug 5): payment source для status pill.
   * 'paid_package' / 'paid_direct' → «Оплачено»; 'unpaid' → «Не оплачено»;
   * null для cancelled / no_show_* (pill не показывается). */
  paymentStatus: SlotPaymentSource
}

// Используем в карточке «Недавние прошедшие» на /teacher home:
// последние `limit` booked-в-прошлом без completion row.
export async function listRecentPastUnmarkedSlots(
  teacherAccountId: string,
  limit = 5,
): Promise<LessonSlot[]> {
  const pool = getDbPool()
  const r = await pool.query(
    `select ${SLOT_COLUMNS}
       from lesson_slots s
       where s.teacher_account_id = $1
         and s.status = 'booked'
         and s.start_at <= now()
         and not exists (
           select 1 from lesson_completions c where c.slot_id = s.id
         )
       order by s.start_at desc
       limit $2`,
    [teacherAccountId, Math.min(Math.max(limit, 1), 50)],
  )
  return r.rows.map((row) => rowToSlot(row))
}

// История всех past занятий с фильтрами. Pagination через limit/offset.
// MAX limit = 200; cap'аем на этом уровне, чтобы UI / CSV не падали по
// памяти. CSV-export ходит через ту же функцию с limit=5000.
export async function listLessonHistory(
  teacherAccountId: string,
  filter: LessonHistoryFilter = {},
): Promise<LessonHistoryRow[]> {
  const pool = getDbPool()
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 5000)
  const offset = Math.max(filter.offset ?? 0, 0)
  const params: unknown[] = [teacherAccountId, limit, offset]
  const where: string[] = [
    `s.teacher_account_id = $1`,
    `s.start_at <= now()`,
    `s.status in ('completed','no_show_learner','no_show_teacher','cancelled','booked')`,
  ]
  if (filter.fromIso) {
    params.push(filter.fromIso)
    where.push(`s.start_at >= $${params.length}`)
  }
  if (filter.toIso) {
    params.push(filter.toIso)
    where.push(`s.start_at < $${params.length}`)
  }
  if (filter.learnerAccountId) {
    params.push(filter.learnerAccountId)
    where.push(`s.learner_account_id = $${params.length}`)
  }
  if (filter.status) {
    params.push(filter.status)
    where.push(`s.status = $${params.length}`)
  }
  if (filter.unmarkedOnly) {
    where.push(
      `s.status = 'booked' and not exists (select 1 from lesson_completions c where c.slot_id = s.id)`,
    )
  }
  const sql = `
    select ${SLOT_COLUMNS},
      exists (select 1 from lesson_completions c where c.slot_id = s.id) as is_marked
    from lesson_slots s
    where ${where.join(' and ')}
    order by s.start_at desc
    limit $2 offset $3`
  const r = await pool.query(sql, params)
  const slots = r.rows.map((row) => ({
    ...rowToSlot(row),
    isMarked: Boolean(row.is_marked),
  }))
  // Batch paymentStatus lookup — single SQL, не N+1.
  // post-deploy-followup 2026-06-20: graceful degradation — если SQL
  // в getSlotPaymentSources валит (несовместимый schema, broken
  // allocations row), страница НЕ падает. Pill «Оплачено» — bonus,
  // не critical-path; список занятий важнее.
  let paymentSources: Map<string, SlotPaymentSource> = new Map()
  try {
    paymentSources = await getSlotPaymentSources(slots.map((s) => s.id))
  } catch (err) {
    console.error(
      '[listLessonHistory] getSlotPaymentSources failed, falling back:',
      err instanceof Error ? err.message : err,
    )
  }
  return slots.map((slot) => ({
    ...slot,
    paymentStatus: paymentSources.get(slot.id) ?? null,
  }))
}
