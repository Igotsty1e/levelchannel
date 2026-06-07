// Read helper for the teacher-calendar summary widget.
//
// Returns the few numbers + next-slot needed by `CalendarSummary`.
// All boundary math is done in Postgres `AT TIME ZONE teacher_tz`
// so the day/week windows match the rest of the calendar contour
// (digest preview, conflict probes, lesson cron).

import { getDbPool } from '@/lib/db/pool'
import { safeTimezone } from '@/lib/auth/timezones'

export type CalendarSummary = {
  todayCount: number
  nextSlot: {
    startAt: string
    durationMinutes: number
    label: string
  } | null
  weekBookedCount: number
  weekOpenCount: number
  /** sum of `tariff_amount_kopecks` over booked slots in the current
   *  week (booked but not yet paid is the same kopeck — tariff is the
   *  price the learner agreed to). Null = no priced slots → don't show. */
  weekEarningsKopecks: number | null
  teacherTz: string
  todayLocalYmd: string
}

export async function getTeacherCalendarSummary(
  teacherAccountId: string,
  fromYmd: string,
): Promise<CalendarSummary> {
  const pool = getDbPool()

  const tzRow = await pool.query<{ raw_tz: string | null }>(
    `select timezone as raw_tz from account_profiles where account_id = $1::uuid`,
    [teacherAccountId],
  )
  const teacherTz = safeTimezone(tzRow.rows[0]?.raw_tz ?? null)

  // Today bucket + today_local string (text to dodge JS tz drift —
  // see lib/notifications/teacher-digest-preview.ts comment).
  const today = await pool.query<{ count: number; today_local: string }>(
    `select count(*)::int as count,
            to_char((now() AT TIME ZONE $2)::date, 'YYYY-MM-DD') as today_local
       from lesson_slots s
      where s.teacher_account_id = $1::uuid
        and s.status = 'booked'
        and s.start_at >= ((now() AT TIME ZONE $2)::date)::timestamp AT TIME ZONE $2
        and s.start_at <  (((now() AT TIME ZONE $2)::date + 1)::timestamp) AT TIME ZONE $2`,
    [teacherAccountId, teacherTz],
  )
  const todayCount = today.rows[0]?.count ?? 0
  const todayLocalYmd = today.rows[0]?.today_local ?? fromYmd

  // Week bucket — booked + open + earnings (tariff price × booked) in
  // one shot. fromYmd is the Monday in teacher_tz; the +7d bound is
  // computed at SQL level.
  const week = await pool.query<{
    booked: number
    opened: number
    earnings: string | null
  }>(
    `select
       count(*) filter (where s.status = 'booked')::int as booked,
       count(*) filter (where s.status = 'open')::int as opened,
       sum(s.snapshot_amount_kopecks) filter (where s.status = 'booked') as earnings
     from lesson_slots s
     where s.teacher_account_id = $1::uuid
       and s.status in ('booked', 'open')
       and s.start_at >= ($3::date)::timestamp AT TIME ZONE $2
       and s.start_at <  (($3::date + 7)::timestamp) AT TIME ZONE $2`,
    [teacherAccountId, teacherTz, fromYmd],
  )
  const weekBookedCount = week.rows[0]?.booked ?? 0
  const weekOpenCount = week.rows[0]?.opened ?? 0
  const earningsRaw = week.rows[0]?.earnings
  const weekEarningsKopecks =
    earningsRaw !== null && earningsRaw !== undefined
      ? Number(earningsRaw)
      : null

  // Next slot — earliest future booked slot with learner info.
  const next = await pool.query<{
    start_at: Date | string
    duration_minutes: number
    learner_email: string | null
    first_name: string | null
    last_name: string | null
    display_name: string | null
  }>(
    `select s.start_at,
            s.duration_minutes,
            la.email          as learner_email,
            ap.first_name,
            ap.last_name,
            ap.display_name
       from lesson_slots s
       left join accounts la on la.id = s.learner_account_id
       left join account_profiles ap on ap.account_id = la.id
      where s.teacher_account_id = $1::uuid
        and s.status = 'booked'
        and s.start_at > now()
      order by s.start_at asc
      limit 1`,
    [teacherAccountId],
  )
  let nextSlot: CalendarSummary['nextSlot'] = null
  if (next.rows.length > 0) {
    const r = next.rows[0]
    const composed =
      [r.first_name, r.last_name].filter(Boolean).join(' ').trim()
    const label =
      composed || r.display_name?.trim() || r.learner_email || 'Ученик'
    nextSlot = {
      startAt: new Date(String(r.start_at)).toISOString(),
      durationMinutes: Number(r.duration_minutes),
      label,
    }
  }

  return {
    todayCount,
    nextSlot,
    weekBookedCount,
    weekOpenCount,
    weekEarningsKopecks,
    teacherTz,
    todayLocalYmd,
  }
}
