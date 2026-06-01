-- T3 Sub-PR A foundation: tariffs + packages → learner-scoped binding.
--
-- Plan: docs/plans/tariffs-packages-learner-scope.md (codex-paranoia
-- plan-mode SIGN-OFF round 10/N, cap-extended).
--
-- Companion mini-epic PKG-TEACHER-SCOPE landed before this migration
-- (PR #470) — fixes the existing prod multi-teacher package leak that
-- this migration's junction tables would otherwise inherit.
--
-- Contents (per §Migration):
--   (a)   visibility column on pricing_tariffs + lesson_packages
--   (a.2) deleted_at on lesson_packages (symmetric with pricing_tariffs)
--   (a.3) priority_snapshot on package_purchases (R6-BLOCKER#1 closure:
--         prevents retroactive consume-priority drift)
--   (b)   junction tables: learner_tariff_access, learner_package_access
--   (c)   ownership triggers with revoke-only exemption (R3-BLOCKER#4)
--   (d)   lesson_slots.snapshot_amount_kopecks + backfill + forward trigger
--   (e)   auth_audit_events event_type enum extension (4 new T3 events;
--         full enumeration to avoid the R5-BLOCKER#1 placeholder bug)
--
-- The migration is one transaction (per repo convention); any failure
-- rolls back all 10 statements together.

-- (a) Visibility column on BOTH tables. Default 'catalog' keeps every
-- pre-existing row in the public catalog so no learner-visible behavior
-- changes until junction rows are explicitly added by §Sub-PR D UI.

alter table pricing_tariffs
  add column if not exists visibility text not null default 'catalog'
    check (visibility in ('catalog', 'private'));

alter table lesson_packages
  add column if not exists visibility text not null default 'catalog'
    check (visibility in ('catalog', 'private'));

-- (a.2) lesson_packages.deleted_at — soft-delete symmetry with
-- pricing_tariffs.deleted_at (added pre-T3). Without this column the
-- read-side visibility filter would be asymmetric (tariffs use BOTH
-- is_active=true AND deleted_at IS NULL; packages had only is_active).
-- Backfill is a no-op: existing rows are by definition not soft-deleted.

alter table lesson_packages
  add column if not exists deleted_at timestamptz null;

-- (a.3) package_purchases.priority_snapshot — frozen at purchase time
-- and never read live. Plan §"4. Consumption priority": prevents a
-- teacher's post-purchase revoke from silently demoting an already-
-- paid package's consume order. Default 0 = catalog priority (legacy
-- rows snapshot to catalog).

alter table package_purchases
  add column if not exists priority_snapshot int not null default 0;

comment on column package_purchases.priority_snapshot is
  'T3 (mig 0102): junction priority frozen at purchase time. '
  'NEVER read live learner_package_access.priority for consume — '
  'see plan docs/plans/tariffs-packages-learner-scope.md §4 (R6-BLOCKER#1).';

-- (b) Junction tables.

create table if not exists learner_tariff_access (
  teacher_id uuid not null references accounts(id) on delete cascade,
  learner_account_id uuid not null references accounts(id) on delete cascade,
  tariff_id uuid not null references pricing_tariffs(id) on delete cascade,
  override_amount_kopecks int null
    check (override_amount_kopecks is null
           or override_amount_kopecks between 100 and 100000000),
  granted_at timestamptz not null default now(),
  granted_by_account_id uuid null references accounts(id) on delete set null,
  revoked_at timestamptz null,
  primary key (teacher_id, learner_account_id, tariff_id)
);

create index if not exists learner_tariff_access_lookup_idx
  on learner_tariff_access (teacher_id, learner_account_id)
  where revoked_at is null;

create table if not exists learner_package_access (
  teacher_id uuid not null references accounts(id) on delete cascade,
  learner_account_id uuid not null references accounts(id) on delete cascade,
  package_id uuid not null references lesson_packages(id) on delete cascade,
  override_amount_kopecks int null
    check (override_amount_kopecks is null
           or override_amount_kopecks between 100 and 100000000),
  priority int not null default 0,
  granted_at timestamptz not null default now(),
  granted_by_account_id uuid null references accounts(id) on delete set null,
  revoked_at timestamptz null,
  primary key (teacher_id, learner_account_id, package_id)
);

create index if not exists learner_package_access_lookup_idx
  on learner_package_access (teacher_id, learner_account_id)
  where revoked_at is null;

-- (c) Ownership trigger — enforces:
--   (1) tariff/package owned by the claimed teacher
--   (2) learner-teacher link active EXCEPT on revoke-only UPDATE
-- The revoke-only exemption (R3-BLOCKER#4) lets the archive endpoint
-- bulk-revoke junction rows for a learner who has since unlinked.

create or replace function learner_tariff_access_invariants()
returns trigger as $$
declare
  owner_teacher_id uuid;
  link_active boolean;
  is_revoke_only_update boolean;
begin
  -- (1) tariff owned by claimed teacher.
  select teacher_id into owner_teacher_id
    from pricing_tariffs where id = NEW.tariff_id;
  if owner_teacher_id is null then
    raise exception 'tariff % not found', NEW.tariff_id;
  end if;
  if owner_teacher_id <> NEW.teacher_id then
    raise exception 'tariff % owned by % not %',
      NEW.tariff_id, owner_teacher_id, NEW.teacher_id;
  end if;

  -- (2) link-active check, skipped for revoke-only UPDATE.
  is_revoke_only_update := (
    TG_OP = 'UPDATE'
    and OLD.revoked_at is null
    and NEW.revoked_at is not null
    and NEW.teacher_id = OLD.teacher_id
    and NEW.learner_account_id = OLD.learner_account_id
    and NEW.tariff_id = OLD.tariff_id
    and NEW.override_amount_kopecks is not distinct from OLD.override_amount_kopecks
  );

  if not is_revoke_only_update then
    select exists (
      select 1 from learner_teacher_links
       where teacher_account_id = NEW.teacher_id
         and learner_account_id = NEW.learner_account_id
         and unlinked_at is null
    ) into link_active;
    if not link_active then
      raise exception 'no active link teacher=% learner=%',
        NEW.teacher_id, NEW.learner_account_id;
    end if;
  end if;
  return NEW;
end;
$$ language plpgsql;

drop trigger if exists learner_tariff_access_invariants_trigger
  on learner_tariff_access;
create trigger learner_tariff_access_invariants_trigger
  before insert or update on learner_tariff_access
  for each row execute function learner_tariff_access_invariants();

create or replace function learner_package_access_invariants()
returns trigger as $$
declare
  owner_teacher_id uuid;
  link_active boolean;
  is_revoke_only_update boolean;
begin
  select teacher_id into owner_teacher_id
    from lesson_packages where id = NEW.package_id;
  if owner_teacher_id is null then
    raise exception 'package % not found', NEW.package_id;
  end if;
  if owner_teacher_id <> NEW.teacher_id then
    raise exception 'package % owned by % not %',
      NEW.package_id, owner_teacher_id, NEW.teacher_id;
  end if;

  is_revoke_only_update := (
    TG_OP = 'UPDATE'
    and OLD.revoked_at is null
    and NEW.revoked_at is not null
    and NEW.teacher_id = OLD.teacher_id
    and NEW.learner_account_id = OLD.learner_account_id
    and NEW.package_id = OLD.package_id
    and NEW.override_amount_kopecks is not distinct from OLD.override_amount_kopecks
    and NEW.priority is not distinct from OLD.priority
  );

  if not is_revoke_only_update then
    select exists (
      select 1 from learner_teacher_links
       where teacher_account_id = NEW.teacher_id
         and learner_account_id = NEW.learner_account_id
         and unlinked_at is null
    ) into link_active;
    if not link_active then
      raise exception 'no active link teacher=% learner=%',
        NEW.teacher_id, NEW.learner_account_id;
    end if;
  end if;
  return NEW;
end;
$$ language plpgsql;

drop trigger if exists learner_package_access_invariants_trigger
  on learner_package_access;
create trigger learner_package_access_invariants_trigger
  before insert or update on learner_package_access
  for each row execute function learner_package_access_invariants();

-- (d) lesson_slots.snapshot_amount_kopecks — frozen at booking time
-- so post-booking tariff edits don't shift settlement amount.
-- Plan §"1. Price snapshot invariant".

alter table lesson_slots
  add column if not exists snapshot_amount_kopecks int null
    check (snapshot_amount_kopecks is null
           or snapshot_amount_kopecks between 100 and 100000000);

-- Backfill: any post-booking row (status in {booked, completed,
-- cancelled-after-booking, no_show_*}) without a snapshot gets the
-- CURRENT tariff price. R3-BLOCKER#1 closure: open slots are excluded
-- so they don't get frozen at migration time.

update lesson_slots s
   set snapshot_amount_kopecks = t.amount_kopecks
  from pricing_tariffs t
 where s.tariff_id = t.id
   and s.snapshot_amount_kopecks is null
   and s.tariff_id is not null
   and s.status in ('booked', 'completed', 'cancelled',
                    'no_show_learner', 'no_show_teacher');

-- Forward trigger: defensive fallback for any writer path that
-- forgets to populate snapshot_amount_kopecks. The app-side write in
-- Sub-PR B sets the value IN THE SAME UPDATE that flips status, so
-- this trigger short-circuits via the IS NULL check.
-- R4-BLOCKER#1 + R5-WARN#3 closures.

create or replace function lesson_slots_snapshot_on_book()
returns trigger as $$
begin
  if NEW.status in ('booked', 'completed', 'no_show_learner', 'no_show_teacher')
     and NEW.snapshot_amount_kopecks is null
     and NEW.tariff_id is not null
  then
    select amount_kopecks into NEW.snapshot_amount_kopecks
      from pricing_tariffs where id = NEW.tariff_id;
  end if;
  if TG_OP = 'UPDATE'
     and OLD.snapshot_amount_kopecks is not null
     and OLD.status in ('booked', 'completed', 'cancelled',
                        'no_show_learner', 'no_show_teacher')
     and NEW.snapshot_amount_kopecks is distinct from OLD.snapshot_amount_kopecks
  then
    raise exception 'lesson_slots.snapshot_amount_kopecks is immutable once a booking exists';
  end if;
  return NEW;
end;
$$ language plpgsql;

drop trigger if exists lesson_slots_snapshot_on_book_trg on lesson_slots;
create trigger lesson_slots_snapshot_on_book_trg
  before insert or update on lesson_slots
  for each row execute function lesson_slots_snapshot_on_book();

-- (e) auth_audit_events event_type enum extension.
-- Full enumeration (R5-BLOCKER#1 closure: no `-- ... existing ...`
-- placeholder); 15 pre-existing + 4 new T3 events.

alter table auth_audit_events
  drop constraint if exists auth_audit_events_event_type_check;
alter table auth_audit_events
  add constraint auth_audit_events_event_type_check
  check (event_type in (
    'auth.login.success',
    'auth.login.failed',
    'auth.register.created',
    'auth.reset.requested',
    'auth.reset.confirmed',
    'auth.verify.success',
    'auth.session.revoked',
    'auth.teacher.self_registered',
    'auth.invite.created',
    'auth.invite.revoked',
    'auth.invite.redeemed',
    'auth.teacher.saas_offer_accepted',
    'auth.teacher.saas_offer_backfilled',
    'auth.onboarding.reset',
    'auth.billing.method_changed',
    -- T3 additions:
    'auth.tariff_access.granted',
    'auth.tariff_access.revoked',
    'auth.package_access.granted',
    'auth.package_access.revoked'
  ));
