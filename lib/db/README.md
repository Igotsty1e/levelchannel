# lib/db — single Postgres pool + shared error-code helpers

> **Trust boundary:** infrastructure. NOT on the critical-path inventory itself, but every critical-path module reaches Postgres through `getDbPool()` — a regression here cascades into all of them. Treat as "if this changes, paranoia anyway".

## Purpose

The single `pg.Pool` shared by every Postgres-backed module — payments, auth, idempotency, telemetry, audit, billing, scheduling, calendar. Five domain pools were consolidated into this singleton on 2026-04-29 to bound the connection footprint against the Postgres `max_connections` ceiling.

- **Pool factory** — `getDbPool()` (throws) + `getDbPoolOrNull()` (silent skip for best-effort callers like the audit recorder) + `getHealthProbePool()` (isolated tiny pool for `/api/health`).
- **TLS policy resolver** — `resolveSslConfig(url, env)`. JS-side `ssl` overrides any URL-level `?sslmode=...` hint, so this resolver is the authoritative policy.
- **SQLSTATE predicates** — `isUndefinedTableError` / `isUniqueViolationError` / `isForeignKeyViolationError` / `isCheckViolationError` (AUDIT-CODE-3 2026-05-17 extraction).

## Files

| File | Role |
|---|---|
| `pool.ts` | `getDbPool()`, `getDbPoolOrNull()`, `getHealthProbePool()`, `resolveSslConfig(url, env)` |
| `errors.ts` | `ERR_*` SQLSTATE constants + `isUndefinedTableError` / `isUniqueViolationError` / `isForeignKeyViolationError` / `isCheckViolationError` predicates |

## Invariants

1. **One singleton pool process-wide.** `global.__levelchannelDbPool` is the lazy slot. Every domain-named getter (`getAuthPool`, `getAuditPool`, `lib/audit/pool.ts`, etc.) delegates to `getDbPool()` and returns this same instance. Splitting back into per-domain pools = re-introducing the 50-connection-per-process footprint that consolidation closed.
2. **`max` bounded by `DATABASE_POOL_MAX` env, default 10.** Sized for managed-Postgres free tiers (25-50 connection ceiling). Tune via env, never hardcode.
3. **TLS-by-host auto-detect — strict loopback allowlist.** `localhost` / `127.0.0.1` / `::1` only. NEVER add wildcard suffixes (`.local` was historically here; Codex flagged that any attacker-controlled mDNS host would bypass strict TLS in production — strict allowlist closes that hole). Every non-loopback host gets `{ rejectUnauthorized: true }`.
4. **Production refuses `DB_SSL=disable` for non-local hosts.** Production refuses `DB_SSL_REJECT_UNAUTHORIZED=false` for non-local hosts. Both restrictions skip the loopback path (same-host Postgres is a valid single-server topology — the original "refuse localhost in prod" rule was overzealous and broke real prod).
5. **JS-side `ssl` overrides URL `?sslmode=...`.** Don't try to express TLS policy via the connection string; the resolver is the only authority.
6. **`getDbPoolOrNull()` is the best-effort variant.** Returns `null` when `DATABASE_URL` is unset; only callers that can silently skip (audit recorder) should use it. Production paths use `getDbPool()` so a missing env fails loud at first DB touch.
7. **Health-probe pool is isolated (max=2).** Saturating the shared `max=10` pool under real traffic must not flip the health route into `database: fail`; the probe goes through `getHealthProbePool()`, which shares only the SSL resolver, not the connection ceiling.
8. **SQLSTATE predicates are the single source of truth** for the "is this a missing-table error" question and friends. Adding a new code = add to `errors.ts` (not inline `err.code === '...'` at the call site). The 2026-05-17 AUDIT-CODE-3 extraction was the closure of a prior duplication.

## Cross-references

- `ARCHITECTURE.md §Audit log (payment lifecycle)` — the post-consolidation pool is described inline at the `lib/db/pool.ts` entry; ARCHITECTURE.md is the cross-module diagram.
- `SECURITY.md §Database connections + TLS policy` — the production-grade TLS gate decisions.
- `docs/critical-path.md §Audit-log integrity` — `lib/audit/payment-events.ts` is on the list and depends on this pool.
- `migrations/0029_audit_writer_role.sql` — the `levelchannel_audit_writer` INSERT-only role that the audit recorder uses (separate connection string handled by `lib/audit/pool.ts`, not `getDbPool()`).

## Test surface

- `tests/db/pool.test.ts` (if present) — unit tests on `resolveSslConfig` host parsing + explicit-override branches.
- Indirectly: every `tests/integration/**/*.test.ts` goes through this pool against a real Postgres in `docker-compose.test.yml`.
- Regressions on the loopback-vs-strict-TLS boundary surface as integration-suite failures on the test container.

## How to extend

- New SQLSTATE predicate: add the constant + `isXxxError` helper to `errors.ts`; never inline `err.code === '...'` at a call site.
- New TLS host-class: re-think the strict allowlist first. The 2026-05-XX `.local` removal is the cautionary tale — wildcard host suffixes are an attack surface.
- A second pool for a future workload (e.g. analytics-replica): factor `pool.ts` to take a `connectionString` parameter rather than re-reading `DATABASE_URL`; keep the singleton-per-URL pattern so each replica has exactly one pool.
