# Cross-cutting backlog — 2026-05-18

> **Extracted from `ENGINEERING_BACKLOG.md` 2026-05-19 (DOC-SPLIT task).** Added by product owner 2026-05-18.

Cross-cutting tech-debt items that don't belong to a single epic. Each ships independently when scheduled.

## Active

- **DOC-MODULE-CONTRACTS** — Извлечь module-contracts из `ARCHITECTURE.md` в `lib/*/README.md` per-module (billing/scheduling/auth/payments/calendar/admin/security/db). `ARCHITECTURE.md` остаётся как top-level overview + cross-module диаграмма; контракты на отдельные модули — у каждого модуля под рукой при работе с кодом.
- **API-BOUNDARIES** — Зафиксировать public/private surface между `lib/*` модулями. Каждый `lib/X` экспортирует через `index.ts`; импорт `lib/X/internal/*` или sibling-only файлов из соседнего `lib/Y` запрещён. CI-тест (ts-morph или regex sweep) ловит нарушения. Цель: предотвратить незаметное расширение surface, как было с `internal.ts` уходящим в чужие модули.
- **CRITICAL-PATH-INVENTORY** — Список 20 файлов, поломка которых = production incident: money-moving (`app/api/payments/webhooks/*`, `lib/billing/package-grant.ts`, `lib/payments/store-postgres.ts`), security gates (`lib/auth/sessions.ts`, `lib/auth/learner-archetype.ts`), calendar gates (`lib/scheduling/slots/mutations-cancel.ts`, `lib/calendar/pull-runner.ts`). Список в `docs/critical-path.md`. CI hook: PR трогающая файл из списка требует `Codex-Paranoia: SIGN-OFF` трейлер (не `SUB-WAVE self-reviewed`).
- **COVERAGE-PAYMENTS** — Branches coverage 75% → 85% на платёжных путях (`lib/billing/*`, `lib/payments/*`, `app/api/payments/**`, `app/api/checkout/**`). Coverage report → uncovered branches → тесты на edge cases (refund retry, 3DS callback, postpaid debt summary, advisory-lock contention, webhook signature failures). `vitest.config.ts` coverage thresholds для платёжных путей.

## Closed

- ~~**DOC-SPLIT**~~ — **CLOSED 2026-05-19** (this PR). Разрезать `ENGINEERING_BACKLOG.md` на per-epic файлы в `docs/backlog/`. Top-level `ENGINEERING_BACKLOG.md` остаётся индексом; закрытые волны — в `docs/backlog/archive/`. Цель: больше не ронять контекст-окно на одном файле в 1000+ строк. Per-epic files: `bcs-def.md`, `audit-findings.md`, `saas-pivot.md`, `cross-cutting.md`, `bug-intake.md` + archive carry-over.
