# Roadmap

Этот файл хранит high-level приоритеты следующего этапа. Конкретные
инженерные таски вынесены в `ENGINEERING_BACKLOG.md`.

## P0

### Compliance

- подать уведомление в Роскомнадзор о начале обработки ПДн
- зафиксировать и выполнять retention / deletion policy по ПДн

### Production operations

- настроить ежедневный backup Postgres и регулярно проверять restore
- подключить uptime monitor на `/api/health`
- выключить password auth по SSH и запретить прямой root по паролю
- уйти от manual deploy к более предсказуемому процессу выката

## P1

### Operator visibility

- получить более удобную видимость по оплатам и их статусам
- получить понятный контроль за сбоями и инцидентами оплаты

### Service reliability

- снизить зависимость от ручной операционки вокруг продакшена
- улучшить наблюдаемость за приложением и webhook-контуром

## P2

### Operator tooling and growth

- добавить операторские уведомления о важных платёжных событиях
- улучшить аналитику payment funnel
- при необходимости вернуться к продуктовым улучшениям checkout, если это даст измеримую конверсию

## Важно

- `ROADMAP.md` отвечает за outcome-level приоритеты
- `ENGINEERING_BACKLOG.md` отвечает за implementation queue
- `OPERATIONS.md` отвечает за фактическое состояние production
