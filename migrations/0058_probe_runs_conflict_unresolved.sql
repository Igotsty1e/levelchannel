-- BCS-DEF-1 Phase 1 foundation (2026-05-19) — extend probe_runs CHECK
-- to include the conflict-unresolved alert probe scheduled for Phase
-- 2 of the BCS-DEF-1 epic (the probe script + systemd unit ship in a
-- follow-up sub-PR).
--
-- Adding the CHECK value ahead of the probe script is safe:
--   - the table is write-only by `scripts/lib/probe-runs.mjs
--     recordProbeRun()` and the admin test-send route;
--   - no current writer emits 'conflict-unresolved' until Phase 2;
--   - the CHECK extension is fully additive (no existing values dropped).
--
-- ACCESS EXCLUSIVE briefly on probe_runs during DROP+ADD; the table is
-- small (a few thousand rows max under 90-day retention), the writer
-- swallows errors on conflict, and `/admin/settings/alerts` page reads
-- via partial indexes that don't block on the CHECK. Acceptable.
--
-- Plan: docs/plans/conflict-unresolved-alert.md §2.6.

alter table probe_runs
  drop constraint if exists probe_runs_probe_name_check;
alter table probe_runs
  add constraint probe_runs_probe_name_check
  check (probe_name in (
    'auth-flow', 'calendar-pathology', 'webhook-flow',
    'conflict-unresolved'
  ));
