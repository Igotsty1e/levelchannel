-- BCS-DEF-7 Phase 1 (2026-05-18) — add next_sync_token column to
-- teacher_calendar_integrations for incremental Google Calendar pull.
-- Phase 2 ships the pull-runner delta path. Until then this column
-- stays NULL on all rows; full-rewrite pull continues unchanged.
--
-- Additive — no behaviour change. Type `text` because Google's syncToken
-- is opaque base64; no UNIQUE because multiple integrations may legitimately
-- share a token (unlikely but no harm).
--
-- Plan: docs/plans/bcs-def-7-synctoken-pull.md §2.1 / §5 sub-PR (a).
--
-- Note: per-teacher key (not per-(teacher, calendar)) — MVP guarantees
-- writeCalendarId = readCalendarIds[0] = 'primary' (1:1 pairing).
-- Multi-calendar follow-up is a separate wave; this column would be
-- promoted into a `teacher_calendar_sync_states` table at that time
-- (plan §2.1 rationale 2 + §2.5).

alter table teacher_calendar_integrations
  add column if not exists next_sync_token text null;

comment on column teacher_calendar_integrations.next_sync_token is
  'BCS-DEF-7 (2026-05-18): Google Calendar incremental-sync token. NULL means next pull does a bounded full-rewrite. Phase 2 implements the read path; until then this column is unused.';
