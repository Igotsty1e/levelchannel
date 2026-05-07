-- Wave 3 #2 — one-shot operator setup for the audit-writer DB role.
--
-- WHY THIS IS NOT IN A MIGRATION:
--
--   `CREATE ROLE` requires CREATEROLE privilege (or superuser). The
--   application's DB user (`levelchannel`) does not have CREATEROLE
--   in production — granting it would defeat the whole hardening
--   pass. So this one-shot script is run by the operator as
--   superuser, exactly once. From then on, every deploy applies the
--   grants idempotently via migration 0029.
--
-- HOW TO RUN (on the prod VPS):
--
--   sudo -u postgres psql -d levelchannel -f scripts/setup-audit-writer-role.sql
--
--   Then in psql as superuser, set the password:
--     ALTER USER levelchannel_audit_writer WITH PASSWORD '<40-char alphanumeric>';
--
--   Build AUDIT_DATABASE_URL of the same shape as DATABASE_URL but
--   with this user/password, add to the operator-side env file,
--   restart the levelchannel service.
--
-- THREAT MODEL RECAP:
--
--   Pre-rollout: any SQL-injection bug in the app could UPDATE or
--   DELETE rows in payment_audit_events / auth_audit_events through
--   the primary DATABASE_URL connection. That breaks audit
--   integrity.
--
--   Post-rollout: audit recorder uses AUDIT_DATABASE_URL, which
--   authenticates as this INSERT-only role. Audit rows can be
--   APPENDED but not modified. The retention janitor
--   (`scripts/db-retention-cleanup.mjs`) still uses DATABASE_URL
--   because it needs DELETE.
--
-- IDEMPOTENCE: re-running is safe (DO block + REVOKE/GRANT).

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'levelchannel_audit_writer') then
    create role levelchannel_audit_writer with login;
    raise notice '[wave-3-2] created role levelchannel_audit_writer (no password yet — set it next)';
  else
    raise notice '[wave-3-2] role levelchannel_audit_writer already exists';
  end if;
end$$;

-- Strip any historical privileges this role might have accumulated.
revoke all on payment_audit_events from levelchannel_audit_writer;
revoke all on auth_audit_events from levelchannel_audit_writer;

-- Grant only INSERT. No SELECT, no UPDATE, no DELETE, no TRUNCATE,
-- no REFERENCES.
--
-- Why no SELECT: the recorder does not read; it inserts and discards
-- the result. A SELECT grant would let a compromised audit-writer
-- session read the entire audit history (including PII), which is
-- exactly the leak we are narrowing.
--
-- Why no UPDATE: the recorder never updates. UPDATE on this role
-- would defeat the integrity property.
--
-- Why no DELETE: the retention janitor uses the primary role
-- (DATABASE_URL), not this one. The audit-writer must not be able
-- to delete history.
grant insert on payment_audit_events to levelchannel_audit_writer;
grant insert on auth_audit_events to levelchannel_audit_writer;

-- Sequence access — inserting a row that uses a serial / generated
-- column needs USAGE on the sequence. payment_audit_events and
-- auth_audit_events both use uuid `default gen_random_uuid()`, not
-- sequences, so no sequence grant is necessary today. If a future
-- migration adds a serial column, this comment is the breadcrumb.

-- pgcrypto functions (gen_random_uuid, pgp_sym_encrypt) are
-- EXECUTE-able by PUBLIC by default — no explicit grant needed.

-- Schema USAGE. Without it the role can't even refer to the table by
-- name. PUBLIC has USAGE on schema `public` by default in stock
-- Postgres, but this line is defensive against a future hardening
-- that revokes that default.
grant usage on schema public to levelchannel_audit_writer;

-- Forensic comment.
comment on role levelchannel_audit_writer is
  'Wave 3 #2 — INSERT-only role for audit recorders. Cannot read, update, or delete audit rows. Used by lib/audit/pool.ts when AUDIT_DATABASE_URL is set.';
