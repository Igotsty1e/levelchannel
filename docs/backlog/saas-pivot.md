# SaaS pivot — SAAS-1..6 + follow-ups

> **Extracted from `ENGINEERING_BACKLOG.md` 2026-05-19 (DOC-SPLIT task).** Added by product owner 2026-05-18.

Product is pivoting from single-teacher-channel to multi-teacher SaaS. Each task gets its own plan doc + paranoia plan-mode pass + implementation. Cross-cutting foundation docs (`docs/design-system.md`, `docs/content-style.md`) come first; per-feature plans reference them.

## Active surface

- **SAAS-1 — Календарь Apple-style (1ч сетка + визуальный редизайн).** Сейчас admin /admin/slots + cabinet /cabinet/book показывают сетку с 30-мин шагом. Хочется: 1ч шаг (вертикально компактнее), Apple-Calendar-style визуал (тонкие divider'ы, скруглённые event chips, generous whitespace, hour-only timestamps, subtle hover). Это первая итерация полного редизайна #SAAS-6. План: `docs/plans/calendar-apple-redesign.md`.
- **SAAS-2 — Переписать все тексты (кроме лендинга).** Audit + rewrite admin UI labels (Аккаунты / Тарифы / Пакеты / Слоты / Платежи / Возвраты / Задолженности / Документы / Алерты / Реконсилиация — некоторые не лучшие), cabinet UI, error messages, tooltips, emails. Без технического языка, понятно и админу и юзеру. Foundation: `docs/content-style.md` (style guide + glossary). Multi-week sweep после foundation.
- **SAAS-3 — Регистрация с выбором роли «ученик / учитель».** Сейчас teacher-аккаунты создаёт оператор; меняем на self-service SaaS — любой может зарегистрироваться как учитель, сразу активен (без verification-флага). На /register добавляется radio-button. План: `docs/plans/teacher-self-reg-invite.md` (объединён с SAAS-4).
- **SAAS-4 — Учитель отправляет invite-ссылку с auto-bind.** Учитель в своём кабинете генерирует invite-ссылку (HMAC-signed token, expiry, scope=teacher-bind). Ученик регистрируется по ссылке → `assigned_teacher_id` проставляется автоматически. План объединён с SAAS-3.
- **SAAS-5 — Cabinet IA: «Профиль» как кнопка/модалка.** Текущий cabinet перегружен: профиль (имя, часовой пояс) + danger-zone занимают экранное место рядом с уроками. Сделать профиль скрытой панелью за кнопкой (открывается модалка / отдельный экран). Внутри: имя, часовой пояс, danger-zone. План: `docs/plans/cabinet-profile-button.md`.
- **SAAS-6 — Большой редизайн в стиле Apple.** Все интерфейсы — Apple HIG aesthetic (тонкие линии, generous spacing, SF Pro-style typography, subtle motion, скруглённые углы, vibrancy-style фон). Foundation: `docs/design-system.md` (palette, type-scale, spacing, radii, motion, primitive components). Multi-week sweep после foundation.

**CONFLICT-FEED — defer.** Foundation готова (BCS-F.1 wire-up закрыт PR #251); 4 design-BLOCKERs из round-1 паранойи остаются (см. `docs/plans/conflict-feed.md`). Решение product owner 2026-05-18: defer до тех пор, пока на проде не появится ≥3 учителей ИЛИ operator не пожалуется на отсутствие /admin-видимости конфликтов. До тех пор teacher banner и оператор-side SQL достаточны.

## Follow-ups out of immediate SAAS-1..6 scope

Captured here so future waves pick them up without re-discovering. All surfaced by `/codex-paranoia plan` rounds 2026-05-18.

- ~~**SAAS-1 5.A — token scoping under `.saas-chrome`**~~ — **SHIPPED 2026-05-19** (PR #341, plan PR #331 → `docs/plans/saas-1-5a-token-scoping.md`). SaaS design tokens now scoped under `.saas-chrome` class selector instead of `:root` to avoid bleed into the legacy admin/cabinet surface during the multi-week SAAS-6 rollout.
- ~~**SAAS-INFRA-1**~~ — **SHIPPED 2026-05-19** (PR #346, plan PR #338 → `docs/plans/saas-infra-1-jsdom-rtl.md`). `@testing-library/react` + `jsdom` + `@testing-library/user-event` added to `vitest.config.ts`; component-render assertions now land in the unit suite. Unblocks `SlotBlock` palette + `cabinet-profile-page` Server Component renders.
- ~~**SAAS-1-FOLLOWUP-KEYBOARD**~~ — **SHIPPED 2026-05-19** (PR #354, plan PR #344 → `docs/plans/saas-1-followup-keyboard.md`). Arrow-key cell navigation + Enter-to-create on empty cells in `/admin/slots` Calendar grid; `lib/calendar/grid-keyboard.ts` pure reducers; roving tabindex + 30 new tests (20 unit + 10 RTL via SAAS-INFRA-1). Closes WCAG 2.1 SC 2.1.1 Keyboard for the operator's primary action.
- **SAAS-6-A11Y-1** — Add skip-to-content link to `<AuthShell>` and `<SiteHeader>` per `docs/design-system.md` §Accessibility. Plan-ready: `docs/plans/saas-6-a11y-1-skip-to-content.md` (plan PR #345). Foundation work for SAAS-6 design rollout; awaits scheduling.
