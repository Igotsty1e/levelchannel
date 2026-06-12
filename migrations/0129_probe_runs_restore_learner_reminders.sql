-- 0129_probe_runs_restore_learner_reminders.sql
-- Codex posthoc-audit follow-up (2026-06-12 Wave 2).
--
-- Bug context: migration 0066 added 'learner-reminders' to
-- probe_runs.probe_name CHECK + 'channel_disabled_by_operator' to
-- probe_runs.verdict_kind CHECK. Migration 0068 (3 days later,
-- BCS-DEF-5 teacher-daily-digest) rewrote both CHECKs without
-- including the values from 0066 — silently dropping them from the
-- allowed set.
--
-- Production impact: scripts/learner-reminder-dispatch.mjs still runs
-- and sends reminders, but its per-tick `recordProbeRun()` call hits
-- the constraint violation. The writer is best-effort and swallows the
-- error, so the cron keeps sending — but /admin/settings/alerts loses
-- the latest-run signal for the reminder pipeline. Observability is
-- silently broken for ~3 weeks. Discovered via the regression-test
-- suite (tests/integration/scripts/learner-reminder-dispatch.test.ts
-- expected probe_run rows that never landed).
--
-- Fix: drop + re-add both CHECKs with the FULL union from migrations
-- 0066 + 0068.

alter table probe_runs
  drop constraint if exists probe_runs_probe_name_check;
alter table probe_runs
  add constraint probe_runs_probe_name_check
  check (probe_name in (
    'auth-flow', 'calendar-pathology', 'webhook-flow',
    'conflict-unresolved',
    'learner-reminders',
    'teacher-daily-digest'
  ));

alter table probe_runs
  drop constraint if exists probe_runs_verdict_kind_check;
alter table probe_runs
  add constraint probe_runs_verdict_kind_check
  check (verdict_kind in (
    -- existing 13 values per migration 0053:
    'alert_sent', 'alert_send_failed', 'dedup_skip',
    'no_failures', 'within_thresholds', 'no_offenders',
    'low_volume_skip', 'all_resolved', 'ok',
    'config_missing', 'error',
    'test_send_succeeded', 'test_send_failed',
    -- BCS-DEF-4 learner-reminders (mig 0066, regressed in 0068):
    'channel_disabled_by_operator',
    -- BCS-DEF-5 teacher-daily-digest (mig 0068):
    'digest_sent', 'digest_skipped_disabled', 'digest_no_teachers'
  ));
