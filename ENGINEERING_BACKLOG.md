# Engineering Backlog

Конкретная очередь инженерных задач. Этот файл описывает что ещё нужно
реализовать, а не текущее фактическое состояние продакшена.

Если задача уже работает в коде или на сервере, ей не место в backlog.

## Cabinet contract (in progress)

Multi-phase build из `Output 2` (target architecture). Гостевой checkout
не трогается — все фазы additive. План пофазно:

- **Phase 0 (stabilization)** — **закрыт 2026-04-29**: `migrations/`
  runner + 10 миграций накатаны на прод; ежедневный `pg_dump` cron +
  restore drill пройден; nginx `limit_req_zone` на `/api/*` (webhooks
  исключены); bind `127.0.0.1:3000`; SSH hardening
  (`PermitRootLogin prohibit-password` + `PasswordAuthentication no`);
  `npm run migrate:up` подключён в `__LEVELCHANNEL_AUTODEPLOY__`
  между `npm run build` и swap.
- **Phase 1A (auth foundation, backend only)** — выполнен: миграции
  0005..0010, `lib/auth/`, `lib/email/` (Resend + console fallback),
  unit-тесты на password / tokens / policy / escape / email-normalize.
  Вшитые в эту фазу долги:
  - hash versioning: `lib/auth/password.ts` пишет bcrypt без явного
    version-stamp поля. Миграция на argon2id или повышение cost = forced
    rehash на следующем входе пользователя — нужен `needsRehash()` check
    в login flow до Phase 2.
  - session cleanup: `account_sessions` без cron. Добавить в
    `OPERATIONS.md §11` runbook `delete from account_sessions where
    expires_at < now() - interval '7 days'` (по аналогии с
    idempotency_records).
  - common-password rejection (HIBP / breached lists) — пока политика
    только "не all-digits". Для MVP ок, для public launch стоит добавить.
- **Phase 1B (auth API routes)** — Lane A foundation + Lane B routes +
  Lane C placeholder **done**. 7 routes shipped: register / verify /
  login / logout / reset-request / reset-confirm / me. Integration tests
  cover all D-decisions: D1 register timing parity, D3 login constant-time,
  D4 allow-login-on-unverified, mech-5 sign-out-everywhere on reset.
  Anti-enumeration tests assert byte-equal responses for known/unknown
  email on register and reset-request. Run with `npm run test:integration`
  (requires Docker engine for postgres:16.13 service).
  Lane A `/review` findings (informational — backlog'd):
  - **Consent withdrawal model** — 152-ФЗ subjects can withdraw consent;
    current `account_consents` only models acceptance. Future additive
    migration: add `withdrawn_at` column or `revoked` document_kind.
    Triggers when first withdrawal flow lands (likely Phase 3+ admin
    surface).
  - **Time-window query index** — `account_consents` index on
    `(document_kind, document_version)` doesn't cover `accepted_at`
    filter. Postgres still does btree lookup + filter; fine until tens
    of thousands of rows. Rebuild as `(document_kind, document_version,
    accepted_at)` if `/admin/consent-history` becomes a hot path.
  - **Docker test parallelization** — `docker-compose.test.yml` hardcodes
    container_name `levelchannel-postgres-test` + port 54329. Parallel
    CI runs would collide. Current single-developer flow OK; parameterize
    when CI matrix grows.
- **Phase 2 (auth UI)** — **закрыт 2026-04-29**: 7 страниц поверх
  Phase 1B endpoints — `/register`, `/verify-pending`, `/login`,
  `/forgot`, `/reset` (заменил Phase 1B 404 placeholder), `/cabinet`
  (server-side gate через `lookupSession` + cookie, 307 на `/login`
  без сессии), `/verify-failed` (полный styled UI вместо minimal
  placeholder). Кнопка «Войти» добавлена в landing nav без удаления
  существующих CTA. Shared chrome (`SiteHeader`, `AuthShell`) висит
  на auth + legal страницах. Anti-enumeration на `/forgot` (нейтральное
  сообщение всегда), 152-ФЗ согласие checkbox на `/register` со
  ссылками на `/offer`, `/privacy`, `/consent`. План:
  `docs/plans/phase-2-auth-ui.md`.
  Долги из Phase 2 (informational — backlog'd):
  - **Resend-verify endpoint** — баннер «E-mail не подтверждён» в
    `/cabinet` сейчас ведёт на `/forgot`. Полноценный
    `POST /api/auth/resend-verify` + UI кнопка — Phase 3.
  - **`/verify-pending` без real-time signal** — пользователь не видит,
    когда e-mail подтверждён, пока не зайдёт в `/cabinet`. Polling /
    SSE / WebSocket — post-MVP.
- **Phase 3..6** — детали не разворачиваем в backlog до Phase 2 ship'а;
  high-level: profiles + admin pricing → scheduling → lesson lifecycle
  + 24h rule → cabinet payment + payment_allocations → legal/receipt
  polish. Контракт и обоснование — в Output 2 (`/Output 2 — MVP Product
  & Architecture Proposal` от 2026-04-29).

## P0

### Production reliability

- подключить uptime / failure alerting на приложение и webhook-контур
- добавить сигнал о неуспешном git-based deploy или зависшем `levelchannel-autodeploy`

### Security and payment safety

- вынести app-level rate limiter в shared backend store для multi-instance future (nginx `limit_req` уже на месте, app-level дополняет per-route семантикой)
- добавить отдельный audit log persistence для критичных payment transitions

## P1

### Payment domain

- перейти с polling-only модели к более надёжному способу доставки финального статуса клиенту
- добавить lifecycle cleanup для старых pending orders
- оценить необходимость client-visible reconciliation / operator-side payment list

### Observability

- подключить error tracking
- добавить операторские сигналы по сбоям оплаты и webhook failures

## P2

### Product and operator tooling

- добавить нормальный operator-side список оплат вместо ручного просмотра БД или файлов
- добавить телеметрию по payment funnel в форме, пригодную для принятия решений
- добавить email / Telegram notification о successful payment на стороне оператора

### DX and quality

- собрать security regression checklist перед релизами
- расширить integration coverage для payment routes и production-like storage flows

## Not now

- не добавлять пользовательский кабинет
- не собирать лишние персональные данные в checkout
- не усложнять форму оплаты без прямой бизнес-нужды
