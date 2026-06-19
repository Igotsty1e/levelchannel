// Epic B (2026-06-19) — учительские «дела» (personal events) helpers.
//
// Plan: docs/plans/clever-sprouting-floyd.md Epic B.
//
// Дело хранится в той же lesson_slots с source='personal_event'.
// Активный статус 'personal_event'; терминальные — 'completed' (выполнено)
// и 'cancelled' (отменено).
//
// Контракт:
//   createPersonalEvent(teacherAccountId, input) — INSERT в lesson_slots.
//     Запрещён если на (teacherAccountId, startAt) уже есть строка
//     (UNIQUE constraint mig 0020 lesson_slots_teacher_start_unique).
//   completePersonalEvent(slotId, teacherAccountId) — переводит в
//     'completed' если status='personal_event' и slot принадлежит этому
//     учителю.
//   cancelPersonalEventByTeacher — переводит в 'cancelled'.
//
// Reschedule НЕ реализован в этом эпике (out of scope; см. plan-doc).
// Mutation reuses standard UPDATE + advisory-lock pattern — будет следующим
// follow-up'ом.

import { getDbPool } from '@/lib/db/pool'

import { SLOT_COLUMNS, appendEventSql, rowToSlot } from './internal'
import {
  MAX_PERSONAL_EVENT_BODY_LEN,
  MAX_PERSONAL_EVENT_TITLE_LEN,
  type LessonSlot,
} from './types'

export type CreatePersonalEventInput = {
  startAt: string
  durationMinutes: number
  title: string
  body?: string | null
}

export type CreatePersonalEventResult =
  | { ok: true; slot: LessonSlot }
  | {
      ok: false
      reason:
        | 'invalid_title'
        | 'title_too_long'
        | 'body_too_long'
        | 'invalid_duration'
        | 'invalid_start_at'
        | 'conflict'
    }

export async function createPersonalEvent(
  teacherAccountId: string,
  input: CreatePersonalEventInput,
): Promise<CreatePersonalEventResult> {
  const title = (input.title ?? '').trim()
  if (title.length === 0) return { ok: false, reason: 'invalid_title' }
  if (title.length > MAX_PERSONAL_EVENT_TITLE_LEN) {
    return { ok: false, reason: 'title_too_long' }
  }
  const bodyRaw = typeof input.body === 'string' ? input.body.trim() : null
  const body = bodyRaw && bodyRaw.length > 0 ? bodyRaw : null
  if (body !== null && body.length > MAX_PERSONAL_EVENT_BODY_LEN) {
    return { ok: false, reason: 'body_too_long' }
  }
  if (
    !Number.isInteger(input.durationMinutes) ||
    input.durationMinutes < 15 ||
    input.durationMinutes > 180
  ) {
    return { ok: false, reason: 'invalid_duration' }
  }
  const startMs = Date.parse(input.startAt)
  if (!Number.isFinite(startMs)) {
    return { ok: false, reason: 'invalid_start_at' }
  }
  const pool = getDbPool()
  try {
    const result = await pool.query(
      `insert into lesson_slots
         (teacher_account_id, start_at, duration_minutes, status,
          source, personal_event_title, personal_event_body, events,
          created_at, updated_at)
       values
         ($1::uuid, $2::timestamptz, $3, 'personal_event',
          'personal_event', $4, $5, $6::jsonb,
          now(), now())
       returning ${SLOT_COLUMNS}`,
      [
        teacherAccountId,
        new Date(startMs).toISOString(),
        input.durationMinutes,
        title,
        body,
        appendEventSql('personal_event_created', teacherAccountId, {
          title,
        }),
      ],
    )
    if (result.rows.length === 0) {
      return { ok: false, reason: 'conflict' }
    }
    return { ok: true, slot: rowToSlot(result.rows[0]) }
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message.includes('lesson_slots_teacher_start_unique') ||
        err.message.includes('duplicate key'))
    ) {
      return { ok: false, reason: 'conflict' }
    }
    throw err
  }
}

export type PersonalEventTerminalResult =
  | { ok: true; slot: LessonSlot }
  | { ok: false; reason: 'not_found' | 'wrong_status' | 'not_owner' }

export async function completePersonalEvent(
  slotId: string,
  teacherAccountId: string,
): Promise<PersonalEventTerminalResult> {
  return transitionPersonalEvent(slotId, teacherAccountId, {
    targetStatus: 'completed',
    eventKind: 'personal_event_completed',
  })
}

export async function cancelPersonalEventByTeacher(
  slotId: string,
  teacherAccountId: string,
  reason: string | null,
): Promise<PersonalEventTerminalResult> {
  return transitionPersonalEvent(slotId, teacherAccountId, {
    targetStatus: 'cancelled',
    eventKind: 'personal_event_cancelled',
    cancellationReason: reason ?? null,
  })
}

async function transitionPersonalEvent(
  slotId: string,
  teacherAccountId: string,
  options: {
    targetStatus: 'completed' | 'cancelled'
    eventKind: string
    cancellationReason?: string | null
  },
): Promise<PersonalEventTerminalResult> {
  const pool = getDbPool()
  const client = await pool.connect()
  try {
    await client.query('begin')
    const lookup = await client.query<{
      id: string
      teacher_account_id: string
      status: string
      source: string | null
    }>(
      `select id, teacher_account_id, status, source
         from lesson_slots
        where id = $1::uuid
        for update`,
      [slotId],
    )
    if (lookup.rows.length === 0) {
      await client.query('rollback')
      return { ok: false, reason: 'not_found' }
    }
    const row = lookup.rows[0]
    if (row.teacher_account_id !== teacherAccountId) {
      await client.query('rollback')
      return { ok: false, reason: 'not_owner' }
    }
    if (row.source !== 'personal_event' || row.status !== 'personal_event') {
      await client.query('rollback')
      return { ok: false, reason: 'wrong_status' }
    }
    const upd = await client.query(
      `update lesson_slots
          set status = $2,
              cancelled_at = case when $2 = 'cancelled' then now() else cancelled_at end,
              cancelled_by_account_id = case when $2 = 'cancelled' then $3::uuid else cancelled_by_account_id end,
              cancellation_reason = case when $2 = 'cancelled' then $4 else cancellation_reason end,
              marked_at = case when $2 = 'completed' then now() else marked_at end,
              events = events || $5::jsonb,
              updated_at = now()
        where id = $1::uuid
        returning ${SLOT_COLUMNS}`,
      [
        slotId,
        options.targetStatus,
        teacherAccountId,
        options.cancellationReason ?? null,
        appendEventSql(options.eventKind, teacherAccountId, {
          reason: options.cancellationReason ?? null,
        }),
      ],
    )
    await client.query('commit')
    return { ok: true, slot: rowToSlot(upd.rows[0]) }
  } catch (err) {
    await client.query('rollback').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

export async function listPersonalEventsForTeacher(
  teacherAccountId: string,
  options: { limit?: number; includeTerminal?: boolean } = {},
): Promise<LessonSlot[]> {
  const limit = options.limit ?? 100
  const includeTerminal = options.includeTerminal ?? true
  const pool = getDbPool()
  const result = await pool.query(
    `select ${SLOT_COLUMNS}
       from lesson_slots
      where teacher_account_id = $1::uuid
        and source = 'personal_event'
        and (
          $2::boolean = true
          or status = 'personal_event'
        )
      order by start_at desc
      limit $3`,
    [teacherAccountId, includeTerminal, limit],
  )
  return result.rows.map((r) => rowToSlot(r))
}
