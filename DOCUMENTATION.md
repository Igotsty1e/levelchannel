# Documentation Map

Этот файл задаёт структуру документации. Если агент не знает, какой
документ читать первым, он начинает отсюда.

## Принцип

У каждой темы должен быть один основной документ-владелец. Если одно и то
же правило описано в нескольких местах, агенты почти гарантированно
утащат устаревшую версию.

## Быстрый маршрут для агента

### Быстро понять проект

1. `README.md`
2. `DOCUMENTATION.md`
3. профильный документ по зоне задачи

### Код и архитектура

1. `ARCHITECTURE.md`
2. `PAYMENTS_SETUP.md`, если меняется payment contract
3. `SECURITY.md`, если меняется trust boundary или защита

### Прод, сервер, БД, деплой, логи, бэкапы

1. `OPERATIONS.md`

### Стратегия и следующий этап

1. `ROADMAP.md` для продуктовых, операционных и юридических приоритетов
2. `ENGINEERING_BACKLOG.md` для конкретной implementation queue

### Публичные юридические тексты

1. `app/offer/page.tsx`
2. `app/privacy/page.tsx`
3. `app/consent/personal-data/page.tsx`
4. `OPERATIONS.md`, если вопрос упирается в фактическое хранение, retention или сервер

### Исторический контекст

1. `PRD.md`
2. `docs/plans/*` — архив планов и review-артефактов, не source of truth

## Матрица ответственности

| Документ | Владеет | Не должен хранить |
|---|---|---|
| `README.md` | вход в проект, стек, команды, карта документации | backlog, runbook, временные статусы |
| `DOCUMENTATION.md` | карта документации, правила навигации, зоны ответственности | продуктовые решения, инфраструктурные детали, backlog |
| `ARCHITECTURE.md` | file-by-file карта системы и runtime flow | roadmap, deploy checklist, operator instructions |
| `PAYMENTS_SETUP.md` | payment contract, env contract, webhook contract, режимы оплаты | production runbook, backlog, product strategy |
| `SECURITY.md` | security boundaries, threat model, hardening gaps | deploy steps, product roadmap |
| `OPERATIONS.md` | prod-инфраструктура, сервер, БД, deploy, rollback, retention, incident runbook | продуктовые идеи, кодовые wishlist'ы |
| `ROADMAP.md` | high-level приоритеты продукта, операционки и compliance | низкоуровневые implementation tasks |
| `ENGINEERING_BACKLOG.md` | очередь инженерных задач по реализации | deploy facts, public legal text |
| `PRD.md` | исторический аудит-трейл ранней версии | текущие решения как source of truth |
| `docs/plans/*` | архив design / implementation plans | текущее shipped-состояние и owner-contracts |

## Правило конфликтов

Если документы расходятся, приоритет такой:

1. код и фактический runtime
2. профильный документ-владелец темы
3. `README.md`
4. `ROADMAP.md` и `ENGINEERING_BACKLOG.md`, они задают намерение, а не факт
5. `PRD.md`, только как исторический контекст

## Правила обновления

- Если меняется структура кода, обновляй `ARCHITECTURE.md`.
- Если меняется payment flow, env contract, webhook flow или one-click, обновляй `PAYMENTS_SETUP.md`.
- Если меняется прод, деплой, сервер, retention, backup, rollback, обновляй `OPERATIONS.md`.
- Если меняется trust boundary, consent capture, headers, rate limit, webhook verify, обновляй `SECURITY.md`.
- Если появляется новая идея или направление, сначала реши, это стратегический приоритет или implementation task:
  - outcome-level задача идёт в `ROADMAP.md`
  - конкретная инженерная задача идёт в `ENGINEERING_BACKLOG.md`
- Не дублируй один и тот же backlog одновременно в `ROADMAP.md`, `README.md` и `PAYMENTS_SETUP.md`.

## Правило для агентов

Перед правкой документа агент должен ответить себе на два вопроса:

1. Этот файл владеет темой или только ссылается на неё?
2. Не появится ли после моей правки второй источник истины по той же теме?

Если ответ на второй вопрос "да", правка неправильная.
