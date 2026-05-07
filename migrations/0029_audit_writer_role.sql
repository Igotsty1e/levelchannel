-- Wave 3 #2 (security) — separate INSERT-only DB role for audit tables.
--
-- Threat model this closes:
--
--   The application's primary DB role (used by DATABASE_URL) has
--   full privileges on every table — including UPDATE/DELETE on
--   payment_audit_events and auth_audit_events. A SQL-injection
--   bug ANYWHERE in the app that smuggles a query through that
--   connection could rewrite or wipe the audit history. Audit
--   integrity is the foundation of forensic / 152-FZ-aligned
--   investigations; "the audit log says it didn't happen" must
--   be an absolute statement, not "someone might have edited it".
--
--   The fix is operational, not algorithmic: the audit recorder
--   gets its own DB role with INSERT-only grants on the audit
--   tables. Even if every other code path is compromised, audit
--   rows can be APPENDED but not modified or removed through that
--   connection. The retention janitor still uses the primary role
--   (it needs DELETE).
--
-- Rollout (operator-driven, after this migration applies):
--
--   1. The migration creates the role with NO password set. The
--      role exists but cannot log in until step 2.
--   2. Operator: `ALTER USER levelchannel_audit_writer WITH
--      PASSWORD '<random 40+ char alphanumeric>'`.
--   3. Operator: build `AUDIT_DATABASE_URL` of the same shape as
--      `DATABASE_URL` but with this user/password and add to the
--      operator-side env store.
--   4. Operator: `systemctl restart levelchannel`. The audit pool
--      now goes through this role; the rest of the app keeps
--      using DATABASE_URL.
--   5. Verify: `/api/health` reports `database: ok`; trigger a
--      synthetic audit event (e.g. login a test account); confirm
--      a row appeared via the primary role's read.
--
-- Until AUDIT_DATABASE_URL is set, the audit pool falls back to
-- DATABASE_URL — code change is backwards compatible.
--
-- Idempotence: the migration uses DO blocks + IF NOT EXISTS so
-- re-running is a no-op.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'levelchannel_audit_writer') then
    -- LOGIN role with no password yet. Operator sets it via ALTER USER
    -- in step 2 above. NOLOGIN would be safer in transit but breaks the
    -- step-2 ALTER unless we add LOGIN there too — keeping LOGIN +
    -- no-password achieves the same "cannot connect yet" property.
    create role levelchannel_audit_writer with login;
  end if;
end$$;

-- Strip any historical privileges this role might have accumulated
-- on the audit tables. Idempotent — REVOKE on a non-granted privilege
-- is a no-op.
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
--
-- pgcrypto functions (gen_random_uuid, pgp_sym_encrypt) are
-- EXECUTE-able by PUBLIC by default — no explicit grant needed.

-- Optional: schema USAGE. Without it the role can't even refer to
-- the table by name. PUBLIC has USAGE on schema `public` by default
-- in stock Postgres, so this line is defensive against a future
-- hardening that revokes that.
grant usage on schema public to levelchannel_audit_writer;

-- Comment for forensic clarity.
comment on role levelchannel_audit_writer is
  'Wave 3 #2 — INSERT-only role for audit recorders. Cannot read, update, or delete audit rows. Used by lib/audit/pool.ts when AUDIT_DATABASE_URL is set.';
