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
