# Учительский кабинет — master flow на 6 эпиков (2026-06-15)

Status: PROPOSED · Owner: claude · Type: master plan (план планов)

## Зачем этот документ

Owner-вход: «нет вкладки общей истории занятий», «нет формы недавних past-lessons с действиями типа оплачено/не пришёл», «карточку финансов компактнее», «выстраивай юзер-флоу клиента и учитывай другие его юзер-флоу».

То есть деперативно: **сначала собрать целостный flow учителя**, потом нарезать на эпики так, чтобы каждый освобождал место для следующего и не делал «features ради features». Этот документ — карта поверх 6 связанных эпиков (3 нашли в Phase-1 research, 3 из аудита #644 от 2026-06-15).

---

## Целевой дневной flow учителя

```
Утро (открыл /teacher)
  ├─ greeting
  ├─ digest preview (сегодня)
  ├─ upcoming 3 booked
  ├─ ⭐ НОВОЕ: «Недавние прошедшие» (3-5 без отметки) с quick actions
  └─ finance summary (КОМПАКТНАЯ)

Перед занятием (нужен контекст ученика)
  ├─ из upcoming → клик на занятие → быстрый просмотр
  └─ или /teacher/learners/[id] полная карточка

После занятия (отметить результат)
  ├─ ⭐ НОВОЕ: одной кнопкой «Провёл» / «Не пришёл» на «Недавних прошедших»
  ├─ или в полной /teacher/lessons истории
  └─ автоматически → ученик получает уведомление (Wave-A)

Деньги (раз в день/неделю)
  ├─ /teacher/payments → claims feed + unpaid
  └─ /teacher/lessons → филтр «не оплачены» → bulk mark

Конец недели/месяца
  ├─ ⭐ НОВОЕ: /teacher/lessons CSV-export по фильтру
  └─ finance card (теперь компактная) — выручка / долги
```

---

## 6 эпиков в порядке зависимости

| # | Эпик | Зачем | Файл-плана | Effort | Зависит от |
|--:|---|---|---|---|---|
| **A** | Notifications dispatch (5 BLOCKERов + 3 HIGH) | Без неё учитель/ученик «не узнают» что что-то изменилось — на этом стоят все остальные UX-улучшения | (см. ниже) | 3-4d | — |
| **B** | **Lesson-history page + quick actions** | Owner explicit ask: «вкладка общей истории + форма недавних past + actions» | `teacher-lesson-history-2026-06-15.md` | 3d | A (для авто-уведомлений после mark-no-show) |
| **C** | **Финансовая карточка компактнее** | Owner explicit ask. Освобождает place для «Недавние прошедшие» (эпик B) | `teacher-home-finance-card-compact-2026-06-15.md` | 0.5d | — (параллельно с A или B) |
| **D** | Teacher reschedule UI для booked-занятий | UX-BLOCKER из аудита: учитель не может перенести, только отменить. Естественно после B (где quick actions появляются). | (в audit #644) | 1.5d | A |
| **E** | TG в partial paths (claim+direct-assign) | HIGH-04, HIGH-05 из аудита: email есть, TG нет. | (в audit #644) | 1d | A (общий dispatch helper готов) |
| **F** | Postpaid debt UI fallback | UX-BLOCKER из аудита: долг без CTA когда у учителя нет СБП. | (в audit #644) | 0.5d | A |

**Итого:** ≈10 рабочих дней на 6 PR-ов. **Каждый PR независимо ценен** — owner может остановиться после A+B+C и получить uplifted product, остальное доставить позже.

---

## Sequence рекомендуемый для текущей сессии

### Wave 1 — фундамент (3-4d, 1 PR): **A** — Notifications dispatch
Один общий `lib/notifications/lesson-event-dispatch.ts` с 7 событиями × 2 канала (email + TG). Закрывает 5 BLOCKER + 3 HIGH из аудита `docs/audit/2026-06-15-reschedule-cancel-markpaid-audit.md`. **Это фундамент** — без него «отметил не пришёл» в эпике B не имеет смысла (ученик не узнает что его «no-show» зачтён).

### Wave 2 — учительский менеджмент past lessons (3d, 1 PR): **B** — Lesson-history
- Новая страница `/teacher/lessons` с фильтрами (период / ученик / статус / payment-state) + CSV-экспорт
- Новая карточка «Недавние прошедшие» на `/teacher` home — 3-5 past slots без completion-row, с quick actions «Провёл» / «Не пришёл» / «Оплачено наличкой»
- Новые teacher-side endpoints: `POST /api/teacher/slots/[id]/mark-completed` + `mark-no-show` (сейчас admin-only через `/api/admin/slots/[id]/mark` — это надо вынести в teacher-scope)
- Mobile-friendly card-list для small screens

### Wave 3 — освобождение места (0.5d, 1 PR): **C** — Finance card compact
Снижение высоты карточки на ~30% (с ~280px → ~200px). Не меняем data, только spacing + font-size клампы.

### Wave 4 — teacher-reschedule UI (1.5d, 1 PR): **D**
Кнопка «Перенести» в TeacherSlotDetailModal для booked-full + new RescheduleByTeacherModal. Использует dispatch-helper из A для уведомления ученика.

### Wave 5 — TG в partials (1d, 1 PR): **E**
Дополнить mark-paid claim email + direct-assign email TG-каналом. Common dispatch уже из A.

### Wave 6 — postpaid debt UI (0.5d, 1 PR): **F**
Banner ученику + запись в /teacher/payments «Должны оплатить» когда у учителя нет СБП. Не нужен новый endpoint — только UI.

---

## Связки между эпиками (то что unifies)

### Общая API-поверхность
- **`/api/teacher/slots/[id]/mark-completed`** (новый, B) → trigger в `lesson_completions` INSERT → dispatch event `LessonMarkedComplete` (A) → нотификация ученику
- **`/api/teacher/slots/[id]/mark-no-show`** (новый, B) → INSERT `was_no_show=true` → trigger `lesson_slots.status='no_show_learner'` → dispatch event `LessonMarkedNoShow` → если `accounts.teacher_charge_on_no_show=true` (mig 0114) → также event `MarkPaidExpected` (учитель видит «должен оплатить»)
- **`POST /api/teacher/slots/[id]/reschedule`** (новый, D) → атомарный cancel+insert как у learner-reschedule → dispatch `LessonRescheduledByTeacher` (A) → ученик получает уведомление

### Общие компоненты
- **`<RecentPastSlotsCard>`** (B) на `/teacher` home — наследует pattern `<UpcomingLessons>` (`app/teacher/page.tsx:189-261`)
- **`<LessonHistoryTable>`** (B) на `/teacher/lessons` — наследует pattern `<UnpaidLearners>` (`app/teacher/payments/unpaid-learners.tsx`)
- **`<RescheduleByTeacherModal>`** (D) — копия `<RescheduleByLearnerModal>` из `/cabinet/lessons-section.tsx` с правкой actor
- **`lib/notifications/lesson-event-dispatch.ts`** (A) — единая точка для всех 7 событий, используется во всех Wave-ах

### Общая навигация
- `TeacherCabinetNav` (4 пункта: Главная / Календарь / Ученики / Настройки) **не меняется**.
- Новый `/teacher/lessons` (B) — sub-route под «Главная» (link с home card «Все прошедшие занятия →»). НЕ добавляем 5-й пункт в nav (минимум вызовет breakage mobile bottom-nav layout).

### Общие токены
- `--space-section`, `--surface-3`, `--accent` — уже есть в `app/globals.css`
- Никаких новых color tokens. Compact finance card (C) — только редукция padding/font-size существующих токенов.

---

## Risks + рекомендации

**Зависимость B → A:** если запустить B без A, ученик не получит письмо после «учитель отметил что я не пришёл» — это сделает feature мёртвой с точки зрения customer trust. **Wave 1 (A) запускать первой обязательно.**

**Перегруз `/teacher` home после B:** если добавить «Недавние прошедшие» без C (compact finance) → главная станет очень длинной. **Запускать B и C параллельно (или C первым).**

**Migration discipline:** ни один эпик не требует разрушительной миграции. `lesson_completions` schema от SAAS-PIVOT (mig 0092) уже покрывает все нужные fields. Wave A не требует БД-миграций (только новые helpers). Wave B потребует разве что доб index'а на `lesson_slots(teacher_account_id, start_at)` для фильтров — это безопасная NEW INDEX миграция (mig 0117+).

**Mobile-first:** Wave B обязательно проверить на 390×844 и 360×800. Bottom sticky nav может перекрывать список — нужен padding-bottom 80px на странице `/teacher/lessons`.

**Content style:** все user-facing copy — через `docs/content-style.md`. Запреты на «слот», «webhook», «реконсилиация» в учительском UI. Список — «занятия», «прошедшие», «не пришёл», «оплачено».

---

## Что НЕ в этом master-plan-е

- PWA push-уведомления — отдельный эпик `docs/plans/bcs-def-4-push-pwa-reminders.md`
- Operator/admin flows в `/admin/*`
- Subscription / SBP-method CRUD (отдельный SBP self-service)
- 3DS / CloudPayments sandbox

---

## Связанные документы

- **`docs/audit/2026-06-15-reschedule-cancel-markpaid-audit.md`** — full audit reschedule/cancel/mark-paid (PR #644). Источник эпиков A/D/E/F.
- **`docs/plans/teacher-lesson-history-2026-06-15.md`** (этот PR) — эпик B.
- **`docs/plans/teacher-home-finance-card-compact-2026-06-15.md`** (этот PR) — эпик C.
- **`docs/plans/finance-on-teacher-home-2026-06-09.md`** (SHIPPED) — историческое решение по finance card hero-variant.
- **`docs/audit/frontend-audit-routes.md`** — queue аудита routes.

---

## Next action для owner

Прочесть оба под-плана (B и C) → выбрать что запустить первым. Рекомендация:

1. **Wave 1 (A)** — фундамент, обязательно первый
2. **Wave 2 (B)** + **Wave 3 (C)** — параллельные после A
3. **Wave 4-6** — по мере свободных рук

Каждая волна — отдельная сессия с своим `/codex-paranoia plan` → impl → `/codex-paranoia wave`.
