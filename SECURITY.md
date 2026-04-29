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

## Auth and account layer

Auth backend уже подключён: таблицы, `lib/auth/*`, `lib/email/*` и
`/api/auth/*` живут в runtime. Полного cabinet UI пока нет, но security
инварианты ниже уже обязательны для работающих маршрутов.

- пароли: `bcryptjs`, cost=12. Никакого pepper'а в текущей итерации;
  если будем добавлять — отдельная миграция rehash'а.
- session cookie: `lc_session`, `HttpOnly` + `SameSite=Lax` + `Secure`
  в проде. В БД хранится только sha256 от cookie value, никогда plain.
  Запись в `account_sessions` имеет `expires_at` (7 дней) + `revoked_at`
  для sign-out.
- single-use токены (verify-email, password-reset) хранятся как sha256;
  consumed_at ставится атомарно в одной транзакции с проверкой TTL,
  чтобы replay возвращал тот же "invalid or already used".
- email enumeration: и для register, и для reset-request ответ должен
  быть одинаковым "we sent a link if the email exists". В route handlers
  это уже реализовано, а lib/-модули сами по себе enumeration не
  предотвращают.
- password reset должен revoke'ать все active session'ы аккаунта
  (sign-out everywhere). Это уже делается через
  `revokeAllSessionsForAccount` в reset-confirm handler'е.
- transport (Resend) даёт console-fallback в dev. **В проде гейт уже стоит
  (Phase 1B Lane A):** `lib/email/config.ts` бросает на module load если
  `RESEND_API_KEY` или `AUTH_RATE_LIMIT_SECRET` пусты под `NODE_ENV=production`.
- per-email rate-limit scopes (lib/auth/email-hash.ts) keyed by dedicated
  `AUTH_RATE_LIMIT_SECRET`. **NOT reuse** `TELEMETRY_HASH_SECRET` — разные
  trust boundaries: telemetry secret keys persistent analytics, rate-limit
  secret keys ephemeral in-memory buckets. Mixing их couples rotation
  cadences artificially.
- email-нормализация: `lib/auth/accounts.ts.normalizeAccountEmail` =
  `email.trim().toLowerCase()` на всех read/write путях. DB-level
  CHECK в `migrations/0010_accounts_email_normalized.sql` ловит bypass
  app-слоя (data migration, ручной psql), отвергая non-normalized
  insert до того, как он создаст shadow account. UNIQUE-индекс на
  `accounts.email` остаётся обычным — на нормализованных данных он
  эквивалентен функциональному без оверхеда.
- HTML-escape для transactional templates: `lib/email/escape.ts`
  применяется к каждому динамическому значению (verify/reset URL),
  даже если значение сегодня заведомо безопасно. Защита от того, что
  завтра кто-то поменяет format токена на содержащий `"` или `<`.
- single-use-tokens whitelist invariant: `tableFor(scope)` бросает
  типизированную ошибку, если scope невалиден; SQL никогда не строится
  на `undefined`-имени таблицы.

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

## Phase 0 server-side hardening — закрыт 2026-04-29

Все пять пунктов аудита 2026-04-29 выполнены. Эффективное состояние:

| Что | Было | Сейчас |
|---|---|---|
| `PermitRootLogin` | `yes` | `prohibit-password` (только publickey для root) |
| `PasswordAuthentication` | `yes` (через cloud-init override) | `no` — cloud-init override переписан на `PasswordAuthentication no` |
| Bind `next start` | `*:3000` | `127.0.0.1:3000` (через `--hostname 127.0.0.1 --port 3000` в systemd unit) |
| nginx rate limiting | отсутствует | `limit_req_zone lcapi 30r/m burst=20 nodelay` на `/api/*`. CP webhooks (`^~ /api/payments/webhooks/`) исключены — HMAC + amount cross-check там единственный trust boundary |
| Backup БД | не настроен | ежедневный `pg_dump --no-owner --no-acl --clean --if-exists` в `__LEVELCHANNEL_BACKUP_DIR__/db-YYYY-MM-DD.sql.gz`, retention 14d, perms 600 + dir 700, restore drill пройден |

Backup'ы исходных конфигов на проде сохранены с суффиксом `.bak-<timestamp>`
для быстрого rollback. Детали и runbook — `OPERATIONS.md §3` (SSH/systemd)
и `§13` (статус долгов).

Конкретные шаги по оставшимся пунктам — в `OPERATIONS.md §6` (deploy,
rollback, проверка timer'а) и `§13` (SSH hardening, app binding).

## Обязательные меры перед production

### Infra

- только HTTPS — выполнено (Let's Encrypt + auto-renew)
- reverse proxy: `nginx` — выполнено
- firewall (ufw): открыто `22/80/443` + `10050/tcp` — выполнено
- SSH publickey-only — **выполнено 2026-04-29** (PasswordAuthentication no, PermitRootLogin prohibit-password)
- systemd service с restart policy — выполнено (`Restart=always RestartSec=5`)
- log rotation — стандартный `journald` rotation, sufficient для текущего объёма

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
