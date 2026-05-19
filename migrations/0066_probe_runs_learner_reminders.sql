-- BCS-DEF-4 (2026-05-19) — extend probe_runs CHECK to include
-- 'learner-reminders'. The scheduler is not structurally an alert
-- probe (no dedup-fingerprint, no operator-storm semantics), but it
-- emits the same per-tick observability rows so that /admin/settings/alerts
-- can render the latest-run / verdict signal for the reminder pipeline.
--
-- Also add the new verdict kinds the scheduler emits:
--   'channel_disabled_by_operator' — both email + Telegram master
--     switches are off; scheduler tick exits early without selecting
--     any due slots.
--
-- ACCESS EXCLUSIVE briefly on probe_runs during DROP+ADD; the table
-- is small (a few thousand rows max under 90-day retention), the
-- writer swallows errors on conflict, and `/admin/settings/alerts`
-- page reads via partial indexes that don't block on the CHECK.
-- Acceptable.
--
-- Plan: docs/plans/bcs-def-4-learner-reminders.md §2.10.

alter table probe_runs
  drop constraint if exists probe_runs_probe_name_check;
alter table probe_runs
  add constraint probe_runs_probe_name_check
  check (probe_name in (
    'auth-flow', 'calendar-pathology', 'webhook-flow',
    'conflict-unresolved', 'learner-reminders'
  ));

-- Extend the verdict_kind CHECK with the new scheduler-specific kind.
-- Pre-existing values are preserved.
alter table probe_runs
  drop constraint if exists probe_runs_verdict_kind_check;
alter table probe_runs
  add constraint probe_runs_verdict_kind_check
  check (verdict_kind in (
    'alert_sent',
    'alert_send_failed',
    'dedup_skip',
    'no_failures',
    'within_thresholds',
    'no_offenders',
    'low_volume_skip',
    'all_resolved',
    'ok',
    'config_missing',
    'error',
    'test_send_succeeded',
    'test_send_failed',
    -- BCS-DEF-4 (2026-05-19) — learner reminder scheduler: both email
    -- and Telegram master switches are off; tick exits early.
    'channel_disabled_by_operator'
  ));
