# Payments Setup

Текущее состояние на 28 апреля 2026:

- фронтенд уже подключён к `/api/payments`;
- пользователь вводит `сумму + e-mail`, после чего запускается CloudPayments Widget;
- провайдер по умолчанию: `mock`;
- storage backend по умолчанию: `file`;
- реальный режим CloudPayments включается через `.env`.
- проект работает на `Next.js 16`;
- mock confirm endpoint должен использоваться только для локальной проверки и staging.

## Что уже сделано

- сайт больше не собран как static export-only приложение;
- добавлены API routes для создания платежей и чтения статуса;
- добавлен `thank-you` flow после успешной оплаты;
- добавлено сохранение последнего успешного подтверждения на главной, чтобы пользователь не терял результат после возврата с банка;
- добавлены webhook routes CloudPayments:
  - `/api/payments/webhooks/cloudpayments/check`
  - `/api/payments/webhooks/cloudpayments/pay`
  - `/api/payments/webhooks/cloudpayments/fail`
- добавлен PostgreSQL backend для заказов;
- файловое хранилище заказов в `data/payment-orders.json` оставлено как fallback;
- добавлена передача `receiptEmail` и `receipt` для CloudPayments / CloudKassir.
- добавлены rate limiting, origin checks и HMAC verification для webhook'ов.
- добавлены one-click платежи: `/api/payments/saved-card` и `/api/payments/charge-token`,
  токены сохраняются в `payment_card_tokens` после Pay-вебхука.

## Что нужно для боевого включения

1. Развернуть сайт как Node.js-приложение:
   - Vercel
   - VPS + `next start`
   - любой другой хостинг с постоянным серверным процессом
2. Заполнить `.env`:
   - `PAYMENTS_PROVIDER=cloudpayments`
   - `PAYMENTS_STORAGE_BACKEND=postgres`
   - `PAYMENTS_ALLOW_MOCK_CONFIRM=false`
   - `NEXT_PUBLIC_SITE_URL=https://ваш-домен`
   - `DATABASE_URL=postgresql://...`
   - `TELEMETRY_HASH_SECRET=...`
   - `CLOUDPAYMENTS_PUBLIC_ID=...`
   - `CLOUDPAYMENTS_API_SECRET=...`
3. В кабинете CloudPayments проверить, что включены нужные методы оплаты в форме (`Банковская карта`, при необходимости `T-Pay` и др.).
4. В кабинете CloudPayments / CloudKassir убедиться, что касса переведена в боевой режим и чеки отправляются на e-mail.
5. В кабинете CloudPayments настроить webhook'и:
   - Check -> `https://ваш-домен/api/payments/webhooks/cloudpayments/check`
   - Pay -> `https://ваш-домен/api/payments/webhooks/cloudpayments/pay`
   - Fail -> `https://ваш-домен/api/payments/webhooks/cloudpayments/fail`
6. Прогнать тестовый платёж.
7. Убедиться, что после оплаты status меняется через webhook, а не только через polling.
8. Убедиться, что на e-mail приходит чек от CloudPayments / CloudKassir.
9. Если до этого использовался JSON storage, прогнать:

```bash
npm run migrate:payments:postgres
```

## Важно перед production

- Для production теперь целевой backend: `PostgreSQL`.
- Путь к файловому хранилищу намеренно ограничен директорией `data/`, чтобы конфиг не мог увести запись в произвольное место файловой системы.
- Чеки уже завязаны на передачу `receipt` и `receiptEmail`, но фактическая отправка зависит от настройки CloudKassir в кабинете.
- Для multi-instance deployment обязательно заменить in-memory rate limiter.
- Если платежи пойдут в production, нужен отдельный backup / retention plan для order storage.

## One-click (платёж в один клик)

CloudPayments возвращает `Token` в Pay-уведомлении после успешной первой оплаты.
Токен сохраняется в БД и привязывается к `customerEmail`. На следующем визите
тот же e-mail увидит кнопку «Оплатить картой ··NNNN».

Серверная часть:

1. `POST /api/payments/saved-card` — отдаёт `{ savedCard: { cardLastFour, cardType, createdAt } | null }`.
   Защищён origin-check + rate limit (10/мин/IP).
2. `POST /api/payments/charge-token` — создаёт ордер и вызывает
   `https://api.cloudpayments.ru/payments/tokens/charge` с HTTP Basic Auth
   (`Public ID : API Secret`). Возможные ответы клиенту:
   - `{ status: 'paid', order }` — списание прошло, перенаправляем на `/thank-you`.
   - `{ status: 'requires_widget', order }` — банк потребовал 3-D Secure,
     ордер остаётся `pending`, фронт предлагает обычную форму.
   - `{ status: 'declined', order, message }` — отказ, ордер `failed`.

В кабинете CloudPayments обязательно включить «Оплата по токену» / cofRecurring
(если терминал не поддерживает, `tokens/charge` вернёт ошибку).

### 3-D Secure flow (полностью реализован)

Если на первом one-click-списании банк требует 3DS, поток такой:

1. CloudPayments возвращает `Success: false, Model: { TransactionId, AcsUrl, PaReq, ThreeDsCallbackId }`.
2. Сервер сохраняет `metadata.threeDs` в ордере и возвращает клиенту
   `{ status: 'requires_3ds', threeDs: { acsUrl, paReq, transactionId, termUrl } }`.
3. Клиент строит auto-submitting `<form method="POST" action="acsUrl">` с
   полями `PaReq`, `MD=transactionId`, `TermUrl=https://site/api/payments/3ds-callback?invoiceId=...`.
4. Браузер уходит в окно банка, пользователь подтверждает.
5. Банк POST'ит на `TermUrl` form-данными `MD=...&PaRes=...`.
6. `app/api/payments/3ds-callback/route.ts` читает `PaRes`, вызывает
   `https://api.cloudpayments.ru/payments/cards/post3ds` (HTTP Basic),
   обновляет ордер и редиректит юзера 303 на `/thank-you` или
   `/?payment=failed`.

### Health endpoint

`GET /api/health` отдаёт:

- `{ status: 'ok' }` со статусом 200 — runtime жив, БД пингуется,
  CloudPayments creds на месте.
- `{ status: 'degraded' }` со статусом 503 — что-то критичное не настроено.

Удобно подключить к Render uptime-monitor'у или внешнему watchdog'у.

## Что ещё нужно будет сделать позже

1. Operator notifications о successful payment (Sentry / e-mail / Slack)
2. Reconciliation / admin tooling
3. Monitoring и alerting по webhook failures
4. Redis для rate-limit при переходе на multi-instance деплой
5. Покрытие интеграционными тестами (живая Postgres + sandbox CP terminal)
