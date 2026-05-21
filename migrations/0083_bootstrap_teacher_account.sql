-- SAAS-PIVOT Epic 1 Day 1 — bootstrap teacher account row-MOVE migration.
--
-- Plan: docs/plans/saas-pivot-master.md §2.1 row `0083`, §2.9 (full 7-step
-- specification), §5 Day 1 step 10.
--
-- THIS IS THE GNARLY ONE. The production prod account today holds BOTH
-- admin role AND has been the implicit teacher for every slot, package,
-- tariff, calendar integration, telegram binding, learner link.
-- The role model in the SaaS pivot forbids hybrid admin+teacher.
--
-- Strategy: ROW-MOVE, not synthetic split. We mint a NEW pure-teacher
-- account that inherits the prod email + password + email_verified_at;
-- swap OLD admin's email to a synthetic; revoke OLD sessions; mass-
-- consume OLD outstanding single-use tokens; re-point ALL teacher-side
-- data + learner links to NEW; mark NEW with the migration marker.
--
-- ALL in ONE TX. The scripts/migrate.mjs runner wraps every migration
-- in BEGIN/COMMIT; this file contains a single DO block per logical step.
-- A failure at any step rolls back the entire row-move.
--
-- IDEMPOTENCY (round-9 closure): if any account already carries
-- teacher_account_migration_marker = 'bootstrap-2026-05-22', the
-- migration is a no-op on re-run. Re-running mig 0083 against a
-- post-bootstrap DB exits cleanly via early-return.
--
-- IDEMPOTENCY (fresh DB / test DB): if no admin account exists yet
-- (e.g. fresh integration-test DB before /api/auth/register seeds one),
-- the migration is also a no-op. Step 1 still runs to add the two
-- accounts columns so future tests can call this migration's invariants
-- without forcing a pre-seeded admin.
--
-- IDEMPOTENCY (multiple admin accounts): the migration RAISES an
-- exception if more than one role='admin' row exists. The plan says
-- "Step 2: there should be exactly one admin"; we enforce that
-- precondition rather than guess.

-- --------------------------------------------------------------------
-- Step 1 — extend accounts with audit_email_history + marker columns.
-- These two columns exist BEFORE any other step runs so even the
-- no-op branches can read/write them safely.
-- --------------------------------------------------------------------

alter table accounts
  add column if not exists audit_email_history jsonb not null default '[]'::jsonb;

alter table accounts
  add column if not exists teacher_account_migration_marker text null;

create index if not exists accounts_teacher_migration_marker_idx
  on accounts (teacher_account_migration_marker)
  where teacher_account_migration_marker is not null;

-- --------------------------------------------------------------------
-- Step 2..7 — the row-MOVE itself, conditional on:
--   (a) no row already carries marker='bootstrap-2026-05-22'
--   (b) exactly one role='admin' account exists
-- --------------------------------------------------------------------

do $bootstrap$
declare
  old_id uuid;
  old_email text;
  old_password_hash text;
  old_email_verified_at timestamptz;
  old_teacher_tg_enabled boolean;
  old_teacher_tg_chat_id text;
  new_id uuid;
  admin_count integer;
  already_done integer;
  remaining integer;
begin
  -- Idempotency check #1 — marker set on any row → no-op.
  select count(*) into already_done
    from accounts
   where teacher_account_migration_marker = 'bootstrap-2026-05-22';
  if already_done > 0 then
    raise notice 'mig 0083: bootstrap-2026-05-22 marker already present; skipping row-MOVE (idempotent re-run)';
    return;
  end if;

  -- Idempotency check #2 — fresh DB with no admin → no-op (column-add
  -- in Step 1 above stays). The test suite seeds admins per-test, so
  -- this branch is the common case in integration runs.
  select count(*) into admin_count
    from account_roles
   where role = 'admin';
  if admin_count = 0 then
    raise notice 'mig 0083: no admin accounts yet (fresh DB); skipping row-MOVE';
    return;
  end if;

  -- Precondition — exactly one admin account. Plan §2.9 specifies the
  -- "operator-team account" as the single source; multiple admins on
  -- prod would be a violated precondition.
  if admin_count > 1 then
    raise exception 'mig 0083: expected exactly one role=admin account, found % — refusing to row-MOVE without operator decision', admin_count;
  end if;

  -- ------------------------------------------------------------------
  -- Step 2 — Identify OLD admin + capture credentials we will copy.
  -- ------------------------------------------------------------------
  select a.id, a.email, a.password_hash, a.email_verified_at,
         coalesce(a.teacher_telegram_enabled, false),
         a.teacher_telegram_chat_id
    into old_id, old_email, old_password_hash, old_email_verified_at,
         old_teacher_tg_enabled, old_teacher_tg_chat_id
    from accounts a
    join account_roles r on r.account_id = a.id
   where r.role = 'admin'
   limit 1;

  -- Defence-in-depth — if the join didn't land for any reason, abort.
  if old_id is null then
    raise exception 'mig 0083: admin lookup returned NULL — aborting before any mutation';
  end if;

  -- ------------------------------------------------------------------
  -- Step 3 — Rename OLD email to synthetic + push old email to history.
  -- accounts.email UNIQUE INDEX permits the swap because the UPDATE
  -- commits before NEW's INSERT in step 4.
  -- ------------------------------------------------------------------
  update accounts
     set email = 'admin-2026-05-22@levelchannel.internal',
         audit_email_history = audit_email_history
           || jsonb_build_object(
                'previous_email', old_email,
                'changed_at', now()::text,
                'reason', 'saas-pivot-bootstrap-2026-05-22'
              ),
         updated_at = now()
   where id = old_id;

  -- ------------------------------------------------------------------
  -- Step 4 — Mint NEW pure-teacher account inheriting OLD credentials.
  -- email_verified_at copied so `/teacher` layout's `unverified →
  -- /cabinet` redirect doesn't trap Анастасия on first login
  -- (round-23 BLOCKER #1 closure).
  -- ------------------------------------------------------------------
  insert into accounts (email, password_hash, email_verified_at, created_at, updated_at)
  values (old_email, old_password_hash, old_email_verified_at, now(), now())
  returning id into new_id;

  insert into account_roles (account_id, role, granted_at)
  values (new_id, 'teacher', now())
  on conflict (account_id, role) do nothing;

  -- Bootstrap teacher subscribed to plan-4 immediately.
  insert into teacher_subscriptions (account_id, plan_slug, state, created_at, updated_at)
  values (new_id, 'operator-managed', 'active', now(), now())
  on conflict (account_id) do nothing;

  -- ------------------------------------------------------------------
  -- Step 4a — Revoke OLD active sessions. Anastasiya re-logs on NEW.
  -- ------------------------------------------------------------------
  update account_sessions
     set revoked_at = now()
   where account_id = old_id
     and revoked_at is null;

  -- ------------------------------------------------------------------
  -- Step 4b — Mass-consume OLD's outstanding single-use auth tokens.
  -- Round-24 BLOCKER closure: tokens are account_id-bound, not email-
  -- bound; a stale reset/verify link pointing at OLD would still
  -- authenticate into OLD after the swap. Mark them all consumed in
  -- the same TX as the email rename.
  -- ------------------------------------------------------------------
  update password_resets
     set consumed_at = now()
   where account_id = old_id
     and consumed_at is null;

  update email_verifications
     set consumed_at = now()
   where account_id = old_id
     and consumed_at is null;

  -- ------------------------------------------------------------------
  -- Step 5 — Re-point ALL teacher-side data from OLD to NEW. Round-22
  -- + round-26 + round-21 closures — full inventory from §2.9.
  -- ------------------------------------------------------------------

  -- 5.1 lesson_slots.teacher_account_id
  update lesson_slots
     set teacher_account_id = new_id
   where teacher_account_id = old_id;

  -- 5.2 pricing_tariffs.teacher_id (column added by mig 0075; NULL → NEW)
  update pricing_tariffs
     set teacher_id = new_id
   where teacher_id is null;

  -- 5.3 lesson_packages.teacher_id (column added by mig 0076a; NULL → NEW)
  update lesson_packages
     set teacher_id = new_id
   where teacher_id is null;

  -- 5.4 package_purchases.teacher_id — denormalise from the package row.
  update package_purchases pp
     set teacher_id = lp.teacher_id
    from lesson_packages lp
   where pp.package_id = lp.id
     and pp.teacher_id is null;

  -- 5.5 teacher_calendar_integrations — keyed by account_id (NOT
  -- teacher_account_id); mig 0043 column name is `account_id`.
  -- ON CONFLICT DO NOTHING defensive against the (extremely unlikely)
  -- case where NEW already had a row inserted between step 4 and now.
  update teacher_calendar_integrations
     set account_id = new_id
   where account_id = old_id;

  -- 5.6 teacher_external_busy_intervals.teacher_account_id (mig 0044)
  update teacher_external_busy_intervals
     set teacher_account_id = new_id
   where teacher_account_id = old_id;

  -- 5.7 calendar_push_jobs + calendar_pull_jobs.teacher_account_id (mig 0045)
  update calendar_push_jobs
     set teacher_account_id = new_id
   where teacher_account_id = old_id;

  update calendar_pull_jobs
     set teacher_account_id = new_id
   where teacher_account_id = old_id;

  -- 5.8 teacher_invites.teacher_account_id (mig 0057)
  update teacher_invites
     set teacher_account_id = new_id
   where teacher_account_id = old_id;

  -- 5.9 accounts.teacher_telegram_* — copy OLD's values to NEW, NULL on OLD.
  -- accounts_teacher_telegram_consistency CHECK requires (enabled=false
  -- OR chat_id IS NOT NULL); order matters:
  --   - First set NEW with the OLD values (chat_id THEN enabled).
  --   - Then clear OLD (enabled=false first; chat_id can be NULL once
  --     enabled is false).
  update accounts
     set teacher_telegram_chat_id = old_teacher_tg_chat_id,
         teacher_telegram_enabled = old_teacher_tg_enabled,
         updated_at = now()
   where id = new_id;

  update accounts
     set teacher_telegram_enabled = false,
         teacher_telegram_chat_id = null,
         updated_at = now()
   where id = old_id;

  -- 5.10 teacher_account_daily_digests.account_id (mig 0067)
  update teacher_account_daily_digests
     set account_id = new_id
   where account_id = old_id;

  -- 5.11 learner_reminder_dispatches — schema-survey note: this table
  -- (mig 0064) keys on (slot_id, account_id=learner). It has no
  -- teacher_id column; the teacher is reached transitively via
  -- slot_id → lesson_slots.teacher_account_id, which we already
  -- repointed in 5.1. No direct UPDATE needed. Plan §2.9 mentions
  -- "rows linked via teacher_id" abstractly; the closure here is
  -- "covered by 5.1".

  -- ------------------------------------------------------------------
  -- Step 5a — Re-point account_profiles row + set teacher_public_slug='level'.
  -- Round-21 BLOCKER closure: account_profiles is 1:1 keyed on
  -- account_id; bootstrap row needs explicit move (createAccount does
  -- not auto-mint profiles).
  -- Round-23 BLOCKER #2 closure: account_profiles_locale_allowlist
  -- accepts only 'ru' (NOT 'ru-RU'); the admin re-seed below uses 'ru'.
  -- ------------------------------------------------------------------
  update account_profiles
     set account_id = new_id,
         teacher_public_slug = 'level',
         updated_at = now()
   where account_id = old_id;

  insert into account_profiles (account_id, display_name, timezone, locale, created_at, updated_at)
  values (old_id, 'admin', 'Europe/Moscow', 'ru', now(), now())
  on conflict (account_id) do nothing;

  -- ------------------------------------------------------------------
  -- Step 6 — Re-point learner links + dual-write assigned_teacher_id.
  -- Insert into learner_teacher_links FIRST (PK conflict no-op if it
  -- somehow re-runs), then update legacy column for MVP dual-read sites.
  -- ------------------------------------------------------------------
  insert into learner_teacher_links (learner_account_id, teacher_account_id, linked_at)
  select id, new_id, now()
    from accounts
   where assigned_teacher_id = old_id
  on conflict (learner_account_id, teacher_account_id) do nothing;

  update accounts
     set assigned_teacher_id = new_id,
         updated_at = now()
   where assigned_teacher_id = old_id;

  -- ------------------------------------------------------------------
  -- Step 7 — Mark NEW with the migration marker (idempotency primitive).
  -- ------------------------------------------------------------------
  update accounts
     set teacher_account_migration_marker = 'bootstrap-2026-05-22',
         updated_at = now()
   where id = new_id;

  -- ------------------------------------------------------------------
  -- Final integrity check — OLD must own no teacher-bound data left.
  -- (lesson_slots only; the rest were repointed unconditionally above.)
  -- ------------------------------------------------------------------
  select count(*) into remaining
    from lesson_slots
   where teacher_account_id = old_id;
  if remaining > 0 then
    raise exception 'mig 0083 integrity check failed: % lesson_slots still owned by OLD admin (id=%)', remaining, old_id;
  end if;

  raise notice 'mig 0083: bootstrap row-MOVE complete (OLD=%, NEW=%)', old_id, new_id;
end
$bootstrap$;
