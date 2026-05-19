-- BCS-DEF-5 (2026-05-19) — extend probe_runs.probe_name and
-- probe_runs.verdict_kind CHECK constraints for the teacher-daily-digest
-- cron.
--
-- Plan: docs/plans/bcs-def-5-teacher-reminders.md §2.3 + Round-1
-- BLOCKER 3 closure.
--
-- New probe name: 'teacher-daily-digest' (sibling of the 4 existing
-- alert probes).
-- New verdict kinds:
--   'digest_sent'              — at least one digest fired this tick
--   'digest_skipped_disabled'  — master switch off; no per-teacher rows
--   'digest_no_teachers'       — candidate set was empty
--
-- ACCESS EXCLUSIVE briefly on probe_runs during DROP+ADD; the table is
-- small (a few thousand rows max under 90-day retention) and the writer
-- swallows errors on CHECK conflict (best-effort recordProbeRun()).

alter table probe_runs
  drop constraint if exists probe_runs_probe_name_check;
alter table probe_runs
  add constraint probe_runs_probe_name_check
  check (probe_name in (
    'auth-flow', 'calendar-pathology', 'webhook-flow',
    'conflict-unresolved',
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
    -- BCS-DEF-5 new values:
    'digest_sent', 'digest_skipped_disabled', 'digest_no_teachers'
  ));
