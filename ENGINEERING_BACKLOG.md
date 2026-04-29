# Engineering Backlog

Конкретная очередь инженерных задач. Этот файл описывает что ещё нужно
реализовать, а не текущее фактическое состояние продакшена.

Если задача уже работает в коде или на сервере, ей не место в backlog.

## Cabinet contract (in progress)

Multi-phase build из `Output 2` (target architecture). Гостевой checkout
не трогается — все фазы additive. План пофазно:

- **Phase 0 (stabilization)** — частично выполнен: `migrations/` runner +
  миграции 0001..0004. Остаётся: pg_dump cron + restore drill, nginx
  `limit_req_zone`, bind `127.0.0.1`, SSH hardening, подключить
  `migrate:up` в `levelchannel-autodeploy`.
- **Phase 1A (auth foundation, backend only)** — выполнен: миграции
  0005..0009, `lib/auth/`, `lib/email/` (Resend + console fallback),
  unit-тесты на password / tokens / policy.
- **Phase 1B (auth API routes)** — pending: `/api/auth/{register,login,
  logout,verify,reset-request,reset-confirm,me}` + rate-limit + origin
  check + idempotency-style replay-safety + production assertions
  (`RESEND_API_KEY`, `EMAIL_FROM`).
- **Phase 2 (auth UI)** — pending: `/register`, `/login`, `/forgot`,
  `/reset`, `/verify`, `/cabinet` placeholder. Header лендинга получает
  кнопку «Войти» без удаления существующих CTA.
- **Phase 3..6** — детали не разворачиваем в backlog до Phase 2 ship'а;
  high-level: profiles + admin pricing → scheduling → lesson lifecycle
  + 24h rule → cabinet payment + payment_allocations → legal/receipt
  polish. Контракт и обоснование — в Output 2 (`/Output 2 — MVP Product
  & Architecture Proposal` от 2026-04-29).

## P0

### Production reliability

- подключить uptime / failure alerting на приложение и webhook-контур
- настроить и проверить регулярный backup + restore drill для Postgres
- добавить сигнал о неуспешном git-based deploy или зависшем `levelchannel-autodeploy`

### Security and payment safety

- добавить reverse-proxy rate limiting поверх app-level limiter
- вынести rate limiter в shared backend store для multi-instance future
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
