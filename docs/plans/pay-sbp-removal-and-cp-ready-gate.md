# PAY-SBP-REMOVAL + CP-RESCUE — Two production fixes on `/pay`

**Status:** PLAN SIGN-OFF round 3/3 (Codex-Paranoia plan checkpoint; 4 BLOCKERs + 8 WARNs across 3 rounds closed; impl unblocked). See `/tmp/codex-paranoia-20260520T050900Z/round-{1,2,3}.md` for the full Codex transcripts.
**Wave name:** `pay-sbp-removal-and-cp-rescue` (two-PR epic; PR1 surgical UI removal + server gate, PR2 stuck-pending rollback).
**Trigger:** Live `/pay` test 2026-05-20 revealed two issues:
  1. «Оплатить через СБП» button returns 422 `sbp_api_rejected` with CloudPayments message `"404 - not found"` — terminal-side SBP not activated. Product-owner decision: remove the in-page SBP button entirely.
  2. Primary CTA «Перейти к оплате» fails with «Платёжная форма CloudPayments не загрузилась» AND leaves a stuck-pending order in the DB (forcing CTA to lock to «Сначала завершите текущий платёж» on re-render).
**Author:** Claude (autonomous, behalf of product owner).
**Production target:** see private operator runbook (host/path intentionally not in git per OPERATIONS.md §Maintenance rule).

---

## 0b. Paranoia round-2 closure summary (2026-05-20)

Round 2 returned **BLOCK** with **3 new BLOCKERs + 4 WARNs**. Closures:

| Round-2 finding | Closure |
|---|---|
| **BLOCKER#1** — stale React closure: catch reads `checkout.phase === 'pending' ? checkout.order : null` from pre-click render snapshot, would skip rollback. | §2.2 переписан: rollback теперь **внутри try-block** как nested try/catch вокруг `openCloudPaymentsWidget` (line 611), а не в outer catch (line 688). `payload` (line 566) живёт в той же try-block scope, доступ напрямую — никаких state closure'ов. Outer catch не трогаем — он обрабатывает только POST-time errors (где payload ещё не определён). |
| **BLOCKER#2** — rollback-fail branch использует `setCheckout({phase: 'idle', order: null})`, ломая «Сбросить» affordance. | §2.2 mirror cancel-branch (line 653-668) **точно**: на rollback-fail → `setCheckout({phase: 'pending', order: payload.order, error: 'Не удалось корректно закрыть незавершённый платёж. Нажмите «Сбросить этот платёж».'})`. Affordance сохраняется. |
| **BLOCKER#3** — test layer wrong: `payment-routes.test.ts` route-only, не дёргает `handleClick`. Plus `paymentConfig.provider` cached at module scope — env-override через fixture не работает. | §2.3 переписан: новый файл `tests/payments/pricing-section-widget-rollback.test.tsx` с vitest jsdom + RTL (pattern из `tests/payments/sbp-qr-modal.test.tsx:1-4`). Тест мокает `window.cp = undefined` + мокает `fetch('/api/payments')` → возвращает order с `provider: 'cloudpayments'`. Click primary CTA → assert: (a) fetch к `/api/payments/${invoiceId}/cancel` сделан, (b) UI показывает error message. Module-scope provider cache обходится: `paymentConfig.provider` НЕ читается клиентом — клиент работает по `payload.order.provider` (line 599), который контролируется мок-fetch'ем. |
| **WARN#4** — `tests/payments/sbp-create-qr-api.test.ts` — это unit-тест для API-клиента (createSbpQr), не покрывает route gate. | §1.3 переписан: новый файл `tests/payments/sbp-create-qr-route.test.ts` — vitest, импортирует POST handler напрямую (mock-heavy pattern из `tests/payments/saved-card-auth-gate.test.ts:16-69`). Тест покрывает ТОЛЬКО gate-off cases (`SBP_ENABLED` absent / `'false'` / truthy-non-`'true'`) + guard-order (rate-limit before, origin-check after). Happy-path при `SBP_ENABLED='true'` ОТЛОЖЕН — требует тяжёлых моков для всех downstream-вызовов (createCloudPaymentsOrder, createOrder, withIdempotency, resolveOrderAccountIdForCreate, audit/telemetry); это unit-coverage для route'а в целом, не для gate'а. Покрытие happy path оставляем на manual smoke + future epic если возродим SBP. |
| **WARN#5** — cpScriptReady UX gate underspecified: PricingSection без props, /pay рендерит bare, Strict Mode double-effects. | UX-gate **дропнут** из этого эпика. Rollback сам по себе закрывает баг (stuck-pending не остаётся). UX-улучшение — в follow-up. Это упрощает PR2 до **одного файла** (`components/payments/pricing-section.tsx`) + один тест-файл. |
| **WARN#6** — 404 vs 503 не закреплён; guard-order непоследователен (origin-check ДО SBP gate → cross-site видит 403, не 404). | §1.2 переписан: status = **503** Service Unavailable (semantic: route exists but operator-disabled). Guard order: `enforceRateLimit` (1st — anti-DoS), затем `SBP_ENABLED` gate (2nd — до origin-check), затем `enforceTrustedBrowserOrigin` (3rd). Это значит cross-site no-Origin caller получит 503 (не 403), что и есть desired «функция выключена». Browser cross-site всё равно блокируется CORS preflight. |
| **WARN#7** — doc-sweep incomplete: `ARCHITECTURE.md:33,74`, `PAYMENTS_SETUP.md:8-14`, `docs/critical-path.md:57` всё ещё описывают SBP-UI как live. | §3 расширен doc-sweep'ом. PR1 включает явные edit'ы в ARCHITECTURE.md (две позиции), PAYMENTS_SETUP.md (если упоминает SBP), docs/critical-path.md (если SBP-route в inventory). |

---

## 0a. Paranoia round-1 closure summary (2026-05-20)

Round 1 returned **BLOCK** with **4 BLOCKERs + 4 WARNs**. Closures:

| Round-1 finding | Closure |
|---|---|
| **BLOCKER#1** — gate-before-POST ломает mock-mode (`PAYMENTS_PROVIDER=mock`, `createPayment()` без `checkoutIntent`, клиенты ветвятся на `!checkoutIntent` line 599). | §2.2 переписан: НЕТ pre-POST gate. Фикс — единственный additive `cancelOrder()` rollback в `catch` блоке после throw из `openCloudPaymentsWidget`. Mock-path вообще не доходит до widget (line 599-601), rollback его не касается. UX-дизейбл CTA опционально только когда `provider === 'cloudpayments'` AND `!cpScriptReady` — для mock CTA всегда активен. |
| **BLOCKER#2** — root-cause план неверен: Next 16.2.6 app-dir `beforeInteractive` грузится через `self.__next_s` ДО hydrate из page-level. `onLoad` не работает с `beforeInteractive` И не работает в Server Components. | §2.1 переписан: root-cause — НЕ silent-downgrade, А race + ad-blocker. На медленном канале / при заблокированном `widget.cloudpayments.ru` window между «scroll-to-CTA» и «парсинг bundle» реален независимо от того, beforeInteractive работает или нет — пользователь может кликнуть до того, как window.cp populated. Brave Shields умножает window до бесконечности (script вообще не грузится). Доказательство: `tests/integration/payment/payment-routes.test.ts:233-355` + live Playwright probe (script атрибут `async: true` — ожидаемо для App Router beforeInteractive, не баг). Решение — **rollback** на throw, не предотвращение через onLoad. cpScriptReady-polling (без onLoad) — только UX-дисейбл, не блокер POST. |
| **BLOCKER#3** — перенос script-а в layout рвёт privacy/doc contract (`ARCHITECTURE.md:49-50,263`, `app/privacy/page.tsx:159-169` framing «payment-stage processor») + comment в `app/layout.tsx`/`app/pay/page.tsx` явно «не global». | §2.2a удалён. Скрипт остаётся page-level (`app/pay/page.tsx:51-54`, `app/checkout/[tariffSlug]/page.tsx:85`, `app/cabinet/packages/page.tsx:67`) — privacy framing нетронут. layout.tsx НЕ модифицируется. |
| **BLOCKER#4** — scope-expand на `buy-button.tsx` + `checkout-form.tsx` не проработан: разная семантика (buy-button держит `pending_package_in_flight` lock в `app/api/checkout/package/[slug]/route.ts:145-160`; checkout-form редиректит на `/thank-you` при `!cp?.CloudPayments`). | §1 scope сужен до `/pay` only. `buy-button.tsx` + `checkout-form.tsx` ВЫНЕСЕНЫ в follow-up (см. §6). Текущий эпик трогает ТОЛЬКО `components/payments/pricing-section.tsx` + `app/api/payments/sbp/create-qr/route.ts` + новый env `SBP_ENABLED`. |
| **WARN#1** — `enforceTrustedBrowserOrigin()` пропускает запрос без `Origin` (`lib/security/request.ts:90-119`); SBP-роут после удаления UI остаётся публично-дёргаемым → curl/server-side caller может плодить SBP orders + аудит-шум; merchant-side активация SBP позже создаст silent revive. | Добавлен серверный gate: `SBP_ENABLED` env, default `false`. В роуте `app/api/payments/sbp/create-qr/route.ts` guard ПОСЛЕ rate-limit, ПЕРЕД origin-check — если `process.env.SBP_ENABLED !== 'true'` → **503 `sbp_disabled`** (см. round-2 WARN#6 — 503 semantically truer for «route exists but operator-disabled»; 404 был бы concealment). Это закрывает both curl-vector + silent-revive: для активации нужен явный env-flip + рестарт. |
| **WARN#2** — PR1 inventory: нет `sbpError`/`sbpStatus`, но есть `closeSbpModal`/`onSbpPaid`/`onSbpFailed`/`onSbpTimeout` (`pricing-section.tsx:1071-1101`) и mount-callback props (`onClose/onPaid/onFailed/onTimeout` на line 1550-1553). | §1.1 переписан с правильной картой удаления (см. ниже). |
| **WARN#3** — claim «SBP modal hash-keyed by invoiceId in URL, persists across reload» неверен. Modal живёт только в `sbpModal` React state, reload его уничтожает. | §1.4 переписан: при reload tab во время mid-flow SBP — модалка пропадёт (acceptable, поскольку polling всё равно умирает с tab). |
| **WARN#4** — test-plan неверен: `tests/integration/pay-page.test.ts` не существует, Playwright не runner, mock-mode override обязателен для assertion «no pending order created». | §2.3 + §1.3 переписаны. Реальные test-paths: `tests/integration/payment/payment-routes.test.ts` (vitest), используется `mockCreatePayment` + override `PAYMENTS_PROVIDER=cloudpayments` через test fixture. Smoke-проверка UI отдельно — через `tsc --noEmit` + manual Playwright session (не в CI). |

---

## 1. Issue A — Remove SBP button + gate route (PR1)

### 1.1 UI removal — `components/payments/pricing-section.tsx`

Точная карта удаления (после round-1 inventory fix):

- Line ~7 — `import { SbpQrModal } from '@/components/payments/sbp-qr-modal'`.
- Lines ~266-277 — comment block + `useState` для `sbpModal` (типизированный объект) и `sbpPending`.
- Lines ~1071-1074 — `function closeSbpModal()`.
- Lines ~1075-1084 — `function onSbpPaid()`.
- Lines ~1085-1094 — `function onSbpFailed()`.
- Lines ~1095-1101 — `function onSbpTimeout()`.
- Lines ~983-1075 — `handleSbpClick` (полное тело — idempotency-key gen, fetch, error states, modal mount).
- Lines ~1395-1412 — `<button>Оплатить через СБП</button>` JSX + `secondaryCtaButtonStyle` если он использовался только этой кнопкой (grep — нет, используется для других CTA, оставляем).
- Lines ~1543-1554 — `{sbpModal ? <SbpQrModal ... /> : null}` блок с props `onClose/onPaid/onFailed/onTimeout`.
- Любые refs к `sbpPending`/`sbpModal` в `disabled`/`style` других кнопок — поправить.

После удаления:
- `tsc --noEmit` должен пройти без ошибок.
- `npm run test:integration` зелёный на payment routes.

### 1.2 Server gate — `app/api/payments/sbp/create-qr/route.ts`

Точный guard-order (round-2 WARN#6 closure):

1. `enforceRateLimit(request, 'sbp:create-qr', 10, 60_000)` — anti-DoS первой линией.
2. **NEW `SBP_ENABLED` gate** — между rate-limit и origin-check.
3. `enforceTrustedBrowserOrigin(request)` — остаётся как было.
4. (остальная логика).

```ts
// PAY-SBP-REMOVAL (2026-05-20) — operator-disabled gate. SBP UI was
// removed because CloudPayments-side SBP terminal isn't activated.
// Setting SBP_ENABLED=true revives the route without re-shipping.
// Exact-match guard (env_exact_match): truthy strings rejected.
if (process.env.SBP_ENABLED !== 'true') {
  return NextResponse.json(
    {
      error: 'sbp_disabled',
      message: 'СБП-оплата временно недоступна.',
    },
    {
      status: 503,
      headers: {
        'Cache-Control': 'no-store, max-age=0',
        'Retry-After': '3600',
      },
    },
  )
}
```

Default off — explicit env-flip required for revive. Status **503** (не 404) — semantic: route exists but operator-disabled. `Retry-After: 3600` чтобы любой well-behaved client не долбил каждую секунду.

### 1.3 Tests

(Round-2 WARN#4 closure: правильное mapping.)

- **NEW** `tests/payments/sbp-create-qr-route.test.ts` — vitest. (Round-3 WARN#1: harness pattern из `tests/payments/saved-card-auth-gate.test.ts:16-69` — mock-heavy unit, не `payment-routes` integration. Этот pattern уже мокает `cookies()` + `headers()` + DB через `vi.mock(...)` ДО импорта handler'а + использует `vi.resetModules()` для env-mutation.) Cases:
  - `SBP_ENABLED` absent → POST отвечает **503** с `error: 'sbp_disabled'`. Assertion: zero вызовов к моку `createSbpQr` / `createOrder` / `recordPaymentAuditEvent` (gate срабатывает до них).
  - `SBP_ENABLED='false'` → то же самое.
  - `SBP_ENABLED='true'` **happy path DEFERRED**: требует моков для `createCloudPaymentsOrder` + `createOrder` + `withIdempotency` + `resolveOrderAccountIdForCreate` + audit/telemetry — это unit-coverage для route'а в целом, не для нашего gate'а. Verifies оставляем manual smoke / future epic.
- `tests/payments/sbp-create-qr-api.test.ts` — оставить как есть (unit для API-клиента, не зависит от route gate).
- Manual smoke — через `mcp__playwright__browser_snapshot` после deploy, не в CI.
- `tests/payments/sbp-create-qr-api.test.ts` — оставить как есть (unit для API-клиента, не зависит от route gate).
- Manual smoke — через `mcp__playwright__browser_snapshot` после deploy, не в CI.

### 1.4 Risk

- LOW. UI-only delete + server-side default-off gate.
- Mid-flow SBP modal: при reload tab пользователь теряет модалку (она в React state, не в URL). Acceptable — polling всё равно умирает с tab. Если активен модал — pending order может остаться в DB до webhook/timeout; admin может сбросить через `/admin` UI.
- Curl-vector закрыт `SBP_ENABLED` gate'ом.

---

## 2. Issue B — Stuck-pending rollback on widget-throw (PR2)

### 2.1 Root cause (precise)

`components/payments/pricing-section.tsx:688-701` — `catch` блок в `handleClick` обрабатывает throw из `openCloudPaymentsWidget` (line 611), но **НЕ вызывает `cancelOrder()`** при наличии созданного `payload.order`. В отличие от `widgetResult.type === 'cancel'` (line 636-671), где `cancelOrder` есть.

Цепочка бага:
1. POST `/api/payments` → server создаёт `payment_orders` row (status=pending), возвращает `{order, checkoutIntent}` (line 591-597 — `setCheckout({phase: 'pending', order, receiptToken})`).
2. Если `provider === 'mock'` или `!checkoutIntent` — return (line 599-601). Mock не доходит до widget.
3. Иначе `openCloudPaymentsWidget(intent)` — может throw'нуть `Error('Платёжная форма CloudPayments не загрузилась…')` (line 207).
4. `catch` block (line 688-701) ловит throw, ставит `phase: 'idle'` + error message, **но order остаётся `pending` в DB**.
5. Next render: `hasLockedPendingOrder=true` → primary CTA = «Сначала завершите текущий платёж».

Reasons window.cp может отсутствовать:
- Race: на медленном канале user успевает кликнуть до парсинга bundle.
- Ad-blocker: Brave Shields / uBlock / AdGuard режут `widget.cloudpayments.ru`.

(Округ-1 BLOCKER#2 закрыт: НЕ silent-downgrade, а race+blocker.)

### 2.2 Fix proposal (additive, single behavioral change)

(Round-2 BLOCKER#1 + #2 closure: nested try/catch вокруг `openCloudPaymentsWidget` внутри outer try — `payload` в scope, нет stale-closure'а, и rollback-fail точно мирорит cancel-branch.)

В `components/payments/pricing-section.tsx`, заменить line 611:

```ts
const widgetResult = await openCloudPaymentsWidget(payload.checkoutIntent)
```

на:

```ts
// PAY-CP-RESCUE (2026-05-20) — widget can throw if CloudPayments
// JS bundle didn't load (race on slow network, blocked by Brave
// Shields / uBlock / AdGuard). Without rollback, payload.order
// stays pending in DB and locks the CTA to «Сначала завершите
// текущий платёж» on next render. Mirror cancel-branch (line
// 636-671): nested try/catch with explicit phase:'pending' on
// rollback-fail to preserve the sidebar «Сбросить» affordance.
let widgetResult: Awaited<ReturnType<typeof openCloudPaymentsWidget>>
try {
  widgetResult = await openCloudPaymentsWidget(payload.checkoutIntent)
} catch (widgetError) {
  try {
    await cancelOrder(payload.order.invoiceId, payload.receiptToken ?? null)
    saveInvoiceId(null)
    void logCheckoutEvent({
      type: 'checkout_widget_rollback',
      invoiceId: payload.order.invoiceId,
      amountRub: payload.order.amountRub,
      email: emailValidation.email,
      emailValid: true,
      reason: 'widget_throw',
      message: widgetError instanceof Error ? widgetError.message : 'widget_open_failed',
    })
    setCheckout({
      phase: 'idle',
      order: null,
      error: widgetError instanceof Error
        ? widgetError.message
        : 'Не удалось открыть платёжную форму. Попробуйте ещё раз.',
    })
  } catch (rollbackError) {
    void logCheckoutEvent({
      type: 'checkout_widget_rollback_failed',
      invoiceId: payload.order.invoiceId,
      amountRub: payload.order.amountRub,
      email: emailValidation.email,
      emailValid: true,
      message:
        rollbackError instanceof Error ? rollbackError.message : 'rollback_failed',
    })
    setCheckout({
      phase: 'pending',
      order: payload.order,
      error:
        'Не удалось корректно закрыть незавершённый платёж. Нажмите «Сбросить этот платёж».',
    })
  }
  return
}
```

(Остальной код после этого блока, начиная с `if (widgetResult.status === 'success')` line 613, остаётся без изменений. `payload` — это `const` из line 566, живёт в той же try-block scope. Outer catch (line 688) не трогаем — он обрабатывает только POST-time errors, где payload ещё не определён.)

**UX-улучшение `cpScriptReady`** — **DROPPED из эпика** (round-2 WARN#5). Rollback сам по себе закрывает stuck-pending баг. UX-дисейбл — отдельный follow-up если нужен.

### 2.3 Tests

(Round-2 BLOCKER#3 closure: правильный layer — RTL/jsdom client-side тест, не route-test.)

**NEW** `tests/payments/pricing-section-widget-rollback.test.tsx` — vitest jsdom + RTL pattern из `tests/payments/sbp-qr-modal.test.tsx`. (Round-3 WARN#2: `PricingSection` использует `useRouter()` + mount effects + saved-card probe — тест требует моков для `next/navigation` + stub `/api/payments/saved-card` + по необходимости fake timers.):

Required mocks before `render(<PricingSection />)`:
```ts
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}))

// Stub saved-card probe — иначе useEffect ляжет на fetch undefined.
const fetchSpy = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
  if (url.includes('/api/payments/saved-card')) {
    return Promise.resolve(new Response(JSON.stringify({ savedCard: null }), { status: 200 }))
  }
  // (case-specific overrides for /api/payments, /cancel — set per-test)
  return Promise.reject(new Error(`Unmocked fetch: ${url}`))
})
global.fetch = fetchSpy
```

Под этими моками cases:

```ts
// @vitest-environment jsdom
import { fireEvent, render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
```

Cases:
1. **widget-throw → rollback fires.** Mock `window.cp = undefined` (или `window.cp.CloudPayments` undefined). Mock `fetch('/api/payments')` → возвращает 200 + `{order: {invoiceId, provider: 'cloudpayments', status: 'pending', ...}, checkoutIntent: {...}, receiptToken: 'plain-x'}`. Mock `fetch('/api/payments/.../cancel')` → 200 ok. Render `<PricingSection />`, заполнить форму валидно, click «Перейти к оплате». Assert: (a) fetch к `/cancel` сделан с правильным `X-Receipt-Token` header, (b) UI показывает error message, (c) `logCheckoutEvent({type: 'checkout_widget_rollback'})` вызван (через spy).
2. **rollback-fail → preserve sidebar affordance.** То же что case 1, но `fetch('/api/payments/.../cancel')` → 500. Assert: (a) error message «Не удалось корректно закрыть незавершённый платёж…», (b) phase остаётся `pending`, (c) `logCheckoutEvent({type: 'checkout_widget_rollback_failed'})` вызван.
3. **mock-provider — rollback не вызывается.** Mock `fetch('/api/payments')` → `{order: {provider: 'mock', ...}}`. Click. Assert: NO fetch к `/cancel`, NO error.

`paymentConfig.provider` module-cache не мешает: клиент ветвится по `payload.order.provider` (line 599), который контролируется мок-fetch'ем.

Manual smoke после deploy:
- Brave + shields-blocked `widget.cloudpayments.ru` → click primary CTA → ожидаем: error message + NO pending row в DB для email (проверить через `/admin/payments/[invoiceId]`).
- Чистый Chrome → click primary CTA → widget открывается мгновенно.

### 2.4 Risk

- MEDIUM-LOW. Single-file change в `pricing-section.tsx`, additive `cancelOrder` call в существующий catch. Не меняет happy-path; trigger'ит только когда widget уже бросил исключение.
- `cancelOrder` уже используется в cancel-branch (line 638), helper стабилен.
- Если `cancelOrder` сам бросит — fall-through на текущий error display + sidebar reset.

---

## 3. Files changed

### PR1 (SBP button removal + server gate + doc-sweep)

| File | Change |
|---|---|
| `components/payments/pricing-section.tsx` | Delete SBP import, state, 4 callback functions (`closeSbpModal`/`onSbpPaid`/`onSbpFailed`/`onSbpTimeout`), `handleSbpClick`, SBP button JSX, SbpQrModal mount block. ~150 lines removed. |
| `app/api/payments/sbp/create-qr/route.ts` | Add `SBP_ENABLED !== 'true'` → 503 gate between rate-limit and origin-check. |
| `tests/payments/sbp-create-qr-route.test.ts` | NEW. Cases for gate-off → 503 (5 cases). Happy-path gate-on DEFERRED (round-2 WARN#4 closure — happy-path requires heavy mocks for the whole downstream pipeline). |
| `.env.example` | Add `SBP_ENABLED=false` line with comment. |
| `docs/plans/sbp-payments.md` | Append §0d note: «UI button + route gated 2026-05-20; revive via `SBP_ENABLED=true` env-flip.» — round-3 WARN#3: also update line 127 («No new env vars are required») + line 654 («.env.example (no change)») to reflect that SBP_ENABLED was added. |
| `README.md` | (Round-3 WARN#3) Add `SBP_ENABLED=false` to the env inventory at line 79-95 with one-line comment («Operator gate for the SBP QR route; default off until CloudPayments-side terminal is activated»). |
| `ARCHITECTURE.md` | (Round-3 WARN#3 corrected) Line 33 (pricing-section description) does NOT mention SBP-CTA — no edit needed. Line 74 (SBP route description) — append «Route gated by `SBP_ENABLED=true` env; default off after PAY-SBP-REMOVAL 2026-05-20». |
| `PAYMENTS_SETUP.md` | (Wave-paranoia round-1 WARN#4 closure) Add `SBP_ENABLED=false` entry to the production env checklist (§2 «Fill in `.env`») with the revive procedure inline. |
| `docs/critical-path.md` | (Round-3 WARN#3) If line 57 mentions SBP-route as live UI surface → adjust to «backend route, operator-gated»; if just backend inventory — no edit. Verify before edit. |

### PR2 (stuck-pending rollback)

| File | Change |
|---|---|
| `components/payments/pricing-section.tsx` | Wrap `openCloudPaymentsWidget(payload.checkoutIntent)` (line 611) in nested try/catch with rollback via `cancelOrder()`. Mirror cancel-branch (line 636-671) for rollback-fail. ~50 lines added. |
| `tests/payments/pricing-section-widget-rollback.test.tsx` | NEW. RTL/jsdom test for widget-throw → rollback + rollback-fail → sidebar affordance + mock-provider → no rollback. |

---

## 4. Acceptance criteria

### PR1

- `/pay` loads with only one primary CTA («Перейти к оплате») and zero SBP button.
- `POST /api/payments/sbp/create-qr` returns **503** `sbp_disabled` when `SBP_ENABLED` is absent or not exactly `'true'`.
- New route test passes 5 gate-off cases (absent / 'false' / truthy-non-'true' / rate-limit-first / origin-after). Happy-path (`SBP_ENABLED='true'`) DEFERRED; covered by manual smoke only.
- `tsc --noEmit` clean; `npm run test:integration` green.
- ARCHITECTURE.md, PAYMENTS_SETUP.md, docs/critical-path.md no longer claim SBP UI is live.

### PR2

- Manual repro: with Brave Shields blocking `widget.cloudpayments.ru` + `PAYMENTS_PROVIDER=cloudpayments`, click primary CTA → see clear error, NO row remains in `payment_orders.status='pending'` for that email after the click.
- Manual repro: widget loading normally → primary CTA opens widget instantly, no behavioral change.
- New vitest case in §2.3 green; existing tests still green.
- Sentry: no new `Платёжная форма CloudPayments не загрузилась` error events after 24h post-deploy.

---

## 5. Codex-paranoia trailer expectations

- Plan checkpoint: this document → `/codex-paranoia plan docs/plans/pay-sbp-removal-and-cp-ready-gate.md`. SIGN-OFF required before PR1 implementation.
- Sub-PRs: PR1 ships under Claude self-review; PR2 ships under Claude self-review.
- Trailer on PR1: `Codex-Paranoia: SUB-WAVE self-reviewed (epic pay-sbp-removal-and-cp-rescue); epic-end review pending`.
- Trailer on PR2 (epic-close): `Codex-Paranoia: SIGN-OFF round N/3 (epic-end on <commit-range>)`.
- Epic-end wave: `/codex-paranoia wave <commit-range>` after both PRs merged.

---

## 6. Out of scope (follow-up if needed)

- `app/cabinet/packages/buy-button.tsx` and `app/checkout/[tariffSlug]/checkout-form.tsx` — different semantics (package-buy has `pending_package_in_flight` server lock; checkout-form already redirects to `/thank-you` on `!cp`). If users hit same class of bug in those paths, open a separate epic with proper analysis (round-1 BLOCKER#4).
- Activating CloudPayments-side SBP terminal — operator task via merchant manager.
- Migrating `next/script` strategy — Next 16.2.6 `beforeInteractive` works correctly from page-level; no migration needed (round-1 BLOCKER#2).
- Auto-cleanup script for existing stuck-pending rows — `/admin` already exposes manual cancel; existing rows aren't legion (verify count in admin dashboard pre-deploy).
