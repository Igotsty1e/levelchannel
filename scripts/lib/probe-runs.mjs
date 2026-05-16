// scripts/lib/probe-runs.mjs — shared helper for the three systemd
// alert probes (auth-flow, calendar-pathology, webhook-flow) under
// scripts/*-alert.mjs.
//
// Plan: docs/plans/alerts-obs.md (ALERTS-OBS epic, 2026-05-16).
//
// Pure ESM, no TS, no `@/` path aliases — required because the
// systemd timers exec `node scripts/*-alert.mjs` and Node CLI
// doesn't resolve TS or path aliases.
//
// Probes pass their own `pg.Pool({max: 1})` instance + explicitly
// `await pool.end()` at exit — this helper MUST NOT create its own
// pool (paranoia round-1 BLOCKER #4: `getDbPool()` is a Next.js
// singleton with max=10 and no shutdown path; wrong shape for
// oneshot systemd jobs).
//
// `recordProbeRun` is best-effort: it MUST NOT throw, MUST NOT
// block the probe's primary job (sending alert emails). A DB
// outage or a CHECK constraint violation logs `warn` and returns.

export const PROBE_NAMES = Object.freeze({
  AUTH_FLOW: 'auth-flow',
  CALENDAR_PATHOLOGY: 'calendar-pathology',
  WEBHOOK_FLOW: 'webhook-flow',
})

// Every value here MUST appear verbatim in migration 0053's
// verdict_kind CHECK constraint. Adding a new constant requires
// extending the CHECK first.
export const VERDICT_KINDS = Object.freeze({
  ALERT_SENT: 'alert_sent',
  ALERT_SEND_FAILED: 'alert_send_failed',
  DEDUP_SKIP: 'dedup_skip',
  NO_FAILURES: 'no_failures',
  WITHIN_THRESHOLDS: 'within_thresholds',
  NO_OFFENDERS: 'no_offenders',
  LOW_VOLUME_SKIP: 'low_volume_skip',
  ALL_RESOLVED: 'all_resolved',
  OK: 'ok',
  CONFIG_MISSING: 'config_missing',
  ERROR: 'error',
  TEST_SEND_SUCCEEDED: 'test_send_succeeded',
  TEST_SEND_FAILED: 'test_send_failed',
})

/**
 * Insert one probe_runs row. Best-effort — swallows all errors.
 *
 * @param {import('pg').Pool} pool — the probe's local pool (max:1).
 * @param {{
 *   probeName: typeof PROBE_NAMES[keyof typeof PROBE_NAMES],
 *   verdictKind: typeof VERDICT_KINDS[keyof typeof VERDICT_KINDS],
 *   alertSent?: boolean,
 *   recipientEmail?: string | null,
 *   alertEmailId?: string | null,
 *   fingerprint?: string | null,
 *   stats?: unknown,
 *   errorMessage?: string | null,
 *   isTest?: boolean,
 *   initiatorAccountId?: string | null,
 * }} params
 */
export async function recordProbeRun(pool, params) {
  try {
    await pool.query(
      `insert into probe_runs (
         probe_name, verdict_kind, alert_sent, recipient_email,
         alert_email_id, fingerprint, stats, error_message,
         is_test, initiator_account_id
       ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)`,
      [
        params.probeName,
        params.verdictKind,
        params.alertSent ?? false,
        params.recipientEmail ?? null,
        params.alertEmailId ?? null,
        params.fingerprint ?? null,
        params.stats == null ? null : JSON.stringify(params.stats),
        params.errorMessage ?? null,
        params.isTest ?? false,
        params.initiatorAccountId ?? null,
      ],
    )
  } catch (err) {
    // Best-effort: log + swallow. NEVER throw. The probe's primary
    // job (sending the alert email) must not be blocked by an
    // observability hiccup.
    console.warn(JSON.stringify({
      level: 'warn',
      ts: new Date().toISOString(),
      probe: params.probeName ?? 'unknown',
      msg: 'recordProbeRun failed (best-effort)',
      verdictKind: params.verdictKind ?? null,
      error: err instanceof Error ? err.message : String(err),
    }))
  }
}
