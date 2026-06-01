// BCS-B.2 — Calendly screen 1/2 data layer.
//
// Two read-only queries that power the Calendly-style day picker
// (`GET /api/slots/booking-days`) and the per-day time list
// (`GET /api/slots/booking-times`).
//
// Why a sibling module and not an extension of queries.ts: these are
// learner-facing and projected through `toPublicSlot` at the route
// boundary. Keeping them in their own file makes the visibility
// boundary explicit — `queries.ts` mixes admin / teacher / public
// shapes; these are public-only.
//
// Timezone handling: callers pass an IANA tz string. The day grouping
// happens in Postgres via `AT TIME ZONE` against the timestamptz
// `start_at` column. The btree index on `(teacher_account_id, start_at)`
// stays usable because the range bounds are computed pre-query.
//
// NOTE: a future BCS-D wave will add a busy-interval overlap filter
// (`AND NOT EXISTS (... teacher_external_busy_intervals ...)`). The
// current MVP shape (status='open' + future) is the minimum useful
// surface for shipping the Calendly UI before Google sync lands.

import { getDbPool } from '@/lib/db/pool'

import { UUID_PATTERN, rowToSlot } from './internal'
import type { LessonSlot } from './types'

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_DAYS_RANGE_DAYS = 92 // ~3 months guard against runaway queries
const DEFAULT_TIMES_PER_DAY = 96 // worst-case 30-min slots over 24h

// Codex B.2 review: bare regex accepts `2026-02-31` / `2026-13-01` and
// lets them reach Postgres `::date` cast, which raises and surfaces as
// a 500. Real calendar-date validation: parse + round-trip and check
// the parts match. We deliberately use UTC components because the
// query passes the YMD string into a `$X::date AT TIME ZONE $tz`
// expression — Postgres `::date` is calendar-naïve, so we just need
// to confirm the date *exists* before binding.
export function isValidYmd(value: string): boolean {
  if (!YMD_RE.test(value)) return false
  const y = Number(value.slice(0, 4))
  const m = Number(value.slice(5, 7))
  const d = Number(value.slice(8, 10))
  if (m < 1 || m > 12 || d < 1 || d > 31) return false
  const dt = new Date(Date.UTC(y, m - 1, d))
  return (
    dt.getUTCFullYear() === y
    && dt.getUTCMonth() === m - 1
    && dt.getUTCDate() === d
  )
}

export type BookingRangeError =
  | { code: 'invalid_from'; message: string }
  | { code: 'invalid_to'; message: string }
  | { code: 'invalid_tz'; message: string }
  | { code: 'range_inverted'; message: string }
  | { code: 'range_too_wide'; message: string }

export function validateBookingRange(input: {
  fromYmd: string | null
  toYmd: string | null
  tz: string | null
}): BookingRangeError | null {
  if (!input.fromYmd || !isValidYmd(input.fromYmd)) {
    return { code: 'invalid_from', message: '`from` must be a real YYYY-MM-DD date' }
  }
  if (!input.toYmd || !isValidYmd(input.toYmd)) {
    return { code: 'invalid_to', message: '`to` must be a real YYYY-MM-DD date' }
  }
  if (!input.tz || !isValidIanaTz(input.tz)) {
    return { code: 'invalid_tz', message: '`tz` must be a valid IANA timezone' }
  }
  // Inverted range check: lexicographic compare on YYYY-MM-DD works.
  if (input.fromYmd > input.toYmd) {
    return { code: 'range_inverted', message: '`from` must be ≤ `to`' }
  }
  // Range cap: compute calendar-day delta naively (ignoring tz; the
  // bound is for query-cost containment, not for billing precision).
  const fromMs = Date.UTC(
    Number(input.fromYmd.slice(0, 4)),
    Number(input.fromYmd.slice(5, 7)) - 1,
    Number(input.fromYmd.slice(8, 10)),
  )
  const toMs = Date.UTC(
    Number(input.toYmd.slice(0, 4)),
    Number(input.toYmd.slice(5, 7)) - 1,
    Number(input.toYmd.slice(8, 10)),
  )
  const days = (toMs - fromMs) / 86_400_000
  if (days > MAX_DAYS_RANGE_DAYS) {
    return {
      code: 'range_too_wide',
      message: `range must not exceed ${MAX_DAYS_RANGE_DAYS} days`,
    }
  }
  return null
}

export function isValidIanaTz(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

// Returns YYYY-MM-DD strings (in the provided tz) on which the given
// teacher has at least one OPEN, future slot in the given inclusive
// date range. Empty array when teacher has no matches.
export async function listOpenBookingDays(params: {
  teacherAccountId: string
  fromYmd: string
  toYmd: string
  tz: string
  /** T3 epic-end R1-BLOCKER#2 closure (2026-06-02): viewer for the
   *  private-tariff visibility filter. `null` / undefined excludes
   *  private-tariff slots entirely. */
  viewerAccountId?: string | null
}): Promise<string[]> {
  if (!UUID_PATTERN.test(params.teacherAccountId)) return []
  // Belt-and-suspenders: route already validated, but a direct caller
  // (future BCS-D pull-side reuse) might forget — refuse to bind a
  // string we couldn't ourselves cast to `::date` cleanly.
  if (!isValidYmd(params.fromYmd) || !isValidYmd(params.toYmd)) return []
  if (!isValidIanaTz(params.tz)) return []
  const pool = getDbPool()
  const result = await pool.query(
    `select distinct to_char(s.start_at at time zone $4, 'YYYY-MM-DD') as ymd
       from lesson_slots s
       left join pricing_tariffs t on t.id = s.tariff_id
      where s.status = 'open'
        and s.teacher_account_id = $1
        and s.start_at >= ($2::date at time zone $4)
        and s.start_at <  (($3::date + 1) at time zone $4)
        and s.start_at > now()
        and (
          s.tariff_id is null
          or t.visibility = 'catalog'
          or (
            t.visibility = 'private'
            and $5::uuid is not null
            and exists (
              select 1 from learner_tariff_access lta
               where lta.tariff_id = t.id
                 and lta.learner_account_id = $5::uuid
                 and lta.revoked_at is null
            )
          )
        )
      order by ymd asc`,
    [
      params.teacherAccountId,
      params.fromYmd,
      params.toYmd,
      params.tz,
      params.viewerAccountId ?? null,
    ],
  )
  return result.rows.map((r) => String(r.ymd))
}

// Returns OPEN, future slots whose `start_at` falls within the given
// calendar day in the provided tz. Ordered by start_at ascending.
// Bounded by DEFAULT_TIMES_PER_DAY to keep the response small.
export async function listOpenBookingTimes(params: {
  teacherAccountId: string
  ymd: string
  tz: string
  limit?: number
  /** T3 epic-end R1-BLOCKER#2 closure — viewer for visibility filter. */
  viewerAccountId?: string | null
}): Promise<LessonSlot[]> {
  if (!UUID_PATTERN.test(params.teacherAccountId)) return []
  if (!isValidYmd(params.ymd)) return []
  if (!isValidIanaTz(params.tz)) return []
  const pool = getDbPool()
  const limit = Math.min(
    Math.max(params.limit ?? DEFAULT_TIMES_PER_DAY, 1),
    200,
  )
  const result = await pool.query(
    `select s.id, s.teacher_account_id, s.start_at, s.duration_minutes,
            s.status, s.learner_account_id, s.booked_at, s.cancelled_at,
            s.cancelled_by_account_id, s.cancellation_reason, s.marked_at,
            s.tariff_id, s.notes, s.events, s.created_at, s.updated_at,
            t.slug as tariff_slug,
            t.title_ru as tariff_title_ru,
            t.amount_kopecks as tariff_amount_kopecks
       from lesson_slots s
       left join pricing_tariffs t on t.id = s.tariff_id
      where s.status = 'open'
        and s.teacher_account_id = $1
        and s.start_at >= ($2::date at time zone $3)
        and s.start_at <  (($2::date + 1) at time zone $3)
        and s.start_at > now()
        and (
          s.tariff_id is null
          or t.visibility = 'catalog'
          or (
            t.visibility = 'private'
            and $5::uuid is not null
            and exists (
              select 1 from learner_tariff_access lta
               where lta.tariff_id = t.id
                 and lta.learner_account_id = $5::uuid
                 and lta.revoked_at is null
            )
          )
        )
      order by s.start_at asc
      limit $4`,
    [
      params.teacherAccountId,
      params.ymd,
      params.tz,
      limit,
      params.viewerAccountId ?? null,
    ],
  )
  return result.rows.map((r) =>
    rowToSlot(r, {
      tariffSlug: r.tariff_slug ? String(r.tariff_slug) : null,
      tariffTitleRu: r.tariff_title_ru ? String(r.tariff_title_ru) : null,
      tariffAmountKopecks:
        r.tariff_amount_kopecks !== null
        && r.tariff_amount_kopecks !== undefined
          ? Number(r.tariff_amount_kopecks)
          : null,
    }),
  )
}
