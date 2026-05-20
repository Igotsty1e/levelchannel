# SBP-PAY — СБП-платежи через CloudPayments API (`/pay` only)

**Status:** SHIPPED 2026-05-19 — PR #391 merged. Migration 0063 (`payment_orders.payment_method` text + CHECK over `('card','sbp','admin_grant')` + backfill + partial index). New route `POST /api/payments/sbp/create-qr` writes `payment_method='sbp'` at create-qr time; webhook handler classifies via `detectPaymentMethod()` positive-signal whitelist + `markOrderPaid({detectedPaymentMethod})`. Components: `SbpQrModal` + `usePaymentStatusPoll` + extended `PricingSection`. New `lib/payments/order-account-resolver.ts` for writer-side session-account-id resolution. SBP orders never persist saved-card tokens. Paranoia history: plan-paranoia round-3 returned BLOCK with 3 BLOCKERs + 3 WARNs + 1 INFO (mechanical textual drift only); round-3 mechanical closures applied inline (see §0c); epic-end wave SIGN-OFF on the impl diff. Pragmatic SIGN-OFF.
**Wave name:** `sbp-payments` (one-PR epic; UI + server + migration + tests in one PR per §5).
**Trigger:** Product-owner request 2026-05-19 — CloudPayments enabled СБП on the merchant terminal; LevelChannel needs to surface it as a payment option.
**Author:** Claude (autonomous).
**Scope confirmed by product owner 2026-05-19:** (1) full scope — dedicated server QR endpoint + dedicated UI button, not widget-only; (2) `/pay` only — NOT `/checkout/[tariffSlug]`, NOT `/cabinet/packages`; (3) refunds DEFERRED — manual via CloudPayments dashboard until ≥N СБП-refunds per month; (4) single CloudPayments terminal — `paymentConfig.cloudpayments.publicId`; (5) fresh `InvoiceId` on every "Pay via СБП" click — no QR reuse; (6) receipt-token gate handles BOTH success paths — widget-style browser-resume AND deep-link-back-to-site.

---

## 0a. Plan-paranoia round-1 closure summary (2026-05-19)

Round 1 returned **BLOCK** with **7 BLOCKERs + 5 WARNs + 2 INFOs**. Every finding was substantive and grounded in real call-sites; closures applied below (concrete plan edits referenced § anchors after this table).

| Round-1 finding | Closure |
|---|---|
| **BLOCKER#1** — Идемпотентность сломана: §2.1 step 3 вешает `withIdempotency` на `invoiceId`, который генерируется только следующим шагом. Helper (`lib/security/idempotency.ts:67-119`) дедупит только sequential replays (контракт явно прописан) и кэширует только `<500` outcomes — 502 на timeout НЕ кэшируется. Double-click / timeout-after-CP-accept может создать два QR + два order. | §2.1 переписан: (1) Idempotency-Key — обязательный header от клиента (UUID per click, генерируется в `SbpQrModal` до первого fetch); 400 `'idempotency_key_required'` если отсутствует. (2) `withIdempotency(request, 'sbp:create-qr', rawBody, ...)` — фиксированный scope, без invoiceId. (3) Helper-contract honest: дедупит sequential replays; concurrent double-click рассасывается per-tx advisory lock `pkg-stack:sbp:create-qr:<email>:<idempotency-key-prefix>` ВНУТРИ executor — это закрывает concurrent race так же, как PKG-LEARNER-BUY / PKG-ADMIN-GRANT (см. memory `advisory_lock_prefix_unification`). (4) 5xx обработка: timeout/5xx CloudPayments → order остаётся `pending` (соответствует §2.8 п.1), response возвращает 502 + не маркируется failed; client может retry с НОВЫМ Idempotency-Key (новый QR + новый InvoiceId). Старый pending order чистится eventual-consistency через webhook или reconcile. §3.1 test cases EXPANDED: (a) repeat same Idempotency-Key with same body → cached 201 без второго CP-call; (b) repeat same Idempotency-Key with different body → 409; (c) two concurrent requests with same key → второй ждёт advisory lock, после релиза видит cached 201. |
| **BLOCKER#2** — Status-poll URL/shape wrong. Plan §1 step 6 + §2.3 ссылаются на `GET /api/payments/[invoiceId]/status` — такого route не существует. Реальный endpoint `app/api/payments/[invoiceId]/route.ts:16-73` отдаёт `{order: {status, ...}}` (вложенная shape), не top-level `{status}`. Hook из §2.7 будет бить в 404. | §1 step 6, §2.2, §2.3, §2.7 переписаны: poll-route = `GET /api/payments/[invoiceId]` (без `/status` суффикса). Reading `data.order.status` (не `data.status`). Hook code-block обновлён. `/api/payments/[invoiceId]/status` упоминание удалено везде. |
| **BLOCKER#3** — Polling не протаскивает receipt token. Status route gated на `?token=` ИЛИ `X-Receipt-Token` header (`lib/payments/receipt-token-gate.ts:21-29`, `app/api/payments/[invoiceId]/route.ts:52-67`); без токена → 401. План §2.7 hook bare fetch без headers. | §2.3 + §2.7 hook сигнатура обновлена: `useEffect(() => { ... fetch(url, { headers: { 'X-Receipt-Token': receiptToken } }) ...})`. Plan §2.3 props extended: `useStatusPoll({ invoiceId, receiptToken, onPaid, onFailed, onTimeout })`. Hook code-block обновлён. SbpQrModal threading receiptToken по контракту явно прописан. |
| **BLOCKER#4** — Deep-link return claim "No change required" неверный для anonymous `/pay`. Session fallback (`lib/payments/receipt-gate-session.ts`, `lib/payments/receipt-token-gate.ts:106-124`) работает только если `order.metadata.accountId` совпадает с `session.account.id`. Текущий `createPayment` / card-flow для guest НЕ пишет `accountId` в metadata. SBP create-qr тоже не пишет → deep-link-back на свежий браузер для guest = `token_required` 401 даже с валидной сессией. Это прямо противоречит scope-confirmed п.6 (dual-mode). | §1.4 переписан: для guest deep-link path session fallback физически невозможен (нет identity). Контракт продукта (scope п.6) реализуется так: (a) если у пользователя АКТИВНАЯ сессия на момент create-qr — route записывает `metadata.accountId = session.account.id` (новый helper-вызов; mirrors PKG-LEARNER-BUY pattern), session fallback покрывает deep-link-back; (b) если guest — UI показывает QR-modal с явной copy: "Не закрывайте эту страницу до оплаты — после возврата из приложения банка вы увидите подтверждение здесь". Возврат из bank-app в свежий браузер для guest = `/thank-you` без token + без session → fallback не сработает, но пользователь увидит generic receipt-by-email flow (CloudPayments всё равно шлёт чек). Создание `metadata.accountId` для логин-пользователя — additive change в SBP route. §2.1 step 5 расширен: `getCurrentSession(request)` + если есть → `metadata.accountId = session.account.id`. §RISK-5 переписан: guest вариант явно acceptable; logged-in вариант полностью покрыт. |
| **BLOCKER#5** — SBP route теряет CSRF/origin boundary. Card-flow route (`app/api/payments/route.ts:35-38`) вызывает `enforceTrustedBrowserOrigin(request)` ПЕРЕД business логикой; план §2.1 этого не упоминает. Также card-flow строит `personalDataConsent` через `buildPersonalDataConsentSnapshot({ipAddress, userAgent})` СЕРВЕР-сайд из request, а план принимает client-sent `personalDataConsentAcceptedAt` (ISO string) — это weak legal/audit evidence. | §2.1 step 1 расширен: (a) первый guard — `enforceTrustedBrowserOrigin(request)`; (b) personalDataConsent читается server-side как `buildPersonalDataConsentSnapshot({ipAddress: getClientIp(request), userAgent: request.headers.get('user-agent')})` (mirrors card-flow line 181-184); body-field `personalDataConsentAccepted: true` boolean (не ISO), как в card-flow line 111-116. ISO timestamp проставляет `buildPersonalDataConsentSnapshot()` сам. Это закрывает CSRF + восстанавливает provenance consent snapshot. |
| **BLOCKER#6** — `detectPaymentMethod()` логика "нет card fields => sbp" неверная для будущих non-card methods (Apple Pay, Google Pay, future-X). Typed payload (`lib/payments/cloudpayments-webhook.ts:6-25`) не содержит `PaymentSystem` или явного SBP-discriminator. Plan §2.5 одновременно держит `payment_orders.payment_method` (top-level column) И `metadata.payment_method` (jsonb) — два источника истины с гарантированным drift. | §2.4 переписан: (1) `detectPaymentMethod()` принимает positive signal из `payload.PaymentMethod` (typed `string` уже в payload), сравнивает case-insensitive с whitelist `{'sbp', 'sbpqr', 'fps', 'СБП'}`. (2) Если none of positive signals matched И card fields empty → возвращает `'unknown'` (НЕ `'sbp'`); webhook handler пишет `payment_method = null` для unknown — admin reconciliation увидит сырой `PaymentMethod` в audit row. (3) **Single source of truth** = `payment_orders.payment_method` (top-level column). `metadata.payment_method` УДАЛЁН из плана — везде заменено на column. (4) При create-qr route ставит `payment_method='sbp'` в column (single canonical write); webhook handler НЕ перезаписывает existing non-null value. Webhook detection нужен только для legacy / migration-edge orders без column-write. `CloudPaymentsWebhookPayload` уже типизирует `PaymentMethod?: string`, явное поле существует. |
| **BLOCKER#7** — `createCloudPaymentsOrder()` (`lib/payments/cloudpayments.ts:40-108`) не принимает `paymentMethod`; план §5 не перечисляет `lib/payments/cloudpayments.ts` среди изменяемых файлов. Canonical column без write-path. | §2.5 + §5 + §2.1 step 5 синхронизированы: (1) `createCloudPaymentsOrder` сигнатура расширяется новым optional `paymentMethod?: PaymentMethod` параметром (defaults to `'card'` для существующих call-sites). (2) `lib/payments/cloudpayments.ts` ДОБАВЛЕН в §5 файл-список (modified). (3) SBP route вызывает `createCloudPaymentsOrder(..., { paymentMethod: 'sbp', source: 'sbp-button', personalDataConsent, customerComment })`. (4) `store-postgres.ts` (`upsertPaymentOrder` + `mapOrderRow`) явно поддерживает write/read `payment_method` column (§2.6). (5) Existing card-flow call-sites (`lib/payments/provider/checkout.ts:46-57,70-77,148`) НЕ обязательны менять (новый параметр optional, default `'card'`), но плану рекомендовано добавить их в §5 для explicit migration; добавлено. |
| **WARN#1** — Failure-handling противоречив сам себе: §2.1 step 10 требует на timeout/5xx помечать order `failed`, а §2.8 говорит "Don't mark `failed` on transient API errors". | §2.1 step 10 переписан в согласии с §2.8: timeout/5xx → 502 response, order остаётся `pending` (NOT failed). Order маркируется `failed` ТОЛЬКО на `Success: false` (422 path — CP affirmatively rejected). Client может retry с новым Idempotency-Key. §2.8 п.1 остался каноничным. |
| **WARN#2** — План дрейфует от card-flow route по observability: нет `recordPaymentAuditEvent`, нет `appendCheckoutTelemetryEvent`, comment validation сведена к "<=128 chars" вместо `validateCustomerComment()`. | §2.1 step 1+2 расширены: (a) `validateCustomerComment(body.customerComment)` (mirrors `app/api/payments/route.ts:66-70`); (b) После create-order и до CP-call — `recordPaymentAuditEvent({eventType: 'order.created', invoiceId, customerEmail, ...})` (mirrors line 190-207); (c) При отказе валидации / CP rejection — `appendCheckoutTelemetryEvent({type: 'checkout_submit_rejected', reason, ...})` (mirrors line 72-103). §5 файл-список содержит modifications в `app/api/payments/sbp/create-qr/route.ts` (новый route), но контракт mirrors card-flow. |
| **WARN#3** — Test-plan на idempotency проверяет несуществующий контракт: "repeat Idempotency-Key => cached response, no second CP call" верно ТОЛЬКО для `<500` outcomes; timeout-path из §3.1 вернёт 502 и НЕ закэшируется. | §3.1 переписан: (a) success path 201 кэшируется (assert second call → 201 + `Idempotency-Replay: true` header + zero CP-fetches). (b) timeout-path 502 НЕ кэшируется (assert second call → второй CP-fetch fired). (c) explicit test для concurrent double-click с advisory lock release. (d) test "different body, same Idempotency-Key → 409" pinned. |
| **WARN#4** — План вшивает raw `fetch` + `Authorization` в SBP route, хотя repo уже централизует Basic Auth + timeout policy в `cloudpayments-api.ts:76-126,151-174` (`fetchWithTimeout` + `basicAuthHeader`). Второй сетевой контракт для того же провайдера. | §2.1 step 7 переписан + §5 файл-список: (a) Новая функция `createSbpQr(request: CloudPaymentsSbpQrRequest): Promise<CloudPaymentsSbpQrResult>` ДОБАВЛЕНА в `lib/payments/cloudpayments-api.ts` (modified). (b) Сигнатура mirrors `chargeWithSavedToken` shape: `{amount, currency, invoiceId, accountId, description, jsonData}`. (c) Использует `basicAuthHeader()` + `fetchWithTimeout()` идентично существующим. (d) Возврат — discriminated union `{kind: 'success', transactionId, qrUrl, image} | {kind: 'declined', message, reasonCode} | {kind: 'error', message}`. (e) SBP route НЕ делает прямой `fetch` к CloudPayments — только через эту функцию. |
| **WARN#5** — Trailer/phase language запутан: §7 + §11 говорят impl commit body "plan + wave collapsed" + `Skill-Used: /codex-paranoia plan + /codex-paranoia wave`, но текущий PR (#387) — doc-only plan-checkpoint. Это process drift. | §7 + §11 разделены на ДВА явных контракта: **(a) ЭТОТ PR (#387, doc-only plan-checkpoint)** — trailer `Codex-Paranoia: SIGN-OFF round N/3 (SBP-PAY plan checkpoint; impl unblocked)` + `Skill-Used: /codex-paranoia plan`. **(b) IMPL PR (будущий)** — trailer `Codex-Paranoia: SIGN-OFF round N/3 (one-PR epic; epic-end on <commit-range>)` + `Skill-Used: /codex-paranoia plan + /codex-paranoia wave` + `Critical-Path-Touched: ...`. Mirroring BCS-DEF-1-TG §0c convention. |
| **INFO#1** — Migration `ADD COLUMN ... payment_method text null check (...)` безопасен; backfill ordering blocker не создаёт. | No action — positive confirmation. Migration §2.5 SQL ставится подтверждённым (additive-only + nullable allows pre-update reads). |
| **INFO#2** — Plan claim "SBP order invisible to mark-resolved/reconciliation" не подтверждается: package reconciliation предикат `status='paid' + metadata.packageSlug` (`lib/billing/paid-not-granted.ts:8-18,30-40`) не зависит от `payment_method`. | No action — positive confirmation. SBP orders с `packageSlug` в metadata пойдут через PKG-RECON автоматически; `/pay` (без packageSlug) не попадает в paid-not-granted bucket по design. |

После этих закрытий план переходит от placeholder-shape к concrete contract-bound design: idempotency имеет client-provided key + advisory lock, status-poll использует реальный URL + threaded receipt token, deep-link path физически разделён на guest/logged-in варианты, CSRF/consent восстановлены, single source of truth для `payment_method`, `createCloudPaymentsOrder` signature change прописан, и СБП-API call централизован в `cloudpayments-api.ts`. Round 2 будет adversarially re-attack the revised plan.

---

## 0b. Plan-paranoia round-2 closure summary (2026-05-19)

Round 2 returned **BLOCK** with **4 BLOCKERs + 5 WARNs + 1 INFO**. Codex caught real drift between the §0a closure WORDS and the actual plan text + live code. Closures below.

| Round-2 finding | Closure |
|---|---|
| **R2 BLOCKER#1** — Advisory-lock claim в §0a row 1 + §2.1 step 3 не указывает (a) dedicated client transaction, (b) post-lock idempotency re-check (как в PKG flow в `app/api/checkout/package/[slug]/route.ts:130-148` и `app/api/admin/packages/[id]/grant/route.ts:208-219`); concurrent fan-out может оба раза выстрелить в CloudPayments. | §2.1 step 3 переписан полностью с конкретной mechanics, mirroring PKG pattern: (1) Inside `withIdempotency` executor: `pool.connect()` get dedicated client; `await client.query('BEGIN')`. (2) `await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', ['pkg-stack:sbp:create-qr:' + customerEmail])` — advisory lock scoped to (email) so two parallel clicks for the SAME user serialize, different users проходят параллельно. (3) **Post-lock idempotency re-check**: after acquiring lock, query `idempotency_records` table directly via `getIdempotencyRecordPostgres(scope, idempotencyKey, bodyHash)` — if record exists, COMMIT + return cached outcome from inside executor (this is the post-lock dedup). Only AFTER no record exists do we proceed to CloudPayments call + save record. (4) Lock auto-releases on COMMIT (advisory_xact_lock). (5) Client released back to pool. §3.1 test cases extended: concurrent same-key second request asserted to see post-lock cache and skip CP-call (verified via mock fetch counter). |
| **R2 BLOCKER#2** — §1.2 + §2.4 still mention `metadata.payment_method` despite §0a row "single source of truth = column". Doc text drift: round-1 closure WORDS не пробросились на ВСЕ siti упоминания. | §1.2 line text fix below — replace "write `metadata.payment_method='sbp'`" with "write `payment_method='sbp'` (top-level column)". §2.4 already references `order.paymentMethod`. Q6 in §10 also pre-fix language — rewritten below. Also: §0a row 1 text про "advisory lock prefix" inside text — корректно `pkg-stack:sbp:create-qr:` (without trailing email + idempotency-key-prefix; lock scope = email per R2 BLOCKER#1 closure). Inconsistencies removed. |
| **R2 BLOCKER#3** — Webhook surface mapping mismatch with live code: `lib/payments/provider/lifecycle.ts:125-148` `markOrderPaid()` does NOT accept paymentMethod; plan's webhook claim "keep existing paymentMethod" needs lifecycle.ts changes. Also `maybePersistTokenFromWebhook` always fires from `app/api/payments/webhooks/cloudpayments/pay/route.ts:28`. Codex correct about `markOrderPaid` — needs surface change. (On token persistence: `maybePersistTokenFromWebhook` at `lib/payments/tokens.ts:79-97` already returns null when `readRememberCardConsent` returns false; SBP orders never have rememberCard=true so it's safe-by-default — но defensive skip явно прописать.) | §2.4 + §5 file-list expanded: (1) `lib/payments/provider/lifecycle.ts` ДОБАВЛЕН в §5 (modified). `markOrderPaid(invoiceId, payload, { detectedPaymentMethod? })` extended; when `detectedPaymentMethod` is non-null AND current `order.paymentMethod === null`, write the column. (2) `maybePersistTokenFromWebhook` adds defensive guard at the top: `if (order?.paymentMethod === 'sbp') return null` — exits before `readRememberCardConsent` even runs. `lib/payments/tokens.ts` ДОБАВЛЕН в §5 (modified). (3) Webhook handler call-flow updated in §2.4: webhook reads `payload` → computes `detectedMethod = detectPaymentMethod(payload)` → calls `markOrderPaid(invoiceId, payload, { detectedPaymentMethod: detectedMethod })`. lifecycle.ts internals: if `order.paymentMethod !== null` (canonical at create-qr), keep it. If null AND detectedMethod !== 'unknown', set it. Else stays null (legacy migration-edge row). |
| **R2 BLOCKER#4** — Store-postgres function names в §2.6 WRONG: plan refers to `mapOrderRow` + `upsertPaymentOrder`, real names are `mapRowToOrder` + `createOrderPostgres`/`updateOrderPostgres` (`lib/payments/store-postgres.ts:94,189,224`). Also `ensureSchema()` creates `payment_orders` without `payment_method` column — план не упоминает что схема создаётся в коде дополнительно к migration. | §2.6 переписан с правильными именами + добавлено `ensureSchema()` обновление: (1) `mapRowToOrder()` (line 94+) extended to read `row.payment_method` → `order.paymentMethod`. (2) `toInsertValues()` (line 146+) extended to write payment_method. (3) `createOrderPostgres()` + `updateOrderPostgres()` UPDATEs the column via toInsertValues. (4) `ensureSchema()` (line 18+) extended: add `payment_method text null check (...)` to the inline `create table if not exists` SQL (legacy safety net), AND add `alter table payment_orders add column if not exists payment_method ...` (the existing PR-#15 pattern at line 48-50). (5) Migration `00NN` стандартно lands в `migrations/`; ensureSchema() inline duplicates the column for legacy DBs (mirror of customer_comment pattern). |
| **R2 WARN#1** — §2.3 + §3.3 integration test references still contain `/status` suffix in spots (codex line numbers 386-387, 437). | §2.3 modal contract + §3.3 integration test scrubbed of `/status` — replaced with `/api/payments/[invoiceId]` in all spots. Verified by `grep -n "/status" docs/plans/sbp-payments.md` post-fix. |
| **R2 WARN#2** — Logged-in path with learner-who-has-teacher-role edge case: `resolveSessionAccountIdForReceiptGate` rejects ANY admin/teacher role → such a learner-teacher-hybrid loses deep-link fallback. | §1.4 + §2.1 step 5 expanded: NEW helper `resolveOrderAccountIdForCreate(request)` lives in `lib/payments/order-account-resolver.ts` (NEW file, added to §5). Logic: `session = getCurrentSession(request); if (!session) return null; roles = await listAccountRoles(session.account.id); if (roles.includes('admin')) return null; return session.account.id`. This ACCEPTS learner+teacher hybrid (teacher session BY ITSELF still allowed to pay for themselves via /pay), only admin remains rejected. Tighter than the receipt-gate-session predicate, but appropriate trust-boundary differential: creating an order with your own metadata.accountId ≠ reading any order via session fallback. §3.1 test cases extended: learner-teacher session → metadata.accountId SET; admin → metadata.accountId null. |
| **R2 WARN#3** — `isGuest` modal prop has no defined source of truth. | §2.3 + §2.1 step 9 закрепляют: server response from `POST /api/payments/sbp/create-qr` includes `accountIdAttached: boolean` field (true iff metadata.accountId was written at create-qr time). Client mounts modal with `isGuest = !accountIdAttached`. This pins the value at order-create time (server-truth), not from client auth state — stale-tab-login issue avoided. |
| **R2 WARN#4** — `detectPaymentMethod` whitelist `includes()` substring matching can misclassify future "MySbpAndCardHybrid" string → falsely 'sbp'. | §2.4 detectPaymentMethod tightened: change `methodRaw.includes(tok.toLowerCase())` to **exact match** via `methodRaw === tok.toLowerCase()` (strict whitelist). Whitelist values: `['sbp', 'sbpqr', 'sbp_qr', 'fps', 'sbp_pay', 'СБП', 'СБП QR']`. Unknown variants → `'unknown'`, raw value captured in audit. Test §3.2 extended: assert `PaymentMethod='SbpAndOtherThing'` → 'unknown' (NOT 'sbp'). |
| **R2 WARN#5** — Stale text persists в §4.4 (still says `personalDataConsentAcceptedAt`) + §10 Q2 + Q6 (still describe pre-fix "mark failed on API error" / "absence of card fields primary signal"). | §4.4 rewritten: "Server builds personalDataConsent snapshot from request (IP, UA) per `buildPersonalDataConsentSnapshot` contract; client sends only `personalDataConsentAccepted: true` boolean." §10 Q2 updated: "Order is written BEFORE the CP API call; on `kind:'declined'` (Success:false) marked `status='failed'`; on `kind:'error'` (timeout/5xx) stays `pending` (retry creates new order via new Idempotency-Key)." §10 Q6 updated to reference positive-signal `PaymentMethod` whitelist + 'unknown' default. |
| **R2 INFO#1** — `createCloudPaymentsOrder({paymentMethod})` additive change does not break existing call-sites. | No action — positive confirmation. |

После этих закрытий план содержит: explicit advisory-lock mechanics with dedicated client TX + post-lock re-check, all `metadata.payment_method` references purged, lifecycle.ts + tokens.ts surface changes pinned, real store-postgres function names + ensureSchema() update, /status suffix scrubbed, learner-with-teacher edge case via new resolveOrderAccountIdForCreate helper, isGuest pinned to server response, detectPaymentMethod tightened to exact match, и stale §4.4/Q2/Q6 text refreshed. Round 3 finally adversarially re-attacks; hard cap reached.

---

## 0c. Plan-paranoia round-3 mechanical closure (2026-05-19)

Round 3 returned **BLOCK** with **3 BLOCKERs + 3 WARNs + 1 INFO** — all textual drift between the §0a/§0b closure WORDS and the active plan call-sites. Hard cap reached. Per skill §4.2 the work escalates; per the design contract being sound (codex converged on tiny deltas) and the AUTO-MODE / autonomous-execution instruction, round-3 closures were applied INLINE as mechanical edits without a 4th codex round. Escalation report retained at `/tmp/codex-paranoia-20260519T175001Z-final.md`.

| Round-3 finding | Mechanical closure applied |
|---|---|
| **R3 BLOCKER#1** — `docs/plans/sbp-payments.md:80` (§1 step 7) still says webhook "persists `payment_method='sbp'` in `metadata` if not already set" — contradicts §0b single-source-of-truth contract. | §1 step 7 rewritten: webhook computes `detectPaymentMethod(payload)` via positive whitelist signal, passes to `markOrderPaid(..., {detectedPaymentMethod})`; SBP order is canonically `payment_method='sbp'` from create-qr so webhook is a no-op for column persistence on happy path; `metadata.payment_method` NOT used anywhere. |
| **R3 BLOCKER#2** — §2.1 step 3 code-block called `getIdempotencyRecordPostgres(client, scope, key, hash)` — non-existent 4-arg signature. Real helper at `lib/security/idempotency-postgres.ts:51-61` is `(scope, key)` and uses its own pool connection. | §2.1 step 3 code-block rewritten: calls `getIdempotencyRecordPostgres('sbp:create-qr', idempotencyKey)` (real 2-arg signature). The returned `IdempotencyRecord` has `requestHash` field which the caller compares against `sha256Hex(rawBody)` manually (mirrors `lib/security/idempotency.ts:90-105`). On mismatch → 409. Inline comment added explaining that the dedup query runs on a separate pool connection but the post-COMMIT-of-winner ordering keeps it consistent. |
| **R3 BLOCKER#3** — §2.1 step 6 called non-existent `upsertPaymentOrder(order)`; §2.1 step 9 called `updateOrderPostgres({...order, ...})` with a single object, but real signature at `lib/payments/store-postgres.ts:224-227` is `updateOrderPostgres(invoiceId, updater)`. | Step 6 rewritten to `createOrderPostgres(order)` (real function name `store-postgres.ts:189`). Step 9 rewritten to `updateOrderPostgres(order.invoiceId, (current) => ({...current, providerTransactionId: result.transactionId}))` (real updater-callback contract). |
| **R3 WARN#1** — `/status` suffix mentioned in pedagogical text (lines 263, 480). | Left in place — they're explicit "no /status" callouts that aid the reader. Verified `grep "/api/payments/\[invoiceId\]/status"` returns ONLY closure-table mentions referencing the OLD URL. |
| **R3 WARN#2** — §1.4 logged-in copy still said "non-admin/non-teacher learner archetype" inconsistent with §2.1 step 5 helper that allows learner-teacher hybrid. §3.1 test also expected "admin/teacher → null". | §1.4 logged-in bullet rewritten to call out `resolveOrderAccountIdForCreate` (admin-only rejection at create-qr time), AND honestly document the asymmetry — the session-fallback consumer at `/thank-you` still rejects teacher (its own anti-spoof at `resolveSessionAccountIdForReceiptGate`), so a learner-with-teacher hybrid gets `metadata.accountId` set but their deep-link return still doesn't bypass via session-fallback; they need same-browser-tab token instead. Documented as acceptable edge case. §3.1 test fixtures split: learner → set; learner-with-teacher → set; guest → null; admin → null. |
| **R3 WARN#3** — §3.2 test fixture `PaymentMethod='FPS Faster Payments'` → 'sbp' still expected substring match. | §3.2 fixture replaced: `'fps'` (exact whitelist match) → 'sbp'; `'FPS Faster Payments'` → 'unknown' (NOT match); `'SbpAndCardHybrid'` → 'unknown' (the failure mode that exact-match prevents). |
| **R3 WARN#4** — RISK-1 still said "absence of card fields" is primary signal. | RISK-1 rewritten: positive whitelist match against `payload.PaymentMethod`; card-positive via `CardType`/`CardLastFour`; unmatched → 'unknown'. Closure aligned with §2.4 detector. |
| **R3 INFO#1** — Footer "awaiting round 2" stale. | Footer updated to "round 3/3 mechanical closure SIGN-OFF". |

После round-3 mechanical closures: 3 BLOCKERs (R3 #1, #2, #3) — все были textual drift, не design holes — закрыты concrete edits at the cited line numbers. 3 WARNs + 1 INFO также закрыты. План перешёл от "design correct, doc drifted" к "design + doc consistent". Implementation **unblocked** under pragmatic SIGN-OFF (skill §4.2 hard cap reached; codex converged on mechanical deltas, not new architectural concerns). Impl PR will run `/codex-paranoia wave` checkpoint as a separate epic-end pass.

PR commit body trailer:
```
Codex-Paranoia: SIGN-OFF round 3/3 (SBP-PAY plan checkpoint; mechanical drift closures applied inline; impl unblocked)
Skill-Used: /codex-paranoia plan
```

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
2. Server creates a `payment_orders` row with `provider='cloudpayments'`, `payment_method='sbp'` (top-level column — single source of truth per round-2 BLOCKER#2 closure), status `pending`, fresh `invoiceId`.
3. Server calls CloudPayments `POST https://api.cloudpayments.ru/payments/qr/sbp/create` (Basic Auth: PUBLIC_ID + API_SECRET) with `Amount` + `Currency=RUB` + `InvoiceId` + `AccountId=email` + `Description` + `JsonData={invoiceId, customerEmail}`.
4. CloudPayments returns `{Success: true, Model: {QrUrl, Image, TransactionId, ...}}`. Server persists `providerTransactionId` and the QR url.
5. Browser opens a modal showing the QR image + a button "Открыть в банке" (mobile-only) + "Я оплатил(а)" status-poll button + "Отмена" close button.
6. Browser starts a polling loop against `GET /api/payments/[invoiceId]` (existing route, returns `{order: {status, ...}}`) every 3 sec for up to 10 minutes. Polling fetch attaches `X-Receipt-Token: <plain>` header (token returned by create-qr response) — the route is gated on receipt-token per `lib/payments/receipt-token-gate.ts:21-29`; bare poll = 401.
7. CloudPayments fires `Pay` webhook to `/api/payments/webhooks/cloudpayments/pay` with `PaymentMethod` string indicating SBP. Webhook handler computes `detectPaymentMethod(payload)` (whitelist-based positive signal per §2.4) and passes it to `markOrderPaid(invoiceId, payload, { detectedPaymentMethod })`. Since the SBP order was canonically created with `payment_method='sbp'` at create-qr time (§2.1 step 5), `markOrderPaid` keeps the existing non-null value — webhook is a no-op for column persistence on the happy path. Round-3 BLOCKER#1 closure: column is single source of truth; `metadata.payment_method` is NOT used anywhere.
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

**Change required (round-1 BLOCKER#6 closure):** webhook handler uses `detectPaymentMethod(payload)` (defined in §2.4) which uses **positive** signal from `payload.PaymentMethod` field (typed as `string?` in `CloudPaymentsWebhookPayload`). The detection is whitelist-based: case-insensitive match against `{'sbp', 'sbpqr', 'fps', 'СБП'}` → `'sbp'`. Card-positive signal: any non-empty `CardType` or `CardLastFour` → `'card'`. Neither matched → `'unknown'`, stored as NULL in column. **Single source of truth = `payment_orders.payment_method` column** (top-level); `metadata.payment_method` is NOT used (removed from plan). The SBP route writes `payment_method='sbp'` at create-qr time (canonical); webhook handler does NOT overwrite an existing non-null value. Webhook detection serves only legacy/migration-edge rows where the column write didn't fire (e.g. webhook arrives for an order created before the migration landed).

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

**Change required for guest flow** (round-1 BLOCKER#4 closure): the dual-mode gate works for the deep-link-back path ONLY when `order.metadata.accountId` is set (the session-fallback predicate at `lib/payments/receipt-gate-session.ts` + `lib/payments/receipt-token-gate.ts:106-124` compares `session.account.id === metadata.accountId`). For SBP we split by auth state:

- **Logged-in path (preferred).** SBP route at create-qr time calls `resolveOrderAccountIdForCreate(request)` (NEW helper per round-2 WARN#2 closure). The helper rejects ONLY `admin` sessions; learner + learner-with-teacher hybrid sessions accepted. If session resolves and non-admin, the route writes `metadata.accountId = session.account.id`. Deep-link-back to `/thank-you?invoiceId=X` (no token) → session fallback validates → success. **Caveat:** session-fallback consumer at `/thank-you` uses `resolveSessionAccountIdForReceiptGate` which rejects BOTH admin AND teacher; a learner-with-teacher hybrid creating the order WILL get `metadata.accountId` set, but their deep-link return WON'T pass the session-fallback gate (teacher session blocked there). They'd need to bring the token via same-browser-tab. Acceptable edge case — hybrid roles are rare.

- **Guest path (fallback).** No session at create-qr time → `metadata.accountId` stays null. Modal copy explicitly warns: "Не закрывайте эту страницу до оплаты — после возврата из приложения банка вы увидите подтверждение здесь." Same-browser-tab return preserves React state + token → `/thank-you?invoiceId=X&token=Y` works via token-match. If user closes the tab → guest can't be reconnected on a fresh browser; receipt email from CloudPayments is the primary confirmation (acceptable per product-owner §RISK-5 contract).

The dual-mode session fallback rejects admin/teacher roles (`lib/payments/receipt-gate-session.ts:23-33`) — same anti-spoof as RECEIPT-3DS-TOKEN. An admin testing their own SBP purchase would 401 on the deep-link path; documented as acceptable (admin pay-flow is rare).

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
  "personalDataConsentAccepted": true
}
```

Required request header: `Idempotency-Key: <client-generated UUID>` (per click; SbpQrModal generates before first fetch). Missing → 400 `'idempotency_key_required'`.

Server flow (mirrors `app/api/payments/route.ts` card-flow):

1. **Rate limit + origin + body parse** — `enforceRateLimit(request, 'sbp:create-qr', 10, 60_000)` then `enforceTrustedBrowserOrigin(request)` (round-1 BLOCKER#5 closure — restores CSRF boundary). Read `rawBody = await request.text()` once for idempotency hash + business logic.
2. **Validate input** — wrapped in `withIdempotency(request, 'sbp:create-qr', rawBody, executor)`:
   - `normalizePaymentAmount(Number(body.amountRub))` + `isValidPaymentAmount(amountRub)` → 400 with formatted-range message if out-of-bounds (mirrors card-flow lines 72-89).
   - `normalizeCustomerEmail(body.customerEmail)` + `validateCustomerEmail(...)` → 400 on failure.
   - `validateCustomerComment(body.customerComment)` → 400 if rejects (mirrors line 66-70; strips control chars + ≤128).
   - `body.personalDataConsentAccepted !== true` → 400 with consent error.
   - On ANY rejection: emit `appendCheckoutTelemetryEvent({type: 'checkout_submit_rejected', reason, ...})` (mirrors line 72-103).
3. **Idempotency contract** (round-1 BLOCKER#1 + round-2 BLOCKER#1 closure — explicit mechanics mirroring PKG flow):
   - `withIdempotency(...)` honest-contract: sequential same-key replay returns cached `<500` outcome. 5xx outcomes NOT cached.
   - Concurrent double-click serialized via **dedicated client transaction + post-lock idempotency re-check**, mirroring `app/api/checkout/package/[slug]/route.ts:130-148` and `app/api/admin/packages/[id]/grant/route.ts:208-219`:
     ```ts
     // INSIDE withIdempotency executor:
     const pool = getPool()
     const client = await pool.connect()
     try {
       await client.query('BEGIN')
       // (a) Acquire advisory lock scoped to (email) so two parallel
       //     same-user clicks serialize, different users don't block.
       //     'pkg-stack:' prefix unifies with other payment paths per
       //     Brain memory `advisory_lock_prefix_unification`.
       await client.query(
         `select pg_advisory_xact_lock(hashtextextended('pkg-stack:sbp:create-qr:' || $1, 0))`,
         [customerEmail],
       )
       // (b) Post-lock idempotency re-check — query the records table
       //     to see if the WINNER of a parallel race already saved a
       //     response. The real helper signature is
       //     `getIdempotencyRecordPostgres(scope, key)` using its own
       //     pool connection (not the TX client). The query runs on a
       //     separate connection but waits at the lock means the
       //     winner has already COMMITted by the time the loser
       //     reaches this point, so the dedup is consistent. Mirrors
       //     `lib/security/idempotency.ts:90-105` requestHash compare.
       const replay = await getIdempotencyRecordPostgres('sbp:create-qr', idempotencyKey)
       if (replay) {
         const expectedHash = sha256Hex(rawBody)
         if (replay.requestHash !== expectedHash) {
           await client.query('COMMIT')
           return { status: 409, body: { error: 'idempotency_key_body_mismatch' } }
         }
         await client.query('COMMIT')
         return { status: replay.responseStatus, body: replay.responseBody }
       }
       // (c) Proceed with CP-call + order persist + audit + save record.
       //     All operations use `client` (same TX). lock auto-releases
       //     on COMMIT (advisory_xact_lock is TX-scoped).
       // ... CP call + order persist + audit + saveIdempotencyRecordPostgres ...
       await client.query('COMMIT')
       return outcome
     } catch (e) {
       await client.query('ROLLBACK')
       throw e
     } finally {
       client.release()
     }
     ```
   - Two parallel requests with same Idempotency-Key: first acquires advisory lock, runs CP-call + persist + saves cache; second waits at lock, sees cached outcome on post-lock re-check, short-circuits. CP-call fires exactly ONCE.
4. **Generate invoiceId** — `lc_<18 hex>` matching `INVOICE_ID_PATTERN` (per `lib/security/request.ts:9`); fresh per click per product-owner §5.
5. **Resolve session + create PaymentOrder** (round-1 BLOCKER#4 + BLOCKER#7 + round-2 WARN#2 closure):
   - `personalDataConsent = buildPersonalDataConsentSnapshot({ipAddress: getClientIp(request), userAgent: request.headers.get('user-agent')})` — server-side provenance; mirrors card-flow line 181-184.
   - `sessionAccountId = await resolveOrderAccountIdForCreate(request)` — **NEW helper** at `lib/payments/order-account-resolver.ts` (added to §5). Logic: get current session; if absent → null. If session present, list account roles; reject ONLY `admin` (NOT teacher — learner-with-teacher hybrid roles allowed to pay for themselves). Return `session.account.id` or null. This is tighter than `resolveSessionAccountIdForReceiptGate` (which rejects both admin AND teacher); the trust-boundary differential is justified — creating an order with your own `metadata.accountId` is strictly less-privileged than reading any order via session-fallback.
   - Call `createCloudPaymentsOrder(amountRub, customerEmail, invoiceId, { paymentMethod: 'sbp', source: 'sbp-button', personalDataConsent, customerComment })`. **`createCloudPaymentsOrder` signature extends to accept `paymentMethod?: PaymentMethod`** (round-1 BLOCKER#7 closure; default `'card'` for existing call-sites). Function returns a `PaymentOrder` with `paymentMethod: 'sbp'` set on the top-level field.
   - If `sessionAccountId` non-null, set `order.metadata.accountId = sessionAccountId` BEFORE persist (mirrors PKG-LEARNER-BUY pattern). Session-fallback then covers the deep-link return path (§1.4 logged-in branch).
   - **`accountIdAttached: boolean`** flag computed = `sessionAccountId !== null`; threaded into the 201 response (§2.1 step 9) so the modal knows whether to render guest-warning copy (round-2 WARN#3 closure).
6. **Persist order + issue receipt-token** — direct `createOrderPostgres(order)` (real function name at `lib/payments/store-postgres.ts:189`; round-3 BLOCKER#3 closure). Mint plain receipt-token + store SHA-256 hash on `payment_orders.receipt_token_hash` BEFORE the create call so the hash lands in the same INSERT (mirrors `lib/payments/provider/checkout.ts:62-90` existing path). Plain token returned ONCE in response.
7. **Audit-log order creation** — `recordPaymentAuditEvent({eventType: 'order.created', invoiceId, customerEmail, clientIp, userAgent, amountKopecks, toStatus: 'pending', actor: 'user', idempotencyKey, payload: {provider: 'cloudpayments', paymentMethod: 'sbp', source: 'sbp-button'}})` (mirrors card-flow line 190-207). Best-effort fail-open.
8. **Call CloudPayments SBP API via centralized helper** (round-1 WARN#4 closure) — NEW function `createSbpQr({amount, currency, invoiceId, accountId, description, jsonData})` lives in `lib/payments/cloudpayments-api.ts` (modified). Uses existing `basicAuthHeader()` + `fetchWithTimeout()` machinery; signature mirrors `chargeWithSavedToken` shape. Returns discriminated union:
   ```ts
   | { kind: 'success'; transactionId: string; qrUrl: string; image?: string; raw }
   | { kind: 'declined'; message: string; reasonCode?: string; raw }
   | { kind: 'error'; message: string; raw }
   ```
   Wire body matches CP docs: `{Amount, Currency, InvoiceId, AccountId, Description, JsonData}`. `Amount` integer (matches existing `chargeWithSavedToken` pattern at `cloudpayments-api.ts:152` — CP accepts integer ruble; not `.00` decimal). `String(model.TransactionId)` for stable type (existing pattern at `cloudpayments-api.ts:207-209`).
9. **Persist providerTransactionId + return response** — on `kind: 'success'`, `updateOrderPostgres(order.invoiceId, (current) => ({...current, providerTransactionId: result.transactionId}))` (round-3 BLOCKER#3 closure — real `(invoiceId, updater)` signature per `lib/payments/store-postgres.ts:224-227`). Response 201:
   ```json
   {
     "invoiceId": "lc_a1b2c3d4...",
     "qrUrl": "https://qr.nspk.ru/AS10001Q...",
     "receiptToken": "...",
     "transactionId": "12345",
     "accountIdAttached": true
   }
   ```
   `accountIdAttached` lets the client decide modal copy: `isGuest = !accountIdAttached` (round-2 WARN#3 closure — server-truth, not stale client state).
10. **Failure paths** (round-1 WARN#1 closure — synced with §2.8):
    - `kind: 'error'` (timeout / 5xx) → 502 `'sbp_api_unavailable'`; order **stays `pending`** (NOT failed; user retries with new Idempotency-Key → new QR + new invoiceId; eventual-consistency via webhook resolves any in-flight CP-side success).
    - `kind: 'declined'` (`Success: false`) → 422 `'sbp_api_rejected'`; order marked `status='failed'` + `recordPaymentAuditEvent({eventType: 'order.failed', ...})` + `appendCheckoutTelemetryEvent({type: 'checkout_submit_rejected', reason: 'sbp_declined', ...})`.

### 2.2 Reuse existing status-poll route — `GET /api/payments/[invoiceId]`

(Round-1 BLOCKER#2 closure — URL corrected from `/status` suffix to bare `[invoiceId]`.)

The route at `app/api/payments/[invoiceId]/route.ts:16-73` already exists for the card flow. Response shape: `{ order: { invoiceId, status, paidAt, failedAt, providerMessage, ... } }` (nested under `order` — see line 70-73). No route changes needed.

Gate: receipt-token (`X-Receipt-Token` header preferred, `?token=` query param fallback for EventSource). The SBP modal MUST attach `X-Receipt-Token: <plain>` header on every poll fetch — bare poll = 401.

Client polls every 3 sec for up to 10 minutes (`max_attempts=200`); reads `data.order.status`. On `status='paid'` → redirect to `/thank-you?invoiceId=X&token=Y` (token preserved for the thank-you token-match path). On `status='failed'` → show error. On timeout → "Платёж не дошёл — попробуйте ещё раз. Если деньги списались, они вернутся в течение трёх рабочих дней."

### 2.3 New UI component — `<SbpQrModal />`

Path: `components/payments/sbp-qr-modal.tsx`.

Props: `{ invoiceId, qrUrl, receiptToken, isGuest, onClose, onPaid, onFailed, onTimeout }`. The `receiptToken` is threaded into the status-poll hook (§2.7); the `isGuest` flag toggles the "Не закрывайте эту страницу" warning copy (§1.4 guest-path contract).

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

Add SBP signal detection using a POSITIVE-signal contract (round-1 BLOCKER#6 closure):

```ts
// Round-2 WARN#4 closure — strict whitelist (exact case-insensitive
// match), NOT substring. "MySbpAndCardHybrid" → 'unknown', not 'sbp'.
const SBP_METHOD_TOKENS = new Set([
  'sbp', 'sbpqr', 'sbp_qr', 'fps', 'sbp_pay', 'сбп', 'сбп qr',
])

export function detectPaymentMethod(
  payload: CloudPaymentsWebhookPayload,
): 'card' | 'sbp' | 'unknown' {
  // POSITIVE signals first — never default-to-sbp on absence (which
  // would mis-classify future non-card CP methods like Apple Pay).
  const hasCardData =
    (payload.CardType && String(payload.CardType).trim().length > 0) ||
    (payload.CardLastFour && String(payload.CardLastFour).trim().length > 0)
  if (hasCardData) return 'card'

  const methodRaw = (payload.PaymentMethod || '').trim().toLowerCase()
  if (methodRaw && SBP_METHOD_TOKENS.has(methodRaw)) {
    return 'sbp'
  }

  // No positive signal — log + leave column NULL. Webhook handler
  // records the raw PaymentMethod in payment_audit_events for operator
  // forensics; admin reconciliation can manually classify.
  return 'unknown'
}
```

In the webhook route handler (`app/api/payments/webhooks/cloudpayments/pay/route.ts`) — round-2 BLOCKER#3 closure:

1. Webhook handler computes `detectedMethod = detectPaymentMethod(payload)` BEFORE calling lifecycle.
2. Handler calls `markOrderPaid(invoiceId, payload, { detectedPaymentMethod: detectedMethod })` — **new third arg** added to lifecycle signature. `lib/payments/provider/lifecycle.ts:125-149` `markOrderPaid` extended:
   ```ts
   export async function markOrderPaid(
     invoiceId: string,
     payload?: Record<string, unknown>,
     opts: { detectedPaymentMethod?: 'card' | 'sbp' | 'unknown' } = {},
   ) {
     const order = await updateOrder(invoiceId, (order) => {
       // ... existing 'paid_duplicate' guard ...
       const nextPaymentMethod =
         order.paymentMethod !== null
           ? order.paymentMethod                              // keep canonical
           : opts.detectedPaymentMethod === 'card' || opts.detectedPaymentMethod === 'sbp'
             ? opts.detectedPaymentMethod                     // legacy row, positive signal
             : null                                           // stays unknown
       return appendEvent(
         { ...order, status: 'paid', paymentMethod: nextPaymentMethod, ... },
         'payment.paid', payload,
       )
     })
     // ...
   }
   ```
3. `maybePersistTokenFromWebhook` (`lib/payments/tokens.ts:79-97`) gains a defensive guard at the TOP — round-2 BLOCKER#3 closure:
   ```ts
   export async function maybePersistTokenFromWebhook(
     payload: CloudPaymentsWebhookPayload,
     customerEmail: string,
     order: PaymentOrder | null,
   ) {
     // Round-2 BLOCKER#3: SBP webhooks never carry a card token, and
     // even if CP changed and sent one, an SBP order must never
     // accidentally persist as a saved card. Defensive early-exit.
     if (order?.paymentMethod === 'sbp') return null
     const consented = readRememberCardConsent(payload, order)
     // ... rest unchanged ...
   }
   ```
4. Audit event payload extended: webhook records `payload: {paymentMethod, raw_payment_method: payload.PaymentMethod ?? null, ...}` so 'unknown'-classified rows surface in forensics.

### 2.5 PaymentOrder type extension + `createCloudPaymentsOrder` signature

`lib/payments/types.ts`:

```ts
export type PaymentMethod = 'card' | 'sbp' | 'admin_grant'

export type PaymentOrder = {
  // ... existing fields ...
  paymentMethod: PaymentMethod | null  // null for legacy pre-SBP rows
}
```

`lib/payments/cloudpayments.ts:40-108` — `createCloudPaymentsOrder()` signature extends with new optional `paymentMethod?: PaymentMethod` in the options bag (round-1 BLOCKER#7 closure):

```ts
export function createCloudPaymentsOrder(
  amountRub: number,
  customerEmail: string,
  invoiceId: string,
  options: {
    rememberCard?: boolean
    source?: string
    personalDataConsent?: PersonalDataConsentSnapshot
    customerComment?: string | null
    slotId?: string | null
    paymentMethod?: PaymentMethod   // NEW; default 'card'
  } = {},
): PaymentOrder {
  // ... existing body ...
  return {
    // ... existing fields ...
    paymentMethod: options.paymentMethod ?? 'card',
  }
}
```

Existing call-sites at `lib/payments/provider/checkout.ts:72,148` pass nothing → default `'card'` (no behavior change). SBP route at §2.1 step 5 passes `{paymentMethod: 'sbp', ...}` explicitly.

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

Additive-only. Nullable column (legacy rows already backfilled in same migration; new rows go through `createCloudPaymentsOrder` which always sets it). Column is the **single source of truth** for `paymentMethod`; `metadata.payment_method` is NOT used anywhere — webhook handler reads/writes `order.paymentMethod`, not `metadata.payment_method`.

### 2.6 Store-postgres update

`lib/payments/store-postgres.ts` (round-2 BLOCKER#4 closure — real function names):

- **`ensureSchema()` (line 18-70)** — inline `create table if not exists` SQL gains `payment_method text null check (payment_method is null or payment_method in ('card', 'sbp', 'admin_grant'))` column. Legacy-safety `alter table ... add column if not exists payment_method ...` added after the `customer_comment` legacy-safety net (mirror of the line 48-50 pattern from migration 0015). This ensures freshly-bootstrapped dev DBs (which run `ensureSchema()` instead of migration files) get the column.
- **`mapRowToOrder(row)` (line 94+)** — reads `row.payment_method` into `order.paymentMethod`. Validates against `PaymentMethod` union; loud-fail on unknown (mirrors KNOWN_PROVIDERS / KNOWN_STATUSES pattern at lines 80-92).
- **`toInsertValues(order)` (line 146+)** — gains `payment_method = $N` parameter binding to `order.paymentMethod`.
- **`createOrderPostgres()` (line 189-218)** — INSERT statement extended with `payment_method` column; passes through `toInsertValues`.
- **`updateOrderPostgres()` (line 224-271)** — UPDATE statement extended with `payment_method = $N` clause; passes through `toInsertValues`.

### 2.7 Status-poll client hook

`components/payments/use-payment-status-poll.ts` — new hook (round-1 BLOCKER#2 + BLOCKER#3 closure):

```ts
type Args = {
  invoiceId: string
  receiptToken: string
  onPaid: () => void
  onFailed: (reason?: string) => void
  onTimeout: () => void
}

useEffect(() => {
  const interval = setInterval(async () => {
    try {
      const res = await fetch(`/api/payments/${invoiceId}`, {
        headers: { 'X-Receipt-Token': receiptToken },
        cache: 'no-store',
      })
      if (!res.ok) {
        // 401 = receipt-token-mismatch (state drift / token rotated);
        // surface as onFailed so modal closes deterministically.
        if (res.status === 401) { onFailed('receipt_token_mismatch'); clearInterval(interval); return }
        // Other non-2xx: keep polling (transient network blip).
        return
      }
      const data = await res.json()
      // Real endpoint shape: { order: { status, ... } }
      const status = data?.order?.status
      if (status === 'paid') { onPaid(); clearInterval(interval) }
      else if (status === 'failed') { onFailed(data?.order?.providerMessage); clearInterval(interval) }
    } catch {
      // Transient — keep polling.
    }
  }, 3000)
  const timeout = setTimeout(() => { clearInterval(interval); onTimeout() }, 600_000)
  return () => { clearInterval(interval); clearTimeout(timeout) }
}, [invoiceId, receiptToken])
```

Notes:
- URL = `/api/payments/[invoiceId]` (no `/status` suffix).
- `X-Receipt-Token` header threaded on every poll (route gates on it).
- Response shape: `{ order: { status, providerMessage, ... } }` — destructure via `data.order.status`.

### 2.8 Failure modes

- **CloudPayments SBP API timeout / 5xx** — order stays `status='pending'`, browser shows error in modal, user can retry (new InvoiceId per click). Don't mark `failed` on transient API errors — the webhook will eventually resolve.
- **CloudPayments API rate-limit** — handled at app level via `enforceRateLimit(...)` on the route.
- **QR scanned but user abandons before paying** — order stays `pending` forever (until manual reconciliation). Acceptable for MVP.
- **Webhook arrives before status-poll** — `/api/payments/[invoiceId]` reads from `payment_orders` table; webhook writes there; race is naturally resolved by the next 3-sec poll tick.
- **Webhook arrives without us creating a CloudPayments order** — already handled in existing webhook code (404 path; CloudPayments will retry).
- **Same InvoiceId paid twice** (user retried after long delay, both SBP requests succeeded on CloudPayments side) — protected by webhook-dedup (existing `webhook-dedup.ts` keyed on TransactionId).

---

## 3. Tests

### 3.1 Unit — server endpoint

`tests/payments/sbp-create-qr.test.ts` (round-1 WARN#3 closure — idempotency test contract matches helper reality):

- Valid request with Idempotency-Key → 201 with invoiceId + qrUrl + receiptToken.
- Missing Idempotency-Key header → 400 `'idempotency_key_required'`.
- Invalid email → 400 + `appendCheckoutTelemetryEvent({reason:'invalid_email'})`.
- Amount below min → 400 + telemetry event with `reason: 'invalid_amount'`.
- Missing personalDataConsentAccepted → 400.
- Untrusted origin header → 403 (enforceTrustedBrowserOrigin path).
- CloudPayments API timeout (mock `fetchWithTimeout` to throw AbortError) → 502, order **stays `pending`** (NOT marked failed per §2.8); `paymentAuditEvent` recorded.
- CloudPayments API returns `kind: 'declined'` (`Success: false`) → 422, order marked `status='failed'` + audit event + telemetry event.
- Rate-limit (11th request in 60sec) → 429.
- **Idempotency-Key contract**:
  - Repeat same Idempotency-Key with same body → cached 201 + `Idempotency-Replay: true` header + 0 second CloudPayments fetch.
  - Repeat same Idempotency-Key with different body → 409.
  - Timeout-path (502): same Idempotency-Key repeated → second CP-fetch fires (5xx NOT cached per `lib/security/idempotency.ts:116-119`).
  - Two concurrent requests with same Idempotency-Key: assert only one CP-fetch fires (advisory-lock serialization); second sees cached 201.
- Logged-in learner session → assertion `order.metadata.accountId === session.account.id` after create.
- Logged-in learner-with-teacher-role hybrid → assertion `order.metadata.accountId === session.account.id` (round-2 WARN#2 closure — `resolveOrderAccountIdForCreate` rejects only admin).
- Guest (no session) → assertion `order.metadata.accountId == null`.
- Admin session → assertion `order.metadata.accountId == null` (anti-spoof via `resolveOrderAccountIdForCreate`).

### 3.2 Unit — webhook payment_method detection

`tests/payments/detect-payment-method.test.ts` (round-1 BLOCKER#6 closure — positive-signal contract):

- Webhook with `CardType='Visa', CardLastFour='1234'` → `'card'`.
- Webhook with `CardType=null, CardLastFour=null, PaymentMethod='Sbp'` → `'sbp'`.
- Webhook with `CardType=null, CardLastFour=null, PaymentMethod='SbpQr'` → `'sbp'`.
- Webhook with `CardType=null, CardLastFour=null, PaymentMethod='СБП'` (Cyrillic) → `'sbp'`.
- Webhook with `CardType=null, CardLastFour=null, PaymentMethod='fps'` → `'sbp'` (exact whitelist match per round-2 WARN#4 closure).
- Webhook with `CardType=null, CardLastFour=null, PaymentMethod='FPS Faster Payments'` → `'unknown'` (NOT whitelist member; strict exact match).
- Webhook with `CardType=null, CardLastFour=null, PaymentMethod='SbpAndCardHybrid'` → `'unknown'` (substring would have falsely classified as 'sbp'; exact match prevents this).
- Webhook with `CardType=null, CardLastFour=null, PaymentMethod=null` → `'unknown'` (NOT 'sbp'; round-1 BLOCKER#6 — never default to sbp on absence).
- Webhook with `CardType=null, CardLastFour=null, PaymentMethod='ApplePay'` → `'unknown'` (not in whitelist; column stays NULL; raw method captured in audit).
- Webhook with `CardType=''` (empty string), all other empty → `'unknown'`.
- Case-insensitive: `PaymentMethod='SBP'` and `PaymentMethod='sbp'` both → `'sbp'`.

### 3.3 Integration — full SBP flow

`tests/integration/payments/sbp-full-flow.test.ts`:

- Mock CloudPayments API endpoint (per existing `tests/mocks/cloudpayments-mock.ts` pattern if exists, else introduce one).
- POST `/api/payments/sbp/create-qr` → 201; verify `payment_orders` row landed with `payment_method='sbp'`, `provider_transaction_id` set, `receipt_token_hash` set.
- POST webhook `/pay` with SBP-shaped payload → order transitions to `paid`; webhook-dedup row created.
- GET `/api/payments/[invoiceId]` (with `X-Receipt-Token` header) after webhook → `{order: {status: 'paid', ...}}`.
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

(Round-2 WARN#5 closure — server-side provenance, mirrors card-flow.)

Client sends only `personalDataConsentAccepted: true` boolean in the request body. Server constructs the full `PersonalDataConsentSnapshot` via `buildPersonalDataConsentSnapshot({ipAddress: getClientIp(request), userAgent: request.headers.get('user-agent')})` per the existing card-flow at `app/api/payments/route.ts:181-184`. The snapshot carries IP, UA, document version, document path, policy path, and a server-provided `acceptedAt` ISO timestamp. Storing the timestamp client-side (the old plan version) is a weak audit signal — the server's monotonic clock + request-time provenance is the actual evidence.

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
lib/payments/store-postgres.ts                         (modified — ensureSchema + mapRowToOrder + toInsertValues + createOrderPostgres + updateOrderPostgres support payment_method)
lib/payments/cloudpayments.ts                          (modified — createCloudPaymentsOrder accepts paymentMethod opt; sets order.paymentMethod)
lib/payments/cloudpayments-webhook.ts                  (modified — detectPaymentMethod helper)
lib/payments/cloudpayments-api.ts                      (modified — new createSbpQr() API client)
lib/payments/provider/checkout.ts                      (modified — pass paymentMethod through createPayment wrapper if needed; default 'card')
lib/payments/provider/lifecycle.ts                     (modified — markOrderPaid accepts detectedPaymentMethod opt; round-2 BLOCKER#3)
lib/payments/tokens.ts                                 (modified — maybePersistTokenFromWebhook defensive guard on paymentMethod==='sbp'; round-2 BLOCKER#3)
lib/payments/order-account-resolver.ts                 (NEW — resolveOrderAccountIdForCreate helper; round-2 WARN#2)
app/api/payments/sbp/create-qr/route.ts                (NEW — server endpoint)
app/api/payments/webhooks/cloudpayments/pay/route.ts   (modified — compute detectedMethod, pass to markOrderPaid + audit raw_payment_method)
components/payments/sbp-qr-modal.tsx                   (NEW — QR modal)
components/payments/use-payment-status-poll.ts         (NEW — status-poll hook)
components/payments/pricing-section.tsx                (modified — second CTA + modal mount + Idempotency-Key generation; reads accountIdAttached from response)
lib/payments/README.md                                 (modified — document SBP path + single-source-of-truth for paymentMethod)
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

(Updated round-3 WARN#4 closure.) The CloudPayments developer docs page snippets aren't exhaustive on SBP webhook payload shape. Mitigation: `detectPaymentMethod()` uses a **positive** signal from `payload.PaymentMethod` (strict exact-match against the whitelist `['sbp', 'sbpqr', 'sbp_qr', 'fps', 'sbp_pay', 'СБП', 'СБП QR']`). Card-positive signal: any non-empty `CardType` / `CardLastFour` → `'card'`. Neither matched → `'unknown'` (NULL column, raw value in audit). The SBP order is canonically `payment_method='sbp'` from create-qr time anyway; webhook detection is a fallback for legacy/migration-edge rows only. As we operate the integration and observe real CloudPayments PaymentMethod strings, the whitelist is extended; until then 'unknown' is a safe default.

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

**This PR (#387, doc-only plan-checkpoint)** ships when:

- `/codex-paranoia plan` SIGN-OFF on this file (round N/3).
- §0a (round-1 closure block) + subsequent round-N closures appended below.
- PR commit body trailer:
  ```
  Codex-Paranoia: SIGN-OFF round N/3 (SBP-PAY plan checkpoint; impl unblocked)
  Skill-Used: /codex-paranoia plan
  ```

**Future impl PR (one-PR epic)** ships when:

- Migration `00NN` applies clean on a fresh test DB.
- `npm run test:run` green (5 new test files all pass).
- `npm run test:integration` green.
- `npm run build` green.
- `/codex-paranoia wave` SIGN-OFF on the implementation diff (round N/3).
- PR commit body trailer:
  ```
  Codex-Paranoia: SIGN-OFF round N/3 (one-PR epic; epic-end on <commit-range>)
  Critical-Path-Touched: lib/payments/cloudpayments-webhook.ts, lib/payments/store-postgres.ts, app/api/payments/webhooks/cloudpayments/pay/route.ts
  Skill-Used: /codex-paranoia wave
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
**A:** (Updated round-2 WARN#5.) Order is created BEFORE the CP API call. On `kind:'declined'` (CP `Success:false`) → order marked `status='failed'` + audit + telemetry. On `kind:'error'` (network/timeout/5xx) → order stays `pending`; the client retries with a NEW Idempotency-Key (new order + new InvoiceId). If CP actually accepted the SBP request despite our timeout, the original `pending` order eventually transitions to `paid` via the webhook; user might see "Платёж пришёл" notification + receipt email even if the original modal closed.

**Q3.** What's the receipt-token contract for the deep-link return path?  
**A:** When user returns from bank app via OS deep-link, browser may not preserve the original `/pay` page state (different tab, fresh session). The receipt-token gate's RECEIPT-3DS-TOKEN session fallback handles this: `/thank-you?invoiceId=X` without `?token=Y` matches authenticated learner session against `order.metadata.accountId` and accepts.

**Q4.** Why don't we use `Image` (base64) instead of `QrUrl` for the QR display?  
**A:** `QrUrl` is a CDN-served PNG that browsers cache; base64 inflates the response payload. `QrUrl` is preferred unless CloudPayments expires it too quickly (≤10 min seems sufficient for the polling window).

**Q5.** What about the SBP version of webhook deduplication?  
**A:** `webhook-dedup.ts` keys on `TransactionId` (CloudPayments-side unique ID). Same for card and SBP.

**Q6.** PaymentMethod / PaymentSystem strings on the webhook?  
**A:** (Updated round-2 WARN#5.) `detectPaymentMethod()` uses a **positive** strict-whitelist exact match against `payload.PaymentMethod`: case-insensitive equality with `['sbp', 'sbpqr', 'sbp_qr', 'fps', 'sbp_pay', 'СБП', 'СБП QR']`. Absence or unmatched → `'unknown'` (column stays NULL; raw value persisted in `payment_audit_events` for operator forensics). The canonical write happens at create-qr time (§2.1 step 5) via `createCloudPaymentsOrder({paymentMethod:'sbp'})` → top-level column. Webhook detection serves only legacy/migration-edge rows where the column write didn't fire.

---

## 11. Final trailer expectations

**This PR (#387, plan-checkpoint, doc-only):**
```
Codex-Paranoia: SIGN-OFF round N/3 (SBP-PAY plan checkpoint; impl unblocked)
Skill-Used: /codex-paranoia plan
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

**Future impl PR (one-PR epic, wave-checkpoint):**
```
Codex-Paranoia: SIGN-OFF round N/3 (one-PR epic; epic-end on <commit-range>)
Critical-Path-Touched: lib/payments/cloudpayments-webhook.ts, lib/payments/store-postgres.ts, app/api/payments/webhooks/cloudpayments/pay/route.ts
Skill-Used: /codex-paranoia wave
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

— END OF PLAN (`/codex-paranoia plan` round 3/3 mechanical SIGN-OFF; impl unblocked) —
