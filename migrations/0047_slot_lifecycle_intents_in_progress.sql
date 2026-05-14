-- BCS-HARDEN-3 — slot_lifecycle_intents intent claim race fix.
--
-- The original CHECK in migration 0045 omitted 'in_progress' from the
-- allowed status set, so the worker's claim CTE could only bump
-- `attempts` + `last_run_at` and leave `status='pending'`. After
-- BCS-OP-ROLLOUT wired drainIntents to a 5-min cron, two parallel
-- ticks (or a manual re-fire) can re-claim the same row and
-- double-execute the cancel remediation.
--
-- Fix: allow 'in_progress' in the CHECK. The worker now flips to
-- 'in_progress' atomically in the same UPDATE RETURNING that
-- bumps attempts, mirroring the pull/push worker pattern. The
-- `slot_lifecycle_intents_pending_unique` partial index still
-- enforces dedup-at-enqueue (only one pending per slot+kind).

alter table slot_lifecycle_intents
  drop constraint if exists slot_lifecycle_intents_status_check;

alter table slot_lifecycle_intents
  add constraint slot_lifecycle_intents_status_check
  check (status in (
    'pending', 'in_progress', 'succeeded', 'blocked_integration', 'terminal_failure'
  ));
