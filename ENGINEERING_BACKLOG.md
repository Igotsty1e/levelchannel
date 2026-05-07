# Engineering Backlog

Concrete engineering task queue. This file describes what still needs
to be implemented, not the current actual state of production.

If a task already works in code or on the server, it does not belong
here.

## Lesson learned — 2026-05-07 — close the smoke blind spot

`/api/health` instantiates its own ad-hoc `Pool` (see
`app/api/health/route.ts:44`). It does NOT exercise the shared
`getDbPool()` factory in `lib/db/pool.ts` that production routes
(cabinet, admin, slots, payments) actually use. Wave 1.1's overzealous
"refuse localhost in prod" throw fired only on the shared path; the
health probe came back green from its private pool, so post-deploy
smoke claimed everything was OK while every authenticated route was
500-ing.

Concrete follow-ups (open queue):

- ~~**Health probe should exercise the shared pool too.**~~
  **Closed 2026-05-07.** `app/api/health/route.ts` now calls
  `getDbPool()` and races a `select 1` against a 2 s timeout. A
  future regression in `resolveSslConfig` / env handling fires on
  the health probe and stops the deploy. The 2 s race preserves the
  bounded latency the old ad-hoc Pool got from `connectionTimeoutMillis`.
- **Deploy-time smoke runner.** Add a `scripts/post-deploy-smoke.sh`
  (or a workflow step) that hits 5–8 routes the operator cares about:
  `/api/health`, `/api/auth/me` (anon → expect 401), `/login`,
  `/cabinet` (anon → expect 307), `/admin/login`, `/admin/slots`
  (anon → expect 307), `/checkout/<some-tariff-slug>` (200), and
  asserts each returns the expected status. Fail loudly, don't just
  log. Wired into the autodeploy script so a 500-ing prod doesn't
  ship silently.
- ~~**CI integration tests.**~~
  **Closed 2026-05-07.** `.github/workflows/integration-tests.yml`
  runs `npm run test:integration` on every PR and every push to main.
  The Wave 1 + Wave 2 integration tests (webhook dedup, audit
  encryption, learner-archetype gate) and all auth/payment/scheduling
  integration tests are now blocking — a regression caught by a real-
  Postgres test fails CI before merge.

## Today — 2026-05-07 — after 18:06 UTC

### Re-run Codex adversarial review after usage-cap reset

The first attempt at the Codex adversarial review against PRs #45–#52
hit the per-account daily cap mid-prompt (`/tmp/codex-review.jsonl`
line 4: `You've hit your usage limit. ... try again at 6:06 PM`).
A manual self-review was done in the same session and produced 8
findings, of which fixes #1, #5, #7, #8 will land before this entry
fires (see PRs / commits chained off `ab6ac07`).

After 18:06 UTC re-run codex against the **updated** codebase:

```bash
cat /tmp/codex-review-prompt.md | \
  /Applications/Codex.app/Contents/Resources/codex exec \
    --skip-git-repo-check --json \
    | tee /tmp/codex-review-2.jsonl
```

Compare codex findings against the self-review:

- Anything codex finds that the self-review missed → file as new
  backlog entry, severity-rate, schedule.
- Anything codex confirms the self-review caught → close the loop in
  this backlog entry with a note.
- Anything codex marks as "blocked" that the self-review flagged as
  active → re-examine; one of us is wrong.

This is the loop-closure for "second mind" — the self-review has a
known conflict-of-interest (the same agent that wrote the code is
reviewing it). Codex's independent run is the validation step.

## TOMORROW — 2026-05-08 — verify and execute

### Wave 2.1 Phase B — null out plaintext PII in `payment_audit_events`

**This is the destructive completion of Wave 2.1 (encryption-at-rest).
After 24h+ of real prod traffic on the dual-write path it should be
the first thing checked next morning.**

Wave 2.1 (PR #45 squash `a094337`, shipped 2026-05-07) added
`customer_email_enc` + `client_ip_enc` bytea columns and started
dual-writing them via pgcrypto. The plaintext columns are still
populated for safe rollback during the migration window. Real
security gain (DB-dump leak useless without the key) only kicks in
once plaintext is wiped.

Pre-flight checks (must all pass before running the destructive UPDATE):

- [ ] At least 24 hours have elapsed since the Wave 2.1 deploy.
- [ ] `/api/health` reports the post-Wave SHA + `database: ok`.
- [ ] No `[audit]` warns in `journalctl -u levelchannel` over the last
      24h (an `AUDIT_ENCRYPTION_KEY` mismatch / missing key surfaces
      there).
- [ ] Re-run the verification probe and confirm zero plaintext-only
      rows AND non-zero `_enc` populated rows:

      ```sql
      select
        count(*) filter (where customer_email is not null and customer_email_enc is null) as plaintext_only_email,
        count(*) filter (where client_ip is not null and client_ip_enc is null)         as plaintext_only_ip,
        count(*) filter (where customer_email_enc is not null)                          as encrypted_email_rows,
        count(*) filter (where client_ip_enc is not null)                               as encrypted_ip_rows
      from payment_audit_events;
      ```

      Expect `plaintext_only_*` = 0 and `encrypted_*_rows` ≥ 18 (the
      backfilled count from 2026-05-07; should grow with every new
      audit event since).

- [ ] Sample roundtrip: pick three rows by hand and confirm
      `pgp_sym_decrypt(customer_email_enc, '<key>') = customer_email`.
      If any row mismatches, STOP and investigate before the
      destructive step.

- [ ] Snapshot the table before the destructive UPDATE so a rollback
      is one query away:

      ```sql
      create table payment_audit_events_pre_phase_b as
        select * from payment_audit_events;
      ```

      Drop the snapshot only after Phase B has been in prod for ≥7 days
      with no rollback need.

Destructive step (run inside a transaction, eyes on the dashboard):

```sql
begin;
update payment_audit_events
   set customer_email = null,
       client_ip      = null
 where customer_email_enc is not null
    or client_ip_enc       is not null;
-- expect a row count matching the backfilled set + new rows since.
-- if the count looks wrong, ROLLBACK; do not COMMIT.
commit;
```

Post-flight:

- [ ] `/api/admin/payments/[invoiceId]` still renders audit events
      with `customer_email` populated (reads now exclusively go
      through `pgp_sym_decrypt`).
- [ ] `/api/health` still reports `database: ok`.
- [ ] Write one smoke audit event post-update (e.g. by issuing a
      throwaway `POST /api/payments` on the mock backend) and confirm
      the new row has `customer_email IS NULL` and
      `customer_email_enc IS NOT NULL`.

Phase C (drop the now-empty plaintext columns) goes into a separate
backlog entry **once Phase B has been in prod ≥30 days with no
rollback need**. Do not chain Phase B + Phase C in the same window.

## Wave 3 — security hardening, deferred from 2026-05-07 self-review

Two findings from the self-adversarial review that ARE real but are
medium-effort design work — not safe to chain onto the in-flight
security batch. Schedule for a dedicated wave with planning + tests.

### #3 — webhook handler concurrency (LOW severity, intentional simplification)

**Closed 2026-05-07** in PR #60. `lib/payments/cloudpayments-route.ts:processSerialized` wraps lookup → handler → record on a sticky pool client inside one transaction with `pg_advisory_xact_lock(hashtext("cp:<kind>:<txId>"))`. Concurrent retries serialise: first acquires lock, runs handler, records, commits (lock auto-released); second waits at lock, then post-lock re-check finds the cached row and short-circuits.

Edge case handled: if `recordWebhookDeliveryClient` throws AFTER the handler ran (e.g. Postgres outage mid-INSERT), the path swallows the record error and returns the handler outcome directly — does NOT fall through to the legacy pipeline (which would re-run the handler and duplicate side effects). Pre-handler errors fall through to the legacy non-dedup path.

The handler's own DB writes (`markOrderPaid`, audit, allocation) happen on different pool connections — they're NOT inside the lock-holding transaction. The lock just serialises "who runs the pipeline"; per-op atomicity stays at the data layer.

3 unit tests pin the new pool.connect / BEGIN / advisory lock / COMMIT / release flow. 1 integration test (real Postgres) fires two concurrent `payHandler` requests with the same TxId in `Promise.all` and asserts: handler runs once, exactly one response carries `Webhook-Replay: true`, exactly one `webhook_deliveries` row exists, exactly one `webhook.pay.processed` audit row exists.

### #4 — `AUDIT_ENCRYPTION_KEY` rotation story (MEDIUM severity)

**Closed 2026-05-07** in PR #59 (`<TBD>`). Migration 0027 + `lib/audit/encryption.ts` `getAuditEncryptionKeyOld()` + `scripts/rotate-audit-encryption.mjs` ship the dual-key (PRIMARY + OLD) flow. Reader uses `pgp_sym_decrypt_either` SQL helper (PL/pgSQL with EXCEPTION block) — primary tried first, OLD as fallback during the rotation window. Operator runbook in `SECURITY.md § At-rest encryption — Key rotation`.

5 unit tests pin the OLD-key resolver. 4 integration tests pin the SQL contract: helper returns NULL on both-keys-wrong (no throw), the rotation flow round-trips a row from OLD to NEW with no plaintext touch, the predicate-guarded UPDATE is idempotent (already-PRIMARY rows are skipped), the reader logs warn on invalid OLD without crashing.

## Wave 4 — security hardening from Codex review 2026-05-07

Codex adversarial pass after the Wave 3 batch landed found six real issues my self-review missed (0/6 catch-rate vs 6/6 Codex). Five of the six were closed in the same-day PR (`.local` mDNS TLS bypass, audit-encryption scripts bypassing the TLS gate, rotate-script wrong-OLD-key false-success, missing-TransactionId webhook replay, `pool.connect()` no acquisition timeout, anonymous slot DTO leak). One stays open here because it needs operator-side coordination, not just a code change:

### #4b — `getClientIp()` trusts raw `x-forwarded-for` first hop (MEDIUM severity, deferred — needs nginx coord)

**Status:** open. **Found:** 2026-05-07 by Codex.

**Bypass shape.** A client controls the `X-Forwarded-For` header directly and rotates the value on each request. `lib/security/request.ts:33-43` reads the first hop of `x-forwarded-for` as the canonical client IP. The webhook secondary rate limit (`lib/payments/cloudpayments-route.ts` 60 req/min per IP per kind) is keyed by that value — so the per-IP bucket is per-request and never trips. An attacker who has the HMAC secret but not the IP rate limit can drive sustained webhook traffic without the secondary gate firing.

**Why deferred.** The fix is in two halves: (a) the application code must only honour `X-Forwarded-For` when the request arrived from a trusted edge (the production nginx in front of the Node app), and (b) nginx must overwrite `X-Forwarded-For` with the real socket IP before forwarding (or use `X-Real-IP` exclusively, which is what we already have configured but not yet exclusively trusted on the app side). Without (b) being verified, switching the app to "trust nothing" would break legitimate proxied traffic; without (a), trusting the header is the current vuln. So the change is a coordinated app + nginx config + test pass, not a one-line code edit.

**Plan.** When this wave is scheduled:

1. Read `/etc/nginx/sites-available/levelchannel` (operator-side, not in repo) and confirm exact header rewrite behaviour.
2. Switch `getClientIp()` to read `X-Real-IP` only when `request.headers.get('x-real-ip')` is set AND a `TRUSTED_FORWARDED_FROM` env var allows the upstream. Drop `X-Forwarded-For` parsing entirely.
3. Add an integration test that asserts: a client-supplied `X-Forwarded-For` does NOT change the bucket; only the upstream-set `X-Real-IP` does.
4. Roll out app + nginx in lockstep.

Until this lands, the secondary rate limit on `/api/cloudpayments/*` is best-effort — defence-in-depth still has HMAC + IP allowlist at the nginx layer for the provider's source IPs, so the practical exposure requires a HMAC-secret leak (the worst-case scenario the bucket was meant to soft-cap, but the soft cap is the part that's currently bypassable).

## Cabinet expansion (next phases)

Guest checkout is not touched: subsequent phases are additive.

Already closed and not in the backlog:

- Phase 0 stabilization
- Phase 1A auth foundation
- Phase 1B auth API routes
- Phase 2 auth UI
- Phase 3 profiles + admin pricing — **closed 2026-05-04**. Migrations 0017 / 0018 / 0019. Cabinet got profile editor, consent withdrawal, and 30-day-grace account deletion. Operator-side admin surface at `/admin` (dashboard, accounts list / detail, pricing CRUD) gated by `requireAdminRole`. Bootstrap via `scripts/grant-admin.mjs`. The retention cleanup job picks up rows where `scheduled_purge_at <= now()` and anonymizes them. Public `/pay` left free-amount in this wave; catalog wiring is in this same backlog under "Cabinet Phase 6 deferments". See `docs/plans/phase-3-profiles-admin-pricing.md`.
- Phase 4 scheduling — **closed 2026-05-04**. Migration 0020 (`lesson_slots`). Operator-managed slot model with one row per concrete `start_at`. Admin surface at `/admin/slots` covers single-slot create + bulk recurring with weekday/weeks/skip-dates preview-deselect-commit + per-row cancel/delete + book-as-operator. Cabinet «Мои уроки» + «Записаться» sections in `/cabinet`. Booking gated by `requireAuthenticatedAndVerified` (D2). Atomic UPDATE-with-`status='open'` re-assert prevents concurrent-book races (loser → 409). Per-row `events JSONB` event log; no separate audit table. Payment-free in this wave (Phase 6 wires payment); 24-hour cancellation rule deferred to Phase 5. See `docs/plans/phase-4-scheduling.md`.
- Phase 5 lesson lifecycle + 24h rule — **closed 2026-05-04**. Migration 0021 extended the `lesson_slots.status` enum with `completed`, `no_show_learner`, `no_show_teacher` and added a nullable `marked_at` column. Learner cancel route now refuses with 403 + `error: 'too_late_to_cancel'` when `start_at - now() < 24h`; admin / operator routes bypass the gate (override). New `POST /api/admin/slots/[id]/mark` lets the operator stamp lifecycle on past-booked rows. New daily systemd timer `levelchannel-auto-complete-slots` (03:30 UTC) flips still-`booked` rows whose `start_at + duration_minutes` has elapsed to `completed`. Cabinet UI splits «Мои уроки» into Предстоящие / Прошедшие and shows the lifecycle status. Admin `/admin/slots` rows get «Прошёл» / «Не пришёл (учащийся)» / «Не пришёл (учитель)» buttons on past-booked rows; status filter gains «проведённые» / «не пришли». See `docs/plans/phase-5-lifecycle-24h-rule.md`.
- Phase 6 cabinet payment (tariff-bound checkout) — **closed 2026-05-04**. Migration 0022 added `payment_allocations` (kind enum starts with `lesson_slot`, forward-compatible with packages later) and a nullable `lesson_slots.tariff_id` FK to `pricing_tariffs`. New public surface `/checkout/[tariffSlug]` runs in parallel with the existing `/pay` (free-amount) — `/pay` stays bit-for-bit unchanged. Optional `?slot=<uuid>` binds the resulting paid invoice to a `lesson_slot` via `payment_allocations` written from the CloudPayments `webhook.pay.processed` handler. Cabinet «Мои уроки» surfaces «оплатить XXXX ₽» / «оплачено» pills next to booked future slots whose `tariff_id` is non-null. Admin `/admin/slots` create + bulk forms get an optional «Тариф» dropdown; the slot list shows the bound tariff slug + amount. Refund / credit on cancellation is **deliberately parked**: a learner cancelling a paid booking leaves `payment_orders` + `payment_allocations` rows in place; operator handles refund manually via the CloudPayments dashboard for now, until refund volume justifies a clean refund flow (Phase 7). Saved-card 1-click checkout still scoped to free-amount `/pay`. See `docs/plans/phase-6-cabinet-payment.md`.

Open high-level queue:

- **Calendar / grid UI for slots** (both operator and learner side). The current list view works but does not scale visually past ~10 slots; a standard week × hour grid (think Google Calendar / email scheduling) would let the operator paint slots with click-and-drag and the learner pick a time visually. Surfaced from manual testing 2026-05-04.
- Phase 7 (when needed): refund / credit on cancellation; sunset `/pay` free-amount → tariff picker once the new flow is proven

Before starting any of these, write a fresh in-repo design doc. Code,
owner docs, and git history beat old chat outputs.

## P0

### Production reliability

- ~~wire up uptime / failure alerting on the app~~: **closed 2026-04-29**. GitHub Actions cron `*/5 *` pings `/api/health` and opens / closes an issue tagged `uptime-incident`. Runbook: `OPERATIONS.md §9`. Detection latency ~5–15 min (cron + GH Actions schedule jitter). For sub-minute precision, layer in BetterStack / Healthchecks.io.
- ~~add failure alerting on the **webhook contour** (CloudPayments check / pay / fail)~~: **shipped 2026-04-29 (workflow side; activation requires server-side patch)**. `scripts/webhook-flow-alert.mjs` plus systemd unit / timer (`scripts/systemd/`); every 30 minutes it reads `payment_audit_events` over the last hour and emails via Resend when `(paid + fail) / created < 0.3` with ≥5 created orders. Activation lives in the private operations runbook. Details: `OPERATIONS.md`.
- ~~signal failed git-based deploy or stuck `levelchannel-autodeploy.timer`~~: **shipped 2026-04-29 (workflow side; activation requires server-side patch)**. `.github/workflows/deploy-freshness.yml` compares `main` SHA with `version` from `/api/health` every 30 minutes; opens / closes a `deploy-stale` issue. Activation lives in the private operations runbook. Details: `OPERATIONS.md`.

### Security and payment safety

- ~~move the app-level rate limiter into a shared backend store for a multi-instance future~~: **closed 2026-05-04**. Migration 0016 added `rate_limit_buckets` (bucket_key PK, count, reset_at). `lib/security/rate-limit.ts` rewritten to a Postgres-backed atomic upsert with an in-memory fallback when `DATABASE_URL` is unset or transiently unreachable (warn-and-fall-through, nginx `limit_req` is the last line either way). `enforceRateLimit` is now async; the 21 call sites in `app/api/**` were updated. Cleanup folded into the existing daily systemd timer (`scripts/db-retention-cleanup.mjs`, rows with `reset_at < now() - 1h`). Covered by an in-memory unit suite plus a real-Postgres integration suite under `tests/integration/security/rate-limit.test.ts`.
- ~~add a separate audit log for critical payment transitions~~: **closed 2026-04-29**. Migration 0012 plus `lib/audit/payment-events.ts`; 10 final-state events written from 7 route handlers (`order.created` / `cancelled`, `mock.confirmed`, `webhook.pay.processed`, `webhook.fail.received`, `charge_token.succeeded` / `requires_3ds` / `declined`, `threeds.callback.received` / `confirmed` / `declined`). Best-effort recorder, retention 3 years, full PII under 152-FZ legitimate interest. Docs: `ARCHITECTURE.md` Audit log section, `SECURITY.md` Audit log section, `OPERATIONS.md §5` psql queries.
- ~~add pre-validation phases to audit~~: **closed 2026-04-29**. Migration 0014 plus `lib/payments/cloudpayments-route.ts` refactor; the wrapper now takes `kind: 'check'|'pay'|'fail'` and writes phase-0 (`webhook.<kind>.received`) after parse and phase-1 (`webhook.<kind>.declined` / `webhook.pay.validation_failed`) on validation failure. The old `webhook.fail.received` (semantically a finalize event) was renamed to `webhook.fail.processed`; live data was migrated in the same transaction.
- ~~add `charge_token.attempted`~~: **NOT planned**. `chargeWithSavedCard` creates `invoice_id` inside the function; an `attempted` event has no clean attach point (FK constraint to payment_orders). The outcome events (`succeeded` / `requires_3ds` / `declined`) cover the lifecycle.
- **`charge_token.error` (deferred)**: the sync-error path needs the `chargeWithSavedCard` return type to surface `invoice_id` even on throw. The route's catch currently sends `console.warn` to journald (see `app/api/payments/charge-token/route.ts`). Close it when a real incident with lost context shows up.
- ~~consolidate domain-specific Postgres pools into a shared `lib/db/pool.ts`~~: **closed 2026-04-29**. `lib/db/pool.ts`: `getDbPool()` (throws on missing `DATABASE_URL`) plus `getDbPoolOrNull()` (silent, for audit best-effort). All 5 domain getters (payments / auth / idempotency / telemetry / audit) delegate to the shared singleton; public API at call sites is unchanged. Connection footprint: 5×10=50 max before, `DATABASE_POOL_MAX` (default 10) now.
- ~~set up cron pruning for `payment_audit_events`~~: **shipped 2026-04-29 (workflow side; activation requires SSH)**. `scripts/db-retention-cleanup.mjs` plus systemd unit / timer (04:30 daily) deletes `payment_audit_events > 3 years` and expired rows from `account_sessions` / `email_verifications` / `password_resets` / `idempotency_records`. Activation details live in the private operations runbook.

## P1

### Payment domain

- ~~move from a polling-only model to a more reliable way to deliver the final status to the client~~: **shipped 2026-05-04**. SSE endpoint `/api/payments/[invoiceId]/stream` (`app/api/payments/[invoiceId]/stream/route.ts`) backed by an in-process `lib/payments/status-bus.ts` (Node `EventEmitter`). `markOrderPaid` / `markOrderFailed` / `markOrderCancelled` emit only on real transitions (the existing `payment.paid_duplicate` / `fail_duplicate` / `cancel_duplicate` event names short-circuit the emit). Browser `EventSource` in `components/payments/pricing-section.tsx` plus a slow 10-second poll as belt-and-suspenders fallback for ad-blockers / corporate proxies that strip `text/event-stream`. Heartbeat `:hb` every 25 s, hard cap 5 min per connection (EventSource auto-reconnects). `X-Accel-Buffering: no` so nginx flushes byte-by-byte. Multi-instance future: swap the bus for a PG `LISTEN/NOTIFY` wrapper without touching the route shape.
- ~~add lifecycle cleanup for old pending orders~~: **shipped 2026-05-04 (workflow side; activation requires server-side patch)**. `scripts/cancel-stale-orders.mjs` plus systemd unit / timer (`scripts/systemd/`); hourly at minute 7 it finds rows with `status='pending'` and `created_at < now() - <threshold>` (default 60 min, floor 30 min via `STALE_ORDER_THRESHOLD_MINUTES`), runs a per-row tx that flips status to `cancelled`, appends a `payment.cancelled` event with reason `stale_pending_timeout`, and writes a matching `order.cancelled` audit row with `actor='system'`. 4 integration tests cover stale cancel / fresh skip / terminal-status untouched / threshold-floor. Activation lives in the private operations runbook.
- ~~decide whether client-visible reconciliation or an operator-side payment list is needed~~: **operator list shipped 2026-05-04**. `/admin/payments` (paginated list with status/email filters) + `/admin/payments/[invoiceId]` (detail with order, payment_audit_events trail, payment_allocations + linked lesson_slots, internal events log). Driven by `lib/payments/admin-list.ts:listPaymentOrdersForAdmin`. Client-visible reconciliation deferred — the SSE push (`/api/payments/[invoiceId]/stream`) already covers learner-visible payment status; further reconciliation surfaces wait until a real workflow needs them.

### Observability

- ~~per-event operator notifications for payment failures~~: **shipped 2026-05-04**. `lib/email/templates/operator-payment-failure.ts` + `sendOperatorPaymentFailureNotification` in `lib/email/dispatch.ts`. Wired into the two terminal-failure surfaces: CloudPayments Fail webhook (`app/api/payments/webhooks/cloudpayments/fail/route.ts`) and 3DS callback decline (`app/api/payments/3ds-callback/route.ts`). Best-effort (try/catch around the dispatch call) so a Resend outage cannot block the webhook ack or the user redirect. Silent skip when `OPERATOR_NOTIFY_EMAIL` is empty. Validation failures and Check-phase declines are deliberately NOT notified (suspicious-but-not-terminal; covered by the audit log + the aggregate webhook-flow alert). Template covered by 5 unit tests.
- ~~hook up error tracking~~: **closed 2026-04-29**. Sentry @sentry/nextjs v10 plus `instrumentation.ts` (Node / Edge), `instrumentation-client.ts` (browser), `app/global-error.tsx`. Project: `mastery-zs/levelchannel`. End-to-end smoke event passed. Production activation lives in the private operations runbook.
- add operator signals for payment failures and webhook failures

### Auth and consent

- ~~add password hash versioning plus a `needsRehash()` path for future cost / algorithm changes~~: **closed 2026-04-29**. `passwordNeedsRehash()` in `lib/auth/password.ts` parses the cost from the bcrypt prefix; the login route silently re-hashes after `verifyPassword` and calls `setAccountPassword`. Best-effort (warn, continue on DB error). Covered by unit and integration tests. Future migration to argon2id: update the regex at the same time as introducing the new hasher, otherwise every login will rehash every time.
- ~~add cleanup for expired `account_sessions`~~: **shipped 2026-04-29**. Folded into `scripts/db-retention-cleanup.mjs` (above).
- ~~add common-password rejection~~: **closed 2026-04-29**. Local denylist in `lib/auth/common-passwords.ts` (~100 top breaches), normalizes case and whitespace; `validatePasswordPolicy` returns `too_common`. HIBP k-anonymity API stays as a future extension if needed.

### Cabinet Phase 6 deferments (parked here so they don't get forgotten)

- ~~wire `/pay` to the pricing catalog~~: **partially shipped 2026-05-04** as `/checkout/[tariffSlug]` running in parallel with `/pay`. The free-amount `/pay` stays untouched. Decision on whether to fold `/pay` into a tariff picker (or keep both indefinitely) deferred until the new flow has soak time.
- **collect `phone_e164` on the profile** if and when an operator workflow actually needs to call or Telegram a learner. Until then we don't widen the PD surface.

## P2

### Product and operator tooling

- add a proper operator-side payment list instead of manual DB / file inspection
- add payment funnel telemetry useful for decisions
- ~~add operator email notification for a successful payment~~: **closed 2026-04-29**. Inline in the pay-webhook handler after `markOrderPaid` plus audit. Renders via `lib/email/templates/operator-payment-notify.ts`, dispatched via `sendOperatorPaymentNotification()`. Best-effort (try / catch plus warn). Production activation lives in the private operations runbook. Silent no-op when unset.
- Telegram notification: separate wave if email turns out to be insufficient (needs bot token plus parse_mode reasoning; do it when a real need appears).
- ~~add `POST /api/auth/resend-verify` plus UI button~~: **closed 2026-04-29**. Endpoint in `app/api/auth/resend-verify/route.ts` (authenticated, idempotent, rate-limited 10/min/IP plus 3/hour/account); UI button in `app/cabinet/resend-verify-button.tsx` replaced the Phase 2 hack of linking to `/forgot`.
- ~~add a consent withdrawal model for `account_consents`~~: **closed 2026-04-29**. Migration 0013 added a `revoked_at` column plus partial index `account_consents_active_idx` (where `revoked_at IS NULL`). Store ops in `lib/auth/consents.ts`: `withdrawConsent()` (stamps the latest unrevoked row), `getActiveConsent()` (returns the latest non-revoked). UI / API endpoint goes with Phase 3 admin / cabinet. Covered by 5 integration tests. Implements 152-FZ art.9 §5.
- add a separate `accepted_at`-covering index for `account_consents` if consent-history becomes a real hot path

### DX and quality

- ~~assemble a security regression checklist for releases~~: **closed 2026-04-29**. `docs/security-regression-checklist.md`: 9 sections (code-review gates, tests must be green, auth invariants matrix cross-ref, payment + webhook invariants, audit log invariants, observability, legal scope, post-merge smoke, quarterly drill). First scheduled drill: 2026-07-29.
- ~~widen integration coverage for payment routes~~: **closed 2026-04-29**. `tests/integration/payment/payment-routes.test.ts` covers `POST /api/payments` (create plus amount / consent rejection plus idempotency replay), cancel (success plus 404 plus 400 malformed id), mock-confirm. Each test asserts DB state plus audit event shape. All against a real Docker Postgres in mock-payment mode (via `TEST_INTEGRATION=1`, which makes setup-env switch provider / storage / allowMockConfirm). Webhook handlers: in the next item.
- ~~add an integration test for webhook handlers (HMAC verify path)~~: **closed 2026-04-29**. `tests/integration/payment/webhooks.test.ts` plus helper `tests/integration/payment/sign.ts`. 4 tests: Pay valid → paid plus received / processed audit; HMAC mismatch → 401, no audit; Pay amount-mismatch → received plus validation_failed; Fail valid → failed plus received / processed audit. Order seeding goes through a direct INSERT (not through `createPayment`) because in integration mode the provider is mock and webhook validation requires `provider='cloudpayments'`.
- ~~parameterize the Docker integration stack for parallel CI~~: **closed 2026-04-29**. `docker-compose.test.yml` now reads `LC_TEST_DB_NAMESPACE` (default `default`) and `LC_TEST_DB_PORT` (default 54329) from env. `scripts/test-integration.sh` derives namespace plus port from `LC_TEST_PARALLEL_ID` (sha256 → 8-char suffix plus port window 54330..54429), plus a unique `COMPOSE_PROJECT_NAME`. Single-developer flow stays byte-equal historical defaults; parallel shards / runners no longer fight over the port / container.
- ~~add an integration test for login with an unverified email (Phase 1B D4)~~: **closed 2026-04-29**. `tests/integration/auth/login.test.ts` now contains the test `allows login when email is not yet verified`: registers, asserts `emailVerifiedAt` is null, login returns 200 plus session cookie plus body with `emailVerifiedAt: null`.
- add a real-time signal for `/verify-pending`, only if users actually need it

## Not now

- do not bloat the cabinet beyond auth and payment-adjacent scenarios without a direct business need
- do not collect more personal data at checkout
- do not complicate the payment form without a direct business need
