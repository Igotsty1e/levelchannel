import { isUndefinedTableError } from '@/lib/db/errors'
import { getDbPool } from '@/lib/db/pool'

// BCS-DEF-5 (2026-05-19) — admin-side readers for /admin/settings/digest.
// Plan: docs/plans/bcs-def-5-teacher-reminders.md §2.7.
//
// Three widgets:
//   1. Last-tick summary — most-recent probe_runs row where
//      probe_name='teacher-daily-digest'.
//   2. 7-day summary table — per-day counts of sent / empty_day /
//      errors from teacher_account_daily_digests.
//
// Both readers return `{ migrationPending: true }` if the underlying
// table doesn't exist (deploy window before `npm run migrate:up` ran).

export type DigestLastRun =
  | { migrationPending: true }
  | {
      migrationPending?: false
      lastRun: {
        ranAt: string
        verdictKind: string
        stats: Record<string, unknown> | null
        errorMessage: string | null
      } | null
    }

export async function getDigestLastRun(): Promise<DigestLastRun> {
  const pool = getDbPool()
  try {
    const r = await pool.query(
      `select ran_at, verdict_kind, stats, error_message
         from probe_runs
        where probe_name = 'teacher-daily-digest'
          and is_test = false
        order by ran_at desc
        limit 1`,
    )
    const row = r.rows[0] ?? null
    return {
      lastRun: row
        ? {
            ranAt: new Date(String(row.ran_at)).toISOString(),
            verdictKind: String(row.verdict_kind),
            stats: row.stats as Record<string, unknown> | null,
            errorMessage: row.error_message
              ? String(row.error_message)
              : null,
          }
        : null,
    }
  } catch (err) {
    if (isUndefinedTableError(err)) return { migrationPending: true }
    throw err
  }
}

export type DigestDayStat = {
  date: string // 'YYYY-MM-DD'
  sent: number
  emptyDay: number
  errors: number
}

export type DigestSevenDaySummary =
  | { migrationPending: true }
  | { migrationPending?: false; days: DigestDayStat[] }

export async function getDigestSevenDaySummary(): Promise<DigestSevenDaySummary> {
  const pool = getDbPool()
  try {
    // Aggregate by sent_date over the trailing 7 days. We pull both
    // sent + skipped rows in one round-trip and bucket in TS.
    const r = await pool.query(
      `select sent_date,
              count(*) filter (where email_sent = true)::int as sent,
              count(*) filter (where skipped_reason = 'empty_day')::int
                as empty_day,
              count(*) filter (where
                skipped_reason = 'send_failed'
                or last_error is not null
              )::int as errors
         from teacher_account_daily_digests
        where sent_date >= (current_date - interval '6 days')::date
        group by sent_date
        order by sent_date desc`,
    )
    const days: DigestDayStat[] = r.rows.map((row) => ({
      date: new Date(String(row.sent_date)).toISOString().slice(0, 10),
      sent: Number(row.sent ?? 0),
      emptyDay: Number(row.empty_day ?? 0),
      errors: Number(row.errors ?? 0),
    }))
    return { days }
  } catch (err) {
    if (isUndefinedTableError(err)) return { migrationPending: true }
    throw err
  }
}
