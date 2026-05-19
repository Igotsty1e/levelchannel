-- BCS-DEF-1-TG (2026-05-19) — recipient_kind discriminator on probe_runs
-- so per-recipient rows can disambiguate email vs Telegram alert deliveries.
--
-- Plan: docs/plans/bcs-def-1-tg-telegram-alerts.md §2.4.
--
-- Per-recipient rows reuse the FANOUT precedent
-- (docs/plans/bcs-def-1-fanout.md §2.1): one probe_runs row per
-- (probe, recipient_kind) tick. Without the discriminator, future
-- channels (Slack, SMS) would need new probe_runs columns; with it,
-- a CHECK widening is the only schema change.
--
-- Additive-only:
--   * NOT NULL with literal default 'email' = metadata-only on PG11+
--     (no table rewrite, no full scan).
--   * Existing code (pre-BCS-DEF-1-TG) does not reference recipient_kind
--     so build → migrate → swap from the autodeploy contract
--     (docs/private/OPERATIONS.private.md:33-37,254-259) is safe.
--   * Partial index targets the Telegram channel query in
--     lib/admin/probe-status.ts getLatestTelegramRun().
--
-- ACCESS EXCLUSIVE briefly during ALTER TABLE; probe_runs is small
-- under 90-day retention (a few thousand rows) and recordProbeRun()
-- is best-effort (swallows errors). Acceptable.

alter table probe_runs
  add column if not exists recipient_kind text not null default 'email'
  check (recipient_kind in ('email', 'telegram'));

create index if not exists probe_runs_telegram_latest_idx
  on probe_runs (ran_at desc)
  where recipient_kind = 'telegram' and is_test = false;

comment on column probe_runs.recipient_kind is
  'BCS-DEF-1-TG (2026-05-19): channel discriminator — every probe tick '
  'records one row per delivery channel (email + optionally telegram). '
  'Allows independent per-channel verdict tracking (alert_sent vs '
  'alert_send_failed) without partial-success enum holes.';
comment on column probe_runs.alert_email_id is
  'Channel-agnostic message id snapshot. When recipient_kind=''email'' '
  'this is the Resend message id; when recipient_kind=''telegram'' it '
  'is the Telegram message id (numeric, stringified). Kept as '
  'alert_email_id (not renamed) to avoid touching every reader.';
