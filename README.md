# LevelChannel

Конверсионный сайт для индивидуальных занятий по английскому языку с серверной интеграцией оплаты через CloudPayments Widget.

## Текущее состояние

- стек: `Next.js 16`, `React 18`, `App Router`, `TypeScript`
- сайт работает как Node.js-приложение, а не как static export
- оплата уже встроена в UI и API
- checkout работает по сценарию `свободная сумма + e-mail + CloudPayments popup widget`
- перед созданием платежа пользователь обязан подтвердить отдельное согласие на обработку персональных данных
- провайдер по умолчанию: `mock`
- storage backend: `file` или `postgres`
- реальный режим CloudPayments включается через `.env`
- проект прошёл базовый hardening: security headers, origin checks, rate limiting, webhook signature verification

## Быстрый старт

1. Установить зависимости:

```bash
npm install
```

2. Создать `.env` на основе [`.env.example`](/Users/ivankhanaev/LevelChannel/.env.example)

3. Запустить локально:

```bash
npm run dev
```

4. Production build:

```bash
npm run build
npm run start
```

## Переменные окружения

Минимальный набор:

- `PAYMENTS_PROVIDER=mock|cloudpayments`
- `PAYMENTS_STORAGE_BACKEND=file|postgres`
- `PAYMENTS_STORAGE_FILE=payment-orders.json`
- `PAYMENTS_MOCK_AUTO_CONFIRM_SECONDS=20`
- `PAYMENTS_ALLOW_MOCK_CONFIRM=true|false`
- `NEXT_PUBLIC_SITE_URL=http://localhost:3000`
- `DATABASE_URL=postgresql://...`
- `TELEMETRY_HASH_SECRET=...`
- `CLOUDPAYMENTS_PUBLIC_ID=...`
- `CLOUDPAYMENTS_API_SECRET=...`

## Основные маршруты

Страницы:

- `/`
- `/offer`
- `/privacy`
- `/consent/personal-data`
- `/thank-you`

Payment API:

- `POST /api/payments`
- `GET /api/payments/[invoiceId]`
- `POST /api/payments/mock/[invoiceId]/confirm`
- `POST /api/payments/webhooks/cloudpayments/check`
- `POST /api/payments/webhooks/cloudpayments/pay`
- `POST /api/payments/webhooks/cloudpayments/fail`

## Документация

- [ARCHITECTURE.md](/Users/ivankhanaev/LevelChannel/ARCHITECTURE.md) — file-by-file карта кода
- [OPERATIONS.md](/Users/ivankhanaev/LevelChannel/OPERATIONS.md) — где сервер, как деплоим, git, БД, runbook
- [SECURITY.md](/Users/ivankhanaev/LevelChannel/SECURITY.md) — hardening + threat model
- [PAYMENTS_SETUP.md](/Users/ivankhanaev/LevelChannel/PAYMENTS_SETUP.md) — CloudPayments, one-click, 3DS, health
- [AGENTS.md](/Users/ivankhanaev/LevelChannel/AGENTS.md) — operating guide для ИИ-агентов
- [ROADMAP.md](/Users/ivankhanaev/LevelChannel/ROADMAP.md)
- [PRD.md](/Users/ivankhanaev/LevelChannel/PRD.md) — исторический продуктовый документ первой версии

## Что уже сделано

- лендинг переведён на `Next.js 16`
- подключён серверный контур для оплат
- встроен CloudPayments card/widget flow с передачей `receiptEmail`
- добавлена отдельная страница согласия на обработку персональных данных и серверная фиксация акцепта checkbox в заказе
- добавлен mock-режим для локальной проверки checkout flow
- подготовлены webhook'и CloudPayments
- проведён дополнительный security hardening
- добавлен PostgreSQL storage backend и миграционный скрипт `npm run migrate:payments:postgres`
- зависимости обновлены, `npm audit --omit=dev` сейчас чистый

## Что важно помнить

- файловый storage остаётся fallback-режимом, production-целевой backend теперь `PostgreSQL`
- боевой CloudPayments flow ещё не прогнан до конца, потому что нет рабочего production deploy + webhook setup
- mock confirm должен оставаться выключенным в production

## Рекомендуемый следующий шаг

Поднять и включить `PostgreSQL` в `.env`, прогнать миграцию заказов, затем проверить реальный end-to-end тест widget flow, webhook'ов и отправки чеков через CloudKassir.
