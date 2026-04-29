# Roadmap

## Статус

Production runtime на VPS и боевой CloudPayments уже запущены. Следующий
этап, операционное дожатие production и юридический контур вокруг ПДн.

## Ближайшие задачи

### P0

- подать уведомление в Роскомнадзор о начале обработки ПДн
- настроить ежедневный backup Postgres и проверить restore
- подключить uptime monitor на `/api/health`
- выключить password auth по SSH и запретить прямой root по паролю
- зафиксировать и выполнять retention / deletion policy по ПДн
- перевести продовый workdir на git-aware deploy или другой auditable rollout

### P1

- добавить error monitoring
- добавить reverse proxy rate limiting
- зафиксировать deploy automation без ручного rsync

### P2

- добавить reconciliation screen / admin tooling
- добавить телеметрию по payment funnel
- добавить email / Telegram notification о successful payment на стороне оператора

## Что нужно сделать в коде в будущем

### Payment domain

- перейти с polling на более надёжную модель статусов при росте нагрузки
- добавить idempotency key для client-side create payment requests
- добавить lifecycle cleanup для старых pending orders

### Security

- вынести rate limiter в shared backend store
- добавить отдельный audit log persistence
- добавить security regression checklist перед релизом

### Product

- добавить нормальный operator-side список оплат вместо файлового просмотра `data/`
- при необходимости вернуть предустановленные суммы как быстрые кнопки поверх свободного ввода

## Не делать сейчас

- не добавлять пользовательский кабинет
- не добавлять сбор лишних персональных данных
- не усложнять checkout формами, пока не появится реальная бизнес-необходимость
