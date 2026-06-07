# Frontend audit — route map

> Used by the page-by-page polish loop (2026-06-07+).
> Each row gets opened, screenshotted, design-reviewed, copy-shortened, button-ified where possible.
> Cabinet stays in its light/sans language — we polish, not repaint.

## Test logins

Shared password for all qa-fixture accounts: `QaFix!2026`

| Role | Email | Scenario |
|---|---|---|
| Teacher | `qa-fixture-teacher@levelchannel.test` | 5 learners, mid tier, packages + tariffs |
| Learner-1 | `qa-fixture-learner-1@levelchannel.test` | Петя — active 8-pkg, 3/8 used |
| Learner-2 | `qa-fixture-learner-2@levelchannel.test` | Маша — active 4-pkg, 0/4 used |
| Learner-3 | `qa-fixture-learner-3@levelchannel.test` | Дима — postpaid + debt |
| Learner-4 | `qa-fixture-learner-4@levelchannel.test` | Аня — expired 4-pkg |
| Learner-5 | `qa-fixture-learner-5@levelchannel.test` | Кирилл — empty state |

## Audit order

Numbered in walk-order. Status: `[ ]` pending, `[~]` in-progress, `[x]` done.

### A. Auth flow (anonymous)

- [ ] A1. `/` (public landing)
- [ ] A2. `/login`
- [ ] A3. `/register`
- [ ] A4. `/forgot` + `/reset?token=`
- [ ] A5. `/verify-pending`
- [ ] A6. `/verify-failed`
- [ ] A7. `/consent/personal-data`
- [ ] A8. `/privacy`
- [ ] A9. `/offer`

### B. Teacher cabinet (`qa-fixture-teacher@`)

- [x] B1. `/teacher` — главная учителя (overview / digest tile)
- [x] B2. `/teacher/calendar` — расписание
- [ ] B3. `/teacher/learners` — список учеников
- [ ] B4. `/teacher/learners/qa-fixture-learner-1@...` — карточка ученика Петя (детальная)
- [ ] B5. `/teacher/learners/[Дима]/settle` — settle экран (закрытие долга)
- [ ] B6. `/teacher/packages` — управление пакетами
- [ ] B7. `/teacher/tariffs` — тарифы
- [ ] B8. `/teacher/profile` — профиль / реквизиты учителя
- [ ] B9. `/teacher/settings` — настройки хаб
- [ ] B10. `/teacher/settings/calendar` — интеграция Google Calendar
- [ ] B11. `/teacher/settings/digest` — настройки дайджестов
- [ ] B12. `/teacher/subscription` — тариф учителя в LevelChannel

### C. Learner cabinet (`qa-fixture-learner-1@`)

- [ ] C1. `/cabinet` — главная ученика (балансы + ближайший слот)
- [ ] C2. `/cabinet/book` — выбор даты для записи
- [ ] C3. `/cabinet/book/[ymd]` — выбор слота
- [ ] C4. `/cabinet/book/[ymd]/[slotId]` — подтверждение записи
- [ ] C5. `/cabinet/packages` — мои пакеты + покупка
- [ ] C6. `/cabinet/profile` — профиль ученика
- [ ] C7. `/cabinet/settings` — настройки ученика
- [ ] C8. `/cabinet/settings/calendar` — Google Calendar ученика

### D. Payment flow

- [ ] D1. `/pay` — лендинг оплаты (для подписки)
- [ ] D2. `/checkout/[tariffSlug]` — оформление подписки teacher
- [ ] D3. `/thank-you` — экран успеха
- [ ] D4. `/t/[slug]` — публичная карточка учителя
- [ ] D5. `/t/[slug]/pay` — публичная оплата ученика

### E. Empty states (worth checking with learner-5 «Кирилл»)

- [ ] E1. `/cabinet` for empty learner (нет ни пакетов, ни слотов)
- [ ] E2. `/cabinet/packages` for empty learner
- [ ] E3. `/teacher/learners` if no learners (skip — у нас 5 фикстурных)

## Audit checklist per screen

For every page:

1. **Visual** — does it look polished or like an admin tool?
2. **Copy** — сократить, переписать понятно, избавиться от жаргона.
3. **Buttons over text** — где можно заменить ссылку/выпадашку на кнопку.
4. **Sliders / steppers** — для числовых тарифов/пакетов/количества.
5. **Empty states** — что видит новичок.
6. **Mobile** — хотя бы 375px width sanity check.
7. **A11y quick** — labels, focus rings, contrast.

Edits land directly in `components/...` / `app/...`. Server strings + email/push payloads also fair game.

## Discovered bugs (fix after audit)

- `lib/notifications/teacher-digest-preview.ts` had Postgres `date` → JS `toISOString().slice(0,10)` drift on east-of-UTC Node runtimes — fixed inline 2026-06-07 via `to_char` in SQL.
- `scripts/teacher-daily-digest.mjs` (cron) likely has the same pattern — needs follow-up audit. If confirmed, prod digest emails may be one day behind for any teacher whose Node runtime is east of UTC.

## Out of scope

- `/admin/*` — операторский UI, не для аудита user-friendliness.
- `/saas/v3` — лендинг уже отдельно polished.
- `/saas/v1`, `/saas/v2-*` — старые лендинги, скоро уйдут.
- `/legal/v*` — статичные правовые страницы.
- `/saas-offer-accept`, `/saas-offer-awaiting` — операторный handshake.
