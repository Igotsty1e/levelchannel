# Roadmap

Этот файл хранит high-level приоритеты следующего этапа. Конкретные
инженерные таски вынесены в `ENGINEERING_BACKLOG.md`.

## P0

### Compliance

- подать уведомление в Роскомнадзор о начале обработки ПДн
- зафиксировать и выполнять retention / deletion policy по ПДн

### Production operations

- регулярно проверять `pg_dump` бэкапы и restore drill (cron активен с 2026-04-29)
- подключить uptime monitor на `/api/health`
- регулярно проверять rollback drill и состояние git-based autodeploy

## P1

### Operator visibility

- получить более удобную видимость по оплатам и их статусам
- получить понятный контроль за сбоями и инцидентами оплаты

### Service reliability

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
