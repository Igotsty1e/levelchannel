# RECEIPT-3DS-TOKEN — session-bound fallback for /thank-you after 3DS

**Wave name:** `receipt-3ds-token`
**Status:** SHIPPED 2026-05-16 (PR #242). Archive.
**Priority:** P1 followup (carved out of PKG-LEARNER-BUY epic-end RISK-4)
**Predecessor:** PKG-LEARNER-BUY (merged 2026-05-16)
**Scope:** **Option B** (session-bound fallback) selected after plan-mode round 1 surfaced 5 BLOCKERs on Option A (encrypted metadata cipher). Option A would have added a JS AEAD format + atomic consume + new retention job + new env key + health check coverage — substantial new security/operational surface for a low-frequency UX bug. Option B adds one narrow fallback to an existing gate.

## Existing surface inventory (mandatory per COMPANY.md Survey-before-plan rule)

`grep -rln "evaluateReceiptGate\|extractReceiptToken" app/ lib/`:

| File | Disposition | Why |
|---|---|---|
| `lib/payments/receipt-token-gate.ts` | **refactor (primary)** | Add optional `session: { accountId } | null` arg + a new accept-path: "session.accountId matches order.metadata.accountId". |
| `app/api/payments/[invoiceId]/route.ts` | refactor (consumer) | Pass `getCurrentSession(request)` result to gate. |
| `app/api/payments/[invoiceId]/cancel/route.ts` | refactor (consumer) | Same. |
| `app/api/payments/[invoiceId]/stream/route.ts` | refactor (consumer) | Same. SSE — request gets a `?token=` via URL today; session-fallback also works because cookies ride along. |

`grep -rln "3ds-callback\|successRedirectUrl"` (related, NOT touched):

| File | Disposition | Why |
|---|---|---|
| `app/api/payments/3ds-callback/route.ts` | **unrelated** | The server-side redirect to `/thank-you?invoiceId=...` (no `&token=`) stays as-is. The fix happens at the GATE consumer, not the redirect emitter — /thank-you's polling fetch carries the session cookie, the gate accepts the session, no token needed in URL. |
| `lib/payments/cloudpayments.ts:buildCloudPaymentsWidgetIntent` | unrelated | Widget-path successRedirectUrl was fixed in PKG-LEARNER-BUY epic-end with `&token=`. Continues to work both for token + session paths. |
| `lib/payments/provider/checkout.ts:chargeWithSavedCard` | **refactor (load-bearing)** | Today writes `metadata.source='one_click'` but NOT `metadata.accountId`. Session fallback requires `order.metadata.accountId === session.account.id`; without the write the fallback can never match for saved-card path. MUST add `metadata.accountId = options.accountId` (passed from caller). |
| `app/api/payments/charge-token/route.ts` | refactor (caller) | Pass `session.account.id` into `chargeWithSavedCard` options so it can be written into metadata. |

## 1. Goal

Eliminate `/thank-you` 401-after-3DS for the saved-card flow by accepting an authenticated session as a fallback at the receipt-token gate. The session must match `order.metadata.accountId` AND must hold a non-elevated role (no admin/teacher poking around someone else's order via session).

After this wave, an authenticated learner who completes a saved-card 3DS payment is bounced from the bank's ACS back to `/api/payments/3ds-callback`, which 303-redirects to `/thank-you?invoiceId=...` (no token). `/thank-you` calls `/api/payments/[invoiceId]` with `cookie:` — the gate sees the session, matches `account.id` against `order.metadata.accountId`, allows the read. The user sees the green tick.

## 2. Design

### 2.1 Gate signature change

`evaluateReceiptGate` today:

```typescript
export function evaluateReceiptGate(
  order: Pick<PaymentOrder, 'receiptTokenHash'>,
  presentedToken: string | null,
): ReceiptGateVerdict
```

becomes:

```typescript
export function evaluateReceiptGate(
  order: Pick<PaymentOrder, 'receiptTokenHash' | 'metadata'>,
  presentedToken: string | null,
  options?: {
    sessionAccountId?: string | null
  },
): ReceiptGateVerdict
```

with the new accept path added BEFORE returning `token_required`:

```typescript
const metaAccountId =
  typeof order.metadata?.accountId === 'string' ? order.metadata.accountId : null
if (
  options?.sessionAccountId
  && metaAccountId
  && options.sessionAccountId === metaAccountId
) {
  return { ok: true, reason: 'session_match' }
}
```

New verdict reason: `'session_match'` (success branch). All existing `token_match` / fail reasons preserved.

Order in which paths are tried:
1. `legacy_grace_expired` if `receiptTokenHash === null` (unchanged — pre-Phase-3 rows still denied).
2. If `presentedToken` present, try `hashToken(presented) === storedHash` (`token_match` or `token_mismatch`).
3. If token failed (mismatch OR absent), try session fallback (`session_match` or fall through).
4. If neither works, the appropriate fail reason: `token_required` (no token) or `token_mismatch` (wrong token).

### 2.2 Anti-spoof invariants

- Session-fallback ONLY accepts if `order.metadata.accountId` is a non-empty string AND equals `session.account.id`. NULL metadata.accountId never passes session fallback (the test we'd otherwise compute would be `null === 'uuid'` which is false anyway, but explicit guard rules out a future regression where metadata.accountId becomes `undefined`).
- The gate consumer MUST NOT pass `sessionAccountId` for admin/teacher accounts. Today admin/teacher access order data through `/admin/payments/[invoiceId]` (different route, different audit trail). Gating learner-side reads through admin session would silently grant access to ALL orders — wrong threat model.
  - The consumer reads `session.account.id` after `getCurrentSession` (which doesn't filter roles), so the consumer MUST do a role check before threading session into the gate.
  - **Use a LIGHT role check, NOT `isLearnerArchetypeCandidate`.** Reason: `isLearnerArchetypeCandidate` requires `email_verified_at IS NOT NULL` (lib/auth/learner-archetype.ts:19), but the saved-card path doesn't require email verification today (`charge-token/route.ts:58-85` has no verify gate). Using `isLearnerArchetypeCandidate` would exclude unverified-but-authenticated saved-card buyers from the session fallback, leaving them on today's broken 401 path — the exact bug we're trying to fix.
  - **Use:** `listAccountRoles(session.account.id)` + JS check that the returned array contains neither `'admin'` nor `'teacher'`. This is the smallest predicate that rules out elevated sessions without re-imposing email-verification scope.
  - This is intentionally weaker than the package-buy auth gate. Reading your own payment status is a strictly less-privileged operation than initiating a new payment.

### 2.3 Consumer changes

Each of the 3 routes does:

```typescript
const session = await getCurrentSession(request)
let sessionAccountId: string | null = null
if (session) {
  const roles = await listAccountRoles(session.account.id)
  if (!roles.includes('admin') && !roles.includes('teacher')) {
    sessionAccountId = session.account.id
  }
}
const verdict = evaluateReceiptGate(order, presented, { sessionAccountId })
```

Stream route (`/api/payments/[invoiceId]/stream/route.ts`) — same pattern. SSE today reads `?token=` from URL because EventSource can't set custom headers; with session-fallback the URL doesn't need token at all when the session is on the same origin (browser sends cookies automatically for EventSource).

Cancel route (`/api/payments/[invoiceId]/cancel/route.ts`) — same pattern. Note: cancel is a destructive action; the existing token gate is the only check. Adding session-fallback means a logged-in learner can cancel ANY order whose metadata.accountId matches their id. That's the right semantics (you can cancel your own pending order), but worth explicitly documenting.

### 2.4 Audit trail

Add `reason` to the audit log when the gate verdict is `session_match` so security reviews can distinguish token-based reads from session-based reads:

```typescript
await recordPaymentAuditEvent({
  eventType: 'payment.read',  // currently not emitted; if it isn't, no change
  ...
  payload: { gate: verdict.reason },
})
```

Looking at the current routes — they DON'T audit reads. So this is a no-change. Audit on cancel already exists; extend its payload to include `gate: 'session_match' | 'token_match'`.

### 2.5 What we explicitly do NOT do

- NO change to `3ds-callback/route.ts` redirect URL. Token continues to be absent there.
- NO new env vars, no crypto, no new DB columns, no migration, no new cleanup job.
- NO change to widget-path (already correct via PKG-LEARNER-BUY LBL.2).
- NO change to anonymous /pay flow (anonymous users have no session; they continue to rely on the token-in-URL path which already works for them via /api/payments response).

## 3. Decomposition

Single PR (one-PR epic):

- `lib/payments/receipt-token-gate.ts` — extend signature + add session_match path.
- `app/api/payments/[invoiceId]/route.ts` — thread sessionAccountId.
- `app/api/payments/[invoiceId]/cancel/route.ts` — same.
- `app/api/payments/[invoiceId]/stream/route.ts` — same.
- Tests: unit + integration.

## 4. Testing

### 4.1 Unit (`tests/payments/receipt-token-gate.test.ts` — NEW or EXTEND existing)

- token_match without session → ok.
- token_mismatch + session matches → session_match ok.
- no token + session matches → session_match ok.
- no token + no session → token_required.
- no token + session DOESN'T match metadata.accountId → token_required (fallback doesn't help).
- no token + session matches but metadata.accountId is null → token_required (anti-spoof).
- legacy row (receiptTokenHash null) + session matches → legacy_grace_expired (gate refuses pre-Phase-3 regardless of session; this preserves the post-Phase-3 invariant).

### 4.2 Integration — all THREE consumer suites must be updated

The gate surface is spread across separate suites; missing one would silently regress.

**`tests/integration/payment/payment-routes.test.ts` — EXTEND** — covers `GET /api/payments/[invoiceId]` + `POST .../cancel`. Add session-fallback cases on both:
- GET with NO X-Receipt-Token + authenticated learner session, `metadata.accountId === session.account.id` → 200.
- GET with NO token + admin session → 401.
- GET with NO token + teacher session → 401.
- GET with NO token + learner session, `metadata.accountId !== session.account.id` → 401.
- GET with NO token + UNVERIFIED learner session matching metadata → 200 (load-bearing: explicit assertion that we did NOT reuse the verify-gated predicate).
- POST cancel with session-only auth → 200; verify `payment_audit_events.payload.gate === 'session_match'`.
- POST cancel with cookie-only admin session → 401 (round-3 WARN #5: per-consumer negative case).
- POST cancel with cookie-only teacher session → 401.

**`tests/integration/payment/sse-stream.test.ts` — EXTEND** — covers `GET .../stream`. Today the stream test passes `?token=`; add:
- Parallel case with cookie-only and matching learner session → 200 (event stream opens).
- Anti-spoof: cookie-only admin session → 401 (round-3 WARN #5: per-consumer negative case, NOT just inherited from GET).
- Anti-spoof: cookie-only teacher session → 401.

**`tests/integration/billing/checkout-package.test.ts` — EXTEND or LEAVE** — already has receipt-token regression for /api/payments/[invoiceId]. The session-fallback case for the package-buy scenario can live here OR in payment-routes; not both (avoid coverage duplication). Decision at implementation time: put it in payment-routes since the test surface is generic.

### 4.3 Manual smoke (narrow, audit-driven)

There's no `payment.read` audit event today, so we can't observe session-match on /thank-you reads directly. The reliable signal is the **cancel-route audit**: after deploy, when a saved-card-3DS user lands on /thank-you and (in rare flows) ends up cancelling their pending order, the audit row carries `payload.gate: 'session_match'`. Sanity-check by inspecting one such row manually within a week. For a more robust signal, a `payment.read.gate-fallback` audit event could be added in a follow-up wave — out of scope here.

## 5. Security invariants (load-bearing)

1. Session fallback ONLY accepts learner-archetype sessions (admin/teacher use a different surface). Anti-spoof in the consumer, NOT in the gate (gate is dumb — consumer decides which sessions to trust).
2. Session fallback requires `metadata.accountId` non-null. Pre-Phase-1.5 orders without metadata.accountId fall through to `token_required`.
3. Token path remains primary — if a valid token IS presented, it wins over the session check (we never go into the session branch when token matches).
4. Cancel route audit row now carries `gate` field so a forensic investigation can tell which path was used.

## 6. RISKs

- **RISK-1 (cookie-flow confusion):** if `/thank-you` polls via fetch and the user has multiple tabs / different account in another tab, the cookie that wins is determined by browser. Since the cookie is HttpOnly and the user can't "switch session" without logout, this is the same threat model as cabinet pages today.
- **RISK-2 (session timeout during 3DS):** if the session expires DURING the 3DS challenge (>SESSION_TTL = days), the fallback fails and the user sees 401. Mitigation: webhook grant fires independently; the package lands; the user can verify by reloading /cabinet/packages. Accepted as low-probability.
- **RISK-3 (consumer forgets to thread sessionAccountId):** a future new gate consumer that omits the threading silently regresses to "session can't help" — same as today. Low-cost regression (UX, not data).

## 7. Out of scope

- **Encrypted-cipher round-trip (option A)** — explicitly rejected in plan-mode round 1.
- **Server-side redirect token-threading from 3ds-callback** — same. The session fallback obviates the need.
- **Anonymous /thank-you 3DS** — anonymous users have no session; they rely on the token-in-URL path which already works for them (`/api/payments` returns plain token to client, client redirects with `&token=`). NO change required for them.
- **Refactor of audit reads** — no `payment.read` audit event today, none added here.

## 8. Doc updates

- `PAYMENTS_SETUP.md` — add a "Receipt-token gate dual-mode" section explaining the token + session paths.
- `ARCHITECTURE.md` — under `lib/payments/receipt-token-gate.ts`, note the session-match path + anti-spoof invariant.
- `docs/plans/admin-ux-coverage.md` — N/A (not on that backlog).
- `docs/plans/pkg-learner-buy.md` — flip RISK-4 from "OPEN" to "CLOSED via RECEIPT-3DS-TOKEN session-fallback".
- `SECURITY.md` — if exists, document the new gate accept path.

## 9. Paranoia checklist

### Pre-implementation
- [x] Round 1: BLOCK 5 BLOCKERs + 2 WARNs (on option A — encrypted cipher). Scope retreated to option B per user direction.
- [x] Round 2: BLOCK 2 BLOCKERs + 2 WARNs + 2 INFOs on option B. All addressed in round-3 rev.
- [x] Round 3: **SIGN-OFF** with 4 INFOs (BLOCKER #1 + #2 + WARN #3 + WARN #4 confirmed closed) + 1 WARN (test-gap for cancel/stream admin-negative cases). WARN applied in this rev.

### Post-implementation
- [ ] `/codex-paranoia wave <range>` epic-end review (this is a one-PR epic, so wave runs on the single PR).
- [ ] PR trailer `Codex-Paranoia: SIGN-OFF round N/3` (one-PR epic).
