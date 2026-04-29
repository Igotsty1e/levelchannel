-- DB-level invariant for email normalization. Application code in
-- lib/auth/accounts.ts always writes lower(btrim(email)) — this CHECK
-- makes that contract enforceable from outside the application too:
-- a one-off psql session, a future data migration, or any non-TS writer
-- that bypasses normalizeAccountEmail() will be rejected at insert time
-- instead of creating a shadow account that races the canonical one.
--
-- The existing UNIQUE index on (email) keeps doing its job. Because
-- every value in the column is now already normalized, a regular UNIQUE
-- on `email` is functionally equivalent to a UNIQUE on lower(btrim(email))
-- without the cost of a second index.
--
-- If a future row happens to be non-normalized at the moment this
-- migration runs, ALTER TABLE will fail loudly. That is the desired
-- behavior: a non-normalized row is the kind of drift this constraint
-- exists to prevent, and the operator should fix it manually before
-- re-running the migration.

alter table accounts
  add constraint accounts_email_normalized
  check (email = lower(btrim(email)));
