# Engineering Backlog

Конкретная очередь инженерных задач. Этот файл описывает что ещё нужно
реализовать, а не текущее фактическое состояние продакшена.

Если задача уже работает в коде или на сервере, ей не место в backlog.

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
