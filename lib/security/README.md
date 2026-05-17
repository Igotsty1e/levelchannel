# lib/security — defense-in-depth primitives

> **Trust boundary:** authoritative security gates. `idempotency.ts` + `request.ts` are on the **critical-path inventory** (`docs/critical-path.md`). PRs touching them MUST carry `Codex-Paranoia: SIGN-OFF`.

## Purpose

Cross-cutting security primitives every authenticated/money-moving route depends on:
- **Idempotency** — `withIdempotency` is the wrapper around money-moving + admin mutator routes. Same-key sequential replay returns cached response.
- **Rate-limit** — shared-store via Postgres `rate_limit_buckets` (migration 0016) with in-memory fallback. Atomic upsert, fixed-window semantics.
- **Origin checks** — `enforceTrustedBrowserOrigin` (Same-Origin / Sec-Fetch-Site filter).
- **Invoice ID validation** — `validateInvoiceId` shape check; rejects path-traversal + non-prefix invoices.

## Files

| File | Role |
|---|---|
| `idempotency.ts` | `withIdempotency(request, scope, rawBody, executor)` — Postgres-backed cache by sha256(rawBody); 7-day retention |
| `rate-limit.ts` | `takeRateLimit(key, limit, windowMs)` — Postgres bucket + memory fallback; `__resetRateLimitsForTesting` |
| `request.ts` | `enforceRateLimit(request, key, limit, windowMs)`, `enforceTrustedBrowserOrigin(request)`, `validateInvoiceId` |

## Invariants

1. **`withIdempotency` contract is SEQUENTIAL-only.** Same-key concurrent callers MAY both execute. Post-merge paranoia rollback PR #258 reverted a lib-level lock attempt because it created pool-DoS under N ≥ DATABASE_POOL_MAX concurrent same-key (lib-level locks holding pool connections = pool starvation). Callers needing concurrent safety MUST use optimistic concurrency (e.g. `expectedUpdatedAt`) — ALERTS-EDITOR is the reference.
2. **Idempotency cache stores ≤ 4xx responses.** 5xx is infra failure; replay should retry. AUDIT-CODE-2 (2026-05-17) fixed an env-preflight ordering bug where 422 was cached and a corrected retry kept replaying.
3. **Rate-limit Postgres → memory fallback.** When the Postgres bucket is unreachable, fall back to in-memory so the route still has SOME protection. nginx `limit_req` is the last-line defense and remains regardless.
4. **Atomic fixed-window upsert.** Same counter agrees across replicas via INSERT … ON CONFLICT DO UPDATE. Window-reset is server-side (`reset_at <= now()` → start fresh).
5. **`enforceTrustedBrowserOrigin` is HMAC-style rejection.** Cross-site requests get 403 with no leaked info; same-origin pass-through is silent.
6. **Invoice ID format gate.** `lc_*` prefix + UUID-shaped body. Rejects `..` and `/` to defeat path traversal in the `/api/payments/[invoiceId]/*` family.

## Cross-references

- `ARCHITECTURE.md §Security layer` — file inventory.
- `SECURITY.md` — full security contract (auth, encryption, audit, rate-limit defense-in-depth).
- `docs/critical-path.md §Security gates` — the 2 files in this module that are load-bearing.
- `~/.claude/projects/-Users-ivankhanaev-LevelChannel/memory/post-merge-paranoia-rollback.md` (if extracted) — the lib-level lock anti-pattern.

## Test surface

- `tests/security/*.test.ts` — unit tests on idempotency (file-backend branch only; Postgres branch is integration), rate-limit, request helpers.
- `tests/integration/payment/*.test.ts` — withIdempotency end-to-end on money-moving routes.
- `tests/integration/admin/*.test.ts` — admin mutator routes go through requireAdminRole + enforceRateLimit + enforceTrustedBrowserOrigin.
