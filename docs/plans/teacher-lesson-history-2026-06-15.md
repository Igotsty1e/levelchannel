# Эпик B: Lesson-history page + quick actions для прошедших занятий

Status: PROPOSED 2026-06-15 · Owner: claude
Parent: `docs/plans/teacher-master-flow-2026-06-15.md`
Depends on: Wave-A notifications (эпик A) для dispatch после mark-no-show / mark-completed

---

## Зачем

Owner-вход прямой:
> «нет вкладки с общей историей занятий. И нет отдельной формы с недавними прошедшими занятиями (+ действиями типа оплачено/ученик не пришел и тд). Чтобы юзер мог сам их менеджерить тоже быстро/удобно»

Phase-1 research показал: past lessons **фрагментированы по 3 surface-ам** (`/teacher/learners/[id]` table, `/teacher/payments` claims feed, `/cabinet` read-only), **нет единого view**, **нет teacher-side mark-no-show action** (сейчас admin-only через `/api/admin/slots/[id]/mark`), **нет фильтров**, **нет mobile list**.

## Целевая UX

1. **На главной `/teacher`** — карточка «Недавние прошедшие» (3-5 past slots без completion row), три quick-actions на каждом:
   - ✅ «Провёл» → INSERT `lesson_completions` с `was_no_show=false`
   - ❌ «Не пришёл» → INSERT с `was_no_show=true`
   - 💰 «Оплачено наличкой» → reuse `createTeacherMarkPaid` (`lib/payments/sbp-claims.ts:42`)
2. **Отдельная страница `/teacher/lessons`** — полная история всех past lessons со всеми учениками:
   - Фильтры: период (last 7d / 30d / месяц / кастом), ученик (combobox), статус (проведено/не пришёл/отменено), оплачено (yes/no/частично)
   - Mobile: card-list. Desktop: table.
   - CSV-экспорт через существующий `/api/teacher/payment-claims/export.csv` (расширить query или новый endpoint)
   - Каждая строка: «Провёл / Не пришёл / Оплачено» — quick actions inline
   - Bulk-select для batch «отметить оплачено».

## Зависимости + сборка существующего

### DB (использовать as-is, мiграция только под индекс)
- `lesson_completions` table — уже SoT для completed/no_show (mig 0092)
- Триггеры forward/reverse flip `lesson_slots.status` — уже есть
- `accounts.teacher_charge_on_no_show` / `charge_on_late_cancel` (mig 0114) — уже есть, расширяет «должны оплатить»
- **Новая миграция:** `migrations/0117_lesson_slots_history_index.sql` — composite index `(teacher_account_id, start_at DESC) WHERE status IN ('completed','no_show_learner','cancelled')`. NEW INDEX, CONCURRENTLY safe.

### API — новые endpoints (teacher-scope)

| Route | Method | Body | Что делает |
|---|---|---|---|
| `/api/teacher/slots/[id]/mark-completed` | POST | `{}` | INSERT `lesson_completions(was_no_show=false)`. Триггер → status=completed. Dispatch event `LessonMarkedComplete` (Wave-A). |
| `/api/teacher/slots/[id]/mark-no-show` | POST | `{}` | INSERT `lesson_completions(was_no_show=true)`. Триггер → status=no_show_learner. Dispatch event `LessonMarkedNoShow`. Если `accounts.teacher_charge_on_no_show=true` → также event «должен оплатить» в digest. |
| `/api/teacher/lessons/recent-past` | GET | query: `limit=5` | Returns last 5 past lessons (start_at < now) без completion row. Для карточки «Недавние прошедшие» на home. |
| `/api/teacher/lessons/history` | GET | query: `from, to, learnerId, status, paid` | Returns paginated past lessons со всеми filters. Для страницы `/teacher/lessons`. |
| `/api/teacher/lessons/export.csv` | GET | query: те же filters | CSV-экспорт. Альт: расширить существующий `/api/teacher/payment-claims/export.csv`. |

**Существующий endpoint** `/api/teacher/lessons/[id]/uncomplete` остаётся как есть — 48h gate + reverse.

**Существующий endpoint** `/api/admin/slots/[id]/mark` остаётся для админ-кейсов (forced state выходящий за 48h).

### Компоненты — новые + reuse

**Новые:**
- `components/teacher/home/recent-past-card.tsx` — карточка на `/teacher` home. Паттерн from `<UpcomingLessons>` (`app/teacher/page.tsx:189-261`)
- `components/teacher/lessons/lesson-history-table.tsx` — table для desktop. Паттерн from `<UnpaidLearners>` (`app/teacher/payments/unpaid-learners.tsx:47-307`)
- `components/teacher/lessons/lesson-history-card-list.tsx` — card-list для mobile
- `components/teacher/lessons/filters-bar.tsx` — combobox-учiникa + chip-group статуса + date range picker

**Reuse:**
- `components/ui/primitives/{Pill,EmptyState,Banner,Combobox,DatePicker,ChipGroup,Button}.tsx`
- `<ClaimsFeed>` pattern (tabs) из `app/teacher/payments/feed.tsx`
- `useNarrowContainer` hook из `components/calendar/MobileFallback.tsx` для responsive switching

### Route

**Новый:** `app/teacher/lessons/page.tsx` (SSR shell) + `app/teacher/lessons/client.tsx` (client-island с фильтрами + state machine)

**Навигация:** Sub-route под «Главная» nav-item (НЕ добавляем 5-й пункт в `TeacherCabinetNav` чтобы не сломать mobile bottom layout). Link «Все прошедшие занятия →» внутри `<RecentPastCard>` ведёт на `/teacher/lessons`.

## Mobile-first

- 390×844 и 360×800 проверить (memory `cabinet_mobile_first_restructure` обязал)
- Padding-bottom 80px на `/teacher/lessons` page чтобы sticky bottom nav не перекрывала last row
- Quick-action buttons min-height 44px (iOS touch target)
- Bulk-select — на mobile через swipe? Default — checkbox в card

## Content style (per `docs/content-style.md`)

- Page title: «Все занятия»
- Card title на home: «Недавние прошедшие»
- Quick actions: «Провёл», «Не пришёл», «Оплачено наличкой»
- Status pills: «Проведено», «Не пришёл», «Отменено», «Не оплачено»
- Filter chip group: «За 7 дней» / «За месяц» / «Свой период»
- Empty state: «Прошедших занятий пока нет.»

## Verification

**Unit:**
- `tests/teacher/lessons/recent-past-card.test.tsx` — 3 cases: empty / 5 lessons / quick-action click
- `tests/teacher/lessons/history-filters.test.tsx` — filters change → query updates
- `tests/calendar/mark-completed-no-show.test.tsx` — POST shape + триггер behavior

**Integration (Docker Postgres):**
- `tests/integration/scheduling/mark-completed.test.ts` — POST → INSERT completion → trigger flips status → query returns past
- `tests/integration/scheduling/mark-no-show.test.ts` — same + check charge_on_no_show effect

**Playwright walkthrough:**
- Логин учителя → главная → видна «Недавние прошедшие» → клик «Провёл» → row исчезает + ученик получает email (Wave-A)
- `/teacher/lessons` → фильтр по ученику → bulk-select 3 row → «Отметить оплачено» → 3 row меняют payment-state
- Mobile 390×844 → таблица превращается в card-list

## Risks

- **Wave-A зависимость:** без неё mark-no-show не уведомит ученика → ученик не понимает почему его пакет на 1 меньше. **Не запускать B до merge A.**
- **«Недавние прошедшие» добавляет шум на главную** если много past без mark. Mitigation: показывать только last 5 + ссылку «Открыть все».
- **Index migration на large table:** `lesson_slots` в проде может быть 100k+ строк. CREATE INDEX CONCURRENTLY безопасно но долго — запускать в low-traffic окне.
- **Bulk-actions** могут вылететь на rate-limit если 50+ slots. Ограничить bulk = 20 одновременно.

## Effort

≈3 рабочих дня = 1 PR. Декомпозиция:
- Sub-PR 1 (1d): backend (2 mutation endpoints + 2 GET + миграция + интеграция Wave-A dispatch)
- Sub-PR 2 (1d): `<RecentPastCard>` + интеграция на `/teacher` home + unit tests
- Sub-PR 3 (1d): `/teacher/lessons` page + filters + mobile/desktop + CSV + playwright

Если эпик > 5 файлов / 500 строк — дробить иначе одним PR.

## Out of scope

- Learner-side past actions («Запросить чек», «Оспорить») — отдельный эпик
- Recurring lesson series UI — отдельно
- Calendar view past slots редизайн — отдельно
- Admin past slots browser — отдельно

## Связанные

- Master plan: `docs/plans/teacher-master-flow-2026-06-15.md`
- Audit: `docs/audit/2026-06-15-reschedule-cancel-markpaid-audit.md` (Wave-A — зависимость)
- DB схема: SAAS-PIVOT Day 5A (`docs/plans/saas-pivot-master.md`)
- Финансовая карточка компактная: `docs/plans/teacher-home-finance-card-compact-2026-06-15.md` (партнёр)
