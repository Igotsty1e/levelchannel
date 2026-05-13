import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { requireTeacherAndVerified } from '@/lib/auth/guards'
import { deleteEvent } from '@/lib/calendar/google/push'
import { ensureFreshAccessToken } from '@/lib/calendar/google/token-refresh'
import { getDbPool } from '@/lib/db/pool'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/teacher/slots/[id]/delete-external-conflict
//
// Action b) "Удалить event в Google Calendar". Synchronous (NOT via
// the push outbox — teacher-initiated, immediate UX feedback). Plan
// §4.7:
//   1. Read slot's conflict source (calendar_id, event_id).
//   2. Check is_writable_in_source on the busy row — refuse if not.
//   3. ensureFreshAccessToken.
//   4. events.delete on the source calendar.
//   5. Clear the conflict stamp on the slot AND drop the busy row.
//
// 200/204/404/410 from Google all → ok. Plan §4.5.

type RouteParams = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: RouteParams) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(
    request,
    'teacher:slot:delete-external:ip',
    10,
    60_000,
  )
  if (rl) return rl

  const auth = await requireTeacherAndVerified(request)
  if (!auth.ok) return auth.response

  const { id: slotId } = await params
  const pool = getDbPool()

  const slotRow = await pool.query(
    `select id, teacher_account_id, conflict_source_calendar_id,
            conflict_source_event_id, external_conflict_at
       from lesson_slots
      where id = $1`,
    [slotId],
  )
  if (slotRow.rows.length === 0) {
    return NextResponse.json(
      { error: 'not_found' },
      { status: 404, headers: NO_STORE },
    )
  }
  const slot = slotRow.rows[0]
  if (String(slot.teacher_account_id) !== auth.account.id) {
    return NextResponse.json(
      { error: 'not_found' },
      { status: 404, headers: NO_STORE },
    )
  }
  const calId = slot.conflict_source_calendar_id
    ? String(slot.conflict_source_calendar_id)
    : null
  const eventId = slot.conflict_source_event_id
    ? String(slot.conflict_source_event_id)
    : null
  if (!calId || !eventId || !slot.external_conflict_at) {
    return NextResponse.json(
      { error: 'no_conflict_recorded' },
      { status: 409, headers: NO_STORE },
    )
  }

  // Check writability — refuse if the source calendar is read-only.
  const busy = await pool.query(
    `select is_writable_in_source from teacher_external_busy_intervals
      where teacher_account_id = $1
        and external_calendar_id = $2
        and external_event_id = $3`,
    [auth.account.id, calId, eventId],
  )
  if (busy.rows.length === 0) {
    // The busy interval is gone (already cleared by next pull). Nothing
    // to delete in Google. Clear the stamp on the slot.
    await pool.query(
      `update lesson_slots
          set external_conflict_at = null,
              external_conflict_kind = null,
              conflict_source_calendar_id = null,
              conflict_source_event_id = null,
              updated_at = now()
        where id = $1`,
      [slotId],
    )
    return NextResponse.json(
      { ok: true, action: 'cleared_locally', deletedInGoogle: false },
      { status: 200, headers: NO_STORE },
    )
  }
  if (!busy.rows[0].is_writable_in_source) {
    return NextResponse.json(
      {
        error: 'source_not_writable',
        message:
          'Эту встречу нельзя удалить в Google из LevelChannel — календарь только для чтения.',
      },
      { status: 403, headers: NO_STORE },
    )
  }

  const fresh = await ensureFreshAccessToken({
    accountId: auth.account.id,
  })
  if (!fresh.ok) {
    return NextResponse.json(
      {
        error: 'token_unavailable',
        reason: fresh.reason,
      },
      { status: 503, headers: NO_STORE },
    )
  }

  const deleted = await deleteEvent({
    accessToken: fresh.accessToken,
    externalCalendarId: calId,
    eventId,
  })
  if (!deleted.ok) {
    return NextResponse.json(
      {
        error: 'google_delete_failed',
        kind: deleted.error.kind,
      },
      { status: 502, headers: NO_STORE },
    )
  }

  // Clear conflict stamp + drop busy row.
  await pool.query(
    `delete from teacher_external_busy_intervals
      where teacher_account_id = $1
        and external_calendar_id = $2
        and external_event_id = $3`,
    [auth.account.id, calId, eventId],
  )
  await pool.query(
    `update lesson_slots
        set external_conflict_at = null,
            external_conflict_kind = null,
            conflict_source_calendar_id = null,
            conflict_source_event_id = null,
            updated_at = now()
      where id = $1`,
    [slotId],
  )

  return NextResponse.json(
    {
      ok: true,
      action: 'deleted_in_google',
      deletedInGoogle: true,
      googleStatus: deleted.status,
    },
    { status: 200, headers: NO_STORE },
  )
}
