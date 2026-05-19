import { isUndefinedTableError } from '@/lib/db/errors'
import { getDbPool } from '@/lib/db/pool'

// ALERTS-OBS (2026-05-16) — read-only observability for the systemd
// alert probes (3 at ship; extended to 4 by BCS-DEF-1 Phase 4,
// 2026-05-19 — see PROBE_NAMES below).
//
// Reads from `probe_runs` (migration 0053; CHECK extended by migration
// 0058 for the 4th probe). Writes happen exclusively from .mjs probes
// via scripts/lib/probe-runs.mjs + the test-send endpoint at
// /api/admin/settings/alerts/[probe]/test-send.
//
// Plans: docs/plans/alerts-obs.md (initial 3-probe surface);
// docs/plans/conflict-unresolved-alert.md (BCS-DEF-1, 4th probe).

export type ProbeName =
  | 'auth-flow'
  | 'calendar-pathology'
  | 'webhook-flow'
  // BCS-DEF-1 Phase 1 (2026-05-19) — `'conflict-unresolved'` is now a
  // valid value of the ProbeName union (used by SETTING_SCHEMA scope
  // entries in `lib/admin/operator-settings.ts`). The probe is NOT yet
  // shipped — Phase 2 lands `scripts/conflict-unresolved-alert.mjs` +
  // the systemd unit + extends `PROBE_NAMES` below + the admin alerts
  // page's PROBE_TITLES. Until then, `isProbeName('conflict-unresolved')`
  // returns true (so the type union holds), but the array iteration
  // (which drives the admin alerts UI render loop) excludes it.
  | 'conflict-unresolved'

export const PROBE_NAMES: readonly ProbeName[] = [
  'auth-flow',
  'calendar-pathology',
  'webhook-flow',
  // BCS-DEF-1 Phase 4 (2026-05-19) — Phase 2 shipped the probe
  // script (scripts/conflict-unresolved-alert.mjs); PROBE_NAMES
  // iteration is widened here so /admin/settings/alerts renders the
  // 4th probe card (last-run / last-alert / settings editor). Until
  // the probe starts writing probe_runs rows on prod, the card just
  // shows "Данные недоступны" — same shape as migration-pending.
  'conflict-unresolved',
]

export function isProbeName(value: unknown): value is ProbeName {
  return (
    value === 'auth-flow'
    || value === 'calendar-pathology'
    || value === 'webhook-flow'
    || value === 'conflict-unresolved'
  )
}

export type ProbeStatus =
  | { migrationPending: true }
  | {
      migrationPending?: false
      probeName: ProbeName
      lastRun: {
        ranAt: string
        verdictKind: string
        alertSent: boolean
        stats: Record<string, unknown> | null
        errorMessage: string | null
      } | null
      lastAlert: {
        ranAt: string
        recipientEmail: string | null
        fingerprint: string | null
        alertEmailId: string | null
      } | null
    }

// Postgres "relation does not exist" error code (`42P01`) is checked
// via `isUndefinedTableError` from `lib/db/errors`. AUDIT-CODE-3
// (2026-05-17) extracted the helper from this file + the sibling
// test-send route to a shared module so the two stay aligned. This
// matters during the deploy-before-migrate window when migration 0053
// hasn't applied yet — admin page renders a banner, endpoint returns
// 503 instead of 500.

export async function getProbeStatus(probeName: ProbeName): Promise<ProbeStatus> {
  const pool = getDbPool()
  try {
    const lastRunQ = pool.query(
      `select ran_at, verdict_kind, alert_sent, stats, error_message
         from probe_runs
        where probe_name = $1
          and is_test = false
        order by ran_at desc
        limit 1`,
      [probeName],
    )
    const lastAlertQ = pool.query(
      `select ran_at, recipient_email, fingerprint, alert_email_id
         from probe_runs
        where probe_name = $1
          and is_test = false
          and alert_sent = true
        order by ran_at desc
        limit 1`,
      [probeName],
    )
    const [lastRunR, lastAlertR] = await Promise.all([lastRunQ, lastAlertQ])
    const lastRunRow = lastRunR.rows[0] ?? null
    const lastAlertRow = lastAlertR.rows[0] ?? null
    return {
      probeName,
      lastRun: lastRunRow
        ? {
            ranAt: new Date(String(lastRunRow.ran_at)).toISOString(),
            verdictKind: String(lastRunRow.verdict_kind),
            alertSent: Boolean(lastRunRow.alert_sent),
            stats: lastRunRow.stats as Record<string, unknown> | null,
            errorMessage: lastRunRow.error_message
              ? String(lastRunRow.error_message)
              : null,
          }
        : null,
      lastAlert: lastAlertRow
        ? {
            ranAt: new Date(String(lastAlertRow.ran_at)).toISOString(),
            recipientEmail: lastAlertRow.recipient_email
              ? String(lastAlertRow.recipient_email)
              : null,
            fingerprint: lastAlertRow.fingerprint
              ? String(lastAlertRow.fingerprint)
              : null,
            alertEmailId: lastAlertRow.alert_email_id
              ? String(lastAlertRow.alert_email_id)
              : null,
          }
        : null,
    }
  } catch (err) {
    if (isUndefinedTableError(err)) {
      return { migrationPending: true }
    }
    throw err
  }
}

export async function checkProbeRunsTableExists(): Promise<boolean> {
  const pool = getDbPool()
  try {
    await pool.query(`select 1 from probe_runs limit 0`)
    return true
  } catch (err) {
    if (isUndefinedTableError(err)) return false
    throw err
  }
}
