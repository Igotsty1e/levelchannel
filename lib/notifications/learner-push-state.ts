import { resolveOperatorSetting } from '@/lib/admin/operator-settings'
import { getAuthPool } from '@/lib/auth/pool'
import { isUndefinedTableError } from '@/lib/db/errors'

// BCS-DEF-4-PUSH (2026-06-06) — SSR helper for the cabinet push UI.
// Resolves the 4-state contract documented in §3.9 + acceptance §10.
//
// Plan: docs/plans/bcs-def-4-push-pwa-reminders.md §3.9

export type LearnerPushState =
  | { kind: 'disabled' }
  | { kind: 'unconfigured' }
  | { kind: 'migrationPending' }
  | {
      kind: 'ready'
      vapidPublicKey: string
      activeDevices: Array<{
        id: string
        userAgent: string | null
        lastUsedAt: string | null
      }>
    }

export async function resolveLearnerPushState(
  accountId: string,
): Promise<LearnerPushState> {
  const setting = await resolveOperatorSetting(
    'LEARNER_REMINDERS_PUSH_ENABLED',
  )
  if (setting.dbErrored || setting.value !== 1) {
    return { kind: 'disabled' }
  }
  const vapidPublicKey = (process.env.PUSH_VAPID_PUBLIC_KEY ?? '').trim()
  const vapidPrivateKey = (process.env.PUSH_VAPID_PRIVATE_KEY ?? '').trim()
  const vapidSubject = (process.env.PUSH_VAPID_SUBJECT ?? '').trim()
  if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
    return { kind: 'unconfigured' }
  }
  try {
    const pool = getAuthPool()
    const res = await pool.query(
      `SELECT id, user_agent, last_used_at
         FROM learner_push_subscriptions
        WHERE account_id = $1::uuid AND unsubscribed_at IS NULL
        ORDER BY id DESC`,
      [accountId],
    )
    return {
      kind: 'ready',
      vapidPublicKey,
      activeDevices: res.rows.map((row) => ({
        id: String(row.id),
        userAgent: row.user_agent ? String(row.user_agent) : null,
        lastUsedAt: row.last_used_at
          ? new Date(String(row.last_used_at)).toISOString()
          : null,
      })),
    }
  } catch (err) {
    if (isUndefinedTableError(err)) {
      return { kind: 'migrationPending' }
    }
    throw err
  }
}
