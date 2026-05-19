# SBP-PAY — СБП-платежи через CloudPayments API (`/pay` only)

**Status:** DRAFT 2026-05-19 (awaiting `/codex-paranoia plan` round 1).
**Wave name:** `sbp-payments` (one-PR epic; UI + server + migration + tests in one PR per §5).
**Trigger:** Product-owner request 2026-05-19 — CloudPayments enabled СБП on the merchant terminal; LevelChannel needs to surface it as a payment option.
**Author:** Claude (autonomous).
**Scope confirmed by product owner 2026-05-19:** (1) full scope — dedicated server QR endpoint + dedicated UI button, not widget-only; (2) `/pay` only — NOT `/checkout/[tariffSlug]`, NOT `/cabinet/packages`; (3) refunds DEFERRED — manual via CloudPayments dashboard until ≥N СБП-refunds per month; (4) single CloudPayments terminal — `paymentConfig.cloudpayments.publicId`; (5) fresh `InvoiceId` on every "Pay via СБП" click — no QR reuse; (6) receipt-token gate handles BOTH success paths — widget-style browser-resume AND deep-link-back-to-site.

---

## 0. Cross-refs

- `lib/payments/cloudpayments.ts` — current widget intent builder; SBP must NOT break the widget path.
- `lib/payments/cloudpayments-webhook.ts` — webhook payload parser; CardLastFour/CardType/Token become NULL on СБП payments, current code needs `payment_method='sbp'` branch.
- `app/api/payments/webhooks/cloudpayments/pay/route.ts` (and `check` / `fail`) — webhook routes that update PaymentOrder.
- `lib/payments/receipt-gate-session.ts` + `lib/payments/receipt-token-gate.ts` — receipt-token contract on `/thank-you`; dual-mode session fallback shipped 2026-05-16 (RECEIPT-3DS-TOKEN). СБП deep-link return uses the same fallback.
- `app/pay/page.tsx` + `components/payments/pricing-section.tsx` — pay-page UI; new "Оплатить через СБП" CTA + QR modal landed here.
- `docs/private/OPERATIONS.private.md` — operator runbook; CloudPayments dashboard refund instructions.
- `docs/content-style.md` — Russian copy rules; СБП copy follows the glossary (no "виджет"-style jargon for learners).
- `docs/critical-path.md` — `lib/payments/cloudpayments-webhook.ts` is on critical path; this wave touches it.

---

## 1. Goal

Add a dedicated "Оплатить через СБП" CTA on `/pay`. Clicking it:

1. Submits a form (amount + email + customer comment + personal-data consent) to a new server endpoint.
2. Server creates a `payment_orders` row with `provider='cloudpayments'`, `metadata.payment_method='sbp'`, status `pending`, fresh `invoiceId`.
3. Server calls CloudPayments `POST https://api.cloudpayments.ru/payments/qr/sbp/create` (Basic Auth: PUBLIC_ID + API_SECRET) with `Amount` + `Currency=RUB` + `InvoiceId` + `AccountId=email` + `Description` + `JsonData={invoiceId, customerEmail}`.
4. CloudPayments returns `{Success: true, Model: {QrUrl, Image, TransactionId, ...}}`. Server persists `providerTransactionId` and the QR url.
5. Browser opens a modal showing the QR image + a button "Открыть в банке" (mobile-only) + "Я оплатил(а)" status-poll button + "Отмена" close button.
6. Browser starts a polling loop against `GET /api/payments/[invoiceId]/status` (existing route) every 3 sec for up to 10 minutes.
7. CloudPayments fires `Pay` webhook to `/api/payments/webhooks/cloudpayments/pay` with `PaymentMethod` / `PaymentSystem` indicating SBP. Webhook handler reads `CardType=null` (the SBP signal) + persists `payment_method='sbp'` in `metadata` if not already set.
8. Browser's status-poll sees `status='paid'`, closes modal, redirects to `/thank-you?invoiceId=...&token=...`.
9. `/thank-you` validates receipt-token under both widget-mode AND session-fallback (already shipped — RECEIPT-3DS-TOKEN).

**Non-goals:**

- NOT a widget-tab toggle — that's already supported by CloudPayments (`restrictedPaymentMethods: ['Sbp']` is NOT set, so the widget already shows СБП). This wave is the **dedicated** flow that bypasses the widget for users who explicitly clicked СБП.
- NOT `/checkout/[tariffSlug]` (free-amount pay-page only).
- NOT `/cabinet/packages` (the existing package-buy flow uses the widget).
- NOT refunds (deferred — manual via CloudPayments dashboard).
- NOT СБП participant-bank deep-link picker (CloudPayments handles bank selection inside their UI; we just open the QR URL).

---

## 1.1 Existing surface inventory — payment provider config

`lib/payments/config.ts`:

- `paymentConfig.cloudpayments.publicId` — terminal ID (single terminal per product-owner decision §4).
- `paymentConfig.cloudpayments.apiSecret` — Basic Auth secret for server-to-server API calls.
- `paymentConfig.siteUrl` — used for `successRedirectUrl` / `failRedirectUrl` in widget intent.

No new env vars are required — the existing CloudPayments credentials cover the SBP API.

## 1.2 Existing surface inventory — webhook handler

`lib/payments/cloudpayments-webhook.ts` shape:

- Parses `payload.InvoiceId` / `ExternalId` (one or the other; SBP API returns InvoiceId in our request).
- Extracts `CardLastFour`, `CardType`, `CardExpDate`, `Token` for the saved-card flow.
- Currently SILENT on `payment_method` — assumes card.

**Change required:** treat `CardType === null || CardType === ''` AND `Token === null` AND `PaymentMethod` indicates SBP → write `metadata.payment_method='sbp'`. Card-side path stays default (`metadata.payment_method='card'` for newly-created orders, NULL for legacy rows).

## 1.3 Existing surface inventory — payment_orders schema

`migrations/0001_payment_orders.sql`:

- `metadata jsonb null` — current home for non-canonical fields (source, rememberCard, slotId, accountId).

**Change required:** add a typed column `payment_method text null check (payment_method in ('card', 'sbp', 'admin_grant'))` for fast filtering + index. `'admin_grant'` is for the existing PKG-ADMIN-GRANT path (which sets `provider='admin_grant'`); a CHECK constraint catch-all migration backfills the legacy rows to `'card'` (the only real option pre-SBP).

Migration number: **`00NN`** (placeholder per `~/Obsidian/Brain/wiki/concepts/migration-number-late-binding.md` — actual integer picked at commit time after BCS-DEF-1-TG migration 0061 + BCS-DEF-2 migration 0062 land).

## 1.4 Existing surface inventory — receipt-token gate

`lib/payments/receipt-token-gate.ts` + `lib/payments/receipt-gate-session.ts`:

- Token issued at create-order time, returned ONCE in `POST /api/payments` response.
- Plain token never persisted; hash stored in `payment_orders.receipt_token_hash`.
- `/thank-you?invoiceId=X&token=Y` validates: hash match → success; missing/wrong token → session fallback (RECEIPT-3DS-TOKEN, 2026-05-16) accepts authenticated learner session matching `order.metadata.accountId`.

**No change required** — the dual-mode gate already handles the СБП deep-link-back path: учитель / ученик кликает "Я оплатил(а)", browser polls until `paid`, then `window.location = /thank-you?invoiceId=X&token=Y` (widget path) OR returns from bank app via OS deep-link → land on `/thank-you?invoiceId=X` without token → session fallback kicks in.

## 1.5 Existing surface inventory — /pay UI

`app/pay/page.tsx` + `components/payments/pricing-section.tsx`:

- Free-amount input + email + comment + personal-data consent + "Оплатить картой" CTA → widget.
- Saved-card one-click path for returning users.
- Failure modal + retry link.

**Change required:** add second CTA "Оплатить через СБП" parallel to "Оплатить картой" (both visible). The SBP CTA opens a new modal `<SbpQrModal />` that renders the QR + actions.

## 1.6 Critical-path inventory

Per `docs/critical-path.md` (refreshed 2026-05-19 PR #369):

- `lib/payments/cloudpayments-webhook.ts` — critical-path file. CHECK in webhook handler around the SBP-branch must be paranoia-reviewed (this plan).
- `lib/payments/store-postgres.ts` — critical-path. SBP column write goes through it.
- `app/api/payments/webhooks/cloudpayments/pay/route.ts` — critical-path.

PR commit body therefore carries `Codex-Paranoia: SIGN-OFF round N/3` trailer (not `SUB-WAVE`) per `docs/critical-path.md`.

---

## 2. Design

### 2.1 New server endpoint — `POST /api/payments/sbp/create-qr`

Route file: `app/api/payments/sbp/create-qr/route.ts`.

Request body:
```json
{
  "amountRub": 3500,
  "customerEmail": "user@example.com",
  "customerComment": "за урок 26 апреля",
  "personalDataConsentAcceptedAt": "2026-05-19T18:00:00Z"
}
```

Server flow:

1. **Validate input** — amount in `[MIN_PAYMENT_AMOUNT_RUB, MAX_PAYMENT_AMOUNT_RUB]`, email is `validateCustomerEmail(...)`, comment `≤128 chars`, consent timestamp present. 400 `'invalid_input'` on any failure.
2. **Rate limit** — `enforceRateLimit(request, 'sbp:create-qr:ip', 10, 60_000)` — 10 QR-creations per IP per minute.
3. **Idempotency** — `withIdempotency(request, 'sbp:create-qr:' + invoiceId, body, ...)` wraps the rest. Idempotency-Key from the client guards against double-clicks.
4. **Generate invoiceId** — fresh UUID per product-owner decision §5.
5. **Create PaymentOrder** — `createCloudPaymentsOrder(...)` reused; `metadata.payment_method='sbp'`, `metadata.source='sbp-button'`. Persist via `store-postgres.ts`.
6. **Issue receipt-token** — mint plain token, store SHA-256 hash. Return plain token in response.
7. **Call CloudPayments API** —
   ```js
   const resp = await fetch('https://api.cloudpayments.ru/payments/qr/sbp/create', {
     method: 'POST',
     headers: {
       'Content-Type': 'application/json',
       'Authorization': 'Basic ' + base64(publicId + ':' + apiSecret),
     },
     body: JSON.stringify({
       Amount: amountRub,
       Currency: 'RUB',
       InvoiceId: invoiceId,
       AccountId: customerEmail,
       Description: buildPaymentDescription(amountRub, customerComment),
       JsonData: JSON.stringify({ invoiceId, customerEmail }),
     }),
     signal: AbortSignal.timeout(5000),
   })
   ```
8. **Parse + persist** — `{Success: true, Model: {QrUrl, Image, TransactionId}}`. Save `providerTransactionId = String(TransactionId)`, return `QrUrl` (full URL, used as `<img src>` AND deep-link `href`).
9. **Response 201**:
   ```json
   {
     "invoiceId": "...",
     "qrUrl": "https://qr.nspk.ru/AS10001Q...",
     "receiptToken": "...",
     "transactionId": 12345
   }
   ```
10. **Failure paths**: 502 `'sbp_api_unavailable'` on AbortError / 5xx; 422 `'sbp_api_rejected'` on `Success: false`. Mark order `status='failed'` in both cases.

### 2.2 New status-poll route reuse — `GET /api/payments/[invoiceId]/status`

The route at `app/api/payments/[invoiceId]/route.ts` already exists for the existing card flow. Returns `{status, paidAt, ...}`. No changes needed.

Client polls every 3 sec for up to 10 minutes (`max_attempts=200`); on `status='paid'` redirect, on `status='failed'` show error, on timeout show "Платёж не дошёл — попробуйте ещё раз".

### 2.3 New UI component — `<SbpQrModal />`

Path: `components/payments/sbp-qr-modal.tsx`.

Props: `{ invoiceId, qrUrl, receiptToken, onClose, onPaid, onFailed, onTimeout }`.

Render:

- `<img src={qrUrl} alt="QR-код для оплаты через СБП" />` — qrUrl is the CloudPayments-hosted QR PNG URL (also accepts `Image` base64 if needed; QrUrl is preferred for cache-friendliness).
- Russian copy block per `docs/content-style.md`:
  - Heading: "Оплата через СБП"
  - Body: "Откройте приложение вашего банка → раздел СБП / Сканировать QR → отсканируйте этот код."
  - Mobile-only deep-link button: `<a href={qrUrl} target="_blank">Открыть в приложении банка</a>` (works on mobile because the QR URL is in the NSPK format that mobile bank apps recognize as a deep-link target).
- Auto-polling status indicator (spinner + "Ожидаем подтверждение…"); on paid → redirect; on timeout → "Истёк лимит времени. Попробуйте ещё раз".
- Close button — fires `onClose`; the PaymentOrder stays `status='pending'` until webhook resolves it (eventual consistency).

A11y: focus-trap inside modal; ESC closes; QR image has descriptive alt.

### 2.4 Webhook handler update — `lib/payments/cloudpayments-webhook.ts`

Add SBP signal detection:

```ts
export function detectPaymentMethod(payload: CloudPaymentsWebhookPayload): 'card' | 'sbp' {
  // SBP signal per CloudPayments docs:
  //   - CardType / CardFirstSix / CardLastFour / Token are NULL/empty
  //   - PaymentMethod or PaymentSystem indicates SBP
  // We trust the absence-of-card-fields signal (TYPED null/empty) AS
  // primary, because PaymentMethod string is undocumented in our copy
  // of the CloudPayments reference.
  const hasCardData =
    (payload.CardType && String(payload.CardType).trim().length > 0) ||
    (payload.CardLastFour && String(payload.CardLastFour).trim().length > 0) ||
    (payload.Token && String(payload.Token).trim().length > 0)
  if (hasCardData) return 'card'
  // Secondary cross-check: PaymentMethod string contains "Sbp" / "СБП".
  // If absent AND no card data, default to 'sbp' (the only other path).
  return 'sbp'
}
```

In the webhook route handler (`app/api/payments/webhooks/cloudpayments/pay/route.ts`):

- After matching `payment_orders` by `invoiceId`, read existing `metadata.payment_method`. If already `'sbp'` (set at create-qr time), keep it. Otherwise apply `detectPaymentMethod(payload)` and update.
- Skip saved-card path if `payment_method === 'sbp'` (don't try to write a `saved_cards` row with NULL card data).

### 2.5 PaymentOrder type extension

`lib/payments/types.ts`:

```ts
export type PaymentMethod = 'card' | 'sbp' | 'admin_grant'

export type PaymentOrder = {
  // ... existing fields ...
  paymentMethod: PaymentMethod | null  // null for legacy pre-SBP rows
}
```

Migration `00NN_payment_orders_payment_method.sql`:

```sql
alter table payment_orders
  add column if not exists payment_method text null
    check (payment_method is null or payment_method in ('card', 'sbp', 'admin_grant'));

-- Backfill legacy rows: admin_grant rows from PKG-ADMIN-GRANT,
-- card otherwise.
update payment_orders
  set payment_method = case
    when provider = 'admin_grant' then 'admin_grant'
    else 'card'
  end
  where payment_method is null;

-- Partial index for fast filtering in admin reconciliation views.
create index if not exists payment_orders_method_status_idx
  on payment_orders (payment_method, status)
  where payment_method is not null;
```

Additive-only. No NOT NULL on the column (legacy rows already backfilled in same migration; new rows go through the `createCloudPaymentsOrder` path that sets it).

### 2.6 Store-postgres update

`lib/payments/store-postgres.ts`:

- `mapOrderRow(row)` reads `row.payment_method` into `order.paymentMethod`.
- `upsertPaymentOrder(order)` SQL gains `payment_method = excluded.payment_method`.

### 2.7 Status-poll client hook

`components/payments/use-payment-status-poll.ts` — new hook:

```ts
useEffect(() => {
  const interval = setInterval(async () => {
    const res = await fetch(`/api/payments/${invoiceId}/status`)
    const data = await res.json()
    if (data.status === 'paid') { onPaid(); clearInterval(interval) }
    else if (data.status === 'failed') { onFailed(data.reason); clearInterval(interval) }
  }, 3000)
  const timeout = setTimeout(() => { clearInterval(interval); onTimeout() }, 600_000)
  return () => { clearInterval(interval); clearTimeout(timeout) }
}, [invoiceId])
```

### 2.8 Failure modes

- **CloudPayments SBP API timeout / 5xx** — order stays `status='pending'`, browser shows error in modal, user can retry (new InvoiceId per click). Don't mark `failed` on transient API errors — the webhook will eventually resolve.
- **CloudPayments API rate-limit** — handled at app level via `enforceRateLimit(...)` on the route.
- **QR scanned but user abandons before paying** — order stays `pending` forever (until manual reconciliation). Acceptable for MVP.
- **Webhook arrives before status-poll** — `/api/payments/[invoiceId]/status` reads from `payment_orders` table; webhook writes there; race is naturally resolved by the next 3-sec poll tick.
- **Webhook arrives without us creating a CloudPayments order** — already handled in existing webhook code (404 path; CloudPayments will retry).
- **Same InvoiceId paid twice** (user retried after long delay, both SBP requests succeeded on CloudPayments side) — protected by webhook-dedup (existing `webhook-dedup.ts` keyed on TransactionId).

---

## 3. Tests

### 3.1 Unit — server endpoint

`tests/payments/sbp-create-qr.test.ts`:

- Valid request → 201 with invoiceId + qrUrl + receiptToken.
- Invalid email → 400 `'invalid_input'`.
- Amount below min → 400.
- CloudPayments API timeout (mock `fetch` to throw AbortError) → 502 + order marked failed.
- CloudPayments API returns `Success: false` → 422 + order marked failed.
- Rate-limit (11th request in 60sec) → 429.
- Idempotency-Key repeat → cached response, no second CloudPayments call.

### 3.2 Unit — webhook payment_method detection

`tests/payments/detect-payment-method.test.ts`:

- Webhook with `CardType='Visa', CardLastFour='1234'` → `'card'`.
- Webhook with `CardType=null, CardLastFour=null, Token=null` → `'sbp'`.
- Webhook with `CardType=''` (empty string) → `'sbp'`.
- Webhook with `CardType='Visa', Token=null` → `'card'` (Token absent doesn't make it SBP).

### 3.3 Integration — full SBP flow

`tests/integration/payments/sbp-full-flow.test.ts`:

- Mock CloudPayments API endpoint (per existing `tests/mocks/cloudpayments-mock.ts` pattern if exists, else introduce one).
- POST `/api/payments/sbp/create-qr` → 201; verify `payment_orders` row landed with `payment_method='sbp'`, `provider_transaction_id` set, `receipt_token_hash` set.
- POST webhook `/pay` with SBP-shaped payload → order transitions to `paid`; webhook-dedup row created.
- GET `/api/payments/[invoiceId]/status` after webhook → `{status: 'paid'}`.
- GET `/thank-you?invoiceId=X&token=Y` with valid token → success.
- GET `/thank-you?invoiceId=X` WITHOUT token but with authenticated learner session matching `metadata.accountId` → success (session fallback path).

### 3.4 Integration — column + index

`tests/integration/payments/payment-method-column.test.ts`:

- Migration `00NN` applies; column exists with CHECK.
- INSERT `payment_method='card'` succeeds.
- INSERT `payment_method='bogus'` fails CHECK.
- Backfill: pre-existing rows updated to `'card'` or `'admin_grant'` correctly.

### 3.5 RTL — modal a11y

`tests/payments/sbp-qr-modal.test.tsx` (per SAAS-INFRA-1 jsdom+RTL):

- Modal renders QR image with descriptive alt.
- ESC closes modal → `onClose` called.
- Tab cycles inside modal (focus trap).
- "Открыть в приложении банка" link has correct `href`.

---

## 4. Security

### 4.1 Webhook authentication

Existing HMAC-SHA256 verification (`buildCloudPaymentsHmac` in `cloudpayments-webhook.ts`) applies to SBP webhooks identically. No new auth surface.

### 4.2 Server-to-server API auth

Basic Auth via `paymentConfig.cloudpayments.publicId` + `paymentConfig.cloudpayments.apiSecret`. Secret never leaves the server. Body of the POST request to CloudPayments contains no PII beyond what's already in our `payment_orders` (email, amount, comment).

### 4.3 QR url leakage

The QR url returned by CloudPayments is a short-lived NSPK URL (`https://qr.nspk.ru/...`). It contains the invoice ID-derived signature internally but does NOT contain plaintext PII. Acceptable to display in modal + browser history.

### 4.4 Personal-data consent

The existing `personalDataConsentAcceptedAt` requirement on the card-pay path is reused. SBP-CTA enforces the same checkbox.

### 4.5 Receipt-token contract

Plain token returned ONCE in `/api/payments/sbp/create-qr` response. Browser stores in component state; passes to `/thank-you` via `?token=` query param. Same contract as the widget path — no new surface.

### 4.6 Rate-limit DDoS

`POST /api/payments/sbp/create-qr` is rate-limited per IP. Server-to-server outbound (CloudPayments API) is implicitly rate-limited by our IP rate limit upstream.

---

## 5. Decomposition — single PR

One-PR epic. Files touched:

```
docs/plans/sbp-payments.md                            (NEW — this file)
migrations/00NN_payment_orders_payment_method.sql     (NEW — additive column + backfill)
lib/payments/types.ts                                  (modified — PaymentMethod type + field)
lib/payments/store-postgres.ts                         (modified — read/write payment_method column)
lib/payments/cloudpayments-webhook.ts                  (modified — detectPaymentMethod helper)
lib/payments/cloudpayments-api.ts                      (modified — new createSbpQr() API client)
app/api/payments/sbp/create-qr/route.ts                (NEW — server endpoint)
app/api/payments/webhooks/cloudpayments/pay/route.ts   (modified — apply detectPaymentMethod + skip saved-card on SBP)
components/payments/sbp-qr-modal.tsx                   (NEW — QR modal)
components/payments/use-payment-status-poll.ts         (NEW — status-poll hook)
components/payments/pricing-section.tsx                (modified — second CTA + modal mount)
lib/payments/README.md                                 (modified — document SBP path)
ARCHITECTURE.md                                        (modified — note SBP path in §payment flow)
.env.example                                           (no change — no new env vars)
tests/payments/sbp-create-qr.test.ts                                       (NEW)
tests/payments/detect-payment-method.test.ts                               (NEW)
tests/payments/sbp-qr-modal.test.tsx                                       (NEW)
tests/integration/payments/sbp-full-flow.test.ts                           (NEW)
tests/integration/payments/payment-method-column.test.ts                   (NEW)
docs/critical-path.md                                  (modified — note SBP path touches existing critical files)
docs/private/OPERATIONS.private.md                     (modified — runbook for SBP refund via dashboard)
ENGINEERING_BACKLOG.md                                 (modified — SBP-REFUND-AUTO deferred line)
```

**Estimated diff:** ~700-900 LOC (server route + modal + status-poll hook + 5 test files + plan-doc + docs).

**Critical-path:** `lib/payments/cloudpayments-webhook.ts` + `lib/payments/store-postgres.ts` are critical-path. PR commit body carries `Codex-Paranoia: SIGN-OFF round N/3` trailer.

---

## 6. Risks + mitigations

### RISK-1 — CloudPayments SBP API undocumented edge cases

The CloudPayments developer docs page snippets I have access to don't fully spell out the SBP webhook payload shape. Mitigation: `detectPaymentMethod()` uses the **absence** of card fields (which is well-defined) as the primary signal, NOT the presence of an undocumented PaymentMethod string. Webhook tests cover both null + empty-string variants.

### RISK-2 — QR scanned, user pays, webhook delayed by minutes

Status-poll runs every 3 sec; webhook usually arrives within seconds of bank confirmation. If webhook is delayed 5+ min, status-poll timeout shows "Платёж не дошёл — попробуйте ещё раз" and user gets confused (they DID pay). Mitigation: timeout copy says "Если вы оплатили — деньги придут, мы пришлём чек на email. Не оплачивайте ещё раз." Webhook eventually resolves; user gets receipt.

### RISK-3 — Two СБП payments for the same InvoiceId

Product owner chose §5 "fresh invoiceId per click". Webhook-dedup keyed on `TransactionId` (CloudPayments-side unique). Same TransactionId can't be paid twice. Different InvoiceIds for the same user paying twice → both succeed, but each has its own paid order → admin reconciliation surfaces it as 2 separate rows. Mitigation: existing reconcile flow handles duplicates.

### RISK-4 — Mobile deep-link `qr.nspk.ru` doesn't trigger bank app on iOS Safari

On iOS, opening `https://qr.nspk.ru/...` from Safari sometimes opens the URL in a new tab instead of bouncing to a bank app. Mitigation: copy in the modal explains the manual fallback ("откройте приложение банка вручную, отсканируйте QR со скриншота"). NSPK has been improving deep-link recognition; expect this to improve over time.

### RISK-5 — User closes modal mid-payment

Order stays `pending`. Webhook eventually transitions to `paid` (if user finished paying). User gets receipt email but no in-app confirmation. Mitigation: order is `paid` in DB → `/cabinet` shows it correctly. Email receipt is the primary confirmation.

### RISK-6 — Migration `00NN` number race

Per `~/Obsidian/Brain/wiki/concepts/migration-number-late-binding.md`: BCS-DEF-1-TG owns 0061 (PR #386, not yet merged); BCS-DEF-2 owns 0062 (PR #385, not yet merged). SBP gets the next available number AT COMMIT TIME, not now. Plan-doc uses `00NN` placeholder.

### RISK-7 — CloudPayments API rate-limit on server-to-server

Their docs imply per-terminal rate limits but don't publish the exact threshold. Mitigation: our app-level rate-limit (10/min per IP) is well below any reasonable CloudPayments-side limit.

---

## 7. Acceptance criteria

The PR ships when:

- Migration `00NN` applies clean on a fresh test DB.
- `npm run test:run` green (5 new test files all pass).
- `npm run test:integration` green.
- `npm run build` green.
- `/codex-paranoia plan` SIGN-OFF on this file (round N/3).
- `/codex-paranoia wave` SIGN-OFF on the implementation diff (round N/3) — wave-mode happens AFTER impl PR is open.
- PR commit body trailer:
  ```
  Codex-Paranoia: SIGN-OFF round N/3 (one-PR epic; plan + wave collapsed)
  Critical-Path-Touched: lib/payments/cloudpayments-webhook.ts, lib/payments/store-postgres.ts, app/api/payments/webhooks/cloudpayments/pay/route.ts
  Skill-Used: /codex-paranoia plan + /codex-paranoia wave
  ```

Post-merge (operator-side):
- Hit `/pay` in a browser; verify "Оплатить через СБП" CTA visible alongside "Оплатить картой".
- Click it → modal opens with QR + status indicator.
- Pay a small amount via real bank app; verify `/thank-you` lands correctly + email receipt arrives.
- Repeat the test paying via the CARD path; verify nothing regressed.

---

## 8. Migration / rollout

1. PR opens with all files.
2. CI runs migration `00NN` against test DB → green.
3. PR merges (squash) to main.
4. Autodeploy timer picks up the new commit; `npm run build → npm run migrate:up → swap → health-check` per `docs/private/OPERATIONS.private.md`.
5. After deploy, `/pay` shows the new CTA.
6. Operator-side: no env-var changes needed (single CloudPayments terminal already configured). No systemd unit changes.

**No deploy-ordering hazard.** Migration `00NN` is purely additive (new column + backfill); the OLD shipped code never reads it. New code writes/reads it.

---

## 9. Out of scope — deferred follow-ups

### 9.1 SBP refunds — SBP-REFUND-AUTO

Manual refund via CloudPayments dashboard until the volume justifies automation. New backlog entry `SBP-REFUND-AUTO` to be added when ≥5 SBP-refunds per month accumulate. Refund API endpoint: `POST https://api.cloudpayments.ru/payments/sbp/refund` (per docs).

### 9.2 SBP on `/checkout/[tariffSlug]` and `/cabinet/packages`

Product owner explicitly scoped these out 2026-05-19. If demand surfaces (operator complaint or learner request), add as `SBP-CHECKOUT-FLOW` later.

### 9.3 Saved-card-style SBP recurrence

CloudPayments has SBP-recurrent contracts on some terminals; not in scope for MVP.

### 9.4 SBP bank-list deep-link picker

CloudPayments handles bank selection inside their QR flow. If we ever need a custom "pick your bank" UI, that's a separate wave.

---

## 10. Open questions for paranoia round 1

Pre-canned answers if codex round-1 surfaces these:

**Q1.** Why not just enable the widget's СБП tab and skip all this work?  
**A:** Product owner chose option B (full scope) — dedicated CTA + dedicated UX. The widget СБП tab IS enabled by default (no `restrictedPaymentMethods` set), but a dedicated button is more discoverable for users who want СБП specifically + better mobile UX (deep-link to bank app from the modal, not from inside an iframe).

**Q2.** What if the SBP API call succeeds but the order-write fails?  
**A:** Write order BEFORE the API call. If API call fails, mark order `failed`. This way order-state is always at least as current as the external service.

**Q3.** What's the receipt-token contract for the deep-link return path?  
**A:** When user returns from bank app via OS deep-link, browser may not preserve the original `/pay` page state (different tab, fresh session). The receipt-token gate's RECEIPT-3DS-TOKEN session fallback handles this: `/thank-you?invoiceId=X` without `?token=Y` matches authenticated learner session against `order.metadata.accountId` and accepts.

**Q4.** Why don't we use `Image` (base64) instead of `QrUrl` for the QR display?  
**A:** `QrUrl` is a CDN-served PNG that browsers cache; base64 inflates the response payload. `QrUrl` is preferred unless CloudPayments expires it too quickly (≤10 min seems sufficient for the polling window).

**Q5.** What about the SBP version of webhook deduplication?  
**A:** `webhook-dedup.ts` keys on `TransactionId` (CloudPayments-side unique ID). Same for card and SBP.

**Q6.** PaymentMethod / PaymentSystem strings on the webhook?  
**A:** Per docs (incomplete on our side), undocumented exact string. `detectPaymentMethod()` uses the **absence** of card fields as primary signal (typed nulls). Codex round may push us to also pin the PaymentMethod string after testing on the real terminal — that's a follow-up enrichment.

---

## 11. Final trailer expectations

PR commit body carries:
```
Codex-Paranoia: SIGN-OFF round N/3 (one-PR epic; plan + wave collapsed)
Critical-Path-Touched: lib/payments/cloudpayments-webhook.ts, lib/payments/store-postgres.ts, app/api/payments/webhooks/cloudpayments/pay/route.ts
Skill-Used: /codex-paranoia plan + /codex-paranoia wave
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

— END OF DRAFT (awaiting `/codex-paranoia plan` round 1) —
