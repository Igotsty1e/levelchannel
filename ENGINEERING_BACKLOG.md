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
- добавить pre-validation phases в audit (`webhook.check.received`, `webhook.*.declined`, `webhook.pay.validation_failed`) — требует переработки `cloudpayments-route` wrapper'а
- добавить `charge_token.attempted` / `charge_token.error` (двухфазная запись)
- консолидировать domain-specific Postgres pools в общий `lib/db/pool.ts` — сейчас 5 отдельных pool'ов (payments, auth, idempotency, telemetry, audit), на multi-instance future это становится ограничением по connection count
- настроить cron pruning для `payment_audit_events` (>3 года)

## P1

### Payment domain

- перейти с polling-only модели к более надёжному способу доставки финального статуса клиенту
- добавить lifecycle cleanup для старых pending orders
- оценить необходимость client-visible reconciliation / operator-side payment list

### Observability

- подключить error tracking
- добавить операторские сигналы по сбоям оплаты и webhook failures

### Auth and consent

- добавить password hash versioning + `needsRehash()` путь для будущей смены cost / алгоритма
- добавить cleanup для истёкших `account_sessions`
- добавить common-password rejection (HIBP / breached list или локальный denylist)

## P2

### Product and operator tooling

- добавить нормальный operator-side список оплат вместо ручного просмотра БД или файлов
- добавить телеметрию по payment funnel в форме, пригодную для принятия решений
- добавить email / Telegram notification о successful payment на стороне оператора
- добавить `POST /api/auth/resend-verify` + UI кнопку вместо обхода через `/forgot`
- добавить модель отзыва согласия в `account_consents`
- добавить отдельный `accepted_at`-covering index для `account_consents`, если consent-history станет реальным hot path

### DX and quality

- собрать security regression checklist перед релизами
- расширить integration coverage для payment routes и production-like storage flows
- параметризовать Docker integration stack для параллельного CI
- добавить integration-тест на login с unverified email (Phase 1B D4 invariant — cabinet allow, payment-gated). Сейчас policy живёт только в коде `app/api/auth/login/route.ts` без regression-теста
- добавить real-time signal для `/verify-pending`, только если это реально нужно пользователям

## Not now

- не раздувать кабинет дальше auth + payment-adjacent сценариев без прямой бизнес-нужды
- не собирать лишние персональные данные в checkout
- не усложнять форму оплаты без прямой бизнес-нужды
