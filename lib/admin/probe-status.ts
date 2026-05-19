import { isUndefinedColumnError, isUndefinedTableError } from '@/lib/db/errors'
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
  // BCS-DEF-1 (2026-05-19) — `'conflict-unresolved'` is a valid value
  // of the ProbeName union. The probe script
  // (`scripts/conflict-unresolved-alert.mjs`), its systemd unit, the
  // PROBE_NAMES extension below, and the admin alerts page's
  // PROBE_TITLES all shipped in subsequent sub-PRs of the BCS-DEF-1
  // epic. `isProbeName('conflict-unresolved')` returns true and the
  // /admin/settings/alerts UI iterates this probe alongside the other
  // three.
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
    // BCS-DEF-1-TG R1 BLOCKER#6 closure (2026-05-19): per-probe "Last
    // run" / "Last alert" cards stay email-channel-only after migration
    // 0061 introduces Telegram rows. Without the recipient_kind filter
    // a Telegram row would render as `Resend: <telegram message id>`
    // with `(нет адреса)` — incoherent UI. Telegram rows surface
    // exclusively via `getLatestTelegramRun()` below.
    const lastRunQ = pool.query(
      `select ran_at, verdict_kind, alert_sent, stats, error_message
         from probe_runs
        where probe_name = $1
          and is_test = false
          and recipient_kind = 'email'
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
          and recipient_kind = 'email'
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
    // BCS-DEF-1-TG R1 BLOCKER#5 closure (2026-05-19): also surface
    // `migrationPending` when the column itself is missing (42703 —
    // deploy-recovery scenario where migration 0061 was rolled back
    // AFTER NEW code swapped in). Belt-and-suspenders: the autodeploy
    // contract makes this rare in normal operation.
    if (isUndefinedTableError(err) || isUndefinedColumnError(err)) {
      return { migrationPending: true }
    }
    throw err
  }
}

// BCS-DEF-1-TG (2026-05-19) — Telegram channel observability. Renders
// into the dedicated "Telegram канал" section above the per-probe
// cards. Channel-wide (across all 4 probes); the partial index
// `probe_runs_telegram_latest_idx` (migration 0061) supports the
// ORDER BY clause. Same migration-pending guard as `getProbeStatus`.
export type TelegramRunStatus =
  | { migrationPending: true }
  | {
      migrationPending?: false
      lastRun: {
        probeName: string
        ranAt: string
        verdictKind: string
        alertSent: boolean
        chatId: string | null
        messageId: string | null
        fingerprint: string | null
        errorMessage: string | null
      } | null
    }

export async function getLatestTelegramRun(): Promise<TelegramRunStatus> {
  const pool = getDbPool()
  try {
    const r = await pool.query(
      `select probe_name, ran_at, verdict_kind, alert_sent,
              recipient_email, alert_email_id, fingerprint, error_message
         from probe_runs
        where is_test = false
          and recipient_kind = 'telegram'
        order by ran_at desc
        limit 1`,
    )
    const row = r.rows[0] ?? null
    return {
      lastRun: row
        ? {
            probeName: String(row.probe_name),
            ranAt: new Date(String(row.ran_at)).toISOString(),
            verdictKind: String(row.verdict_kind),
            alertSent: Boolean(row.alert_sent),
            // For Telegram rows, `recipient_email` stores the chat-id
            // snapshot (or null), `alert_email_id` stores the Telegram
            // message id — see migration 0061 column comments.
            chatId: row.recipient_email ? String(row.recipient_email) : null,
            messageId: row.alert_email_id ? String(row.alert_email_id) : null,
            fingerprint: row.fingerprint ? String(row.fingerprint) : null,
            errorMessage: row.error_message
              ? String(row.error_message)
              : null,
          }
        : null,
    }
  } catch (err) {
    if (isUndefinedTableError(err) || isUndefinedColumnError(err)) {
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
