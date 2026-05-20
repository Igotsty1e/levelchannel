// scripts/lib/probe-runs.mjs — shared helper for the systemd alert
// probes (auth-flow, calendar-pathology, webhook-flow at ship; plus
// conflict-unresolved added by BCS-DEF-1 Phase 1 2026-05-19) under
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
  // BCS-DEF-1 (2026-05-19) — the conflict-unresolved alert probe ships
  // via `scripts/conflict-unresolved-alert.mjs`. The CHECK on
  // probe_runs.probe_name was extended in migration 0058 so this name
  // is valid for INSERT, and recordProbeRun() accepts rows with this
  // value.
  CONFLICT_UNRESOLVED: 'conflict-unresolved',
  // BCS-DEF-5 (2026-05-19) — daily 08:00 teacher lesson digest. Probe
  // script: scripts/teacher-daily-digest.mjs. CHECK extended in
  // migration 0063.
  TEACHER_DAILY_DIGEST: 'teacher-daily-digest',
  // BCS-DEF-4 (2026-05-19) — the learner-reminders scheduler ships via
  // `scripts/learner-reminder-dispatch.mjs`. Structurally NOT an alert
  // probe (no dedup-fingerprint, no operator-storm semantics) — but
  // emits per-tick observability rows so /admin/settings/alerts can
  // surface the latest-run / verdict signal. Migration 0064 extends
  // the probe_runs.probe_name CHECK to accept this value.
  LEARNER_REMINDERS: 'learner-reminders',
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
  // BCS-DEF-5 (2026-05-19) — daily teacher digest probe verdicts.
  // CHECK extended in migration 0063.
  DIGEST_SENT: 'digest_sent',
  DIGEST_SKIPPED_DISABLED: 'digest_skipped_disabled',
  DIGEST_NO_TEACHERS: 'digest_no_teachers',
  // BCS-DEF-4 (2026-05-19) — learner reminder scheduler verdict when
  // both email + telegram master switches are off (early exit, no
  // due-row SELECT). Migration 0064 widens the probe_runs.verdict_kind
  // CHECK to accept this value.
  CHANNEL_DISABLED_BY_OPERATOR: 'channel_disabled_by_operator',
})

// BCS-DEF-1-TG (2026-05-19) — per-channel discriminator on probe_runs.
// Every channel emits its own row per tick; rows default to 'email'
// for back-compat with pre-Telegram probes (one-row-per-tick semantics
// preserved when the Telegram master switch is off).
export const RECIPIENT_KINDS = Object.freeze({
  EMAIL: 'email',
  TELEGRAM: 'telegram',
})

/**
 * Insert one probe_runs row. Best-effort — swallows all errors.
 *
 * BCS-DEF-1-TG (2026-05-19): `recipientKind` defaults to 'email' so
 * legacy callers keep their existing row shape; new Telegram-channel
 * callers pass 'telegram'. The DB CHECK constraint
 * (migration 0061) enforces the partition.
 *
 * @param {import('pg').Pool} pool — the probe's local pool (max:1).
 * @param {{
 *   probeName: typeof PROBE_NAMES[keyof typeof PROBE_NAMES],
 *   verdictKind: typeof VERDICT_KINDS[keyof typeof VERDICT_KINDS],
 *   alertSent?: boolean,
 *   recipientEmail?: string | null,
 *   recipientKind?: typeof RECIPIENT_KINDS[keyof typeof RECIPIENT_KINDS],
 *   recipientTelegramChatId?: string | null,
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
    const recipientKind = params.recipientKind ?? RECIPIENT_KINDS.EMAIL
    await pool.query(
      `insert into probe_runs (
         probe_name, verdict_kind, alert_sent, recipient_email,
         alert_email_id, fingerprint, stats, error_message,
         is_test, initiator_account_id, recipient_kind
       ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11)`,
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
        recipientKind,
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
