# Wave 1 + Wave 2 — security hardening — retrospective plan

> **Status:** SHIPPED 2026-05-07. This doc is a retrospective
> reconstruction of the plan as it WOULD have looked before code
> landed, written for `/plan-eng-review` to read against the
> already-merged commits + the in-flight adversarial findings. The
> exercise calibrates whether `/plan-eng-review` would have caught
> any of the three problems we hit only after deploy:
>
>   1. The Wave 1.1 "refuse localhost in production" throw that
>      shipped clean and 500'd every authenticated route.
>   2. The Wave 1.1 health-probe blind spot (ad-hoc `pg.Pool`
>      bypassed `resolveSslConfig`).
>   3. The 8 adversarial findings surfaced during self-review.
>
> Compare `/plan-eng-review`'s output to the actual incidents +
> findings as a calibration data point.

## Goal

Close five concrete production-money risks identified by the
2026-05-07 security inventory:

1. **Postgres connection downgraded to plaintext** if operator forgot
   `?sslmode=require` in `DATABASE_URL`. Risk: any in-flight payment
   or auth row visible on the wire.
2. **CloudPayments webhook retries** re-running the full handler
   (markPaid, audit, operator email, allocation) on every retry. Risk:
   double-charged operators (the email goes twice), polluted audit
   trail, mounting allocation insert errors.
3. **Authenticated `admin` / `teacher` roles** allowed to call
   learner-side `/api/slots/*` endpoints. Risk: misleading data
   surfaces, teacher self-booking own slots, role-confusion bugs.
4. **`payment_audit_events` PII at rest in plaintext** for ~3 years
   (152-FZ retention). Risk: a DB dump leak (Render-equivalent
   support copy, operator laptop, backup misconfig) exposes 3 years
   of customer emails + login IPs.
5. **No bound on webhook flooding** if `CLOUDPAYMENTS_API_SECRET`
   leaks. Risk: an attacker holding the key can DoS the handler,
   storm operator email, and exhaust the audit table.

## Non-goals (this wave)

- Refund / credit on cancellation flow (Phase 7, separate wave)
- Calendar / grid UI for slots
- Sentry rule customization
- Operator key-rotation runbook (deferred to Wave 3 backlog)

## Architecture

### Wave 1.1 — TLS-required Postgres connections

`lib/db/pool.ts`'s `getDbPool()` previously accepted any
`DATABASE_URL` shape — TLS came only from a `?sslmode=require` URL
hint. The hint is forgettable.

New: `resolveSslConfig(url, env)` factory. Auto-detects
`localhost / 127.0.0.1 / ::1 / *.local` as no-TLS (loopback path);
every other host gets `ssl: { rejectUnauthorized: true }`. The
JS-side `ssl` option overrides URL hints, so the code owns the
policy.

Production hard-fail policy:
- `DB_SSL=disable` AND non-local host → throw
- `DB_SSL_REJECT_UNAUTHORIZED=false` AND non-local host → throw
- `DATABASE_URL pointing at localhost in production` → **throw** [DRAFT]

> **Note for the reviewer:** the third rule was in the plan as
> ORIGINALLY DRAFTED. Production for this app is a single VPS with
> Postgres on 127.0.0.1. The "throw on localhost-in-prod" rule was
> overzealous — it broke every authenticated route on first deploy.
> Hotfix landed via PR #47 within 30 minutes. Question for
> `/plan-eng-review`: would you have flagged this DURING the plan,
> or only after the incident?

### Wave 1.2 — webhook delivery dedup

New table `webhook_deliveries(provider, kind, transaction_id) PK`,
nullable `invoice_id`, jsonb `response_body`, `received_at` ts.

After HMAC verify + parse → consult cache. Hit returns cached
response with `Webhook-Replay: true` header. Miss runs handler,
stores outcome at the end. Best-effort: PG outage on lookup or
persist falls through to legacy non-dedup path.

Keyed by `TransactionId` only — `kind` separates check/pay/fail
flows that can legitimately share a TxId.

### Wave 1.3 — learner-archetype gate

New guards `requireLearnerArchetype` /
`requireLearnerArchetypeAndVerified` in `lib/auth/guards.ts`.
Deny-list (admin, teacher); legacy "no role" passes through as
implicit student.

Applied to `/api/slots/{mine, available, [id]/book, [id]/cancel}`.
403 with `error: wrong_role` and translatable message.

Anonymous browse on `/api/slots/available` stays open per the
existing loose contract (no learner data leaks; open slots carry
teacher + tariff + timing only).

### Wave 2.1 — pgcrypto encryption-at-rest

Migration 0025 enables `pgcrypto`, adds `customer_email_enc bytea`
and `client_ip_enc bytea` to `payment_audit_events` alongside the
existing plaintext columns. Three-phase plan:

- **Phase A** (this wave): app dual-writes via `pgp_sym_encrypt(...)`.
  Reads prefer encrypted with plaintext fallback (so the eventual
  null-out is invisible to consumers). Backfill script for legacy rows.
- **Phase B** (operator-driven, no schema change): nulled-out
  plaintext columns once Phase A has soaked for 24h+.
- **Phase C** (future wave, ≥30 days after Phase B): drop the
  plaintext columns.

Key resolution: `AUDIT_ENCRYPTION_KEY` from env, mandatory in
production, ≥32 chars enforced by `lib/audit/encryption.ts`.

### Wave 2.2 — secondary rate limit on webhooks

After HMAC verify (so unauth flood is free) and before parse, hit
`enforceRateLimit('webhook:cloudpayments:<kind>:ip', 60, 60_000)`.
60/min/(kind, IP) — ~1000× above legitimate CP retry cadence,
fires only on key-leak flood.

## Test plan

- 244 unit tests target the modules + edge cases (TLS resolver, dedup
  CASE-WHEN, encryption key resolver, learner-archetype gate).
- 51 integration tests against real Postgres 16.13 cover the SQL
  contract paths (PK conflict semantics, pgcrypto roundtrip, role
  exclusivity, dedup table CHECK constraints).
- Smoke: `/api/health` returns 200 + `database: ok` after deploy.

## Open questions for the reviewer

1. **Health probe parity vs isolation.** The plan as drafted has
   `/api/health` instantiating its own `pg.Pool` to be independent of
   any pool-init bug. After deploy, the Wave 1.1 throw-on-localhost
   bug shipped clean *because* health bypassed `resolveSslConfig`.
   What's the right shape: shared pool (regression-safe, DoS-exposed)
   or dedicated pool (DoS-isolated, regression-safe IFF SSL gate is
   shared)?

2. **Webhook race during concurrent retries.** Two retries arriving
   <100ms apart both pass the dedup lookup, both run the handler,
   both attempt to record. Result: duplicate operator email. CP
   retries are minutes apart in practice — is this an intentional
   simplification or do we need `pg_advisory_xact_lock`?

3. **TransactionId collision attack.** With leaked
   `CLOUDPAYMENTS_API_SECRET`, an attacker can submit a webhook with
   a chosen TxId that collides with a future legit retry, poisoning
   the cache. Should the dedup key be just `(provider, kind, TxId)`
   or `(provider, kind, TxId, content_fingerprint)`?

4. **Encryption key rotation.** What happens if the operator rotates
   `AUDIT_ENCRYPTION_KEY`? The plan as drafted has no fallback path —
   every previously-encrypted row becomes unreadable. Is single-key
   acceptable for V1, or do we need the dual-key design from day 1?

5. **`pg_stat_statements` parameter capture.** The audit recorder
   passes the encryption key as bind value `$14`. If an operator
   later turns on `pg_stat_statements (track=all, save=on)` for
   performance triage, the key lands in `pg_stat_statements` visible
   to any DBA with `pg_read_all_stats`. The plan needs to surface
   this as an operator-side invariant.

## Rollout

1. Apply migrations 0024 (webhook_deliveries), 0025 (pgcrypto + bytea
   columns).
2. Set `AUDIT_ENCRYPTION_KEY` in the operator-side env store BEFORE
   deploy so audit insertions don't fail.
3. Deploy via autodeploy (git pull → npm install → npm run build →
   npm run migrate:up → systemctl restart).
4. Run `scripts/backfill-audit-encryption.mjs` to encrypt legacy rows.
5. Verify `/api/health` returns 200 + `database: ok`.
6. Phase B null-out queued for 24h+ later.
