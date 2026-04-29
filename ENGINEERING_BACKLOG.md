# Engineering Backlog

Конкретная очередь инженерных задач. Этот файл описывает что ещё нужно
реализовать, а не текущее фактическое состояние продакшена.

Если задача уже работает в коде или на сервере, ей не место в backlog.

## Cabinet expansion (next phases)

Гостевой checkout не трогается — дальнейшие фазы additive.

Уже закрыто и не живёт в backlog:

- Phase 0 stabilization
- Phase 1A auth foundation
- Phase 1B auth API routes
- Phase 2 auth UI

Открытая high-level очередь:

- Phase 3 — profiles + admin pricing
- Phase 4 — scheduling
- Phase 5 — lesson lifecycle + 24h rule
- Phase 6 — cabinet payment + `payment_allocations` + legal/receipt polish

Перед стартом любой из этих фаз нужен свежий in-repo design doc. Код,
owner-docs и git history важнее старых chat outputs.

## P0

### Production reliability

- ~~подключить uptime / failure alerting на приложение~~ — **закрыто 2026-04-29**: GitHub Actions cron `*/5 *` пингует `/api/health` и открывает/закрывает issue с лейблом `uptime-incident`. Runbook в `OPERATIONS.md §9`. Detection latency ~5–15 мин (cron + GH Actions schedule jitter). Если потребуется sub-minute precision — добавить второй слой (BetterStack / Healthchecks.io)
- ~~добавить failure alerting **на webhook-контур** (CloudPayments check/pay/fail)~~ — **shipped 2026-04-29 (workflow side, требует patch на сервере для активации)**: `scripts/webhook-flow-alert.mjs` + systemd unit/timer (`scripts/systemd/`) — каждые 30 минут читает `payment_audit_events` за час и шлёт email через Resend если `(paid + fail) / created < 0.3` при ≥5 созданных заказов. Активация: `cp scripts/systemd/*.service /etc/systemd/system/` + `cp ...timer` + `systemctl enable --now`. Подробно — `OPERATIONS.md §9` Webhook-flow alerting
- ~~добавить сигнал о неуспешном git-based deploy или зависшем `levelchannel-autodeploy.timer`~~ — **shipped 2026-04-29 (workflow side, требует patch на сервере для активации)**: `.github/workflows/deploy-freshness.yml` сравнивает SHA `main` с `version` из `/api/health` каждые 30 минут, открывает/закрывает issue `deploy-stale`. Активация: добавить `export GIT_SHA=$(git rev-parse HEAD)` перед `npm run build` в `/usr/local/bin/levelchannel-autodeploy` + forward'ить переменную в systemd unit env. Подробно — `OPERATIONS.md §6` Deploy freshness check

### Security and payment safety

- вынести app-level rate limiter в shared backend store для multi-instance future (nginx `limit_req` уже на месте, app-level дополняет per-route семантикой)
- ~~добавить отдельный audit log persistence для критичных payment transitions~~ — **закрыто 2026-04-29**: миграция 0012 + `lib/audit/payment-events.ts`, 10 финальных событий пишутся из 7 route handlers (`order.created/cancelled`, `mock.confirmed`, `webhook.pay.processed`, `webhook.fail.received`, `charge_token.succeeded/requires_3ds/declined`, `threeds.callback.received/confirmed/declined`). Best-effort recorder, retention 3 года, full PII за legitimate-interest 152-ФЗ. Документация: `ARCHITECTURE.md` § Audit log + `SECURITY.md` § Audit log + `OPERATIONS.md §5` psql-запросы
- ~~добавить pre-validation phases в audit~~ — **закрыто 2026-04-29**: миграция 0014 + рефактор `lib/payments/cloudpayments-route.ts`, который теперь принимает `kind: 'check'|'pay'|'fail'` и пишет phase-0 (`webhook.<kind>.received`) после parse + phase-1 (`webhook.<kind>.declined` / `webhook.pay.validation_failed`) при validation failure. Старый `webhook.fail.received` (semantically finalize) переименован в `webhook.fail.processed`; live data замигрировано в той же транзакции
- ~~добавить `charge_token.attempted`~~ — **NOT planned**: `chargeWithSavedCard` создаёт `invoice_id` внутри функции, у `attempted` event нет clean attach point (FK constraint к payment_orders); outcome events (`succeeded` / `requires_3ds` / `declined`) покрывают lifecycle полностью
- **`charge_token.error` (deferred)** — sync-error path требует refactor'а return type `chargeWithSavedCard` чтобы поверхностно отдавать `invoice_id` даже на throw. Сейчас catch в route шлёт `console.warn` в journal (см. `app/api/payments/charge-token/route.ts`). Закрыть когда возникнет реальный инцидент с потерянным contextом
- ~~консолидировать domain-specific Postgres pools в общий `lib/db/pool.ts`~~ — **закрыто 2026-04-29**: `lib/db/pool.ts` — `getDbPool()` (throws on missing DATABASE_URL) + `getDbPoolOrNull()` (silent — для audit best-effort). Все 5 domain-getter'ов (payments / auth / idempotency / telemetry / audit) делегируют на shared singleton, public API за call sites не сломан. Connection footprint: было 5×10=50 max, стало `DATABASE_POOL_MAX` (default 10).
- ~~настроить cron pruning для `payment_audit_events`~~ — **shipped 2026-04-29 (workflow side, активация требует SSH)**: `scripts/db-retention-cleanup.mjs` + systemd unit/timer (04:30 daily) удаляют `payment_audit_events > 3 года` плюс expired-записи из `account_sessions / email_verifications / password_resets / idempotency_records`. Подробно — `OPERATIONS.md §5`

## P1

### Payment domain

- перейти с polling-only модели к более надёжному способу доставки финального статуса клиенту
- добавить lifecycle cleanup для старых pending orders
- оценить необходимость client-visible reconciliation / operator-side payment list

### Observability

- ~~подключить error tracking~~ — **закрыто 2026-04-29**: Sentry @sentry/nextjs v10 + `instrumentation.ts` (Node/Edge) + `instrumentation-client.ts` (browser) + `app/global-error.tsx`. Project `mastery-zs/levelchannel`. Smoke event прошёл end-to-end. Активация в production = добавить `SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN` в `/etc/levelchannel.env`. Подробно — `OPERATIONS.md §9` Sentry
- добавить операторские сигналы по сбоям оплаты и webhook failures

### Auth and consent

- ~~добавить password hash versioning + `needsRehash()` путь для будущей смены cost / алгоритма~~ — **закрыто 2026-04-29**: `passwordNeedsRehash()` в `lib/auth/password.ts` парсит cost из bcrypt prefix; login route после `verifyPassword` silently re-hash'ит и `setAccountPassword`. Best-effort (warn + продолжает на ошибке БД). Покрыто unit + integration тестами. Будущая миграция на argon2id — обновить regex одновременно с введением нового хешера, иначе все login'ы будут перехешировать каждый раз
- ~~добавить cleanup для истёкших `account_sessions`~~ — **shipped 2026-04-29**: вошло в `scripts/db-retention-cleanup.mjs` (см. выше)
- ~~добавить common-password rejection~~ — **закрыто 2026-04-29**: локальный denylist в `lib/auth/common-passwords.ts` (~100 топ-utечек), normalize'ит case + whitespace; `validatePasswordPolicy` возвращает `too_common`. HIBP k-anonymity API — расширение если понадобится дальше

## P2

### Product and operator tooling

- добавить нормальный operator-side список оплат вместо ручного просмотра БД или файлов
- добавить телеметрию по payment funnel в форме, пригодную для принятия решений
- добавить email / Telegram notification о successful payment на стороне оператора
- ~~добавить `POST /api/auth/resend-verify` + UI кнопку~~ — **закрыто 2026-04-29**: endpoint в `app/api/auth/resend-verify/route.ts` (authenticated, idempotent, rate-limited 10/min/IP + 3/hour/account), UI button в `app/cabinet/resend-verify-button.tsx` заменил Phase 2 хак с ссылкой на `/forgot`
- ~~добавить модель отзыва согласия в `account_consents`~~ — **закрыто 2026-04-29**: миграция 0013 — добавила колонку `revoked_at` + partial index `account_consents_active_idx` (where `revoked_at IS NULL`). Store ops в `lib/auth/consents.ts`: `withdrawConsent()` (stamps latest unrevoked row), `getActiveConsent()` (returns latest non-revoked). UI / API endpoint — Phase 3 admin / личный кабинет. Покрыто 5 integration тестами. Реализует 152-ФЗ ст.9 п.5
- добавить отдельный `accepted_at`-covering index для `account_consents`, если consent-history станет реальным hot path

### DX and quality

- собрать security regression checklist перед релизами
- ~~расширить integration coverage для payment routes~~ — **закрыто 2026-04-29**: `tests/integration/payment/payment-routes.test.ts` покрывает POST /api/payments (create + amount/consent rejection + idempotency replay), cancel (success + 404 + 400-malformed-id), mock-confirm. Каждый тест проверяет DB-состояние + audit-events shape. Всё против реального Docker Postgres в mock-payment mode (через `TEST_INTEGRATION=1` → setup-env переключает provider/storage/allowMockConfirm). Webhook handlers — backlog item ниже (нужны HMAC-tooling).
- добавить integration test для webhook handlers (HMAC verify path) — нужен test-side HMAC signing helper. Currently покрыто только unit tests на parse + signature verify в `tests/payments/cloudpayments-webhook.test.ts`
- ~~параметризовать Docker integration stack для параллельного CI~~ — **закрыто 2026-04-29**: `docker-compose.test.yml` теперь читает `LC_TEST_DB_NAMESPACE` (default `default`) и `LC_TEST_DB_PORT` (default 54329) из env. `scripts/test-integration.sh` derive'ит namespace + port из `LC_TEST_PARALLEL_ID` (sha256 → 8-char suffix + port window 54330..54429), плюс уникальный `COMPOSE_PROJECT_NAME`. Single-developer flow без env vars остался byte-equal historical defaults; параллельные shards/runners больше не дерутся за порт/контейнер
- ~~добавить integration-тест на login с unverified email (Phase 1B D4)~~ — **закрыто 2026-04-29**: `tests/integration/auth/login.test.ts` теперь содержит test `allows login when email is not yet verified` — регистрирует, проверяет что `emailVerifiedAt` null, login возвращает 200 + session cookie + body с `emailVerifiedAt: null`
- добавить real-time signal для `/verify-pending`, только если это реально нужно пользователям

## Not now

- не раздувать кабинет дальше auth + payment-adjacent сценариев без прямой бизнес-нужды
- не собирать лишние персональные данные в checkout
- не усложнять форму оплаты без прямой бизнес-нужды
