# Migrations

Source of truth for the production Postgres schema. Replaces the implicit
`ensureSchema*` paths that used to create tables on first request.

## Convention

- One file per migration. Names: `NNNN_short_name.sql`, zero-padded.
- Applied in lexicographic order.
- Each file runs in its own transaction.
- Additive only. Destructive changes (DROP, NOT-NULL backfill, type changes
  on populated columns) require a separate planning round before they ship.
- Idempotent CREATE statements (`if not exists`) so a database that already
  has the legacy schema applies the migration with zero diff.

## Running

```bash
DATABASE_URL=postgres://... npm run migrate:up
DATABASE_URL=postgres://... npm run migrate:status
```

`up` applies every pending migration. `status` lists every file with its
state (`applied` / `pending`) plus any orphan rows in `_migrations` whose
file no longer exists.

## Bootstrapping an existing database

The four files numbered `0001..0004` mirror the schema that the legacy
`ensureSchema*` calls used to create at runtime. On a database that already
has those tables, `npm run migrate:up` will:

1. create the `_migrations` bookkeeping table;
2. run each migration body inside a transaction. Because every statement is
   `create table if not exists` / `create index if not exists`, no schema
   change happens — the only effect is recording the four migration names
   in `_migrations`;
3. report `done`.

Run it once on each environment (local dev, staging, prod) to bring the
bookkeeping in sync. After that, every new schema change ships as a new
file in this directory and is rolled out via the same command.

## Out of scope (intentionally)

- `down` / rollback migrations. Schema changes are additive; reverting a
  bad release is done by reverting the application code, not by reversing
  schema mutations.
- Code migrations (`.js`/`.ts`). Only `.sql` is recognized.
- Schema diff / drift detection. The runner trusts the file order.

## Authoring a new migration

1. Pick the next number (`ls migrations/ | tail -n 1`, increment).
2. Write `NNNN_what_changes.sql`. Keep the body small and focused.
3. Use `IF NOT EXISTS` on CREATE so re-running on a partially-applied
   environment is safe.
4. For ALTER TABLE on populated columns, wrap in `DO $$ BEGIN ... EXCEPTION
   WHEN duplicate_column THEN NULL; END $$` or check `information_schema`
   first — Postgres has no native `ADD COLUMN IF NOT EXISTS` for some
   variants.
5. Run `npm run migrate:up` against a local Postgres before committing.
