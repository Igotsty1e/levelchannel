# Roadmap

## Статус

Проект уже готов к следующему этапу: реальный server deployment и подключение боевого CloudPayments.

## Ближайшие задачи

### P0

- развернуть production runtime на VPS или Vercel
- получить `CLOUDPAYMENTS_PUBLIC_ID`
- получить `CLOUDPAYMENTS_API_SECRET`
- проверить боевую форму CloudPayments и включённые методы оплаты
- проверить боевой CloudKassir и отправку чеков на e-mail
- настроить реальные webhook URL
- отключить `PAYMENTS_ALLOW_MOCK_CONFIRM` в production
- прогнать реальный end-to-end тест оплаты

### P1

- довести PostgreSQL storage до полного production rollout
- добавить uptime / error monitoring
- добавить reverse proxy rate limiting
- зафиксировать deployment playbook

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
