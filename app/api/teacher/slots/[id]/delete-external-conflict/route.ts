import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { requireTeacherWithCurrentSaasOfferConsent } from '@/lib/auth/guards'
import { deleteEvent } from '@/lib/calendar/google/push'
import { withTokenRetry, type CallResult } from '@/lib/calendar/token-retry'
import { enqueuePullJob } from '@/lib/calendar/pull-worker'
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
//   5. Single-TX cleanup guarded by (teacher_id, cal_id, event_id):
//        - DELETE matching busy intervals.
//        - UPDATE *all* lesson_slots still pointing at the same
//          (cal_id, event_id). One deleted event can have flagged
//          several booked slots (long meetings, all-day events) —
//          §4.7 says clear them all optimistically.
//        - Guard prevents silently overwriting a concurrent
//          re-stamp from a fresh pull/dismiss.
//   6. Enqueue a priority-2 pull so the channel-watch side re-converges
//      fast.
//
// 200/204/404/410 from Google all → ok. Plan §4.5.

type RouteParams = { params: Promise<{ id: string }> }

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

  const auth = await requireTeacherWithCurrentSaasOfferConsent(request)
  if (!auth.ok) return auth.response

  const { id: slotId } = await params
  if (!UUID_PATTERN.test(slotId)) {
    // Hostile / bad client. Don't 500 on a pg uuid-cast error.
    return NextResponse.json(
      { error: 'not_found' },
      { status: 404, headers: NO_STORE },
    )
  }
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
    // The busy interval is already gone (a pull cleared it underneath
    // us). Nothing to delete in Google. Clear the stamp on *every*
    // slot still pointing at this (cal_id, event_id) in a single
    // guarded statement.
    const cleared = await pool.query(
      `update lesson_slots
          set external_conflict_at = null,
              external_conflict_kind = null,
              conflict_source_calendar_id = null,
              conflict_source_event_id = null,
              updated_at = now()
        where teacher_account_id = $1
          and conflict_source_calendar_id = $2
          and conflict_source_event_id = $3
        returning id`,
      [auth.account.id, calId, eventId],
    )
    return NextResponse.json(
      {
        ok: true,
        action: 'cleared_locally',
        deletedInGoogle: false,
        clearedSlots: cleared.rows.length,
      },
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

  // BCS-OP-ROLLOUT plan §4.6 — wrap deleteEvent with withTokenRetry.
  // First 401 → force-refresh, retry. Second 401 → integration flipped
  // to disconnected (handled inside the helper).
  const wrapped = await withTokenRetry(
    auth.account.id,
    async (token): Promise<CallResult<true>> => {
      const r = await deleteEvent({
        accessToken: token,
        externalCalendarId: calId,
        eventId,
      })
      if (r.ok) return { ok: true, value: true }
      const auth401 = r.error.kind === 'http' && r.error.status === 401
      return { ok: false, auth401, raw: r.error }
    },
  )
  if (!wrapped.ok) {
    const raw = wrapped.raw as { kind?: string; reason?: string }
    if (raw && typeof raw.kind === 'string') {
      return NextResponse.json(
        {
          error: 'google_delete_failed',
          kind: raw.kind,
        },
        { status: 502, headers: NO_STORE },
      )
    }
    return NextResponse.json(
      {
        error: 'token_unavailable',
        reason: raw?.reason ?? 'unknown',
      },
      { status: 503, headers: NO_STORE },
    )
  }

  // Single-TX cleanup guarded by (teacher_id, cal_id, event_id) — a
  // concurrent re-stamp pointing at a different event will NOT match
  // the WHERE clause and will be left alone.
  let clearedSlots = 0
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query(
      `delete from teacher_external_busy_intervals
        where teacher_account_id = $1
          and external_calendar_id = $2
          and external_event_id = $3`,
      [auth.account.id, calId, eventId],
    )
    const slotsCleared = await client.query(
      `update lesson_slots
          set external_conflict_at = null,
              external_conflict_kind = null,
              conflict_source_calendar_id = null,
              conflict_source_event_id = null,
              updated_at = now()
        where teacher_account_id = $1
          and conflict_source_calendar_id = $2
          and conflict_source_event_id = $3
        returning id`,
      [auth.account.id, calId, eventId],
    )
    clearedSlots = slotsCleared.rows.length
    await client.query('commit')
  } catch (err) {
    await client.query('rollback')
    throw err
  } finally {
    client.release()
  }

  // Best-effort priority-2 pull: the channel-watch side should see the
  // delete fast and re-converge on the next pull cycle. A failure here
  // doesn't roll back the user-visible work — the scheduled pull cron
  // will catch up.
  try {
    await enqueuePullJob({
      teacherAccountId: auth.account.id,
      externalCalendarId: calId,
      priority: 2,
    })
  } catch {
    // Non-fatal — see comment above.
  }

  return NextResponse.json(
    {
      ok: true,
      action: 'deleted_in_google',
      deletedInGoogle: true,
      // After withTokenRetry the inner call returned ok:true with
      // value:true (we don't preserve the Google status code). Surface
      // HTTP 204 by convention — Google's events.delete returns 204
      // No Content on success.
      googleStatus: 204,
      clearedSlots,
    },
    { status: 200, headers: NO_STORE },
  )
}
