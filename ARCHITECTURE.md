# Architecture

## Overview

Проект состоит из двух частей:

- публичный лендинг на `Next.js App Router`
- серверный payment-контур внутри того же приложения

Основная продуктовая логика сейчас сосредоточена в checkout flow и обработке статусов оплаты.

## Структура

### Frontend

- [`app/page.tsx`](/Users/ivankhanaev/LevelChannel/app/page.tsx) — главная страница
- [`components/payments/pricing-section.tsx`](/Users/ivankhanaev/LevelChannel/components/payments/pricing-section.tsx) — UI оплаты со свободной суммой и e-mail, создание платежа, polling статуса, запуск widget, сохранение последнего успешного подтверждения на главной
- [`app/thank-you/page.tsx`](/Users/ivankhanaev/LevelChannel/app/thank-you/page.tsx) — страница подтверждения оплаты
- [`app/offer/page.tsx`](/Users/ivankhanaev/LevelChannel/app/offer/page.tsx) — публичная оферта
- [`app/privacy/page.tsx`](/Users/ivankhanaev/LevelChannel/app/privacy/page.tsx) — политика конфиденциальности

### Payment domain

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
3. Server создаёт внутренний `invoiceId`, order и widget intent
4. Клиент запускает CloudPayments Widget поверх сайта
5. В widget передаются `externalId`, `receiptEmail`, `receipt`, `userInfo.email`
6. После оплаты CloudPayments отправляет webhook
7. Server валидирует подпись, сумму и `AccountId`
8. Клиент видит финальный статус через polling, страницу `/thank-you` и сохранённую success-карточку на главной после возврата

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
2. `README.md`
3. `ARCHITECTURE.md`
4. `PAYMENTS_SETUP.md`
5. `PRD.md` как исторический документ
