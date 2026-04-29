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
- `RESEND_API_KEY=...` (transactional email; empty → console fallback in dev; **boot fails in prod if empty**)
- `EMAIL_FROM="LevelChannel <noreply@levelchannel.ru>"`
- `AUTH_RATE_LIMIT_SECRET=...` (HMAC key для per-email rate-limit scopes; 32+ chars; **boot fails in prod if empty**)

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

- [DOCUMENTATION.md](/Users/ivankhanaev/LevelChannel/DOCUMENTATION.md) — карта документации, кто чем владеет, что читать первым
- [ARCHITECTURE.md](/Users/ivankhanaev/LevelChannel/ARCHITECTURE.md) — file-by-file карта кода
- [OPERATIONS.md](/Users/ivankhanaev/LevelChannel/OPERATIONS.md) — где сервер, как деплоим, git, БД, runbook
- [SECURITY.md](/Users/ivankhanaev/LevelChannel/SECURITY.md) — hardening + threat model
- [PAYMENTS_SETUP.md](/Users/ivankhanaev/LevelChannel/PAYMENTS_SETUP.md) — CloudPayments, one-click, 3DS, health
- [AGENTS.md](/Users/ivankhanaev/LevelChannel/AGENTS.md) — operating guide для ИИ-агентов
- [ROADMAP.md](/Users/ivankhanaev/LevelChannel/ROADMAP.md) — high-level приоритеты
- [ENGINEERING_BACKLOG.md](/Users/ivankhanaev/LevelChannel/ENGINEERING_BACKLOG.md) — инженерная очередь задач
- [PRD.md](/Users/ivankhanaev/LevelChannel/PRD.md) — исторический продуктовый документ первой версии
- [migrations/README.md](/Users/ivankhanaev/LevelChannel/migrations/README.md) — формат и правила работы с SQL-миграциями

## Что важно помнить

- файловый storage остаётся fallback-режимом, production-целевой backend теперь `PostgreSQL`
- боевой CloudPayments flow уже работает на VPS, а прод обновляется git-based автодеплоем с сервера по `origin/main`
- mock confirm должен оставаться выключенным в production
