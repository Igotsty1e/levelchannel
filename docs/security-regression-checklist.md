# Security regression checklist

> **When to run:** before every PR merge that touches the payment
> domain, auth, security headers, the audit log, env-var contract,
> or the deploy pipeline. For doc-only / unrelated PRs (typo fix,
> non-legal copy, README) skip - but don't skip *because* the diff
> looks small. A one-line change to `lib/security/request.ts` is
> not "small."
>
> **Purpose:** catch the security regressions that automated tests
> can't see. Tests verify named invariants; this checklist forces a
> human to ask "is the diff doing what I think it's doing in the
> pieces *between* the test cases."

---

## 1. Code-review gates (read the diff)

For every changed file, ask:

- [ ] **Trust boundary unchanged?** No new path that accepts user
      input without `enforceTrustedBrowserOrigin` (mutation routes)
      or HMAC verify (CloudPayments webhooks).
- [ ] **No new `new Pool(...)` outside `lib/db/pool.ts`** (single
      shared pool - `getDbPool()` / `getDbPoolOrNull()`). Per-domain
      getters are fine; new ad-hoc Pools are not. Bypassing
      `getDbPool` also bypasses the Wave 1.1 TLS gate
      (`resolveSslConfig`); standalone scripts that need a pool
      should mirror the same auto-detect logic or import the helper.
- [ ] **No client-supplied amount or email is trusted on the
      server.** Payment amount comes from
      `lib/payments/catalog.normalizePaymentAmount` +
      `isValidPaymentAmount`; email comes from
      `validateCustomerEmail`. Account email is normalized via
      `normalizeAccountEmail()` (`trim().toLowerCase()`).
- [ ] **No `dangerouslySetInnerHTML`.** Email templates run their
      input through `lib/email/escape.escapeHtml`.
- [ ] **No new env var that's read at request time without a
      production assertion** (mirror `lib/email/config.ts` boot
      check pattern when the value is required in prod).
- [ ] **No `console.log` of secrets, tokens, full IPs, or full
      e-mails outside the audit log path.** `payment_telemetry`
      stays HMAC-hashed/masked. Audit log is the only sanctioned
      home for full PII; access stays admin-only.
- [ ] **`PAYMENTS_ALLOW_MOCK_CONFIRM=true` is not in any committed
      file.** `.env.example` keeps it as the documented dev-only
      knob; `lib/payments/config.ts` throws on boot if it's true
      under `NODE_ENV=production`.
- [ ] **No `--no-verify` git flag in scripts or CI.** AGENTS.md
      treats it as a hard stop requiring explicit user authorization.
- [ ] **CSP changes deliberate.** `next.config.js` content-security-
      policy is the single source of truth. New `connect-src` /
      `script-src` / `frame-src` entries get a one-line rationale
      in the commit message.

## 2. Tests must be green

- [ ] `npm run test:run` - full unit suite, 100% pass.
- [ ] `npm run test:integration` - Docker Postgres real DB suite,
      100% pass.
- [ ] `npm run build` - no TypeScript errors, no Sentry/withSentryConfig
      warnings new in this PR (the `disableLogger` deprecation is
      pre-existing).
- [ ] If you touched `lib/payments/`, `lib/security/`, `lib/auth/`,
      or any payment route - coverage threshold (70% lines / branches)
      via `npm run test:coverage` stays green.

## 3. Auth invariants (only relevant when auth code changes)

Cross-reference `ARCHITECTURE.md § Test infrastructure (integration)
> Auth invariants covered by integration suite` matrix. The integration
test for each invariant is the contract:

- [ ] Register: byte-equal response for known/unknown email
      (anti-enumeration shape).
- [ ] Register: symmetric wall-clock budget for new vs existing
      email path (anti-enumeration timing).
- [ ] Login: constant-time via `dummyHash` for unknown vs
      known-but-wrong-password (D3).
- [ ] Login: 200 + session cookie even when `email_verified_at` is
      null (D4 - payment routes gate separately).
- [ ] Login: silent password rehash when stored hash is below
      current bcrypt cost.
- [ ] Reset request: 200 ok identical for known/unknown email.
- [ ] Reset confirm: revoke all sessions BEFORE create new (mech-5
      sign-out-everywhere).
- [ ] Resend-verify: 401 unauth, idempotent on already-verified,
      per-account hourly cap (3/hour).

If your diff touches the route or its store ops, eyeball that
the matching test in `tests/integration/auth/*` still asserts
the invariant - not just that the test is green.

## 4. Payment + webhook invariants

- [ ] **Amount validation runs on the server** for every money-
      moving route. Client value is for UX only.
- [ ] **`withIdempotency` wraps every money-moving route.** Adding
      a new route that creates an order or charges a card → wrap it.
- [ ] **HMAC verification path unchanged in `cloudpayments-webhook.ts`.**
      Wire format is `base64(HMAC-SHA256(rawBody, ApiSecret))`. No
      decoding, no JSON-vs-form branching for signature input. If
      you touch this file, regression test in
      `tests/payments/cloudpayments-webhook.test.ts` covers the
      exact bytes - re-run it.
- [ ] **Webhook delivery dedup intact** (Wave 1.2). Every webhook
      flowing through `handleCloudPaymentsWebhook` must consult
      `webhook_deliveries` keyed by `(provider, kind, transaction_id)`
      after HMAC + parse and short-circuit on a hit. Regression
      tests in `tests/payments/cloudpayments-webhook-dedup.test.ts`
      and `tests/integration/payment/webhook-dedup.test.ts`.
- [ ] **Webhook secondary rate limit intact** (Wave 2.2). 60/min/
      kind/IP cap sits AFTER HMAC; HMAC-fail flood must consume
      zero bucket budget. Regression test in
      `tests/payments/cloudpayments-webhook-rate-limit.test.ts`.
- [ ] **CloudPayments webhooks never go through nginx `limit_req`**
      (they're matched by `^~ /api/payments/webhooks/`). HMAC is
      the only auth on these routes; the application-level rate
      limit above is the only post-HMAC bound.
- [ ] **No `tokenize: true` or `metadata.rememberCard: true` without
      explicit user consent** at `pricing-section.tsx`. `tokens.ts:
      readRememberCardConsent` enforces this on the webhook side.
- [ ] **3-D Secure flow** (`/api/payments/3ds-callback`) - every
      branch (success / decline / error / unknown invoice / invalid
      state / double callback) returns a 303 redirect, never a 5xx.
      Bank may POST twice - must not double-charge or double-fail.

## 5. Audit log invariants

- [ ] Every business transition still produces the matching
      `payment_audit_events` row. Cross-check the per-route
      bullets in `ARCHITECTURE.md § Audit log (payment lifecycle)`.
- [ ] Recorder remains best-effort: `recordPaymentAuditEvent` does
      NOT throw, errors land in `console.warn`. Test:
      `tests/audit/payment-events.test.ts` "swallowed PG failure"
      stays green.
- [ ] Adding a new event type → update **all four** of:
      `migrations/NNNN_*.sql` (CHECK enum), `PAYMENT_AUDIT_EVENT_TYPES`
      array in `lib/audit/payment-events.ts`, the call site, and
      `tests/integration/audit/payment-events.test.ts` "no enum drift"
      test (which iterates the TS array).
- [ ] FK constraint `invoice_id → payment_orders` ON DELETE NO
      ACTION stays intact. Audit must outlive the order.
- [ ] **Audit at-rest encryption intact** (Wave 2.1). `recordPaymentAuditEvent`
      passes `AUDIT_ENCRYPTION_KEY` as the last bind so
      `pgp_sym_encrypt(...)` populates `customer_email_enc` /
      `client_ip_enc` whenever the plaintext column is non-null.
      `listPaymentAuditEventsByInvoice` reads via
      `pgp_sym_decrypt(_enc, key)` with plaintext fallback. Regression
      tests: `tests/audit/encryption.test.ts`,
      `tests/integration/audit/encryption.test.ts`. If you change the
      bind order in the recorder, update the unit test's `binds[13]`
      assertion.
- [ ] **`AUDIT_ENCRYPTION_KEY` floor**: `lib/audit/encryption.ts` enforces
      ≥32 chars and a production-mandatory presence. Do not relax these
      without an explicit security review.

## 6. Observability

- [ ] **Uptime probe** - `.github/workflows/uptime-probe.yml`
      schedule untouched (or intentionally tightened). If you
      changed `/api/health`, the probe's keyword check (`"status":"ok"`
      AND `"database":"ok"`) still finds those literals.
- [ ] **Deploy-freshness probe** - if you bumped CSP, `next.config.js`
      tunables, or anything in the build pipeline, manual run of
      `gh workflow run deploy-freshness.yml` after merge should
      either close (prod caught up) or open `deploy-stale` issue
      with a clear diagnosis.
- [ ] **Sentry** - if you changed `instrumentation.ts` or
      `instrumentation-client.ts`, follow the manual smoke in
      `OPERATIONS.md §9 Sentry`:
      `node -e "S.init({dsn:...}); S.captureMessage('manual smoke ' + Date.now()); S.flush(5000)"`
      and confirm the event lands in Sentry within 30 seconds.
- [ ] **Webhook-flow-alert** thresholds (`MIN_VOLUME=5`,
      `RATIO_FLOOR=0.3`) reasonable for real load? Check by
      eyeballing recent `payment_audit_events.created_at` window.

## 7. Legal scope

- [ ] If the diff touches `app/offer/`, `app/privacy/`,
      `app/consent/`, `lib/legal/`, or `docs/legal/`:
      commit carries `Legal-Pipeline-Verified:` trailer (see
      `docs/legal-pipeline.md`). The local commit-msg hook
      enforces this; CI re-checks per-commit on the PR.
- [ ] Substantive change to legal text → trailer must reference
      the legal-rf pipeline run that approved it
      (`legal-rf-router → legal-rf-private-client → legal-rf-qa`),
      not `trivial-fix`.
- [ ] `PERSONAL_DATA_DOCUMENT_VERSION` bumped in
      `lib/legal/personal-data.ts` only when legal text actually
      changed semantically. Bump → existing `account_consents`
      rows for the old version stay as historical record;
      `recordConsent` next time picks up the new version.

## 8. Post-merge smoke (production)

- [ ] After autodeploy completes (~1-3 min after push),
      `curl -i https://levelchannel.ru/api/health` returns 200 +
      `"status":"ok"`.
- [ ] If your diff touched a public route, hit it once with curl
      to confirm shape.
- [ ] Watch `gh issue list --label uptime-incident --state open`
      for the next 15 minutes. New issue → roll back via
      `OPERATIONS.md §6` runbook before debugging in place.
- [ ] If you added a migration, confirm the autodeploy log shows
      `applied NNNN_*.sql` and `/api/health.checks.database` is
      `ok`.

## 9. Quarterly drill (operator)

Once per quarter, walk through the actual checklist on a real PR
even if all items are tedious - this is the opposite of a
fire-drill. The goal is muscle memory, not a passing checkmark.

Track: log each quarterly run as a comment in
`OPERATIONS.md §13` Debt and known ops gaps with date + outcome.
First drill: **2026-07-29**.
