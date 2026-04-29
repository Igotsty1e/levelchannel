# Payments Setup

Этот файл описывает текущий payment contract в коде и checklist для
нового или повторного боевого окружения.

## Текущий payment contract

- фронтенд уже подключён к `/api/payments`;
- пользователь вводит `сумму + e-mail`, подтверждает отдельное согласие на обработку ПДн, после чего запускается CloudPayments Widget;
- провайдер по умолчанию: `mock`;
- storage backend по умолчанию: `file`;
- реальный режим CloudPayments включается через `.env`.
- проект работает на `Next.js 16`;
- mock confirm endpoint должен использоваться только для локальной проверки и staging.

## Что нужно для нового боевого окружения

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

Production runtime и фактический VPS runbook сейчас описаны в `OPERATIONS.md`.
Раздел ниже оставляем как contract-level checklist для нового окружения или
повторной настройки.

## Важно перед production

- Для production теперь целевой backend: `PostgreSQL`.
- Путь к файловому хранилищу намеренно ограничен директорией `data/`, чтобы конфиг не мог увести запись в произвольное место файловой системы.
- Чеки уже завязаны на передачу `receipt` и `receiptEmail`, но фактическая отправка зависит от настройки CloudKassir в кабинете.
- Для multi-instance deployment обязательно заменить in-memory rate limiter.
- Backup / retention plan для order storage и удаления ПДн должен быть зафиксирован в `OPERATIONS.md`.

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

Удобно подключить к внешнему uptime-monitor'у или watchdog'у.

## Что делать дальше

Стратегические приоритеты по оплате держим в `ROADMAP.md`, а конкретные
инженерные задачи по payment domain и observability, в
`ENGINEERING_BACKLOG.md`.
