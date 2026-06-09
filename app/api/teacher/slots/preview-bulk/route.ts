import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { readJsonObjectOr400 } from '@/lib/api/json-body'
import { requireTeacherAndVerified } from '@/lib/auth/guards'
import {
  RecurrenceInputError,
  expandRecurrence,
  type DayOfWeek,
} from '@/lib/calendar/recurrence'
import { getDbPool } from '@/lib/db/pool'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Preview endpoint for the bulk-add slots form.
 *
 * Body:
 *   {
 *     startDate: 'YYYY-MM-DD',
 *     endDate:   'YYYY-MM-DD',
 *     daysOfWeek: number[] (0=Sun..6=Sat),
 *     times:      string[] (HH:MM, MSK wall clock),
 *     durationMinutes: number,
 *   }
 *
 * Response:
 *   {
 *     willCreate: { startUtcIso, durationMinutes }[],
 *     skippedReasons: { startUtcIso, reason }[],
 *     conflicts: { startUtcIso }[]
 *   }
 *
 * Conflicts are detected by querying lesson_slots for the same
 * teacher_account_id and start_at matching one of the preview rows
 * with status <> 'cancelled' (partial unique index mig 0035).
 */

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

function asDayOfWeek(n: unknown): DayOfWeek | null {
  if (typeof n !== 'number' || !Number.isInteger(n)) return null
  if (n < 0 || n > 6) return null
  return n as DayOfWeek
}

export async function POST(request: Request) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate
  const rl = await enforceRateLimit(
    request,
    'teacher:slots:preview-bulk:ip',
    30,
    60_000,
  )
  if (rl) return rl
  const guard = await requireTeacherAndVerified(request)
  if (!guard.ok) return guard.response

  const parsed = await readJsonObjectOr400(request)
  if (!parsed.ok) return parsed.response
  const raw = parsed.body

  const startDate = typeof raw.startDate === 'string' ? raw.startDate : ''
  const endDate = typeof raw.endDate === 'string' ? raw.endDate : ''
  const durationMinutes =
    typeof raw.durationMinutes === 'number' ? raw.durationMinutes : 0
  const daysOfWeekRaw = Array.isArray(raw.daysOfWeek) ? raw.daysOfWeek : []
  const timesRaw = Array.isArray(raw.times) ? raw.times : []
  const daysOfWeek = daysOfWeekRaw
    .map(asDayOfWeek)
    .filter((v): v is DayOfWeek => v !== null)
  const times = timesRaw.filter(
    (t): t is string => typeof t === 'string' && TIME_RE.test(t),
  )

  try {
    const expanded = expandRecurrence({
      startDate,
      endDate,
      daysOfWeek,
      times,
      durationMinutes,
    })

    const willCreate = expanded.slots
    const conflicts: string[] = []
    if (willCreate.length > 0) {
      const startsAt = willCreate.map((s) => s.startUtcIso)
      const pool = getDbPool()
      const res = await pool.query<{ start_at: string }>(
        `select start_at
           from lesson_slots
          where teacher_account_id = $1::uuid
            and status <> 'cancelled'
            and start_at = any($2::timestamptz[])`,
        [guard.account.id, startsAt],
      )
      for (const row of res.rows) {
        conflicts.push(new Date(row.start_at).toISOString())
      }
    }
    const conflictSet = new Set(conflicts)
    const final = willCreate.filter((s) => !conflictSet.has(s.startUtcIso))

    return NextResponse.json(
      {
        willCreate: final,
        skippedReasons: expanded.skipped,
        conflicts: Array.from(conflictSet).map((s) => ({ startUtcIso: s })),
        truncatedAt200: willCreate.length > 200,
      },
      { status: 200, headers: NO_STORE },
    )
  } catch (err) {
    if (err instanceof RecurrenceInputError) {
      return NextResponse.json(
        { error: err.message },
        { status: 400, headers: NO_STORE },
      )
    }
    console.error('[teacher.slots.preview-bulk] unexpected', err)
    return NextResponse.json(
      { error: 'internal_error' },
      { status: 500, headers: NO_STORE },
    )
  }
}
