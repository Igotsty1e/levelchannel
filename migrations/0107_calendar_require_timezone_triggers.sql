-- Replacement timezone-required triggers, originally planned for mig
-- 0106 but deferred to a follow-up PR to avoid a rolling-deploy race.
-- Parent epic (calendar-onboarding-cleanup, PR #537) shipped 2026-06-05
-- and is now baseline on prod. App-layer gates have been live so OLD
-- binary is gone — safe to add the triggers now.
--
-- Plan: docs/plans/calendar-onboarding-followup-2026-06-06.md
--
-- This migration takes EXCLUSIVE LOCKs on both tables BEFORE the
-- preflight scan AND before CREATE TRIGGER. Otherwise a concurrent
-- callback + PATCH could race between the preflight and the trigger
-- going live, creating an active|degraded + NULL row that the trigger
-- does not retro-validate. EXCLUSIVE allows reads but blocks writes —
-- that's what we need for the validation window. The locks are
-- released on commit (scripts/migrate.mjs wraps each migration in a
-- single tx).

lock table account_profiles in exclusive mode;
lock table teacher_calendar_integrations in exclusive mode;

-- Preflight: surface any grandfathered (active|degraded with NULL or
-- missing profile.timezone) rows. Abort if any exist so the operator
-- manually resolves before re-running the migration. A healthy prod
-- has 0 such rows.
-- LEFT JOIN catches the missing-profile-row class too.
-- RAISE EXCEPTION (not NOTICE) — scripts/migrate.mjs has no notice
-- handler so NOTICE is silently swallowed.
do $$
declare
  grandfathered_count int;
begin
  select count(*) into grandfathered_count
    from teacher_calendar_integrations tci
    left join account_profiles ap on ap.account_id = tci.account_id
   where tci.sync_state in ('active', 'degraded')
     and (ap.account_id is null or ap.timezone is null);
  if grandfathered_count > 0 then
    raise exception
      '[mig 0107] PREFLIGHT FAIL: % active|degraded integrations have missing profile or NULL profile.timezone. Manual operator action required: either create/set the teacher''s account_profiles.timezone OR downgrade their integration to ''disconnected'' before re-running the migration.',
      grandfathered_count
      using errcode = 'data_exception';
  end if;
end $$;

-- Trigger A: refuse INSERT/UPDATE into active|degraded when
-- account_profiles.timezone is NULL. Fires on EVERY active|degraded
-- write (not just state transitions) so the TOCTOU race where
-- upsertGoogleIntegration re-asserts sync_state='active' on a row
-- whose timezone was concurrently cleared is closed at DB layer.
--
-- Takes a per-account tx-scoped advisory lock BEFORE the cross-table
-- SELECT so concurrent transactions for the SAME account_id serialize.
-- Without this, under READ COMMITTED two concurrent writers (PATCH
-- clearing timezone + callback inserting active integration) can each
-- pass their gate against a stale snapshot and commit into the
-- active|degraded + timezone=NULL state.
--
-- hashtextextended (64-bit) keeps unrelated accounts from colliding
-- on the same 32-bit lock slot.
create or replace function teacher_calendar_integrations_require_timezone()
returns trigger language plpgsql as $$
declare
  acc_tz text;
begin
  if new.sync_state not in ('active', 'degraded') then
    return new;
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended('tz_invariant:' || new.account_id::text, 0)
  );
  select timezone into acc_tz
    from account_profiles
   where account_id = new.account_id;
  if acc_tz is null then
    raise exception
      'teacher_calendar_integrations: timezone must be set before activating Google Calendar (account_id=%)',
      new.account_id
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists teacher_calendar_integrations_require_timezone_trg
  on teacher_calendar_integrations;
create trigger teacher_calendar_integrations_require_timezone_trg
  before insert or update on teacher_calendar_integrations
  for each row
  execute function teacher_calendar_integrations_require_timezone();

-- Trigger B: refuse to leave an active|degraded integration with a
-- missing or NULL profile.timezone via UPDATE clear-to-null, INSERT
-- with timezone=NULL, or DELETE.
--
-- Takes the SAME per-account advisory lock so writers contend with
-- Trigger A's writes.
create or replace function account_profiles_timezone_required_when_integration_active()
returns trigger language plpgsql as $$
declare
  has_active boolean;
  check_account_id uuid;
begin
  if tg_op = 'DELETE' then
    check_account_id := old.account_id;
  else
    check_account_id := new.account_id;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('tz_invariant:' || check_account_id::text, 0)
  );

  if tg_op = 'UPDATE' then
    if not (new.timezone is null and old.timezone is not null) then
      return new;
    end if;
  elsif tg_op = 'INSERT' then
    if new.timezone is not null then
      return new;
    end if;
  end if;

  select exists (
    select 1 from teacher_calendar_integrations
     where account_id = check_account_id
       and sync_state in ('active', 'degraded')
  ) into has_active;

  if has_active then
    raise exception
      'account_profiles: cannot % timezone while teacher_calendar_integrations is active (account_id=%)',
      case tg_op
        when 'INSERT' then 'create row with NULL'
        when 'UPDATE' then 'clear'
        when 'DELETE' then 'remove (which orphans the integration''s timezone reference)'
      end,
      check_account_id
      using errcode = 'check_violation';
  end if;

  if tg_op = 'DELETE' then return old; else return new; end if;
end $$;

drop trigger if exists account_profiles_timezone_required_when_integration_active_trg
  on account_profiles;
create trigger account_profiles_timezone_required_when_integration_active_trg
  before insert or update or delete on account_profiles
  for each row
  execute function account_profiles_timezone_required_when_integration_active();
