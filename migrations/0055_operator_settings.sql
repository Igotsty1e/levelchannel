-- ALERTS-EDITOR Sub-PR A (2026-05-17) — operator-tunable settings
-- table + immutable audit log.
--
-- Plan: docs/plans/alerts-editor.md.
--
-- Phase A (this migration): create tables + trigger that enforces
-- audit-log immutability. App code is added in the same PR via
-- lib/admin/operator-settings.ts + scripts/lib/operator-settings.mjs.
-- Probe scripts still env-only at this stage (Sub-PR B will switch
-- them); /admin editor UI ships in Sub-PR C.
--
-- Resolver contract: DB row → env var → hardcoded default. Empty
-- DB row means "use env or default" (no implicit override). This
-- preserves bootstrap when the DB is empty AND lets operator-side
-- emergency env-override work via DELETE of the DB row first.

create table if not exists operator_settings (
  key text primary key
    check (key ~ '^[A-Z][A-Z0-9_]+$' and length(key) <= 64),
  value text not null
    check (length(value) <= 1024),
  description text,
  updated_at timestamptz not null default now(),
  updated_by_account_id uuid references accounts(id) on delete set null
);

-- Audit log. R2 BLOCKER #2 + R1 WARN #7 — single-TX write+audit
-- on the main pool (the only correct shape for atomicity). Audit
-- immutability is enforced by a DB trigger that blocks UPDATE +
-- DELETE on this table.
create table if not exists operator_settings_events (
  id bigserial primary key,
  key text not null,
  event_kind text not null
    check (event_kind in ('set', 'delete')),
  old_value text,      -- null on first-ever set
  new_value text,      -- null on delete
  updated_by_account_id uuid references accounts(id) on delete set null,
  ts timestamptz not null default now(),
  check (
    (event_kind = 'set' and new_value is not null)
    or (event_kind = 'delete' and new_value is null)
  )
);

create index if not exists operator_settings_events_key_ts_idx
  on operator_settings_events (key, ts desc);
create index if not exists operator_settings_events_ts_idx
  on operator_settings_events (ts desc);

-- UPDATE-immutability trigger. Same trust boundary as the audit-
-- writer role pattern (migration 0029) but via SQL constraint
-- rather than GRANT semantics — required so single-pool single-TX
-- atomicity holds for the operator_settings + audit write.
--
-- - UPDATE on any event row: blocked unconditionally.
-- - DELETE on a row younger than 89 days: blocked. Older rows can
--   be pruned by the 90-day retention sweep
--   (scripts/db-retention-cleanup.mjs); rows in the [0, 89d] window
--   stay immutable so an app-process compromise CANNOT erase
--   recent audit rows to cover an admin-credential exfiltration.
--   Wave-R1 BLOCKER #2 closure (the earlier UPDATE-only trigger
--   left a real anti-tamper gap vs the audit-writer pattern).
--
-- The 89-day boundary is one day tighter than the retention sweep's
-- 90-day window, so the sweep trivially passes the predicate.
-- Operator-side forensic DELETEs of older rows are unaffected.
create or replace function block_immutable_operator_settings_events()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'operator_settings_events rows are immutable (audit log; UPDATE blocked)';
  elsif tg_op = 'DELETE' then
    if old.ts is null or old.ts > now() - interval '89 days' then
      raise exception 'operator_settings_events rows younger than 89 days are immutable (audit log; recent DELETE blocked)';
    end if;
    -- Old enough to delete: return OLD so the DELETE proceeds.
    -- Returning NULL would silently cancel the operation.
    return old;
  end if;
  return null;
end$$;

drop trigger if exists block_update_on_operator_settings_events_trg
  on operator_settings_events;
drop trigger if exists block_immutable_operator_settings_events_trg
  on operator_settings_events;
create trigger block_immutable_operator_settings_events_trg
  before update or delete on operator_settings_events
  for each row execute function block_immutable_operator_settings_events();
