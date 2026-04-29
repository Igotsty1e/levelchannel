# Architecture

## Overview

Проект состоит из двух частей:

- публичный лендинг на `Next.js App Router`
- серверный payment-контур внутри того же приложения

Основная продуктовая логика сейчас сосредоточена в checkout flow и обработке статусов оплаты.

## Структура

### Frontend

- [`app/page.tsx`](/Users/ivankhanaev/LevelChannel/app/page.tsx) — главная страница
- [`components/payments/pricing-section.tsx`](/Users/ivankhanaev/LevelChannel/components/payments/pricing-section.tsx) — UI оплаты со свободной суммой и e-mail, обязательным checkbox согласия на обработку ПДн, созданием платежа, polling статуса, запуском widget, сохранением последнего успешного подтверждения на главной
- [`app/thank-you/page.tsx`](/Users/ivankhanaev/LevelChannel/app/thank-you/page.tsx) — страница подтверждения оплаты
- [`app/offer/page.tsx`](/Users/ivankhanaev/LevelChannel/app/offer/page.tsx) — публичная оферта
- [`app/privacy/page.tsx`](/Users/ivankhanaev/LevelChannel/app/privacy/page.tsx) — политика в отношении обработки персональных данных
- [`app/consent/personal-data/page.tsx`](/Users/ivankhanaev/LevelChannel/app/consent/personal-data/page.tsx) — отдельный текст согласия на обработку персональных данных

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

### Auth foundation

Backend-only слой для будущего кабинета. UI и API-роуты ещё не подключены —
эта итерация добавляет таблицы и lib/-модули; следующая фаза подключит
`/api/auth/*` и страницы. Гостевой checkout от него не зависит.

- [`migrations/0005_accounts.sql`](/Users/ivankhanaev/LevelChannel/migrations/0005_accounts.sql) — `accounts` (uuid PK, email UNIQUE, password_hash, email_verified_at, disabled_at)
- [`migrations/0006_account_roles.sql`](/Users/ivankhanaev/LevelChannel/migrations/0006_account_roles.sql) — `account_roles` (admin / teacher / student через CHECK)
- [`migrations/0007_account_sessions.sql`](/Users/ivankhanaev/LevelChannel/migrations/0007_account_sessions.sql) — `account_sessions` (token_hash UNIQUE, expires_at, revoked_at)
- [`migrations/0008_email_verifications.sql`](/Users/ivankhanaev/LevelChannel/migrations/0008_email_verifications.sql) — single-use verify-email tokens (TTL 24h)
- [`migrations/0009_password_resets.sql`](/Users/ivankhanaev/LevelChannel/migrations/0009_password_resets.sql) — single-use reset tokens (TTL 1h)
- [`lib/auth/pool.ts`](/Users/ivankhanaev/LevelChannel/lib/auth/pool.ts) — отдельный `pg.Pool` для auth, тот же DATABASE_URL
- [`lib/auth/password.ts`](/Users/ivankhanaev/LevelChannel/lib/auth/password.ts) — bcryptjs, cost=12
- [`lib/auth/tokens.ts`](/Users/ivankhanaev/LevelChannel/lib/auth/tokens.ts) — random 32B base64url + sha256 hash; tokens хранятся только хешем
- [`lib/auth/policy.ts`](/Users/ivankhanaev/LevelChannel/lib/auth/policy.ts) — password policy (8..128 символов, не all-digits)
- [`lib/auth/accounts.ts`](/Users/ivankhanaev/LevelChannel/lib/auth/accounts.ts) — store ops: create / getByEmail / getById / markVerified / setPassword / role grant/revoke
- [`lib/auth/sessions.ts`](/Users/ivankhanaev/LevelChannel/lib/auth/sessions.ts) — create / lookup / revoke + cookie helpers (`lc_session`, HttpOnly + SameSite=Lax + Secure в проде)
- [`lib/auth/single-use-tokens.ts`](/Users/ivankhanaev/LevelChannel/lib/auth/single-use-tokens.ts) — общий store для verify-email и password-reset (whitelist scope в SQL)
- [`lib/auth/verifications.ts`](/Users/ivankhanaev/LevelChannel/lib/auth/verifications.ts), [`lib/auth/resets.ts`](/Users/ivankhanaev/LevelChannel/lib/auth/resets.ts) — thin wrappers с TTL

### Email transport

- [`lib/email/config.ts`](/Users/ivankhanaev/LevelChannel/lib/email/config.ts) — `RESEND_API_KEY` + `EMAIL_FROM`. Если ключ пустой — console fallback.
- [`lib/email/client.ts`](/Users/ivankhanaev/LevelChannel/lib/email/client.ts) — Resend SDK + dev console writer.
- [`lib/email/templates/verify.ts`](/Users/ivankhanaev/LevelChannel/lib/email/templates/verify.ts), [`lib/email/templates/reset.ts`](/Users/ivankhanaev/LevelChannel/lib/email/templates/reset.ts) — inline HTML + plain text, RU.
- [`lib/email/dispatch.ts`](/Users/ivankhanaev/LevelChannel/lib/email/dispatch.ts) — `sendVerifyEmail`, `sendResetEmail` с URL построением через `paymentConfig.siteUrl`.

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
