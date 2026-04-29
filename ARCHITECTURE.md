# Architecture

## Overview

Проект состоит из двух частей:

- публичный лендинг на `Next.js App Router`
- серверный payment-контур внутри того же приложения

Основная продуктовая логика сейчас сосредоточена в checkout flow и обработке статусов оплаты.

## Структура

### Frontend

- [`app/page.tsx`](/Users/ivankhanaev/LevelChannel/app/page.tsx) — главная страница (с `<Link href="/login">Войти</Link>` в nav)
- [`components/payments/pricing-section.tsx`](/Users/ivankhanaev/LevelChannel/components/payments/pricing-section.tsx) — UI оплаты со свободной суммой и e-mail, обязательным checkbox согласия на обработку ПДн, созданием платежа, polling статуса, запуском widget, сохранением последнего успешного подтверждения на главной
- [`app/thank-you/page.tsx`](/Users/ivankhanaev/LevelChannel/app/thank-you/page.tsx) — страница подтверждения оплаты
- [`app/offer/page.tsx`](/Users/ivankhanaev/LevelChannel/app/offer/page.tsx) — публичная оферта
- [`app/privacy/page.tsx`](/Users/ivankhanaev/LevelChannel/app/privacy/page.tsx) — политика в отношении обработки персональных данных
- [`app/consent/personal-data/page.tsx`](/Users/ivankhanaev/LevelChannel/app/consent/personal-data/page.tsx) — отдельный текст согласия на обработку персональных данных
- [`app/register/page.tsx`](/Users/ivankhanaev/LevelChannel/app/register/page.tsx) — регистрация (Phase 2): email + пароль + 152-ФЗ согласие → `POST /api/auth/register`, успех → `/verify-pending`
- [`app/verify-pending/page.tsx`](/Users/ivankhanaev/LevelChannel/app/verify-pending/page.tsx) — info-страница после регистрации
- [`app/login/page.tsx`](/Users/ivankhanaev/LevelChannel/app/login/page.tsx) — вход (Phase 2): email + пароль → `POST /api/auth/login`, успех → `/cabinet`
- [`app/forgot/page.tsx`](/Users/ivankhanaev/LevelChannel/app/forgot/page.tsx) — запрос сброса пароля (Phase 2): нейтральная confirmation всегда (anti-enumeration)
- [`app/reset/page.tsx`](/Users/ivankhanaev/LevelChannel/app/reset/page.tsx) — установка нового пароля по токену из URL (Phase 2): после успеха `mech-5` уже создал новую сессию
- [`app/cabinet/page.tsx`](/Users/ivankhanaev/LevelChannel/app/cabinet/page.tsx) — server-side gate (Phase 2): прямой `lookupSession` через cookie, 307 на `/login` без сессии. Содержание — placeholder «Кабинет в разработке»
- [`app/cabinet/logout-button.tsx`](/Users/ivankhanaev/LevelChannel/app/cabinet/logout-button.tsx) — client island: `POST /api/auth/logout` + redirect на `/`
- [`app/verify-failed/page.tsx`](/Users/ivankhanaev/LevelChannel/app/verify-failed/page.tsx) — styled UI для истёкшей/использованной verify-ссылки (Phase 2 заменил Phase 1B placeholder)
- [`components/site-header.tsx`](/Users/ivankhanaev/LevelChannel/components/site-header.tsx) — sticky header для auth/legal страниц с `useEffect → fetch /api/auth/me` и переключением «Войти» ↔ «Кабинет»
- [`components/auth-shell.tsx`](/Users/ivankhanaev/LevelChannel/components/auth-shell.tsx) — общая chrome-обёртка для auth страниц (header + центрированная колонка)
- [`components/auth-form-bits.tsx`](/Users/ivankhanaev/LevelChannel/components/auth-form-bits.tsx) — shared `AuthField`, `AuthErrorBox`, `AuthInfoBox`, `authInputStyle` для 4 форм
- [`lib/auth/client.ts`](/Users/ivankhanaev/LevelChannel/lib/auth/client.ts) — браузерный `postAuthJson` helper: единый JSON-shape, нормализация ошибок, обработка 429

### Payment domain

- [`lib/legal/personal-data.ts`](/Users/ivankhanaev/LevelChannel/lib/legal/personal-data.ts) — версия документов и server-side snapshot акцепта согласия
- [`lib/payments/catalog.ts`](/Users/ivankhanaev/LevelChannel/lib/payments/catalog.ts) — payment constraints, суммы и описание услуги
- [`lib/payments/types.ts`](/Users/ivankhanaev/LevelChannel/lib/payments/types.ts) — типы заказа и публичной модели
- [`lib/payments/config.ts`](/Users/ivankhanaev/LevelChannel/lib/payments/config.ts) — payment env config
- [`lib/payments/provider.ts`](/Users/ivankhanaev/LevelChannel/lib/payments/provider.ts) — orchestration: create payment, mark paid/failed, public model
- [`lib/payments/mock.ts`](/Users/ivankhanaev/LevelChannel/lib/payments/mock.ts) — mock provider
- [`lib/payments/cloudpayments.ts`](/Users/ivankhanaev/LevelChannel/lib/payments/cloudpayments.ts) — формирование server-side order и widget intent для CloudPayments / CloudKassir
- [`lib/payments/cloudpayments-webhook.ts`](/Users/ivankhanaev/LevelChannel/lib/payments/cloudpayments-webhook.ts) — webhook payload parsing and verification
- [`lib/payments/cloudpayments-api.ts`](/Users/ivankhanaev/LevelChannel/lib/payments/cloudpayments-api.ts) — server-to-server HTTP клиент для `/payments/tokens/charge` (one-click)
- [`lib/payments/tokens.ts`](/Users/ivankhanaev/LevelChannel/lib/payments/tokens.ts) — извлечение Token из вебхука и публичная маска карты
- [`lib/payments/store.ts`](/Users/ivankhanaev/LevelChannel/lib/payments/store.ts) — adapter layer, выбирает file или postgres backend (заказы + токены карт)
- [`lib/payments/store-file.ts`](/Users/ivankhanaev/LevelChannel/lib/payments/store-file.ts) — файловое хранилище заказов и токенов
- [`lib/payments/store-postgres.ts`](/Users/ivankhanaev/LevelChannel/lib/payments/store-postgres.ts) — PostgreSQL backend для заказов и `payment_card_tokens`
- [`scripts/migrate-payment-orders-to-postgres.mjs`](/Users/ivankhanaev/LevelChannel/scripts/migrate-payment-orders-to-postgres.mjs) — one-shot перенос заказов из JSON в PostgreSQL

### Auth and account layer

Auth-контур уже живёт в коде: есть таблицы, `lib/auth/*`, `lib/email/*`
и `app/api/auth/*`. Полноценный cabinet UI ещё не построен, но backend
маршруты уже участвуют в build и runtime. Гостевой checkout от этого
слоя по-прежнему не зависит.

- [`migrations/0005_accounts.sql`](/Users/ivankhanaev/LevelChannel/migrations/0005_accounts.sql) — `accounts` (uuid PK, email UNIQUE, password_hash, email_verified_at, disabled_at)
- [`migrations/0006_account_roles.sql`](/Users/ivankhanaev/LevelChannel/migrations/0006_account_roles.sql) — `account_roles` (admin / teacher / student через CHECK)
- [`migrations/0007_account_sessions.sql`](/Users/ivankhanaev/LevelChannel/migrations/0007_account_sessions.sql) — `account_sessions` (token_hash UNIQUE, expires_at, revoked_at)
- [`migrations/0008_email_verifications.sql`](/Users/ivankhanaev/LevelChannel/migrations/0008_email_verifications.sql) — single-use verify-email tokens (TTL 24h)
- [`migrations/0009_password_resets.sql`](/Users/ivankhanaev/LevelChannel/migrations/0009_password_resets.sql) — single-use reset tokens (TTL 1h)
- [`migrations/0010_accounts_email_normalized.sql`](/Users/ivankhanaev/LevelChannel/migrations/0010_accounts_email_normalized.sql) — `CHECK (email = lower(btrim(email)))` invariant; защита от shadow accounts при bypass app-слоя
- [`lib/auth/pool.ts`](/Users/ivankhanaev/LevelChannel/lib/auth/pool.ts) — отдельный `pg.Pool` для auth, тот же DATABASE_URL
- [`lib/auth/password.ts`](/Users/ivankhanaev/LevelChannel/lib/auth/password.ts) — bcryptjs, cost=12
- [`lib/auth/tokens.ts`](/Users/ivankhanaev/LevelChannel/lib/auth/tokens.ts) — random 32B base64url + sha256 hash; tokens хранятся только хешем
- [`lib/auth/policy.ts`](/Users/ivankhanaev/LevelChannel/lib/auth/policy.ts) — password policy (8..128 символов, не all-digits)
- [`lib/auth/accounts.ts`](/Users/ivankhanaev/LevelChannel/lib/auth/accounts.ts) — store ops: create / getByEmail / getById / markVerified / setPassword / role grant/revoke + `normalizeAccountEmail` helper (`trim().toLowerCase()`) — единая точка нормализации для всех путей записи/чтения
- [`lib/auth/sessions.ts`](/Users/ivankhanaev/LevelChannel/lib/auth/sessions.ts) — create / lookup / revoke + cookie helpers (`lc_session`, HttpOnly + SameSite=Lax + Secure в проде)
- [`lib/auth/single-use-tokens.ts`](/Users/ivankhanaev/LevelChannel/lib/auth/single-use-tokens.ts) — общий store для verify-email и password-reset (whitelist scope в SQL)
- [`lib/auth/verifications.ts`](/Users/ivankhanaev/LevelChannel/lib/auth/verifications.ts), [`lib/auth/resets.ts`](/Users/ivankhanaev/LevelChannel/lib/auth/resets.ts) — thin wrappers с TTL
- [`lib/auth/consents.ts`](/Users/ivankhanaev/LevelChannel/lib/auth/consents.ts) — store ops для `account_consents` (recordConsent / listAccountConsents / getLatestConsent). Phase 1B D2.
- [`lib/auth/dummy-hash.ts`](/Users/ivankhanaev/LevelChannel/lib/auth/dummy-hash.ts) — module-load bcrypt-хешированный dummy + `constantTimeVerifyPassword`. Закрывает email-enumeration через timing на login (Phase 1B D3).
- [`lib/auth/email-hash.ts`](/Users/ivankhanaev/LevelChannel/lib/auth/email-hash.ts) — HMAC-keyed sha256 нормализованного email через `AUTH_RATE_LIMIT_SECRET` для per-email rate-limit scope keys. Не reuse `TELEMETRY_HASH_SECRET` — разные trust boundaries (Phase 1B mech-3).

### Email transport

- [`lib/email/config.ts`](/Users/ivankhanaev/LevelChannel/lib/email/config.ts) — `RESEND_API_KEY` + `EMAIL_FROM`. Если ключ пустой — console fallback. **Production assertions at module load:** `RESEND_API_KEY` и `AUTH_RATE_LIMIT_SECRET` обязательны при `NODE_ENV=production` — boot аборт если пусты.
- [`lib/email/client.ts`](/Users/ivankhanaev/LevelChannel/lib/email/client.ts) — Resend SDK + dev console writer.
- [`lib/email/escape.ts`](/Users/ivankhanaev/LevelChannel/lib/email/escape.ts) — `escapeHtml` для динамических значений в шаблонах (5 опасных символов).
- [`lib/email/templates/verify.ts`](/Users/ivankhanaev/LevelChannel/lib/email/templates/verify.ts), [`lib/email/templates/reset.ts`](/Users/ivankhanaev/LevelChannel/lib/email/templates/reset.ts), [`lib/email/templates/already-registered.ts`](/Users/ivankhanaev/LevelChannel/lib/email/templates/already-registered.ts) — inline HTML + plain text, RU. URL пропускается через `escapeHtml`. `already-registered` для existing-email path в register flow (Phase 1B D1 timing parity).
- [`lib/email/dispatch.ts`](/Users/ivankhanaev/LevelChannel/lib/email/dispatch.ts) — `sendVerifyEmail`, `sendResetEmail`, `sendAlreadyRegisteredEmail`. URLs построены через `paymentConfig.siteUrl`.

### Test infrastructure (integration)

- [`docker-compose.test.yml`](/Users/ivankhanaev/LevelChannel/docker-compose.test.yml) — `postgres:16.13` service на `127.0.0.1:54329`, tmpfs storage. Точное соответствие prod.
- [`scripts/test-integration.sh`](/Users/ivankhanaev/LevelChannel/scripts/test-integration.sh) — bring up → wait → migrate:up → vitest → tear down. `npm run test:integration`.
- [`vitest.integration.config.ts`](/Users/ivankhanaev/LevelChannel/vitest.integration.config.ts) — отдельный config; tests/integration/**/*.test.ts. Unit `npm run test:run` остаётся быстрым и без Docker dep.

**Auth invariants covered by integration suite.** Эта матрица — source of truth для того, какие security-инварианты уже проверяются Postgres-backed тестами. Если инвариант ниже изменён в коде, регрессия должна падать в указанном файле. Открытые пункты — в `ENGINEERING_BACKLOG.md` § DX and quality.

| Invariant | Where covered |
|---|---|
| Register: byte-equal response для known/unknown email (anti-enumeration shape) | [`tests/integration/auth/register.test.ts`](/Users/ivankhanaev/LevelChannel/tests/integration/auth/register.test.ts) (`returns identical response for already-registered email`) |
| Register: симметричный wall-clock budget для new/existing email path (anti-enumeration timing) | [`tests/integration/auth/register.test.ts`](/Users/ivankhanaev/LevelChannel/tests/integration/auth/register.test.ts) (`register paths take similar wall-clock time`) |
| Login: constant-time через `dummyHash` для unknown-email vs known-email-wrong-password | [`tests/integration/auth/login.test.ts`](/Users/ivankhanaev/LevelChannel/tests/integration/auth/login.test.ts) (`constant-time D3`) |
| Reset: запрос на unknown email возвращает 200 ok (anti-enumeration) | [`tests/integration/auth/reset.test.ts`](/Users/ivankhanaev/LevelChannel/tests/integration/auth/reset.test.ts) (`returns 200 ok for unknown email`) |
| Reset confirm: revoke всех сессий аккаунта до создания новой (mech-5 sign-out-everywhere) | [`tests/integration/auth/reset.test.ts`](/Users/ivankhanaev/LevelChannel/tests/integration/auth/reset.test.ts) (`signs out everywhere on success (mech-5 invariant)`) |
| Session lifecycle: создание / валидация / revoke / expiry | [`tests/integration/auth/session-lifecycle.test.ts`](/Users/ivankhanaev/LevelChannel/tests/integration/auth/session-lifecycle.test.ts) |
| **NOT covered yet:** login with unverified email returns 200 + session (cabinet-allow, payment-gated) | backlog'd в `ENGINEERING_BACKLOG.md` § DX and quality |

### Audit log (payment lifecycle)

Append-only audit-log-of-record для money-bound transitions. Параллельный канал к `payment_telemetry` (которая privacy-friendly funnel-аналитика, HMAC email + /24 IP) — audit хранит full email + full IP для расследования инцидентов. Доступ admin-only; см. `SECURITY.md` § "Audit log — payment lifecycle".

- [`migrations/0012_payment_audit_events.sql`](/Users/ivankhanaev/LevelChannel/migrations/0012_payment_audit_events.sql) — append-only таблица. CHECK enum `event_type` (17 transitions), FK `invoice_id` → `payment_orders` ON DELETE NO ACTION (audit переживает order), structured columns + JSONB `payload`. Индексы: per-invoice, per-account (partial WHERE NOT NULL), per-type-time.
- [`lib/audit/payment-events.ts`](/Users/ivankhanaev/LevelChannel/lib/audit/payment-events.ts) — `recordPaymentAuditEvent(...)` (best-effort: catch + warn + return false; не throw'ит, чтобы business path не валился). `listPaymentAuditEventsByInvoice(invoiceId)` для admin tooling. Экспорт `PAYMENT_AUDIT_EVENT_TYPES` — single source of truth для enum, должен совпадать с миграционным CHECK (закрыто integration-тестом).
- [`lib/audit/pool.ts`](/Users/ivankhanaev/LevelChannel/lib/audit/pool.ts) — изолированный pg Pool (max=4) под audit. Будущая консолидация всех domain pool'ов в общий `lib/db/pool.ts` — backlog item.

Точки записи (route handlers):

- [`app/api/payments/route.ts`](/Users/ivankhanaev/LevelChannel/app/api/payments/route.ts) → `order.created`
- [`app/api/payments/[invoiceId]/cancel/route.ts`](/Users/ivankhanaev/LevelChannel/app/api/payments/[invoiceId]/cancel/route.ts) → `order.cancelled`
- [`app/api/payments/mock/[invoiceId]/confirm/route.ts`](/Users/ivankhanaev/LevelChannel/app/api/payments/mock/[invoiceId]/confirm/route.ts) → `mock.confirmed`
- [`app/api/payments/charge-token/route.ts`](/Users/ivankhanaev/LevelChannel/app/api/payments/charge-token/route.ts) → `charge_token.succeeded` / `charge_token.requires_3ds` / `charge_token.declined`
- [`app/api/payments/3ds-callback/route.ts`](/Users/ivankhanaev/LevelChannel/app/api/payments/3ds-callback/route.ts) → `threeds.callback.received` + `threeds.confirmed` / `threeds.declined`
- [`app/api/payments/webhooks/cloudpayments/pay/route.ts`](/Users/ivankhanaev/LevelChannel/app/api/payments/webhooks/cloudpayments/pay/route.ts) → `webhook.pay.processed`
- [`app/api/payments/webhooks/cloudpayments/fail/route.ts`](/Users/ivankhanaev/LevelChannel/app/api/payments/webhooks/cloudpayments/fail/route.ts) → `webhook.fail.received`

Не покрыто (открытые backlog-items, см. `ENGINEERING_BACKLOG.md`):
- `webhook.check.received` / `webhook.*.declined` / `webhook.pay.validation_failed` — пока пишется только финальный business transition; pre-validation phases требуют переработки `cloudpayments-route` wrapper'а.
- `charge_token.attempted` / `charge_token.error` — pre-call recording требует двухфазной записи; для MVP отдан только финальный исход.

### Schema migrations

- [`scripts/migrate.mjs`](/Users/ivankhanaev/LevelChannel/scripts/migrate.mjs) — минимальный self-contained runner поверх `pg`. Команды: `npm run migrate:up`, `npm run migrate:status`. Применяет файлы `migrations/NNNN_*.sql` по порядку в транзакциях, фиксирует имена в `_migrations`.
- [`migrations/`](/Users/ivankhanaev/LevelChannel/migrations) — SQL-миграции, по одной на изменение схемы.
  - `0001_payment_orders.sql`, `0002_payment_card_tokens.sql`, `0003_payment_telemetry.sql`, `0004_idempotency_records.sql` — повторяют существующие `ensureSchema*` через `create ... if not exists`. На прод-БД, где таблицы уже существуют, `npm run migrate:up` приносит схему под bookkeeping без диффа.
- Legacy `ensureSchema*` функции в `lib/payments/store-postgres.ts`, `lib/security/idempotency-postgres.ts`, `lib/telemetry/store-postgres.ts` остаются как safety net. После того как runner подключён в deploy pipeline и накатан хотя бы один раз на проде, их можно постепенно удалять — но не в этом цикле.

### Security layer

- [`lib/security/request.ts`](/Users/ivankhanaev/LevelChannel/lib/security/request.ts) — origin checks, invoice id validation, per-IP rate limiting
- [`lib/security/rate-limit.ts`](/Users/ivankhanaev/LevelChannel/lib/security/rate-limit.ts) — in-memory limiter
- [`next.config.js`](/Users/ivankhanaev/LevelChannel/next.config.js) — security headers для Node deployment
- [`public/.htaccess`](/Users/ivankhanaev/LevelChannel/public/.htaccess) — security headers для Apache

### Auth API routes (Phase 1B Lane B)

- [`app/api/auth/register/route.ts`](/Users/ivankhanaev/LevelChannel/app/api/auth/register/route.ts) — POST. Symmetric work for new vs existing email path; consent recording on new accounts (D1)
- [`app/api/auth/verify/route.ts`](/Users/ivankhanaev/LevelChannel/app/api/auth/verify/route.ts) — GET click-through; no origin check (mech-4); consumes single-use token; 303 → `/cabinet` on success, `/verify-failed` on failure
- [`app/api/auth/login/route.ts`](/Users/ivankhanaev/LevelChannel/app/api/auth/login/route.ts) — POST. constantTimeVerifyPassword (D3); identical 401 for unknown/disabled/wrong-password (anti-enumeration); allows login on unverified email (D4)
- [`app/api/auth/logout/route.ts`](/Users/ivankhanaev/LevelChannel/app/api/auth/logout/route.ts) — POST. Revokes session, clears cookie. Replay-safe.
- [`app/api/auth/reset-request/route.ts`](/Users/ivankhanaev/LevelChannel/app/api/auth/reset-request/route.ts) — POST. Identical `{ok: true}` for known/unknown email (anti-enumeration)
- [`app/api/auth/reset-confirm/route.ts`](/Users/ivankhanaev/LevelChannel/app/api/auth/reset-confirm/route.ts) — POST. revokeAllSessionsForAccount **before** createSession (mech-5); password-policy gate keeps token unconsumed on weak input
- [`app/api/auth/me/route.ts`](/Users/ivankhanaev/LevelChannel/app/api/auth/me/route.ts) — GET. Bootstrap; same-origin, no origin check; 401 with cookie cleared on missing/expired session
- [`app/api/auth/resend-verify/route.ts`](/Users/ivankhanaev/LevelChannel/app/api/auth/resend-verify/route.ts) — POST. Authenticated; idempotent on already-verified (200 noop); rate-limited 10/min/IP + 3/hour/account. Replaces the Phase 2 cabinet hack of pointing at `/forgot`. Old unconsumed verify tokens are NOT pre-emptively invalidated — single-use enforcement at consume time covers race
- [`app/cabinet/resend-verify-button.tsx`](/Users/ivankhanaev/LevelChannel/app/cabinet/resend-verify-button.tsx) — client island for the cabinet banner button
- [`app/verify-failed/page.tsx`](/Users/ivankhanaev/LevelChannel/app/verify-failed/page.tsx) — minimal placeholder for verify-route failure landing (Lane C; full UI in Phase 2)

### API routes

- [`app/api/payments/route.ts`](/Users/ivankhanaev/LevelChannel/app/api/payments/route.ts) — создание платежа
- [`app/api/payments/[invoiceId]/route.ts`](/Users/ivankhanaev/LevelChannel/app/api/payments/%5BinvoiceId%5D/route.ts) — статус
- [`app/api/payments/[invoiceId]/cancel/route.ts`](/Users/ivankhanaev/LevelChannel/app/api/payments/%5BinvoiceId%5D/cancel/route.ts) — отмена
- [`app/api/payments/events/route.ts`](/Users/ivankhanaev/LevelChannel/app/api/payments/events/route.ts) — клиентская телеметрия
- [`app/api/payments/saved-card/route.ts`](/Users/ivankhanaev/LevelChannel/app/api/payments/saved-card/route.ts) — есть ли у e-mail сохранённая карта (one-click)
- [`app/api/payments/charge-token/route.ts`](/Users/ivankhanaev/LevelChannel/app/api/payments/charge-token/route.ts) — списание по сохранённому токену (one-click)
- [`app/api/payments/3ds-callback/route.ts`](/Users/ivankhanaev/LevelChannel/app/api/payments/3ds-callback/route.ts) — финализация платежа после 3-D Secure (TermUrl)
- [`app/api/health/route.ts`](/Users/ivankhanaev/LevelChannel/app/api/health/route.ts) — health-check для мониторинга
- [`app/api/payments/mock/[invoiceId]/confirm/route.ts`](/Users/ivankhanaev/LevelChannel/app/api/payments/mock/%5BinvoiceId%5D/confirm/route.ts)
- [`app/api/payments/webhooks/cloudpayments/check/route.ts`](/Users/ivankhanaev/LevelChannel/app/api/payments/webhooks/cloudpayments/check/route.ts)
- [`app/api/payments/webhooks/cloudpayments/pay/route.ts`](/Users/ivankhanaev/LevelChannel/app/api/payments/webhooks/cloudpayments/pay/route.ts) — также сохраняет Token для one-click
- [`app/api/payments/webhooks/cloudpayments/fail/route.ts`](/Users/ivankhanaev/LevelChannel/app/api/payments/webhooks/cloudpayments/fail/route.ts)

### One-click flow

1. После успешной оплаты CloudPayments присылает в Pay-вебхук поле `Token`
   (вместе с `CardLastFour`, `CardType`, `CardExpDate`).
2. Сервер сохраняет токен в `payment_card_tokens`, привязывая к нормализованному
   `customerEmail`.
3. На следующем визите фронт делает `POST /api/payments/saved-card`
   с e-mail. Если запись есть, возвращается публичная маска (last4 + тип).
4. Пользователь жмёт «Оплатить картой ··NNNN» → `POST /api/payments/charge-token`.
5. Сервер создаёт ордер, вызывает `POST https://api.cloudpayments.ru/payments/tokens/charge`
   с HTTP Basic (Public ID : API Secret) и ветвится по ответу:
   - `Success: true` → ордер `paid`, `last_used_at` токена обновляется.
   - `AcsUrl + PaReq` → клиент строит auto-submit форму на ACS банка,
     пользователь проходит 3DS, банк POST'ит обратно на
     `/api/payments/3ds-callback`, мы вызываем `post3ds` и финализируем.
   - decline → ордер `failed`, при критичных ReasonCode'ах токен удаляется.

## Payment flow

### Mock mode

1. Пользователь вводит сумму и e-mail
2. Frontend вызывает `POST /api/payments`
3. Server создаёт order через `mock` provider
4. Frontend опрашивает `GET /api/payments/[invoiceId]`
5. Статус автоматически переходит в `paid` по таймеру

### CloudPayments mode

1. Пользователь вводит сумму и e-mail
2. Frontend вызывает `POST /api/payments`
3. Backend проверяет отдельное согласие на обработку ПДн и сохраняет proof of consent в metadata заказа
4. Server создаёт внутренний `invoiceId`, order и widget intent
5. Клиент запускает CloudPayments Widget поверх сайта
6. В widget передаются `externalId`, `receiptEmail`, `receipt`, `userInfo.email`
7. После оплаты CloudPayments отправляет webhook
8. Server валидирует подпись, сумму и `AccountId`
9. Клиент видит финальный статус через polling, страницу `/thank-you` и сохранённую success-карточку на главной после возврата

## Хранилище заказов

Теперь storage выбирается через `PAYMENTS_STORAGE_BACKEND`.

Варианты:

- `file` — JSON-файл в директории `data/`
- `postgres` — таблица `payment_orders` в PostgreSQL

Плюсы:

- просто
- удобно для локальной проверки и MVP
- не требует внешней инфраструктуры

Минусы:

- не годится для multi-instance deployment
- нет транзакционности уровня БД
- ограниченная масштабируемость

Текущий production target: `PostgreSQL`.

## Deployment model

Текущая архитектура требует server runtime.

Подходящие варианты:

- Vercel
- VPS + `next start`
- любой Node.js hosting с постоянным процессом

Неподходящий вариант:

- чистый static export без backend runtime

## Source of truth

Если между документами есть расхождения:

1. код
2. профильный документ-владелец темы из `DOCUMENTATION.md`
3. `README.md`
4. `ROADMAP.md` и `ENGINEERING_BACKLOG.md` только как intent-layer
5. `PRD.md` как исторический документ
