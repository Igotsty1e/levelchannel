// Teacher-cabinet-polish (2026-05-23) — TASK-3 Sub-PR D.
//
// Pure read helper that returns the teacher's "today_local" booked
// slot list — same projection as the daily digest cron at
// `scripts/teacher-daily-digest.mjs`, intentionally aligned 1:1 so the
// dashboard tile, the digest email, and the operator preview at
// `/admin/(gated)/settings/digest` agree on what counts as "today".
//
// SQL parity contract (plan §3 Sub-PR D + round-2 BLOCKER #2):
//
//   - candidate predicate identical to
//     scripts/teacher-daily-digest.mjs:selectTeacherSlotsForLocalDay
//     (the cron's per-teacher SELECT):
//       start_at >= today_local_00:00 AT TIME ZONE teacher_tz
//       AND start_at < tomorrow_local_00:00 AT TIME ZONE teacher_tz
//   - teacher_tz sourced from account_profiles.timezone with
//     'Europe/Moscow' default when NULL — mirrors `safeTimezone()` in
//     `lib/auth/timezones.ts` (the cron uses the .mjs twin in
//     `scripts/lib/timezone.mjs`). Whitelisted via safeTimezone so a
//     legacy non-allowlist value can't fall through into Postgres.
//   - today_local_ymd computed inside the same SQL statement via
//     `(now() AT TIME ZONE teacher_tz)::date` so a JS/Postgres clock
//     skew can't drift the day boundary by 30s.
//
// Pure read — no mutations, no email, no Telegram, no probe_runs row.
// Anti-spoof: caller is responsible for resolving `teacherAccountId`
// from the authenticated session; this helper never trusts a body.
// Parameterized via $1/$2 (no user-supplied SQL).

import { getDbPool } from '@/lib/db/pool'
import { safeTimezone } from '@/lib/auth/timezones'

export type PreviewSlot = {
  id: string
  startAt: string
  durationMinutes: number
  learnerEmail: string | null
  learnerName: string | null
  zoomUrl: string | null
  status: string
}

export type TeacherDigestPreview = {
  slots: PreviewSlot[]
  todayLocalYmd: string
  teacherTz: string
}

export async function getTeacherDigestPreview(
  teacherAccountId: string,
): Promise<TeacherDigestPreview> {
  const pool = getDbPool()

  // Step 1 — resolve teacher tz (default Europe/Moscow if profile row
  // missing or timezone NULL). Whitelist-clamped via safeTimezone so
  // a legacy value outside ALLOWED_TIMEZONES doesn't end up in the
  // AT TIME ZONE projection below (Postgres would still accept it,
  // but the rest of the cabinet — cron, render helpers — clamps to
  // the allowlist, and we want one tz answer per teacher).
  const tzRow = await pool.query<{ raw_tz: string | null }>(
    `select p.timezone as raw_tz
       from account_profiles p
      where p.account_id = $1::uuid`,
    [teacherAccountId],
  )
  const rawTz = tzRow.rows[0]?.raw_tz ?? null
  const teacherTz = safeTimezone(rawTz)

  // Step 2 — same SQL predicate as the cron's per-teacher SELECT
  // (scripts/teacher-daily-digest.mjs `selectTeacherSlotsForLocalDay`).
  // We additionally compute today_local_ymd inside the same SELECT so
  // the helper returns a self-consistent (date, slots) tuple — the
  // cron computes ymd at JS level via `nowInTimezoneParts`, but the
  // SQL window predicate is identical because both expressions
  // dereference `now()` and the same `teacher_tz` constant.
  //
  // Round-2 BLOCKER #2 closure: cron compares `start_at >=
  // ($ymd::date)::timestamp AT TIME ZONE $tz`. We express the same
  // window inline using `(now() AT TIME ZONE $tz)::date` so the helper
  // doesn't need a separate ymd input — but the inequality is the
  // same calendar-day boundary the cron uses, so a slot at today_local
  // 23:30 stays in, tomorrow_local 00:30 stays out.
  //
  // The cron preserves `status = 'booked'` filter; the dashboard tile
  // also surfaces today's slot regardless of cancellation, so we keep
  // the filter ('booked') matching the cron exactly. Cancelled /
  // completed rows are NOT shown in today's list — same as the email.
  const slotRes = await pool.query<{
    id: string
    start_at: Date | string
    duration_minutes: number
    status: string
    learner_email: string | null
    learner_display_name: string | null
    zoom_url: string | null
    today_local: string
  }>(
    // today_local is returned as a TEXT 'YYYY-MM-DD' string (via
    // to_char) so the Node-tz of the server can't drift the day boundary
    // when the row is parsed. Previously we returned ::date and called
    // .toISOString().slice(0,10) on it, which silently subtracted a day
    // for any Node process running east of UTC.
    `select s.id,
            s.start_at,
            s.duration_minutes,
            s.status,
            la.email          as learner_email,
            lp.display_name   as learner_display_name,
            s.zoom_url,
            to_char((now() AT TIME ZONE $2)::date, 'YYYY-MM-DD') as today_local
       from lesson_slots s
       left join accounts la         on la.id = s.learner_account_id
       left join account_profiles lp on lp.account_id = s.learner_account_id
      where s.teacher_account_id = $1::uuid
        and s.status = 'booked'
        and s.start_at >= ((now() AT TIME ZONE $2)::date)::timestamp AT TIME ZONE $2
        and s.start_at <  (((now() AT TIME ZONE $2)::date + 1)::timestamp) AT TIME ZONE $2
      order by s.start_at asc`,
    [teacherAccountId, teacherTz],
  )

  let todayLocalYmd: string
  if (slotRes.rows.length > 0) {
    todayLocalYmd = String(slotRes.rows[0].today_local)
  } else {
    const dateRes = await pool.query<{ today_local: string }>(
      `select to_char((now() AT TIME ZONE $1)::date, 'YYYY-MM-DD') as today_local`,
      [teacherTz],
    )
    todayLocalYmd = String(dateRes.rows[0].today_local)
  }

  const slots: PreviewSlot[] = slotRes.rows.map((row) => ({
    id: String(row.id),
    startAt: new Date(String(row.start_at)).toISOString(),
    durationMinutes: Number(row.duration_minutes),
    learnerEmail: row.learner_email ? String(row.learner_email) : null,
    learnerName: row.learner_display_name
      ? String(row.learner_display_name)
      : null,
    zoomUrl: row.zoom_url ? String(row.zoom_url) : null,
    status: String(row.status),
  }))

  return { slots, todayLocalYmd, teacherTz }
}
