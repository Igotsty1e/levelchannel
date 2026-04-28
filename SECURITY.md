# Security

## Текущее состояние

Проект прошёл базовый hardening для публичного сайта с payment API.

Уже внедрено:

- `Content-Security-Policy`
- `Strict-Transport-Security`
- `X-Frame-Options`
- `Referrer-Policy`
- `Permissions-Policy`
- `Cross-Origin-Opener-Policy`
- `Cross-Origin-Resource-Policy`
- запрет DNS prefetch
- origin checks для browser-initiated payment requests
- `sec-fetch-site` filtering
- in-memory rate limiting по IP
- валидация `invoiceId`
- `Cache-Control: no-store` для payment responses
- HMAC verification для CloudPayments webhook'ов
- валидация суммы на сервере, без доверия сумме и e-mail с клиента
- ограничение mock confirm в production
- payment storage file исключён из репозитория
- `npm audit --omit=dev` чистый на текущем lockfile

## Защищаемые активы

- статусы заказов
- суммы платежей
- CloudPayments credentials
- webhook endpoints
- server logs и технические данные заказа

## Реализованные меры

### 1. Frontend / Browser

- жёсткий CSP для снижения XSS и injection surface
- пользовательская форма оплаты ограничена только `amount + email`
- нет `dangerouslySetInnerHTML`
- чувствительный order state хранится только как `invoiceId` в `localStorage`

### 2. API

- `POST /api/payments` принимает только `amountRub` и `customerEmail`
- invalid invoice ids отклоняются до обращения к storage
- rate limiting на create / status / mock confirm routes
- browser-origin filtering для mutation endpoints
- чувствительные ответы не кешируются

### 3. Payments

- webhook подпись CloudPayments проверяется через HMAC
- webhook amount сверяется с сохранённым order amount
- webhook `AccountId` / `Email` сверяется с сохранённым e-mail заказа
- duplicate events сохраняются как audit trail
- `fail` после `paid` не перетирает успешный статус
- чек уходит на e-mail через CloudPayments / CloudKassir, сайт не отправляет его сам

### 4. Secrets

- `.env` исключён из репозитория
- payment storage file исключён из репозитория
- CloudPayments credentials используются только на сервере

## Оставшиеся ограничения

- limiter in-memory, значит не синхронизируется между инстансами
- storage файловый, не годится для multi-node production
- нет WAF / reverse-proxy limiting на уровне инфраструктуры
- нет централизованного audit log storage
- нет Sentry / alerting / intrusion visibility

## Обязательные меры перед production

### Infra

- только HTTPS
- reverse proxy: `nginx` или `caddy`
- firewall: открыть только `80/443` и управляемый `SSH`
- вход по SSH только по ключам
- отключить password auth для SSH
- systemd service с restart policy
- log rotation

### App

- `PAYMENTS_ALLOW_MOCK_CONFIRM=false`
- боевые CloudPayments credentials
- реальный `NEXT_PUBLIC_SITE_URL`
- webhook URLs в кабинете CloudPayments
- backup strategy для `data/` или переход на БД

### Monitoring

- uptime monitor
- webhook failure alerting
- disk usage monitoring
- basic app logs aggregation

## Рекомендуемые будущие улучшения

1. Перевести orders в `PostgreSQL`
2. Вынести limiter в `Redis`
3. Добавить structured audit log
4. Добавить Sentry / error tracking
5. Добавить отдельный health endpoint
6. Добавить admin-safe reconciliation tool для платежей
7. Перенести orders в БД перед multi-instance production

## Правило по изменениям

Любые будущие изменения payment flow должны сопровождаться:

- обновлением `README.md`
- обновлением `PAYMENTS_SETUP.md`
- пересмотром `SECURITY.md`, если меняются trust boundaries или секреты
