// teacher-no-slots-mode (Задача 2.1, Sub-PR B, 2026-06-11).
//
// Learner reschedules their own booked slot to a new start_at.
// Semantics = cancel original + create new booked slot with the SAME
// (teacher, tariff, duration) but new start_at. The cancel arm restores
// package consumption (if any); the create arm re-consumes via the same
// pipeline as `bookSlot` / `assignSlotDirect`.
//
// Both arms run INSIDE ONE TX + per-learner advisory_xact_lock — no
// window where package units are double-consumed or lost.
//
// Cancel-window applies (same as `cancelLearnerSlot`): learner cannot
// reschedule a slot that is too close to start.

import { ACTIVE_INTEGRATION_GATE_SQL } from '@/lib/calendar/freshness-sql'
import { getDbPool } from '@/lib/db/pool'
import { dispatchLessonEvent } from '@/lib/notifications/lesson-event-dispatch'
import { getActorDisplayName } from '@/lib/notifications/recipient-resolver'

import {
  SLOT_COLUMNS,
  UUID_PATTERN,
  appendEventSql,
  rowToSlot,
} from './internal'
import { getLearnerCancelWindowHours } from '../policy'
import {
  MSK_BUSINESS_HOUR_MAX,
  MSK_BUSINESS_HOUR_MIN,
  SLOT_GRID_MINUTES,
  type LessonSlot,
} from './types'

export type RescheduleSlotResult =
  | { ok: true; oldSlot: LessonSlot; newSlot: LessonSlot }
  | {
      ok: false
      reason:
        | 'not_found'
        | 'not_owner'
        | 'already_terminal'
        | 'too_late_to_reschedule'
        | 'in_past'
        | 'start_out_of_band'
        | 'start_not_30min_aligned'
        | 'slot_collision'
        | 'external_conflict'
      minutesUntilStart?: number
    }

function computeMskHour(date: Date): number {
  const m = new Date(date.getTime() + 3 * 60 * 60 * 1000)
  return m.getUTCHours() + m.getUTCMinutes() / 60
}

export async function rescheduleSlotByLearner(
  slotId: string,
  learnerAccountId: string,
  newStartAt: string,
): Promise<RescheduleSlotResult> {
  if (!UUID_PATTERN.test(slotId)) return { ok: false, reason: 'not_found' }
  if (!UUID_PATTERN.test(learnerAccountId)) {
    return { ok: false, reason: 'not_owner' }
  }
  const newStartMs = Date.parse(newStartAt)
  if (Number.isNaN(newStartMs)) return { ok: false, reason: 'in_past' }
  if (newStartMs <= Date.now()) return { ok: false, reason: 'in_past' }

  const newDate = new Date(newStartMs)
  const mskHour = computeMskHour(newDate)
  if (mskHour < MSK_BUSINESS_HOUR_MIN || mskHour >= MSK_BUSINESS_HOUR_MAX) {
    return { ok: false, reason: 'start_out_of_band' }
  }
  // minute-start epic (2026-06-11): 30-min grid check dropped.

  const { restorePackageConsumption, consumePackageUnit } = await import(
    '@/lib/billing/consumption'
  )

  const pool = getDbPool()
  const client = await pool.connect()
  try {
    await client.query('begin')

    // Per-learner advisory lock — same key as bookSlot / assignSlotDirect
    // so cancel-restore + new-consume serialise против concurrent booking.
    await client.query(
      `select pg_advisory_xact_lock(hashtext('pkg_consume:' || $1::text))`,
      [learnerAccountId],
    )

    // Step 1: cancel the original slot atomically (asserts learner +
    // booked + within cancel window). Returns the row OR 0 rows.
    const cancelWindowHours = getLearnerCancelWindowHours()
    const cancelRes = await client.query(
      `update lesson_slots
          set status = 'cancelled',
              cancelled_at = now(),
              cancelled_by_account_id = $2,
              cancellation_reason = $3,
              updated_at = now(),
              events = $4::jsonb || events
        where id = $1
          and learner_account_id = $2::uuid
          and status = 'booked'
          and start_at - now() >= make_interval(hours => $5::int)
        returning ${SLOT_COLUMNS}, teacher_account_id, duration_minutes, tariff_id`,
      [
        slotId,
        learnerAccountId,
        'reschedule',
        appendEventSql('slot.reschedule_cancelled', 'learner', {
          newStartAt,
        }),
        cancelWindowHours,
      ],
    )
    if (cancelRes.rows.length === 0) {
      await client.query('rollback')
      return await classifyCancelFailure(slotId, learnerAccountId)
    }
    const oldRow = cancelRes.rows[0]
    const teacherId = String(oldRow.teacher_account_id)
    const tariffId = oldRow.tariff_id ? String(oldRow.tariff_id) : null
    const durationMinutes = Number(oldRow.duration_minutes)
    const oldSlot = rowToSlot(oldRow)

    // Step 2: restore the package consumption attached to the original
    // slot (if any). Idempotent for postpaid.
    await restorePackageConsumption(client, {
      slotId,
      actor: 'learner',
      reason: 'learner_cancel',
    })

    // Step 3: external busy-cache check on new time (F3 freshness gate
    // as in bookSlot / assignSlotDirect).
    const overlap = await client.query(
      `select 1
         from teacher_external_busy_intervals b
         join teacher_calendar_integrations tci
           on tci.account_id = b.teacher_account_id
          and ${ACTIVE_INTEGRATION_GATE_SQL}
        where b.teacher_account_id = $1::uuid
          and b.is_own_event = false
          and tstzrange(b.start_at, b.end_at, '[)')
              && tstzrange(
                $2::timestamptz,
                $2::timestamptz + ($3 || ' minutes')::interval,
                '[)'
              )
        limit 1`,
      [teacherId, newStartAt, durationMinutes],
    )
    if (overlap.rows.length > 0) {
      await client.query('rollback')
      return { ok: false, reason: 'external_conflict' }
    }

    // Step 4: atomic INSERT new booked slot. Partial UNIQUE constraint
    // catches concurrent inserts on (teacher, start_at) → 23505.
    let insertRes
    try {
      insertRes = await client.query(
        `insert into lesson_slots (
           teacher_account_id, learner_account_id, start_at, duration_minutes,
           status, booked_at, tariff_id, source, events
         ) values (
           $1::uuid, $2::uuid, $3::timestamptz, $4::int,
           'booked', now(), $5::uuid, 'direct_assign', $6::jsonb
         )
         returning ${SLOT_COLUMNS}`,
        [
          teacherId,
          learnerAccountId,
          newStartAt,
          durationMinutes,
          tariffId,
          appendEventSql('slot.reschedule_created', 'learner', {
            previousSlotId: slotId,
          }),
        ],
      )
    } catch (e) {
      await client.query('rollback')
      const code = (e as { code?: string }).code
      if (code === '23505') return { ok: false, reason: 'slot_collision' }
      throw e
    }
    const newSlot = rowToSlot(insertRes.rows[0])

    // Step 5: re-consume package against the NEW slot. If original was
    // package-backed and we just restored the unit, this re-consumes it
    // against the new slot. If original was postpaid, this is a no-op
    // (no package to consume) and the new slot stays postpaid.
    if (tariffId) {
      const consume = await consumePackageUnit(client, {
        accountId: learnerAccountId,
        slotId: newSlot.id,
        durationMinutes,
        actor: 'learner',
        expectedTeacherId: teacherId,
      })
      // consume.ok=false means no eligible package → postpaid path.
      // No rollback: postpaid is a valid billing outcome (same as the
      // original slot was, if no package was attached).
      void consume
    }

    await client.query('commit')

    // Wave-A: notify teacher about learner reschedule. Best-effort
    // post-commit dispatch; never throw to caller.
    try {
      const actorName = await getActorDisplayName(learnerAccountId)
      const eventsArr = Array.isArray((insertRes.rows[0] as { events?: unknown }).events)
        ? ((insertRes.rows[0] as { events: unknown[] }).events)
        : []
      await dispatchLessonEvent('LessonRescheduledByLearner', {
        slotId: newSlot.id,
        recipientAccountId: teacherId,
        recipientRole: 'teacher',
        iterSeq: eventsArr.length,
        payload: {
          actorDisplayName: actorName,
          recipientDisplayName: 'Учитель',
          oldSlotStartAtIso: oldSlot.startAt,
          slotStartAtIso: newSlot.startAt,
          durationMinutes: durationMinutes,
        },
      })
    } catch (e) {
      console.error('[rescheduleSlotByLearner] dispatch failed', e)
    }

    return { ok: true, oldSlot, newSlot }
  } catch (e) {
    await client.query('rollback').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

async function classifyCancelFailure(
  slotId: string,
  learnerAccountId: string,
): Promise<RescheduleSlotResult> {
  const pool = getDbPool()
  const lookup = await pool.query(
    `select learner_account_id, status, start_at
       from lesson_slots where id = $1`,
    [slotId],
  )
  const row = lookup.rows[0]
  if (!row) return { ok: false, reason: 'not_found' }
  if (String(row.learner_account_id ?? '') !== learnerAccountId) {
    return { ok: false, reason: 'not_owner' }
  }
  const status = String(row.status)
  if (status !== 'booked') return { ok: false, reason: 'already_terminal' }
  const startMs = new Date(String(row.start_at)).getTime()
  const diffMs = Number.isNaN(startMs) ? -Infinity : startMs - Date.now()
  return {
    ok: false,
    reason: 'too_late_to_reschedule',
    minutesUntilStart: Math.max(0, Math.floor(diffMs / 60_000)),
  }
}

// teacher-reschedule-ui-wave-b (2026-06-16, эпик D из master plan).
//
// Симметрично rescheduleSlotByLearner, но gate = учитель владеет slot,
// reason обязательный (ученик ждёт пояснения), cancel-window НЕ
// применяется (учитель имеет полномочия перенести в любое время).
//
// Atomic: cancel original + create new booked slot (same teacher,
// learner, tariff, duration, new start_at) под per-learner advisory
// lock — те же гарантии что у learner-reschedule.
//
// Wave-A: после commit вызывает dispatchLessonEvent
// ('LessonRescheduledByTeacher'), recipient=learner.

export type RescheduleByTeacherResult =
  | { ok: true; oldSlot: LessonSlot; newSlot: LessonSlot }
  | {
      ok: false
      reason:
        | 'not_found'
        | 'not_owner'
        | 'already_terminal'
        | 'in_past'
        | 'start_out_of_band'
        | 'reason_required'
        | 'slot_collision'
        | 'external_conflict'
    }

export async function rescheduleSlotByTeacher(
  slotId: string,
  teacherAccountId: string,
  newStartAt: string,
  reason: string | null,
): Promise<RescheduleByTeacherResult> {
  if (!UUID_PATTERN.test(slotId)) return { ok: false, reason: 'not_found' }
  if (!UUID_PATTERN.test(teacherAccountId)) {
    return { ok: false, reason: 'not_owner' }
  }
  const trimmedReason = reason?.trim() ?? ''
  if (trimmedReason.length < 5) {
    return { ok: false, reason: 'reason_required' }
  }
  const newStartMs = Date.parse(newStartAt)
  if (Number.isNaN(newStartMs)) return { ok: false, reason: 'in_past' }
  if (newStartMs <= Date.now()) return { ok: false, reason: 'in_past' }
  const newDate = new Date(newStartMs)
  const mskHour = computeMskHour(newDate)
  if (mskHour < MSK_BUSINESS_HOUR_MIN || mskHour >= MSK_BUSINESS_HOUR_MAX) {
    return { ok: false, reason: 'start_out_of_band' }
  }

  const { restorePackageConsumption, consumePackageUnit } = await import(
    '@/lib/billing/consumption'
  )
  const { dispatchLessonEvent } = await import(
    '@/lib/notifications/lesson-event-dispatch'
  )
  const { getActorDisplayName } = await import(
    '@/lib/notifications/recipient-resolver'
  )

  const pool = getDbPool()
  const client = await pool.connect()
  let oldSlot: LessonSlot | null = null
  let newSlot: LessonSlot | null = null
  let learnerId: string | null = null
  let durationMinutes = 0

  try {
    await client.query('begin')

    // Step 1: cancel original (gate = teacher owns slot, status='booked',
    // no cancel-window). RETURNING gives us learner_account_id for the
    // lock + consume restore.
    const cancelRes = await client.query(
      `update lesson_slots
          set status = 'cancelled',
              cancelled_at = now(),
              cancelled_by_account_id = $2,
              cancellation_reason = $3,
              updated_at = now(),
              events = $4::jsonb || events
        where id = $1
          and teacher_account_id = $2::uuid
          and status = 'booked'
        returning ${SLOT_COLUMNS}, learner_account_id, duration_minutes, tariff_id`,
      [
        slotId,
        teacherAccountId,
        trimmedReason,
        appendEventSql('slot.reschedule_cancelled', 'teacher', {
          newStartAt,
          reason: trimmedReason,
        }),
      ],
    )
    if (cancelRes.rows.length === 0) {
      await client.query('rollback')
      return await classifyTeacherCancelFailure(slotId, teacherAccountId)
    }
    const oldRow = cancelRes.rows[0]
    learnerId = String(oldRow.learner_account_id)
    durationMinutes = Number(oldRow.duration_minutes)
    const tariffId = oldRow.tariff_id ? String(oldRow.tariff_id) : null
    oldSlot = rowToSlot(oldRow)

    // Step 2: advisory lock per-learner (same key as bookSlot /
    // assignSlotDirect / learner-reschedule) — serialises against
    // concurrent booking on this learner.
    await client.query(
      `select pg_advisory_xact_lock(hashtext('pkg_consume:' || $1::text))`,
      [learnerId],
    )

    // Step 3: restore package consumption attached to the original slot.
    await restorePackageConsumption(client, {
      slotId,
      actor: 'teacher',
      reason: 'teacher_reschedule',
    })

    // Step 4: external busy-cache check on the new start time (Google
    // Calendar). Same gate as bookSlot / learner-reschedule.
    const overlap = await client.query(
      `select 1
         from teacher_external_busy_intervals b
         join teacher_calendar_integrations tci
           on tci.account_id = b.teacher_account_id
          and ${ACTIVE_INTEGRATION_GATE_SQL}
        where b.teacher_account_id = $1::uuid
          and b.is_own_event = false
          and tstzrange(b.start_at, b.end_at, '[)')
              && tstzrange(
                $2::timestamptz,
                $2::timestamptz + ($3 || ' minutes')::interval,
                '[)'
              )
        limit 1`,
      [teacherAccountId, newStartAt, durationMinutes],
    )
    if (overlap.rows.length > 0) {
      await client.query('rollback')
      return { ok: false, reason: 'external_conflict' }
    }

    // Step 5: insert new booked slot. Partial UNIQUE catches concurrent
    // collisions → 23505.
    let insertRes
    try {
      insertRes = await client.query(
        `insert into lesson_slots (
           teacher_account_id, learner_account_id, start_at, duration_minutes,
           status, booked_at, tariff_id, source, events
         ) values (
           $1::uuid, $2::uuid, $3::timestamptz, $4::int,
           'booked', now(), $5::uuid, 'direct_assign', $6::jsonb
         )
         returning ${SLOT_COLUMNS}`,
        [
          teacherAccountId,
          learnerId,
          newStartAt,
          durationMinutes,
          tariffId,
          appendEventSql('slot.reschedule_created', 'teacher', {
            previousSlotId: slotId,
            reason: trimmedReason,
          }),
        ],
      )
    } catch (e) {
      await client.query('rollback')
      const code = (e as { code?: string }).code
      if (code === '23505') return { ok: false, reason: 'slot_collision' }
      throw e
    }
    newSlot = rowToSlot(insertRes.rows[0])

    // Step 6: re-consume package against the NEW slot.
    if (tariffId) {
      const consume = await consumePackageUnit(client, {
        accountId: learnerId,
        slotId: newSlot.id,
        durationMinutes,
        actor: 'teacher',
        expectedTeacherId: teacherAccountId,
      })
      void consume
    }

    await client.query('commit')

    // Wave-A: notify learner. Best-effort post-commit.
    try {
      const teacherName = await getActorDisplayName(teacherAccountId)
      const eventsArr = Array.isArray(insertRes.rows[0].events)
        ? (insertRes.rows[0].events as unknown[])
        : []
      await dispatchLessonEvent('LessonRescheduledByTeacher', {
        slotId: newSlot.id,
        recipientAccountId: learnerId,
        recipientRole: 'learner',
        iterSeq: eventsArr.length,
        payload: {
          actorDisplayName: teacherName,
          recipientDisplayName: 'Ученик',
          oldSlotStartAtIso: oldSlot.startAt,
          slotStartAtIso: newSlot.startAt,
          durationMinutes,
          reasonText: trimmedReason,
        },
      })
    } catch (e) {
      console.error('[rescheduleSlotByTeacher] dispatch failed', e)
    }

    return { ok: true, oldSlot, newSlot }
  } catch (e) {
    await client.query('rollback').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

async function classifyTeacherCancelFailure(
  slotId: string,
  teacherAccountId: string,
): Promise<RescheduleByTeacherResult> {
  const pool = getDbPool()
  const lookup = await pool.query(
    `select teacher_account_id, status from lesson_slots where id = $1`,
    [slotId],
  )
  const row = lookup.rows[0]
  if (!row) return { ok: false, reason: 'not_found' }
  if (String(row.teacher_account_id ?? '') !== teacherAccountId) {
    return { ok: false, reason: 'not_owner' }
  }
  if (String(row.status) !== 'booked') {
    return { ok: false, reason: 'already_terminal' }
  }
  // Defensive — shouldn't reach here unless transient race.
  return { ok: false, reason: 'already_terminal' }
}
