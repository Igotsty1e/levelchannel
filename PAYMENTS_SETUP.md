# Payments Setup

Текущее состояние на 28 апреля 2026:

- фронтенд уже подключён к `/api/payments`;
- пользователь вводит `сумму + e-mail`, после чего запускается CloudPayments Widget;
- провайдер по умолчанию: `mock`;
- реальный режим CloudPayments включается через `.env`.
- проект работает на `Next.js 16`;
- mock confirm endpoint должен использоваться только для локальной проверки и staging.

## Что уже сделано

- сайт больше не собран как static export-only приложение;
- добавлены API routes для создания платежей и чтения статуса;
- добавлен `thank-you` flow после успешной оплаты;
- добавлены webhook routes CloudPayments:
  - `/api/payments/webhooks/cloudpayments/check`
  - `/api/payments/webhooks/cloudpayments/pay`
  - `/api/payments/webhooks/cloudpayments/fail`
- добавлено файловое хранилище заказов в `data/payment-orders.json`;
- добавлена передача `receiptEmail` и `receipt` для CloudPayments / CloudKassir.
- добавлены rate limiting, origin checks и HMAC verification для webhook'ов.

## Что нужно для боевого включения

1. Развернуть сайт как Node.js-приложение:
   - Vercel
   - VPS + `next start`
   - любой другой хостинг с постоянным серверным процессом
2. Заполнить `.env`:
   - `PAYMENTS_PROVIDER=cloudpayments`
   - `PAYMENTS_ALLOW_MOCK_CONFIRM=false`
   - `NEXT_PUBLIC_SITE_URL=https://ваш-домен`
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

## Важно перед production

- Текущее хранилище заказов файловое. Для первых тестов и MVP на VPS этого достаточно, но для production лучше вынести заказы в БД.
- Путь к файловому хранилищу намеренно ограничен директорией `data/`, чтобы конфиг не мог увести запись в произвольное место файловой системы.
- Чеки уже завязаны на передачу `receipt` и `receiptEmail`, но фактическая отправка зависит от настройки CloudKassir в кабинете.
- Для multi-instance deployment обязательно заменить in-memory rate limiter и файловое хранилище.
- Если платежи пойдут в production, нужен отдельный backup / retention plan для order storage.

## Что ещё нужно будет сделать позже

1. Перейти на БД
2. Добавить operator notifications о successful payment
3. Добавить reconciliation / admin tooling
4. Добавить monitoring и alerting по webhook failures
5. Добавить operator notification о новой успешной оплате
