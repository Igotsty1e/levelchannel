# lib/db — shared Postgres pool + error-narrowing utilities

> **Trust boundary:** infrastructure. The pool singleton is not on the
> critical-path inventory in itself, but if it dies the entire site does
> — every authoritative path (sessions, money, calendar) routes through
> here. Treat regressions in `pool.ts` as production-grade incidents
> even though the file does not carry a `Codex-Paranoia: SIGN-OFF`
> per-PR requirement.

## Purpose

Two responsibilities, both module-level cross-cutting:

- **One shared `pg.Pool`** for every Postgres-backed domain (payments,
  billing, auth, audit, calendar, scheduling, telemetry, security
  rate-limit + idempotency). Replaces the five per-domain pools that
  each defaulted to `max=10` and could together exhaust the
  `max_connections=100` Postgres ceiling. Per-domain getters
  (`getAuthPool`, `getAuditPool`) stay for legibility but all delegate
  here and return the same singleton.
- **SQLSTATE narrowing helpers** so unrelated call sites do not
  re-encode the same predicate (`error.code === '23505'`). Extracted in
  AUDIT-CODE-3 (2026-05-17) after the `42P01` "table missing" check was
  duplicated across `lib/admin/probe-status.ts` and an admin route.

## Files

| File | Role |
|---|---|
| `pool.ts` | `getDbPool()` (throws on missing `DATABASE_URL`), `getDbPoolOrNull()` (silent null for best-effort callers), `getHealthProbePool()` (max=2 dedicated probe pool), `resolveSslConfig(url, env)` (TLS policy) |
| `errors.ts` | SQLSTATE constants (`ERR_UNDEFINED_TABLE`, `ERR_UNIQUE_VIOLATION`, `ERR_FOREIGN_KEY_VIOLATION`, `ERR_CHECK_VIOLATION`) + predicates (`isUndefinedTableError`, `isUniqueViolationError`, `isForeignKeyViolationError`, `isCheckViolationError`) |

## Public API

### Pool getters

- **`getDbPool(): Pool`** — the authoritative singleton. Throws
  `DATABASE_URL is not configured.` when the env is missing. Used by
  every code path that assumes Postgres is wired (payments, auth,
  billing, scheduling, calendar).
- **`getDbPoolOrNull(): Pool | null`** — same singleton, but returns
  `null` instead of throwing when `DATABASE_URL` is unset. Used by
  best-effort callers (audit recorder; rate-limit Postgres-backend
  fallback) that must silently skip when there is no DB to talk to.
  See `lib/audit/pool.ts` for the canonical wrapper.
- **`getHealthProbePool(): Pool`** — dedicated tiny pool
  (`max=HEALTH_POOL_MAX=2`, `connectionTimeoutMillis=1500`,
  `idleTimeoutMillis=1000`) for `/api/health` probes. Isolated from
  the shared singleton so a saturated app pool cannot cause the
  external uptime monitor to false-positive on `database: fail`.

### Error helpers

- **`ERR_UNDEFINED_TABLE` = `'42P01'`** — relation does not exist.
  Used by graceful-degradation paths that may run before their
  supporting migration has been applied (`ALERTS-OBS` admin reader
  returns `{ migrationPending: true }` instead of 500).
- **`ERR_UNIQUE_VIOLATION` = `'23505'`** — duplicate key on UNIQUE /
  PRIMARY KEY. The idempotency contract for `package_purchases`
  (`payment_order_id` UNIQUE) hinges on this code being recognised by
  the grant path.
- **`ERR_FOREIGN_KEY_VIOLATION` = `'23503'`** — FK references a missing
  row.
- **`ERR_CHECK_VIOLATION` = `'23514'`** — value violates a CHECK
  constraint. Surfaces on MSK-band / status-enum / amount-immutability
  triggers.
- **`isUndefinedTableError(err)`** / `isUniqueViolationError(err)` /
  `isForeignKeyViolationError(err)` / `isCheckViolationError(err)` —
  unknown-shape-safe predicates (work on any `unknown`; check for
  `.code` field without forcing a `Error` cast).

## Invariants

1. **One pool process-wide.** The singleton lives on `globalThis` so
   Next.js dev-server hot-reload does not leak fresh pools per
   request. New code MUST go through `getDbPool()` / `getDbPoolOrNull()`
   — never `new Pool(...)` ad-hoc. The 2026-05-07 health-route hotfix
   was exactly this regression (an ad-hoc `new Pool({})` bypassed the
   TLS resolver).
2. **`resolveSslConfig` is the TLS policy.** The pg library's JS-side
   `ssl` option overrides any `?sslmode=...` URL hint, so the policy
   is owned in TypeScript. Auto-detect: `localhost` / `127.0.0.1` /
   `::1` → no TLS (loopback is the single-server-deploy shape); every
   other host → `{ rejectUnauthorized: true }`. Production rejects
   `DB_SSL=disable` and `DB_SSL_REJECT_UNAUTHORIZED=false` ONLY for
   non-local hosts.
3. **No wildcard `.local` in the loopback allowlist.** Strict literal
   match only. The 2026-05-07 Codex finding documented why a
   `*.local` suffix is exploitable via attacker-controlled mDNS
   (`db.attacker.local`); the test in `tests/db/pool.test.ts` pins
   this regression.
4. **Pool sizing.**
   - **App server / route handlers:** `DATABASE_POOL_MAX` (default 10,
     min 1). Suitable for the single-VPS deploy; tunable upward when
     Postgres `max_connections` headroom permits.
   - **Cron probes / one-shot scripts** (e.g. retention cleanup,
     audit backfill, key rotation): use `max=1` when instantiating a
     local `new Pool()` directly with the same `connectionString` +
     `resolveSslConfig`. The shared singleton's 10-connection ceiling
     is sized for app traffic, not for bulk scans.
   - **Health probe:** dedicated `max=2` via `getHealthProbePool()`.
5. **Best-effort callers MUST use `getDbPoolOrNull`.** The audit
   recorder and rate-limit Postgres backend silently skip when
   `DATABASE_URL` is unset, so the boot-time `DATABASE_URL is not
   configured` throw never blocks a dev / test run that does not need
   audit history.
6. **Error helpers are unknown-safe.** Predicates accept `unknown` and
   defensively narrow without throwing — pg may surface errors as
   `Error` subclasses or as bare objects depending on the failure
   mode. Never compare `error.code === '23505'` inline; use the named
   predicate so an added code (e.g. `42703` column missing) lands in
   exactly one place.

## Cross-references

- `ARCHITECTURE.md §Audit log (payment lifecycle)` — the
  `lib/db/pool.ts` entry documents the 2026-04-29 five-pool
  consolidation + the Wave 1.1 `resolveSslConfig` gate.
- `docs/critical-path.md` — pool failure cascades into every Money-
  moving and Security-gate file on the inventory. No file in this
  module is on the list itself; the whole module is the substrate.
- `~/.claude/projects/-Users-ivankhanaev-LevelChannel/memory/postgres_create_table_locks_during_active_tx.md`
  — the 2026-05-16 incident: `CREATE TABLE IF NOT EXISTS` inside a
  nested helper takes `ACCESS EXCLUSIVE` and deadlocks against an
  outer `ACCESS SHARE` from a route TX. Lesson lives in the calling
  pattern, not in this module.
- `lib/auth/pool.ts`, `lib/audit/pool.ts` — domain wrappers that
  delegate here. Audit wrapper additionally honours
  `AUDIT_DATABASE_URL` for the INSERT-only `levelchannel_audit_writer`
  role (migration 0029).

## Test surface

- `tests/db/pool.test.ts` — unit tests on `resolveSslConfig` covering
  loopback auto-detect, `.local` rejection, `DB_SSL=disable` /
  `DB_SSL_REJECT_UNAUTHORIZED=false` production gates.
- `tests/db/errors.test.ts` — unit tests on the SQLSTATE predicates
  (positive + negative shape checks, `unknown`-safety).
- Every Postgres-backed integration suite (`tests/integration/**`)
  exercises the singleton end-to-end; a regression in pool init shows
  up loud as suite-wide connection failures, not as a single test
  flake.
