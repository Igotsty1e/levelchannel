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
- HMAC verification для CloudPayments webhook'ов по `X-Content-HMAC` и `Content-HMAC`
  (HMAC-SHA256 в base64 поверх raw body, без перекодировки)
- валидация суммы на сервере, без доверия сумме и e-mail с клиента
- отдельное server-side доказательство акцепта согласия на обработку ПДн
  (timestamp, версия документа, путь документа, IP, user-agent)
- ограничение mock confirm в production (по умолчанию закрыто, открывается явным `PAYMENTS_ALLOW_MOCK_CONFIRM=true`)
- transactional `SELECT ... FOR UPDATE` на изменение ордера в Postgres — защита от TOCTOU при конкурентных вебхуках
- one-click charge (`/api/payments/charge-token`) проксирует CloudPayments
  Token API через server-side Basic Auth, токены никогда не уходят в браузер
- payment storage file исключён из репозитория
- телеметрия хешируется отдельным `TELEMETRY_HASH_SECRET`, без fallback на CloudPayments secret
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
- создание платежа и one-click charge запрещены без явного checkbox consent на обработку ПДн
- нет `dangerouslySetInnerHTML`
- чувствительный order state хранится только как `invoiceId` в `localStorage`

### 2. API

- `POST /api/payments` принимает только `amountRub`, `customerEmail` и флаг подтверждённого consent
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
- payment telemetry: postgres основной путь, файловый fallback на случай
  сбоя БД (см. `lib/telemetry/store.ts`)
- нет WAF / reverse-proxy limiting на уровне инфраструктуры
- нет централизованного audit log storage
- нет Sentry / alerting / intrusion visibility

## Известные server-side hardening долги (production VPS)

Найдены в ходе аудита 2026-04-29. Краткосрочно прикрыты `ufw`, который
пропускает наружу только `22/80/443/10050`, но это митигация, не решение.

| Что | Текущее | Должно быть | Риск |
|---|---|---|---|
| `PermitRootLogin` | `yes` | `prohibit-password` или `no` | прямой root по SSH |
| `PasswordAuthentication` | `yes` | `no` (только ключи) | brute-force на 22 порт |
| Bind `next start` | `*:3000` | `127.0.0.1:3000` | при ошибке firewall — голое приложение в интернете без TLS |
| nginx rate limiting | отсутствует (только app-level in-memory) | `limit_req_zone` на mutation роутах | DDoS на `/api/payments/*` пробивает к Node |
| Backup БД | не настроен | ежедневный `pg_dump`, retention 14+ дней | при отказе диска — потеря всех платёжных записей |
| Production drift | прод не на git, отстаёт от `main` на 5+ коммитов | git-checkout на сервере + автоматизированный deploy | в проде сейчас работает версия БЕЗ consent capture для 152-ФЗ |

Конкретные шаги по закрытию — в `OPERATIONS.md §6` (deploy / переход на
git) и `§13` (SSH hardening, app binding).

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
- backup strategy для `PostgreSQL` и `data/` telemetry logs

### Monitoring

- uptime monitor
- webhook failure alerting
- disk usage monitoring
- basic app logs aggregation

## Рекомендуемые будущие улучшения

1. Вынести limiter в `Redis`
2. Добавить structured audit log
3. Добавить Sentry / error tracking
4. Добавить отдельный health endpoint
5. Добавить admin-safe reconciliation tool для платежей
6. Перевести payment telemetry из файла в БД или log pipeline

## Правило по изменениям

Любые будущие изменения payment flow должны сопровождаться:

- обновлением `README.md`
- обновлением `PAYMENTS_SETUP.md`
- пересмотром `SECURITY.md`, если меняются trust boundaries или секреты
