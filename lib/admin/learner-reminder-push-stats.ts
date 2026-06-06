import { getAuthPool } from '@/lib/auth/pool'
import { isUndefinedTableError } from '@/lib/db/errors'

// BCS-DEF-4-PUSH (2026-06-06) — admin reader surface for push channel
// counters on /admin/settings/alerts. Mirrors the email/telegram
// counters already shown on the learner-reminders card.
//
// Plan: docs/plans/bcs-def-4-push-pwa-reminders.md §3.10

export type RecentPushDispatchCounts = {
  sent: number
  skipped: Record<string, number>
  migrationPending: boolean
}

export async function getRecentPushDispatchCounts(
  windowMinutes = 60,
): Promise<RecentPushDispatchCounts> {
  try {
    const pool = getAuthPool()
    const res = await pool.query(
      `SELECT status, skipped_reason, COUNT(*)::int AS n
         FROM learner_reminder_dispatches
        WHERE channel = 'push'
          AND created_at >= now() - ($1::int || ' minutes')::interval
        GROUP BY status, skipped_reason`,
      [windowMinutes],
    )
    let sent = 0
    const skipped: Record<string, number> = {}
    for (const row of res.rows) {
      const status = String(row.status)
      const n = Number(row.n)
      if (status === 'sent') {
        sent += n
      } else {
        const reason = row.skipped_reason ? String(row.skipped_reason) : 'unknown'
        skipped[reason] = (skipped[reason] ?? 0) + n
      }
    }
    return { sent, skipped, migrationPending: false }
  } catch (err) {
    if (isUndefinedTableError(err)) {
      return { sent: 0, skipped: {}, migrationPending: true }
    }
    throw err
  }
}
