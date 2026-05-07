-- Wave 3 #2 (security) — separate INSERT-only DB role for audit tables.
--
-- ROLLOUT NOTE — read before re-running this migration anywhere new.
--
-- Postgres `CREATE ROLE` requires the calling user to have CREATEROLE
-- (or be superuser). The application's DB user (`levelchannel`) does
-- NOT have CREATEROLE in production — granting it would defeat the
-- whole point of this hardening pass. So the migration here does NOT
-- attempt to create the role itself. Instead:
--
--   1. Operator pre-creates the role as a one-time superuser action:
--        sudo -u postgres psql -f scripts/setup-audit-writer-role.sql
--      That script handles CREATE ROLE + GRANTs in one shot.
--
--   2. This migration runs idempotently as part of every deploy and
--      re-applies GRANTs if the role exists. If the role does NOT
--      exist (operator hasn't run the setup script yet), the
--      migration emits a NOTICE and exits cleanly — autodeploy
--      proceeds, audit recorder falls back to the shared pool, and
--      the security gain from Wave 3 #2 simply doesn't kick in until
--      the operator acts. No deploy is ever blocked.
--
--   3. After operator runs the setup script, the next deploy
--      (or this migration re-run) applies the grants automatically.
--
-- Threat model recap:
--
--   The application's primary DB role has full privileges on every
--   table — including UPDATE/DELETE on payment_audit_events and
--   auth_audit_events. A SQL-injection bug ANYWHERE in the app that
--   smuggles a query through that connection could rewrite or wipe
--   the audit history. Audit integrity is the foundation of forensic
--   / 152-FZ-aligned investigations; "the audit log says it didn't
--   happen" must be an absolute statement, not "someone might have
--   edited it".
--
--   The fix is operational, not algorithmic: the audit recorder gets
--   its own DB role (`levelchannel_audit_writer`) with INSERT-only
--   grants on the audit tables. Even if every other code path is
--   compromised, audit rows can be APPENDED but not modified or
--   removed through that connection. The retention janitor still
--   uses the primary role (it needs DELETE).
--
-- Idempotence: re-running is a no-op (REVOKE / GRANT statements
-- inside a DO block).

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'levelchannel_audit_writer') then
    -- Strip any historical privileges this role might have
    -- accumulated. REVOKE on a non-granted privilege is a no-op.
    revoke all on payment_audit_events from levelchannel_audit_writer;
    revoke all on auth_audit_events from levelchannel_audit_writer;

    -- Grant only INSERT. Rationale (no SELECT / UPDATE / DELETE)
    -- documented in scripts/setup-audit-writer-role.sql header.
    grant insert on payment_audit_events to levelchannel_audit_writer;
    grant insert on auth_audit_events to levelchannel_audit_writer;

    -- Schema USAGE — defensive against a future hardening that
    -- revokes the PUBLIC default.
    grant usage on schema public to levelchannel_audit_writer;

    raise notice '[wave-3-2] grants re-applied to levelchannel_audit_writer';
  else
    raise notice '[wave-3-2] role levelchannel_audit_writer does not exist; operator must run scripts/setup-audit-writer-role.sql as superuser. Skipping grants. The audit recorder will continue using the shared primary pool until the role is created and AUDIT_DATABASE_URL is set in the operator-side env.';
  end if;
end$$;

comment on column payment_audit_events.event_type is
  'Wave 3 #2: writes to this table go through levelchannel_audit_writer when AUDIT_DATABASE_URL is set in env. INSERT-only role (see scripts/setup-audit-writer-role.sql).';
