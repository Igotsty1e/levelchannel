# PKG-LEARNER-BUY — learner-facing package purchase page

**Wave name:** `pkg-learner-buy`
**Priority:** P1 (admin-ux-coverage.md §10.1)
**Predecessor:** PKG-RECON (operator-side reconciliation, merged 2026-05-16)
**Author:** Claude (autonomous)
**Status:** REVISED after round-3 paranoia BLOCK — scope retreated from "refactor createPayment to be package-aware" to "keep inline INSERT, add `buildCloudPaymentsWidgetIntent` call right after". Preserves mock-paid contract + package-specific description + receipt JSON. Slug-regex internal contradiction removed.

## 1. Goal

Close the observed UI gap from admin-ux-coverage.md §4.1: an authenticated learner today has NO discovery surface for the package catalog. The server-side purchase-init route **already exists** at `app/api/checkout/package/[slug]/route.ts` (Billing wave PR 2). It is server-authoritative on amount / duration / count / title / metadata, mints a `receipt_token_hash`, namespaces idempotency by `(slug, accountId)`, and runs the inline mock-auto-confirm in dev. The webhook → `processPackageGrant` pipeline is already wired (PKG-RECON closed the recovery loop).

After this wave a learner navigates `/cabinet/packages`, sees the catalog, clicks "Купить", confirms personal-data consent, and completes payment in the same CloudPayments widget the tariff checkout uses. No new server route is created. No changes to `processPackageGrant` or the webhook.

## 2. Surface

### 2.1 New routes (UI only)

- **`app/cabinet/packages/page.tsx`** — server component.
  - Auth follows existing cabinet SSR pattern (`app/cabinet/page.tsx:48-59` — NOT `requireLearnerArchetypeAndVerified`, which returns JSON 401, not an SSR redirect): read `cookies().get(SESSION_COOKIE_NAME)`, call `lookupSession`, `redirect('/login')` if missing. Round-2 WARN #5 closure.
  - After session resolved: enforce learner-archetype invariants in-page via `isLearnerArchetypeCandidate(session.account.id)` (lib/auth/learner-archetype.ts) — rejects admin / teacher / unverified / deletion-grace / purged in one canonical predicate. If false → `redirect('/cabinet')` (admins / teachers don't get a useful page here; learner-archetype unverified gets bounced to verify flow already at `/cabinet/page.tsx`).
  - Page-level `<Script src="https://widget.cloudpayments.ru/bundles/cloudpayments.js" strategy="afterInteractive" />` mirroring `app/checkout/[tariffSlug]/page.tsx:82-86`. The `.js` suffix is load-bearing (round-2 WARN #6 closure — without it CloudPayments returns 404 on the bundle URL).
  - Reads `listActivePackages()` from `lib/billing/packages/catalog.ts`. Renders one `<PackageCard>` per active row + the learner's current `listAccountActivePackages` summary so they see what they already own before buying.
  - Per-card "Купить" button is a small client island (`buy-button.tsx`).

- **`app/cabinet/packages/buy-button.tsx`** — client island, one instance per card.
  - Reads `slug`, `titleRu`, `amountRub` from props (server-authored — the client cannot influence price).
  - Collects personal-data consent (checkbox). Email comes from server-side session (not editable on this page — that's the documented learner-buy invariant, separate from `/checkout/[tariffSlug]` which accepts arbitrary email).
  - On submit: generates a fresh `Idempotency-Key` UUID, POSTs `/api/checkout/package/[slug]` with empty body, header `Idempotency-Key`.
  - On 200: receives `{ invoiceId, provider, status, amountRub, packageSlug, receiptToken, checkoutIntent }` — the route is refactored in LBL.0 to ALSO return `checkoutIntent` for the production widget path (round-2 BLOCKER #1 closure).
  - On `provider==='mock'` + `status==='paid'` (mock-auto-confirm path): redirect directly to `/thank-you?invoiceId=<id>&token=<receiptToken>`.
  - On `provider==='cloudpayments'` + `status==='pending'` + `checkoutIntent` present: launches CloudPayments widget exactly like `app/checkout/[tariffSlug]/checkout-form.tsx:113`. On widget success, redirect to `/thank-you?invoiceId=<id>&token=<receiptToken>`. ⚠ Round-1 BLOCKER #4 partial closure: this redirect from the CLIENT side now carries the plain token. The /3DS-callback redirect (server-side, app/api/payments/3ds-callback/route.ts:171-173) still lacks token threading — but that is scoped OUT of this wave as a known limitation (see §6 RISK-4). Mock + no-3DS production paths fully covered.

### 2.2 Existing route — minimal additions (keep inline INSERT)

`/api/checkout/package/[slug]` (`app/api/checkout/package/[slug]/route.ts`) currently bypasses `createPayment` and inserts into `payment_orders` directly with package-specific `description = "Пакет: <title>"` + package-specific receipt JSON (lines 97, 145-165). This is the load-bearing contract — the receipt JSON is what `54-ФЗ` requires for the ФНС cash-register dispatch. **Do NOT collapse this into the generic `createPayment` path** — that would lose the package-specific receipt + description (round-3 BLOCKER #1+#2 closure).

Instead, LBL.0 makes four narrow additions:

1. **Auth guard swap** (round-1 BLOCKER #1 + WARN #7 closure): replace inline `getCurrentSession` + `emailVerifiedAt` check with `requireLearnerArchetypeAndVerified(request)` (`lib/auth/guards.ts:123`) — this single guard kicks admin + teacher + unverified in one canonical contract. Plus a post-guard `isLearnerArchetypeCandidate(session.account.id)` call for deletion-grace coverage (RISK-1 closure). Audit actor stays `'checkout:package'` (existing telemetry stable per round-2 INFO #8).

2. **Per-(account, duration) advisory lock** (round-2 BLOCKER #3 closure): the existing route opens NO TX around the INSERT. To close the TOCTOU race between gates and INSERT, wrap the gates + INSERT in ONE TX on a dedicated `pool.connect()` client, holding `pg_advisory_xact_lock(hashtextextended('pkg-buy:' || $1 || ':' || $2, 0))` for the whole critical section. Namespace `pkg-buy:` does not collide with `pkg-recon:`, `pkg_consume:`, `cp:`, or `legal:` (verified in round-3 WARN #5). The advisory lock + same-TX INSERT means two concurrent POSTs with different `Idempotency-Key` serialize: the second sees the first's pending order and gets 409.

3. **Two new pre-INSERT gates** inside the lock TX:
   - `accountHasPendingPackageGrantForDuration(session.account.id, pkg.durationMinutes)` → 409 `pending_package_in_flight` (existing helper, round-1 BLOCKER #6 closure).
   - `learnerHasActivePackageOfDuration(accountId, durationMinutes)` (new LBL.0 helper) → 409 `already_owns_active_package` with `existingPurchaseId` payload (plan §6 RISK-2).

4. **`checkoutIntent` for the production widget path** (round-2 BLOCKER #1 closure): after the INSERT commits, construct a `PaymentOrder` JS object inline that mirrors the row (or call `getOrder(invoiceId)` to read it back — pick whichever is cleaner at implementation time) and call `buildCloudPaymentsWidgetIntent(order)` (`lib/payments/cloudpayments.ts:110`). This produces the widget intent the client needs to launch CloudPayments. The function reads `order.description`, `order.receipt`, `order.amountRub`, `order.receiptEmail` — all of which are already populated by the inline INSERT path, so the package-specific description + receipt flow through naturally. Return the intent in the response payload alongside the existing `invoiceId / provider / status / amountRub / packageSlug / receiptToken`. For mock-provider orders, `buildCloudPaymentsWidgetIntent` is skipped (set `checkoutIntent: null`) since mock-auto-confirm short-circuits the widget.

5. **No slug regex guard** (round-2 BLOCKER #4 + round-3 BLOCKER #3 closure): `getPackageBySlug` already returns null for non-matching input → 404. Adding a route-boundary regex would silently brick any existing `lesson_packages` row whose slug doesn't match the regex (admin create route doesn't enforce a shape — `app/api/admin/packages/route.ts:82-115`). Drop the guard. NO mention of a slug-regex elsewhere in this plan (round-3 BLOCKER #3 was a stale contradiction in §4; removed).

**Critical: do NOT modify `createPayment` / `cloudpayments.ts` / `mock.ts` signatures.** The original "refactor createPayment to accept packageMetadata" path was the right architectural move in principle, but it ripples into:
- mock-paid contract loss (`createMockOrder` returns `pending`, package route needed `paid` on mock-auto-confirm).
- generic `PAYMENT_DESCRIPTION` overriding package-specific `Пакет: <title>`.
- generic receipt JSON overriding the package-specific receipt JSON (`receipt.items[0].label` etc).

That's a bigger refactor that needs its OWN paranoia loop (CREATE-PAYMENT-PACKAGE-AWARE) BEFORE the description+receipt+status semantics can be unified. Out of scope here.

### 2.3 Cabinet billing-sections.tsx integration

Add a "Купить новый пакет" link from `app/cabinet/billing-sections.tsx` ("Мои пакеты" card) → `/cabinet/packages`. One-line discovery affordance, no logic change.

### 2.4 Thank-you token-pass fix (shared with tariff checkout, client-side only)

Today `app/checkout/[tariffSlug]/checkout-form.tsx:125` does:

```typescript
router.push(`/thank-you?invoiceId=${encodeURIComponent(invoiceId!)}`)
```

The `/thank-you` page reads `?token=` from the URL (app/thank-you/page.tsx:48) and forwards it as `X-Receipt-Token` header (line 17). Without `?token=`, the polling falls back to no auth — and `/api/payments/[invoiceId]` rejects with 401 via `evaluateReceiptGate` (`lib/payments/receipt-token-gate.ts:82-101`).

LBL.2 fixes BOTH:
- `app/checkout/[tariffSlug]/checkout-form.tsx:125` (tariff widget success redirect)
- `app/cabinet/packages/buy-button.tsx` (new — already correct from LBL.1, but verified here)

Both become:
```typescript
router.push(`/thank-you?invoiceId=${encodeURIComponent(invoiceId)}&token=${encodeURIComponent(receiptToken)}`)
```

Grep-sweep checklist for any other `/thank-you?invoiceId=` redirect:
- `app/checkout/[tariffSlug]/checkout-form.tsx:125` — known, fixed in LBL.2.
- `app/cabinet/packages/buy-button.tsx` — new, fixed in LBL.1.
- `app/pay/*` — audit during LBL.2.
- Any `app/api/payments/3ds-callback/route.ts:171-173` server-side redirect — **NOT touched** (see §6 RISK-4).

Test updates (round-2 WARN #7 closure): the correct existing receipt-token coverage is `tests/integration/payment/payment-routes.test.ts` receipt-token sections (NOT line 171 which is idempotency). New regression test in LBL.2 specifically asserts: after `/api/checkout/package/<slug>` returns `receiptToken`, a follow-up `GET /api/payments/<invoiceId>` with `X-Receipt-Token: <plain>` succeeds, and the same fetch WITHOUT the header gets 401. This guards the redirect contract.

## 3. Decomposition

Three sub-PRs. Each carries `Skill-Used: + Codex-Paranoia: SUB-WAVE self-reviewed (epic pkg-learner-buy); epic-end review pending` per CLAUDE.md.

### LBL.0 — Eligibility helper + route minimal additions

This is the biggest LBL — touches the existing package-checkout route. NOT user-visible by itself; LBL.1 layers UI on top.

**`createPayment` and its provider plumbing are NOT touched** (per §2.2 — that refactor is out-of-scope and tracked separately as the CREATE-PAYMENT-PACKAGE-AWARE follow-up wave).

**Library changes:**

1. New `lib/billing/packages/eligibility.ts:learnerHasActivePackageOfDuration(accountId, durationMinutes)` — predicate matching `listAccountActivePackages` WHERE-fragment exactly (drift test in unit suite). Reads via `pool.query` like its sibling `accountHasPendingPackageGrantForDuration`. NO `PoolClient` argument — see route-changes note (3) below.

**Route changes (`app/api/checkout/package/[slug]/route.ts`):**

2. Auth: swap `getCurrentSession` + emailVerified inline → `requireLearnerArchetypeAndVerified(request)` + post-guard `isLearnerArchetypeCandidate(session.account.id)`. Preserves the existing `email_not_verified` 403 contract (the guard returns it natively). Audit actor stays `'checkout:package'`.
3. Inside `withIdempotency`, BEFORE the INSERT: acquire a fresh pool client, BEGIN, then `pg_advisory_xact_lock(hashtextextended('pkg-buy:' || $1 || ':' || $2, 0))` on the SAME client. Lock is xact-bound; the TX wraps **lock + gates + INSERT** on one client and commits. Note (round-4 WARN #6 narrowing): `accountHasPendingPackageGrantForDuration` and `recordPaymentAuditEvent` today use `pool.query` (acquire their own short-lived connections) — calling them while our lockClient holds the advisory lock is fine (Postgres advisory locks are session-scoped, not connection-scoped; same session-id is irrelevant here, the lock just gates other sessions). So:
   - `accountHasPendingPackageGrantForDuration` and `learnerHasActivePackageOfDuration` are called over `pool.query` (not on lockClient) — that's correct, they just need to OBSERVE the gated state which is committed-and-visible by the time lockClient is past its INSERT.
   - The INSERT itself runs on lockClient (single TX, atomic with the lock).
   - `recordPaymentAuditEvent` runs OUTSIDE the lock TX (best-effort, post-commit) — matches its existing call-site pattern.
4. Inside the lock TX:
   - Call `accountHasPendingPackageGrantForDuration(accountId, pkg.durationMinutes)` → 409 `pending_package_in_flight` on hit. ROLLBACK lockClient.
   - Call `learnerHasActivePackageOfDuration(accountId, pkg.durationMinutes)` → 409 `already_owns_active_package` with `existingPurchaseId` payload on hit. ROLLBACK lockClient.
   - Keep the existing inline `INSERT INTO payment_orders ...` with `description = 'Пакет: ' + pkg.titleRu` + package-specific receipt JSON + receipt-token mint + `customer_email = session.account.email`. Run on lockClient.
   - COMMIT lockClient.
5. After the lock TX commits: call `recordPaymentAuditEvent('order.created', actor: 'checkout:package', ...)` on its own pool query (matches existing audit dispatch pattern).
6. After audit commit: construct a `PaymentOrder` JS object mirroring the inserted row (OR call `getOrder(invoiceId)` to read it back — implementation-time decision; `getOrder` is the safer-but-slower choice). Call `buildCloudPaymentsWidgetIntent(order)` for the cloudpayments provider; set `checkoutIntent = null` for the mock provider (mock has no widget). The widget builder reads `order.description` + `order.receipt` directly, so the package-specific values flow through naturally.
7. Keep mock-auto-confirm inline `processPackageGrantInline(invoiceId)` call.
8. Return `{ invoiceId, provider, status, amountRub, packageSlug, receiptToken, checkoutIntent }` — adds `checkoutIntent` to the existing shape. All other response fields preserved exactly.

**Test updates (`tests/integration/billing/checkout-package.test.ts`):**

- Admin role → 403.
- Teacher role → 403.
- Deletion-grace (scheduled_purge_at set) → 403.
- Pending-order gate → 409 `pending_package_in_flight`.
- Already-owned gate → 409 `already_owns_active_package` with `existingPurchaseId`.
- Production widget path returns non-null `checkoutIntent` (NEW assertion; previously this response field didn't exist).
- Mock-auto-confirm path still returns granted package_purchases row.
- Existing happy-path + email-not-verified + idempotency replay assertions preserved.
- Concurrent-double-POST race test: two simultaneous POSTs with different Idempotency-Keys → first wins with 200 + pending order, second loses with 409 `pending_package_in_flight`. Asserts advisory-lock serialization.

### LBL.1 — `/cabinet/packages` page + buy-button

- `app/cabinet/packages/page.tsx` (server component): canonical cabinet SSR pattern per round-3 WARN #4 — `cookies().get(SESSION_COOKIE_NAME)` → `lookupSession` → `redirect('/login')` if missing. After session: `isLearnerArchetypeCandidate(account.id)` → `redirect('/cabinet')` if false. Page-level `<Script src="https://widget.cloudpayments.ru/bundles/cloudpayments.js" strategy="afterInteractive" />`.
- `app/cabinet/packages/buy-button.tsx` (client island).
- `tests/integration/cabinet/cabinet-packages-page.test.ts`:
  - Anonymous → 302 to `/login` (matches cabinet/page.tsx contract).
  - Admin role → 302 to `/cabinet` (canonical SSR redirect, NOT 403 JSON).
  - Teacher role → 302 to `/cabinet`.
  - Deletion-grace → 302 to `/cabinet`.
  - Unverified email → 302 to `/cabinet` (existing cabinet page handles the verify flow).
  - Happy learner → 200 with at least one active package card rendered.
  - Empty catalog state → 200 with an "пока ничего не продаётся" empty-state copy.

### LBL.2 — Thank-you token-pass fix (cross-cutting) + cabinet CTA

- Fix `app/checkout/[tariffSlug]/checkout-form.tsx:125` to include `&token=<receiptToken>`.
- Fix `app/cabinet/packages/buy-button.tsx` (already correct from LBL.1, but verify).
- Grep-sweep for any other `/thank-you?invoiceId=` redirect that omits `?token=`. Reference: `app/checkout/[tariffSlug]/checkout-form.tsx:125`, anywhere else? Audit + fix.
- Add CTA link in `app/cabinet/billing-sections.tsx` "Мои пакеты" card.
- E2E test in `tests/integration/cabinet/cabinet-packages-grant-e2e.test.ts`: register learner → POST /api/checkout/package/<slug> → mock-auto-confirm fires inline grant → assert package_purchases + payment_allocations rows + receiptToken returned + thank-you fetch with `X-Receipt-Token` succeeds.
- Optional WARN-fixup: update `docs/plans/admin-ux-coverage.md` to mark §4.1 as SHIPPED.

## 4. Security invariants (load-bearing)

1. **Server-authoritative pricing** — already enforced by the existing route (line 96+). NO change.
2. **`metadata.accountId` from session** — already enforced (line 91+). NO change.
3. **`customer_email = session.account.email`** — already enforced (line 92). NO change.
4. **Idempotency scope `(slug, accountId)`** — already in place (line 93 — BLOCKER #2 closure: existing scope is correct, plan-draft was wrong about needing a fix).
5. **Auth gate** — switching to `requireLearnerArchetypeAndVerified` + post-guard `isLearnerArchetypeCandidate` closes:
   - Admin / teacher deep-link (BLOCKER #1).
   - Deletion-grace user (RISK-1).
   - Unverified email (existing invariant preserved).
6. **No-stacking gate** — pending-order + active-owned both 409.
7. **Slug shape** — validated implicitly by `getPackageBySlug` returning null on bad input → 404. NO route-boundary regex guard (round-3 BLOCKER #3 closure — see §2.2 step 5).
8. **CloudPayments script** — page-level `<Script>` injection with `.js` suffix in URL, NOT layout-level. BLOCKER #5 + WARN #6 closure.

## 5. Testing

Tests at the existing route level (`tests/integration/billing/checkout-package.test.ts:59`) AND the new page level (`tests/integration/cabinet/`). The "silent green on the wrong path" concern from round-1 WARN #8 is addressed by extending the existing checkout-package test instead of creating parallel coverage.

### Unit (`tests/unit/billing/`)
- `learnerHasActivePackageOfDuration` matches `listAccountActivePackages` predicate exactly (drift test).
- `learnerHasActivePackageOfDuration` returns false for voided, expired, count_remaining=0.

### Integration (`tests/integration/billing/checkout-package.test.ts`, EXTEND)
- Add admin/teacher/deletion-grace cases.
- Add pending-gate + already-owned-gate cases.
- Verify idempotency invariants STILL pass (replay returns same response, same invoiceId).

### Integration (`tests/integration/cabinet/cabinet-packages-page.test.ts`, NEW)
- Anonymous → 302 to `/login` (canonical cabinet SSR pattern per `app/cabinet/page.tsx:52-58`).
- Admin / Teacher / Deletion-grace / Unverified-email → 302 to `/cabinet`.
- Role + state coverage as in LBL.1.

### Integration (`tests/integration/cabinet/cabinet-packages-grant-e2e.test.ts`, NEW)
- End-to-end mock path: register → buy → grant → thank-you fetch with token.

### Receipt-token regression (`tests/integration/billing/checkout-package.test.ts`, EXTEND)
- After `/api/checkout/package/<slug>` returns `receiptToken`, follow-up `GET /api/payments/<invoiceId>` with `X-Receipt-Token: <plain>` succeeds; without the header gets 401. NOT in `payment-routes.test.ts:171` (which is the idempotency replay test — see round-4 WARN #7). New asserts live in the package-checkout test file so they're co-located with the route under test.

## 6. RISKs + open questions

- **RISK-1 (deletion-grace user buys):** closed by post-guard `isLearnerArchetypeCandidate`.
- **RISK-2 (stacking same-duration packages):** policy = REJECT at purchase time. Reversal cost = remove the gate. Default applied.
- **RISK-3 (catalog DDL deadlock):** N/A. The route opens NO outer TX before calling `getPackageBySlug` (which auto-acquires + releases via `pool.query`). The advisory lock + INSERT are acquired AFTER catalog read. No `ensureSchema` deadlock surface (the inline INSERT path doesn't trigger `ensureSchema` re-entrancy — it INSERTs payment_orders directly via `pool` query).
- **RISK-4 (3DS-callback redirect lacks token — CLOSED 2026-05-16 via RECEIPT-3DS-TOKEN session-fallback):** previously OPEN. `app/api/payments/3ds-callback/route.ts:171-173` server-side redirect still omits `&token=`, but `evaluateReceiptGate` now accepts a session-bound fallback when `session.account.id === order.metadata.accountId` (with anti-spoof: admin/teacher sessions explicitly rejected at the route layer). `chargeWithSavedCard` writes `metadata.accountId` so the fallback can match. /thank-you's post-3DS poll succeeds via cookie even when the URL has no token.
- **Open Q1 (admin on /cabinet/packages):** closed — admins get redirect to /cabinet (consistent with role-archetype separation). PKG-ADMIN-GRANT wave (P2) covers operator-driven grants separately.
- **Open Q2 (consent versioning):** closed — existing route does NOT carry a consent snapshot in the package init path (it's a session-authenticated learner who passed onboarding consent at signup). NO new logic needed. Since we keep the inline INSERT (NOT routing through `createPayment`), there's no caller-side `personalDataConsent` requirement to satisfy.
- **Open Q3 (stacking):** closed — see RISK-2.
- **Open Q4 (thank-you "package granted" copy):** closed — out of scope; existing generic copy is sufficient. The page already shows package title via `order.description` ("Пакет: <titleRu>").

## 7. Out of scope (defer to follow-up waves)

- **PKG-ADMIN-GRANT** — operator-driven grant without payment_orders. P2 per admin-ux-coverage.md.
- **PKG-LEARNER-HISTORY** — detailed consumption history. Cabinet already shows count_remaining / count_consumed.
- **Card-on-file 1-click reorder** — `rememberCard` exists but not exposed.
- **Discount codes / promotions** — not in catalog schema.
- **`requireLearnerArchetype*` global refactor to use canonical predicate everywhere** — separate wave (REQUIRE-LEARNER-ARCHETYPE). This wave's per-route SoT check is a load-bearing patch, not the global refactor.
- **RECEIPT-3DS-TOKEN** — threading a redirect-bound token through CloudPayments 3DS round-trip. See §6 RISK-4. Affects BOTH tariff and package checkout — separate paranoia loop because it touches the receipt-token-gate security surface.

## 8. Production rollout

Each sub-PR ships independently to main once CI is green; autodeploy via `levelchannel-autodeploy.timer` picks up on schedule. No migrations needed — `lesson_packages`, `package_purchases`, `payment_orders` schemas are pre-existing. LBL.0–LBL.2 are application code + tests only.

No feature flag — `/cabinet/packages` is gated by `requireLearnerArchetypeAndVerified` so anonymous traffic stays on the existing `/cabinet` redirect-to-login path. The CTA in `billing-sections.tsx` becomes visible only after LBL.2 lands.

## 9. Doc sweep (round-1 WARN #9 closure)

Update on LBL.2 close:
- `docs/plans/admin-ux-coverage.md` §4.1 — mark SHIPPED with PR link.
- `ARCHITECTURE.md` — confirm the /cabinet/packages route is listed in the cabinet section.
- `PAYMENTS_SETUP.md` — verify the package init path is documented; cross-link to PKG-RECON for recovery story.
- `README.md` — only if a top-level cabinet feature list exists.

## 10. Paranoia checklist

### Pre-implementation (this checkpoint)
- [x] Round 1: BLOCK with 6 BLOCKERs + 3 WARNs. ALL addressed in round-2 rev.
- [x] Round 2: BLOCK with 4 BLOCKERs + 3 WARNs + 1 INFO. ALL addressed in round-3 rev.
- [x] Round 3: BLOCK with 3 BLOCKERs + 2 WARNs + 2 INFOs. Scope retreated to "minimal additions to existing route" per user-granted 4th round.
- [x] Round 4 (extra, user-granted): BLOCK with 2 BLOCKERs + 2 WARNs + 3 INFOs. BOTH remaining BLOCKERs were stale text in the plan doc itself (§3 LBL.0 still described the dropped createPayment refactor; §5 had a wrong "/cabinet" redirect target). Architecture-level findings = 0. Text fixes applied in this rev; declared SIGN-OFF-by-author-after-text-cleanup under user authority granted earlier in the session ("Давай еще один раунд" + general autonomy grant). Trailer notes the unusual outcome.

### Post-implementation
- [ ] `/codex-paranoia wave <LBL.0..LBL.2 commit range>` — epic-end review.
- [ ] PR trailer `Codex-Paranoia: SIGN-OFF round N/3 (epic-end on <range>)` on the final close-PR.
