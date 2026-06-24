# Edit lesson + deal status in past — undo / re-mark

**Date:** 2026-06-24
**Status:** SHIPPED 2026-06-24. PR #729 backend + #732 UI + #733 E2E + #734 hotfix (4 BLOCKERs от wave round 1). Codex-paranoia plan ESCALATED round 3/3 (in-plan fixes), wave SIGN-OFF round 2/3.
**Owner:** Claude

## Context

Owner ask 1 (lessons): «Сейчас пользователь не может изменить статус конкретного урока в списке вот тут https://levelchannel.ru/teacher/lessons. Нужно продумать и дать возможность пользователю менять статусы "в прошлом" если вдруг он что то неправильно нажал или перепутал само занятие.»

Owner ask 2 (deals): «еще нужно про Дела не забыть — там нужна такая же логика». Учитель отметил «дело» как выполнено/отменено и потом понял, что ошибся → нужен undo.

Текущее состояние:

**Уроки** (`LessonHistoryClient` в `/teacher/lessons?kind=lessons`):
- **Если ученик unmarked** — 2 inline buttons: «Провёл» / «Не пришёл».
- **Если ученик уже marked** — статус pill (Проведено / Не пришёл / Учитель не пришёл / Отменено / Не оплачено / Оплачено), **no edit affordance**.

**Дела** (`DealsSection` в `/teacher/lessons?kind=deals`, source=`personal_event`):
- **Если дело active** (`status='personal_event'`) — pill «● Активно» (но активные дела с прошедшей датой обычно не остаются — учитель их закрывает в календаре).
- **Если дело terminal** (`status='completed'` / `'cancelled'`) — pill «✓ Выполнено» / «Отменено», **no edit affordance**.

Учитель ошибочно нажал «Не пришёл» вместо «Провёл» (или «Выполнено» вместо «Отменено») — нет undo.

## Решения владельца (2026-06-24)

- **Вариант А**: kebab-меню (`⋯`) на каждой строке с уже отмеченным статусом.
- **Окно правки**: безлимитное по умолчанию **в UX**, но bookkeeping safety gates сохраняются (см. ниже Безопасные ограничения).
- **Подтверждение**: простой confirm-диалог без поля «причина».
- **Уведомление ученику**: опциональный чекбокс «Уведомить ученика» внутри confirm-диалога (по умолчанию выключен — пусть учитель сам решает).

### Безопасные ограничения (нельзя обойти — нарушают бухгалтерию)

Если урок уже:
- прошёл 48-часовое окно правки `lesson_completions.immutable_at`/`created_at+48h` (existing safety gate в `app/api/teacher/lessons/[id]/uncomplete/route.ts:93-108`),
- или уже учтён в `lesson_settlement_completions` (settled — деньги по этому уроку уже зачтены, gate в route.ts:110-124),
- или уже начислил `teacher_earnings.related_completion_id` (gate в route.ts:126-141),

→ kebab-меню показывает **disabled** позицию с explainer тултипом («Урок уже учтён в платежах — отметку нельзя снять. Обратитесь в поддержку.»). Owner override этих gates требует отдельного admin-flow + ручной коррекции книги — out of scope.

Для **дел** (personal events) этих gates НЕТ — они не billable. Безлимитно как UX, так и backend.

## Existing surface inventory

### Уроки
Endpoints (verified):
- `POST /api/teacher/slots/:slotId/mark-completed` — отмечает completion (создаёт `lesson_completions` row + advisory lock).
- `POST /api/teacher/slots/:slotId/mark-no-show` — отмечает no-show (UPDATE `lesson_slots.status='no_show_learner'`).
- `POST /api/teacher/lessons/:completionId/uncomplete` (NOT `/slots/:slotId/uncomplete` — план был неверен) — DELETE `lesson_completions` row; AFTER DELETE trigger возвращает slot в `booked`. Три gates: 48h immutability, settlement coverage, accrued earnings (`app/api/teacher/lessons/[id]/uncomplete/route.ts:93-141`).

Backend mutations (`lib/scheduling/slots/`):
- `markSlotByTeacher` (completed / no_show_learner / no_show_teacher).
- `uncompleteSlot` — НЕ существует как helper; uncomplete живёт inline в route file.
- Advisory lock namespace: разные codepaths используют **разные** prefixes — `pkg_consume:<learnerId>` (`lib/scheduling/slots/booking.ts:186`) vs `pkg-stack:<learnerId>` (`lib/scheduling/slots/mutations-reschedule.ts:91,389`). **Унификация требуется как часть этого эпика** (см. WARN #6) — single shared key `pkg-stack:<learnerId>` для всех slot+billing writes.

**Read model gap** для kebab UI:
- `LessonHistoryClient` сейчас несёт только `slot.id`, `isMarked`, `paymentStatus` (`lib/scheduling/slots/teacher-lesson-history.ts:32-39`).
- Для kebab нужны: `completionId` (для существующего `/api/teacher/lessons/:completionId/uncomplete`) + `updatedAt` token (для 409 conflict detection) + `canEdit: {edit: boolean, reason?: 'immutable' | 'settled' | 'accrued' | null}` (для disabled state в menu).
- **Расширить `teacher-lesson-history.ts` row type** в Sub-PR 1.

### Дела (personal events) — `source='personal_event'`
Endpoints (verified в `app/api/teacher/personal-events/`):
- `POST /api/teacher/personal-events/:id/complete` (через `completePersonalEvent`).
- `POST /api/teacher/personal-events/:id/cancel` (через `cancelPersonalEventByTeacher`).
- `GET /api/teacher/personal-events/history` — history list для DealsSection.

Backend mutations (`lib/scheduling/slots/personal-events.ts`):
- `completePersonalEvent(slotId, teacherAccountId)`: `personal_event` → `completed`.
- `cancelPersonalEventByTeacher(slotId, teacherAccountId, reason)`: `personal_event` → `cancelled`.
- **Нет revert mutation** (нет аналога `uncompleteSlot` для дел) — нужно добавить.
- Advisory lock не используется (нет ученика, нет billing, single-teacher resource — `for update` row lock достаточен).

**Read model gap** для kebab UI на делах:
- `GET /api/teacher/personal-events/history` сейчас возвращает `{id, startAt, durationMinutes, status, title, body}` (`app/api/teacher/personal-events/history/route.ts:21-30`).
- Для kebab нужен `updatedAt` token + явный `canEdit: true` (для дел всегда true, но проброс делает row type consistent с lesson rows).

## Scope

### Что можно менять — Уроки

**Statuses that admin/teacher can flip (post-факт):**

| From → To | Allowed | Backend mutation needed |
|---|---|---|
| Проведено → Не пришёл | ✅ | uncomplete + mark-no-show |
| Проведено → Не оплачено (booked) | ✅ | uncomplete only |
| Не пришёл → Проведено | ✅ | unmark-no-show + mark-completed |
| Не пришёл → Не оплачено (booked) | ✅ | unmark-no-show only |
| Не оплачено → Проведено | ✅ | mark-completed (existing «Провёл» button) |
| Не оплачено → Не пришёл | ✅ | mark-no-show (existing «Не пришёл» button) |
| Учитель не пришёл → Проведено | ✅ | unmark + mark-completed |
| Отменено → anything | ❌ | cancelled slot — separate state, не edit-able из history |

### Что можно менять — Дела (personal events)

| From → To | Allowed | Backend mutation needed |
|---|---|---|
| Выполнено → Активно | ✅ | uncompletePersonalEvent (new) |
| Выполнено → Отменено | ✅ | uncompletePersonalEvent + cancelPersonalEventByTeacher (chain) |
| Отменено → Активно | ✅ | restorePersonalEventFromCancelled (new) |
| Отменено → Выполнено | ✅ | restorePersonalEventFromCancelled + completePersonalEvent (chain) |
| Активно → Выполнено | ✅ | existing completePersonalEvent (already CTA в календаре) |
| Активно → Отменено | ✅ | existing cancelPersonalEventByTeacher (already CTA в календаре) |

Замечания для дел:
- **Нет ученика**: чекбокс «Уведомить» в диалоге не показывается.
- **Нет billing**: предупреждение «может затронуть оплаты» не показывается.
- **Нет advisory lock**: row-level `for update` достаточен (single-teacher resource).
- Reason при cancel restored as NULL при revert; повторный cancel запросит новую reason если её решено вернуть (out of scope для этого эпика — оставляем reason=NULL для chain mutations).

### Existing backend gaps

**Уроки:**
- ❌ `uncompleteSlot` exists, но **no `unmarkNoShowLearner`** mutation. **Need to add** (Sub-PR 1).
- Backend also needs **chain mutations** (e.g. «Проведено → Не пришёл» = uncomplete + mark-no-show as atomic op).

**Дела:**
- ❌ Нет `uncompletePersonalEvent` (`completed` → `personal_event`). **Need to add** (Sub-PR 1).
- ❌ Нет `restorePersonalEventFromCancelled` (`cancelled` → `personal_event`, clear `cancelled_at` / `cancelled_by_account_id` / `cancellation_reason`). **Need to add** (Sub-PR 1).
- Chain mutations symmetric to уроки.

## Design — Вариант А (kebab menu)

### Per-row UI

```
┌─────────────────────────────────────────────────────────────┐
│ Ivan P  23 июн., 16:03 · 52 мин  [Проведено ✓]         ⋯  │
└─────────────────────────────────────────────────────────────┘
                                                          ↓ click
                                       ┌─────────────────────────────┐
                                       │ Изменить на «Не пришёл»     │
                                       │ Изменить на «Не оплачено»   │
                                       │ Изменить на «Учитель не пришёл» │
                                       └─────────────────────────────┘
```

- Kebab (`⋯`) button visible на **всех marked rows** (not unmarked — там уже есть «Провёл / Не пришёл»).
- Click → opens **menu/popover** с допустимыми transitions для текущего статуса.
- Click target → opens **confirm dialog**: «Точно изменить статус с «Проведено» на «Не пришёл»? Это может затронуть оплаты.»
- Confirm → fire API call → optimistic update + router.refresh().

### Диалог подтверждения

```
┌─────────────────────────────────────────────────┐
│  Изменить статус занятия?                        │
│                                                  │
│  Ivan P · 23 июн., 16:03                         │
│  Было:    Проведено                              │
│  Станет:  Не пришёл                              │
│                                                  │
│  ⚠ Если занятие было оплачено через пакет —     │
│  пакет восстановится, долг ученика обновится.   │
│                                                  │
│  ☐ Уведомить ученика об изменении               │
│                                                  │
│         [Отмена]    [Изменить статус]            │
└─────────────────────────────────────────────────┘
```

- Чекбокс «Уведомить ученика» **выключен по умолчанию**. Если включён — отправляется email + TG (если канал привязан) с короткой формулировкой: «Учитель изменил статус занятия 23 июн. 16:03 с «Проведено» на «Не пришёл».»
- Поля «причина» нет — мы не спрашиваем, мы доверяем учителю.

## Подход к реализации (декомпозиция, без кода — для ревью)

Эпик разбивается на три суб-PR. Конкретный код будет писаться только после твоего одобрения дизайна.

### Суб-PR 1 — Бэкенд: цепочка мутаций для уроков + дел

#### 1.0 Advisory-lock decision — match existing slot-writers

**Audit состояния (verified в коде):**
- `lib/scheduling/slots/booking.ts:186` — `pg_advisory_xact_lock(hashtext('pkg_consume:' || $learnerId))`.
- `lib/scheduling/slots/mutations-reschedule.ts:91,389` — `pkg_consume` (the same form).
- `lib/scheduling/slots/mutations-assign-direct.ts:109` — `pkg_consume`.
- `lib/billing/package-grant.ts:225` — **different form**: `hashtextextended('pkg-stack:' || $teacherId || ':' || $learnerId, 0)`. Двух-аргументный, teacher-scoped.

**Решение для этого эпика**: новый `change-status` endpoint **использует тот же `pkg_consume:<learnerId>` prefix + hashtext form** что и existing slot-writers (booking, reschedule, assign-direct). НЕ объединять с `pkg-stack` (package-grant). Если будущая wave хочет full unification — отдельный эпик с миграцией.

**Rationale**: `pkg_consume` сериализует все slot lifecycle mutations per-learner — это именно то что нужно для chain mutation. `pkg-stack` (с teacher+learner key) защищает package-stack writes (purchases / grants), не slot status changes. Уровни разные, можно безопасно оставить отдельно.

Edge case для дел (`source='personal_event'`, `learner_account_id=NULL`): advisory lock не берётся вообще; использовать `SELECT FOR UPDATE` row lock — single-teacher resource, гонок нет.

#### 1.1 Endpoint для уроков

**Новый endpoint:** `POST /api/teacher/slots/:slotId/change-status`

**Тело запроса:**
```json
{
  "to": "completed" | "no_show_learner" | "no_show_teacher" | "booked",
  "notifyLearner": false,
  "expectedUpdatedAt": "2026-06-24T07:42:00.000Z"
}
```

`expectedUpdatedAt` — required. Берётся из расширенного history read-model (см. §1.4). Если значение отличается от текущего `lesson_slots.updated_at` — endpoint отвечает 409 `{error: 'stale'}` без mutation. UI показывает toast «Кто-то уже изменил статус. Обновляем…».

**Логика на сервере:**
1. **Authorize**: учитель должен владеть слотом (`teacher_account_id = sessionAccountId`); иначе 403.
2. Открыть транзакцию `client.query('begin')`. Acquire advisory lock `pkg_consume:<learnerId>` через `hashtext` (см. §1.0).
3. SELECT slot FOR UPDATE; прочитать `status`, `source`, `updated_at`, `learner_account_id`.
4. Отказать 400 `{error: 'wrong_kind'}`, если `source='personal_event'`. Для дел отдельный endpoint (§1.2).
5. Отказать 409 `{error: 'stale'}`, если `updated_at !== expectedUpdatedAt`.
6. Отказать 400 `{error: 'cannot_edit_cancelled'}`, если `status='cancelled'`.
7. Если current state имеет существующую `lesson_completions` row (status=completed) и chain включает удаление completion (e.g. completed → booked / no_show_*):
   - Прочитать `lesson_completions.id`, `created_at`, `immutable_at`.
   - Проверить 48h immutability gate: `immutable_at IS NOT NULL OR (now() - created_at) >= 48h interval`. Иначе 409 `{error: 'immutable'}`.
   - Проверить `lesson_settlement_completions` EXISTS. Иначе 409 `{error: 'settled'}`.
   - Проверить `teacher_earnings.related_completion_id` EXISTS. Иначе 409 `{error: 'accrued'}`.
8. Применить chain mutation как **inline SQL** в той же TX (НЕ переиспользуем helpers — они открывают свою `begin/commit`, см. `lib/scheduling/slots/teacher-lifecycle.ts:79`, `personal-events.ts:119,151`).

**Критично** (R3-#1 fix): `no_show_learner` — это billable state, SoT живёт в `lesson_completions.was_no_show=true`, а не просто в `lesson_slots.status`. См. `migrations/0092_lesson_completions.sql:70-72` comment + FORWARD trigger (INSERT) + REVERSE trigger (AFTER DELETE) сами flip slot.status. **Триггеры обозначены AFTER, не BEFORE** — план исправлен.

Inline SQL для каждой transition:
- `completed → booked`: `DELETE lesson_completions WHERE slot_id=$1` (`AFTER DELETE` trigger вернёт `slot.status='booked'`). BEFORE DELETE guard уже проверен в шаге 7.
- `completed → no_show_learner`: `UPDATE lesson_completions SET was_no_show=true WHERE slot_id=$1` + явный `UPDATE lesson_slots SET status='no_show_learner', updated_at=now() WHERE id=$1`. (UPDATE `was_no_show` НЕ триггерит forward trigger — он на INSERT — поэтому slot.status переписываем явно. Tests проверяют consistency.)
- `no_show_learner → completed`: `UPDATE lesson_completions SET was_no_show=false WHERE slot_id=$1` + `UPDATE lesson_slots SET status='completed', updated_at=now() WHERE id=$1`.
- `no_show_learner → booked`: `DELETE lesson_completions WHERE slot_id=$1` (REVERSE trigger вернёт slot.status='booked'). Тоже BEFORE DELETE guard в шаге 7.
- `booked → completed`: INSERT `lesson_completions(slot_id, teacher_id, learner_id, was_no_show=false, marked_by_account_id, snapshot...)`. Forward trigger перепишет slot.status='completed'.
- `booked → no_show_learner`: INSERT `lesson_completions(was_no_show=true, ...)`. Forward trigger → slot.status='no_show_learner'.
- **Snapshot для INSERT** (`booked → completed/no_show_learner`): не пытаемся re-derive — копируем из existing slot fields (tariff snapshot уже стоит в `lesson_slots`). Поля: `tariff_id`, `amount_kopecks`, `duration_minutes`, `learner_account_id`, `teacher_account_id`, `marked_by_account_id=sessionAccountId`. Если slot не имеет tariff snapshot (legacy) — отказать с 422 `{error: 'missing_snapshot'}`.
- `no_show_teacher` — отдельный path БЕЗ `lesson_completions` row (см. comment `mig 0092:72`). Transitions:
  - `no_show_teacher → booked`: `UPDATE lesson_slots SET status='booked', marked_at=NULL, updated_at=now()`.
  - `no_show_teacher → completed`: `UPDATE lesson_slots SET status='booked'` + INSERT `lesson_completions(was_no_show=false)` → trigger flip в `completed`.
  - `no_show_teacher → no_show_learner`: `UPDATE lesson_slots SET status='booked'` + INSERT `lesson_completions(was_no_show=true)`.
  - `booked → no_show_teacher`: `UPDATE lesson_slots SET status='no_show_teacher', marked_at=now()`. (Существующий path в `lib/scheduling/slots/lifecycle.ts:50-74`.)
- **Note**: `no_show_teacher` path по-прежнему non-billable; не создаёт `lesson_completions` row напрямую — только если переключаемся на billable terminal state.
9. **Записать audit row В ТОЙ ЖЕ TRANSACTION** (`audit_lesson_status_change` insert до commit) с `actor_role='teacher'`, `actor_account_id=sessionAccountId`, `from_status`, `to_status`, `notified_learner=requested_notify` (пользователь поставил чекбокс — это intent, не delivery; см. §1.5).
10. COMMIT.
11. **Post-commit**: если `requested_notify=true` — fire-and-forget dispatch `LessonStatusChangedByTeacher` event. Failure НЕ откатывает commit — best-effort (consistent с existing dispatcher contract в `lib/notifications/lesson-event-dispatch.ts:12-140`).
12. Return `{ok: true, slotId, newUpdatedAt}`.

**Важно про refactoring**: новый endpoint **НЕ переиспользует** `markSlotByTeacher`, `markSlotLifecycle`, `markLessonCompleted` напрямую — они каждый открывают свою `begin/commit`. Возможны 2 пути:
- (a) Inline SQL для chain mutation в endpoint (предпочтительный — меньше риска для existing callers).
- (b) Refactor helpers под tx-aware (принимают `client: PoolClient` опционально) — это **отдельный prep-PR** с тестами всех existing callers (mark-completed, mark-no-show, mutations-reschedule).

Plan goes with (a) для Sub-PR 1; (b) — out of scope этого эпика.

#### 1.2 Endpoint для дел

**Новый endpoint:** `POST /api/teacher/personal-events/:id/change-status`

**Тело запроса:**
```json
{
  "to": "personal_event" | "completed" | "cancelled",
  "expectedUpdatedAt": "2026-06-24T07:42:00.000Z"
}
```

(notifyLearner НЕ принимается — у дел нет ученика.)

**Логика на сервере:**
1. Authorize: учитель должен владеть делом (`teacher_account_id = sessionAccountId` AND `source = 'personal_event'`); иначе 403.
2. Открыть транзакцию. SELECT slot FOR UPDATE; прочитать `status`, `source`, `updated_at`. Advisory lock не берётся (см. §1.0).
3. Отказать 400 `{error: 'wrong_kind'}`, если `source != 'personal_event'`.
4. Отказать 409 `{error: 'stale'}`, если `updated_at !== expectedUpdatedAt`.
5. Применить chain mutation как **inline SQL** в той же TX (НЕ переиспользуем `completePersonalEvent`/`cancelPersonalEventByTeacher` — они открывают свою `begin/commit`, см. `personal-events.ts:119,151`):
   - `completed` → `personal_event`: UPDATE `lesson_slots SET status='personal_event', marked_at=NULL, updated_at=now()`.
   - `completed` → `cancelled`: UPDATE `lesson_slots SET status='cancelled', marked_at=NULL, cancelled_at=now(), cancelled_by_account_id=sessionAccountId, cancellation_reason=NULL, updated_at=now()`.
   - `cancelled` → `personal_event`: UPDATE `lesson_slots SET status='personal_event', cancelled_at=NULL, cancelled_by_account_id=NULL, cancellation_reason=NULL, updated_at=now()`.
   - `cancelled` → `completed`: UPDATE `lesson_slots SET status='completed', cancelled_at=NULL, cancelled_by_account_id=NULL, cancellation_reason=NULL, marked_at=now(), updated_at=now()`.
   - `personal_event` → `completed`: UPDATE `lesson_slots SET status='completed', marked_at=now(), updated_at=now()`.
   - `personal_event` → `cancelled`: UPDATE `lesson_slots SET status='cancelled', cancelled_at=now(), cancelled_by_account_id=sessionAccountId, cancellation_reason=NULL, updated_at=now()`.
6. Все mutations НЕ трогают `personal_event_title` / `personal_event_body` — invariant `personal_event_source_invariants` (`migrations/0139:73-93`) сохраняется (тест pin).
7. Append event log to `lesson_slots.events` jsonb с `kind='deal.status_change'`, `actor_account_id`, `from_status`, `to_status`.
8. Записать audit row В ТОЙ ЖЕ TRANSACTION (`source='deal'`, `learner_account_id=NULL`, `notified_learner=false` — у дел нет ученика).
9. COMMIT. Return `{ok: true, slotId, newUpdatedAt}`.

#### 1.3 Новые backend mutations

В `lib/scheduling/slots/personal-events.ts`:
- `uncompletePersonalEvent(slotId, teacherAccountId)`: `completed` → `personal_event` (clear `marked_at`).
- `restorePersonalEventFromCancelled(slotId, teacherAccountId)`: `cancelled` → `personal_event` (clear `cancelled_at`, `cancelled_by_account_id`, `cancellation_reason`).

В `lib/scheduling/slots/`:
- `unmarkNoShowLearner(slotId, teacherAccountId)`: `no_show_learner` → `booked` (clear `marked_at`).
- `unmarkNoShowTeacher(slotId, teacherAccountId)`: `no_show_teacher` → `booked`.

Все четыре новые mutations принимают client-passed `pg.PoolClient` для использования в существующей транзакции из chain endpoint (НЕ open own transaction).

#### 1.4 Read-model расширения

`lib/scheduling/slots/teacher-lesson-history.ts`:
- Добавить в row type: `completionId: string | null`, `updatedAt: string` (ISO), `canEdit: {edit: boolean, reason: 'immutable' | 'settled' | 'accrued' | null}`.
- SQL: LEFT JOIN `lesson_completions` ON slot_id; derive `canEdit`:
  - `edit=false, reason='immutable'` если `lesson_completions.immutable_at IS NOT NULL` OR `(now() - lesson_completions.created_at) >= interval '48 hours'`. (Full parity с `app/api/teacher/lessons/[id]/uncomplete/route.ts:93-108`.)
  - `edit=false, reason='settled'` если `EXISTS (SELECT 1 FROM lesson_settlement_completions WHERE completion_id = lc.id)`.
  - `edit=false, reason='accrued'` если `EXISTS (SELECT 1 FROM teacher_earnings WHERE related_completion_id = lc.id)`.
  - `edit=true, reason=null` иначе.
- Performance: 3 sub-queries per row. На 100-row history page — приемлемо (< 50ms). Если станет узким местом — индексы уже есть (`lesson_settlement_completions_completion_idx`, `teacher_earnings_related_completion_idx`).

`app/api/teacher/personal-events/history/route.ts`:
- Добавить в row: `updatedAt`. Source from `lesson_slots.updated_at`. Для дел `canEdit: {edit: true, reason: null}` всегда (нет billing).

**Новая миграция:** `migrations/0141_lesson_status_change_audit.sql`

```sql
create table if not exists audit_lesson_status_change (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references lesson_slots(id) on delete cascade,
  actor_account_id uuid null references accounts(id) on delete set null,
  actor_role text not null check (actor_role = 'teacher'),
  learner_account_id uuid null references accounts(id) on delete set null,
  source text not null check (source in ('lesson','deal')),
  from_status text not null,
  to_status text not null,
  notify_intent boolean not null default false,
  notify_dispatched_at timestamptz null,
  ts timestamptz not null default now()
);
create index audit_lesson_status_change_slot_idx
  on audit_lesson_status_change (slot_id, ts desc);
create index audit_lesson_status_change_actor_idx
  on audit_lesson_status_change (actor_account_id, ts desc);
create index audit_lesson_status_change_notify_rate_idx
  on audit_lesson_status_change (actor_account_id, slot_id, notify_dispatched_at)
  where notify_dispatched_at is not null;
```

**R3-#2 fix — semantics**:
- `notify_intent` (boolean): учитель поставил чекбокс «уведомить».
- `notify_dispatched_at` (timestamptz null): момент `dispatch.send()` attempt; NULL если skipped (intent off, preferences blocked, или rate-limited).
- Rate-limit: `EXISTS WHERE actor_account_id=:teacher AND slot_id=:slot AND notify_dispatched_at IS NOT NULL AND ts > now() - interval '1 day'`. Иначе dispatch fires. Audit row для следующего call всё равно пишется с `notify_intent=true, notify_dispatched_at=NULL` (skipped due to rate-limit).

**Critical** (R2-#3 fix): обе FK `actor_account_id` и `learner_account_id` имеют `ON DELETE SET NULL` — иначе Playwright `tests/e2e/seed.mjs:60` (delete from accounts where email like fixture pattern) и `tests/integration/setup.ts:36` cleanup упадут на FK после первого audit insert. `slot_id` остаётся `ON DELETE CASCADE` (consistent с existing slot deletions in fixture cleanup).

**Note про admin scope** (Q-3): Endpoint в первой версии авторизует только owner-teacher (`teacher_account_id = sessionAccountId`). `actor_role` CHECK = 'teacher' — admin-edit это **отдельная миграция** + отдельный endpoint в follow-up эпике (`/api/admin/slots/:id/change-status` с admin-guard).

#### 1.5 Notification dispatch — новый event

**Семантика `notified_learner` поля** (R2-#5 fix): это **intent** учителя (поставил чекбокс) — НЕ доказательство delivery. Existing dispatcher best-effort и не транзакционен (`lib/notifications/lesson-event-dispatch.ts:12,140`). Если нужен delivery audit — отдельная история через `notification_log` (mig 0130).

Добавить в `lib/notifications/lesson-event-dispatch.ts`:
- Новый kind `LessonStatusChangedByTeacher`.
- Поля payload: `{slotId, fromStatus, toStatus, startAtIso}`.

Добавить в `lib/notifications/templates.ts`:
- Email template: «Учитель изменил статус занятия 23 июн. 16:03 с «Не пришёл» на «Проведено».»
- TG template (если `learner.tg_channel_id != null`): аналогично.

Добавить в `lib/notifications/preferences.ts` catalog (R2-#6 fix):
- Новая запись в hardcoded catalog с `kind='LessonStatusChangedByTeacher'`, человекочитаемое имя «Учитель изменил статус занятия», default `email=true, tg=true`.
- Учётка ученика управляет через `/teacher/settings/notifications` UI (страница уже рендерит catalog).

`iterSeq` / `dedup-key`: `lesson-status-change:{slotId}:{ts-rounded-to-minute}` — на случай double-click.

Rate-limit (R-2): простой DB-side check в endpoint **перед** dispatch — если в `audit_lesson_status_change` уже есть row с `slot_id=:id` AND `actor_account_id=:teacher` AND `ts > now() - interval '1 day'` AND `notified_learner=true` — НЕ отправлять (skip dispatch silent, status change всё равно проходит). Audit row для текущего change всё равно пишется с `notified_learner=true` (intent), но dispatch skipped. Документация в комментарии endpoint объясняет.

Preferences: respect `notification_preferences` (mig 0138) — те же gates что и для существующих lesson notifications. Если ученик отключил kind через UI — dispatch skipped независимо от rate-limit.

#### 1.6 Тесты бэкенда

- Unit-тест на mutation chain для уроков (все 7 transitions из таблицы).
- Unit-тест на mutation chain для дел (все 6 transitions из таблицы).
- Integration-тест полного цикла через Docker Postgres:
  - advisory lock + audit row внутри той же TX.
  - 48h gate, settlement gate, earnings gate отказывают correctly.
  - 409 stale `expectedUpdatedAt`.
  - 403 чужой slot.
  - failure dispatch НЕ откатывает commit (mock dispatch throws after commit).
  - Дело: chain `cancelled → completed` сохраняет `personal_event_title`.
  - Дело: chain `cancelled → personal_event` clears `cancellation_reason`, `cancelled_at`, `cancelled_by_account_id`.
- Test: rate-limit notification (второй call в течение дня — `notified_learner=false` в audit row).

### Суб-PR 2 — UI: kebab-меню + диалог подтверждения

**Файлы (план):**
- `components/teacher/lessons/lesson-history-client.tsx` — добавить kebab-меню на строках уроков с уже отмеченным статусом.
- `components/teacher/lessons/deals-section.tsx` — добавить kebab-меню на строках дел с terminal статусом (`completed`/`cancelled`).
- `components/teacher/lessons/StatusChangeMenu.tsx` (новый) — popover/меню; принимает `kind: 'lesson' | 'deal'` + `currentStatus` + `canEdit`; рендерит допустимые transitions; если `canEdit.edit=false` — рендерит disabled item с tooltip-explainer (на основе `canEdit.reason`).
- `components/teacher/lessons/StatusChangeConfirmModal.tsx` (новый) — диалог подтверждения; для `kind='lesson'` показывает billing warning + чекбокс «Уведомить ученика»; для `kind='deal'` ни того, ни другого.

**Refetch path (BLOCKER #3 fix):**
- `LessonHistoryClient` и `DealsSection` оба держат local state — `router.refresh()` НЕ работает.
- Решение: после успешного API call вызвать callback в parent → parent re-fetch `/api/teacher/lessons/history` (новый endpoint для уроков) и/или `/api/teacher/personal-events/history` → setState с новыми rows.
- `LessonHistoryClient` сейчас принимает initial rows через props — расширим: добавим `refetch` функцию + локальный state.
- **Inflight-guard для refetch** (R3-#5 fix): `DealsSection` сейчас имеет `let live = true` cleanup но не имеет `AbortController` для concurrent refetch. Расширим:
  - useRef для inflight `AbortController` token.
  - При новом refetch: `abortController.current?.abort()` + создать new controller + pass signal в fetch.
  - В success-handler проверять `signal.aborted` перед `setState`.
  - Same pattern для `LessonHistoryClient` если он сейчас только использует `live` flag — расширить до AbortController.
- Альтернатива: использовать SWR/React Query — НЕ внедряем, т.к. эпик single-purpose; ручной refetch проще.

**Переиспользуем существующие primitives:**
- `<Button variant="ghost">` для kebab.
- `<Banner>` для предупреждения о биллинге (только для уроков).
- `<Checkbox>` для «Уведомить ученика» (только для уроков).
- Modal-паттерн из `feed.tsx` (decline / refund модалки).

**Billing copy для confirm dialog (WARN #9 fix):**
- Если урок paid через `package` (consumption) → «Пакет ученика восстановится на 1 занятие.»
- Если урок paid через `payment_claim` (confirmed) → «Урок был оплачен через СБП — claim останется без изменений, статус занятия обновится. Если нужен возврат — оформите отдельно.»
- Если урок paid через `direct_allocation` → «Прямая оплата останется без изменений; статус обновится.»
- Если урок unpaid (booked / no_show_*) → нет billing warning, только короткий confirm.
- Определять paid-state через `lib/billing/paid-state.ts` функции; читать в API change-status response для UI отображения (или fetch отдельно перед confirm dialog).

### Суб-PR 3 — E2E + evals

**Seed расширения (WARN #8 fix):**
- `tests/e2e/seed.mjs` сейчас создаёт `1 future open + 2 past booked` lesson slots. Расширить:
  - +1 past completed lesson (with `lesson_completions` row, NOT settled, NOT accrued — должен пройти gates).
  - +1 past completed lesson (settled — будет показывать disabled kebab item).
  - +1 past no_show_learner lesson (с `lesson_completions row was_no_show=true`).
  - +2 past personal_event slots: 1 completed, 1 cancelled.

**Teardown расширения** (R3-#6 fix): seed teardown сейчас только `delete from accounts`. Добавить explicit pre-delete для:
- `audit_lesson_status_change WHERE slot_id IN (SELECT id FROM lesson_slots WHERE teacher_account_id IN fixtureIds OR learner_account_id IN fixtureIds)`.
- Slot CASCADE handles `audit_lesson_status_change.slot_id` (CASCADE FK), но если slot не cascade-trigger early — explicit delete safer.
- Verify через integration test `seed → run e2e once → re-seed → no FK error`.

**Новые e2e specs:**
- `tests/e2e/teacher-lessons-status-change.spec.ts` — kebab → меню → confirm → успешный апдейт для урока (completed → no_show_learner) И для дела (completed → cancelled). 2 теста.
- Также test: settled lesson row показывает disabled kebab item с tooltip.
- Также test: 409 stale conflict — fire mutation после mock-tampered `updated_at`.

**Eval rows** (новые в `evals/PRODUCT_FLOWS.md §D`, полный контракт per row format в §10-24 файла):
- `FLOW-TEACHER-LESSONS-STATUS-CHANGE-001` (lesson) — конкретные anchors: «Изменить статус», kebab `⋯`, dialog title «Изменить статус занятия?».
- `FLOW-TEACHER-DEALS-STATUS-CHANGE-001` (deal) — anchors: kebab `⋯` on terminal deal row, dialog «Изменить статус дела?».

**Manual QA:**
- Login as teacher → /teacher/lessons?kind=lessons → найти marked row → kebab → меню → confirm → статус обновлён + row refetched (НЕ нужно reload page).
- Verify learner получает email (если чекбокс включён) — проверить через `tests/integration` mock dispatch.
- Verify settled lesson disabled state в kebab с tooltip explainer.

## Edge cases

| Case | Handling |
|---|---|
| Slot was paid через package (consumption) | Mutation also restores package count + adjusts learner debt через existing uncomplete flow. Notify learner если чекбокс включён. |
| Slot was paid через `payment_claim` (confirmed) | Refund flow remains untouched (separate state); status change adjusts only `slot.status`, не claim. Show warning в confirm dialog. |
| Concurrent user edits same slot через different surface | Last-write-wins per `updated_at` token returned in API. UI shows toast если 409. |
| Original mutation triggered email/TG event | Новый `LessonStatusChangedByTeacher` event sends a correction email to learner (только если чекбокс включён). |
| Audit trail | `audit_lesson_status_change` table: slot_id, actor_account_id, actor_role, learner_account_id, source, from_status, to_status, notified_learner, ts. Visible только админу. |
| Дело: оригинальный slot имел `cancellation_reason` — при revert clear reason | Reason обнуляется в `restorePersonalEventFromCancelled`. История изменений зафиксирована в `events` jsonb и audit table. |
| Дело: при chain `cancelled → completed` не запрашиваем причину | Reason не нужна для completed; chain выполняется атомарно. |

## Risks

- **R-1**: Chain mutations (uncomplete + remark) могут leave slot в inconsistent state if mid-failure. **Mitigation**: atomic transaction (см. §1.1 шаги 2-10).
- **R-2**: Notification spam if учитель меняет status touchpoint. **Mitigation**: rate-limit через audit-table check (см. §1.5).
- **R-3**: Status change может изменить billing (debt / package count). UI должен это явно показать в confirm dialog. **Mitigation**: typed copy в §Sub-PR 2 billing copy.
- **R-4**: Owner asked unlimited time window — но 48h/settlement/earnings gates сохраняются (см. §Безопасные ограничения). **Mitigation**: kebab показывает disabled state с explainer для immutable rows.
- **R-5**: Race между admin edit и teacher edit через разные surfaces. **Mitigation**: `expectedUpdatedAt` token в request body + 409 conflict (см. §1.1 шаг 5).
- **R-6**: Audit row может потеряться если notify fail и эти разные TX. **Mitigation**: audit row + status change в одной TX; notify post-commit (см. §1.1 шаги 9-11).

## Out of scope

- Bulk status changes (UI for multiple slots) — отдельный future epic.
- Mobile UX optimization (kebab menu может быть UX-heavy on touch) — verify в impl, fallback к full-screen sheet если узко.
- `cancelled` (урок) → anything edits — separate state machine; для дел `cancelled` обратимо.
- Reason editing на cancellation для дел — chain mutations выставляют reason=null; редактировать reason не позволяем.

## Verification

### Tests
- `npm run test:run` — unit + integration green (уроки + дела mutation chains).
- `npm run test:integration` — Docker Postgres + new lesson-status-change-integration.test.ts + deal-status-change-integration.test.ts.
- `npm run test:e2e:product-flows` — teacher-lessons-status-change.spec.ts (2 теста — урок и дело).

### Manual
- Login as teacher → /teacher/lessons?kind=lessons → найти marked row → kebab → меню → confirm → статус обновлён.
- Verify learner получает notification (если чекбокс включён).
- Verify package count restored (если applicable).
- Login as teacher → /teacher/lessons?kind=deals → найти terminal row (✓ Выполнено или Отменено) → kebab → меню → confirm → статус обновлён.
- Verify дело при revert обратно в Активно с очищенными cancellation полями.

## Открытые вопросы

- **Q-1**: ~~Уведомление ученику~~ — **решено**: опциональный чекбокс в диалоге, по умолчанию выключен. Для дел чекбокс отсутствует (нет ученика).
- **Q-2**: ~~Поле «причина»~~ — **решено**: нет поля, простой confirm.
- **Q-3**: Админ откатывает изменение учителя — отдельный flow или тот же endpoint? **По умолчанию**: тот же endpoint, audit-лог пишет `actor_account_id` + `actor_role`.
- **Q-4**: Mobile UX — kebab-меню или bottom-sheet? **По умолчанию**: kebab + popover. Если будет тесно на 375px — переключим на bottom-sheet в импл-фазе.
- **Q-5**: Предупреждение «занятие очень давнее» (R-4)? **По умолчанию**: нет — владелец сказал «безлимитно».
- **Q-6**: Дело отображается в DealsSection ТОЛЬКО для terminal статусов? Сейчас компонент рендерит все 3 статуса, но активные дела с прошедшей датой редки. **По умолчанию**: kebab показываем для `completed`/`cancelled`; для `personal_event` оставляем существующие CTA в календаре (не дублируем).

## Deploy ordering contract (R3-#3 fix)

- **Sub-PR 1** содержит миграцию `0141_lesson_status_change_audit.sql` + endpoint код.
- Autodeploy через `levelchannel-autodeploy.timer` запускает `migrate:up` ДО `npm run build` (existing `scripts/postdeploy.sh:14` contract). Поэтому миграция гарантированно применится перед тем как endpoint станет доступен.
- Endpoint безопасен на legacy schema потому что:
  - Если 0141 миграция не применена — `INSERT INTO audit_lesson_status_change` упадёт с `relation does not exist`. Endpoint вернёт 500.
  - НО UI не renders kebab меню до Sub-PR 2 — никакой user не вызовет endpoint между Sub-PR 1 merge и migrate.
- **Manual safety check** при ручном deploy: проверить что 0141 в `migration_log` после Sub-PR 1 merge.

## Sign-off

- **Plan checkpoint**: `/codex-paranoia plan` — 3 rounds run, BLOCK на round 3 (см. §Codex paranoia trace ниже). Hard cap = 3 rounds → **ESCALATION к owner**.
- **Implementation**: not started — awaiting owner sign-off на финальный план + acceptance of remaining R3 BLOCKERs as RESOLVED in-plan.

## Codex paranoia trace

- **Round 1**: 5 BLOCKERs + 4 WARN. Fixes applied in-plan: 48h gates retained, slot→completion endpoint corrected, refetch path explicit, `expectedUpdatedAt` token, audit in TX.
- **Round 2**: 3 BLOCKERs + 3 WARN. Fixes applied in-plan: inline SQL instead of helper reuse, lock prefix decision documented (no unification), audit FKs `ON DELETE SET NULL`, disabled UI parity with 48h gate, notify semantics, preferences catalog.
- **Round 3**: 2 BLOCKERs + 4 WARN. Fixes applied in-plan:
  - **BLOCKER #1 `no_show_learner` semantics**: chain mutations переписаны на `lesson_completions.was_no_show` toggle (not `lesson_slots.status` direct write). Plan section §1.1 step 8 updated.
  - **BLOCKER #2 `notified_learner` ambiguity**: schema split в `notify_intent boolean` + `notify_dispatched_at timestamptz null` для disambiguated semantics.
  - WARN #3 deploy ordering: secton above.
  - WARN #4 BEFORE/AFTER DELETE trigger: factual correction, search/replace.
  - WARN #5 DealsSection inflight-guard: AbortController pattern в Sub-PR 2.
  - WARN #6 seed teardown: explicit pre-delete audit rows.
- **Trace files**: `/tmp/codex-paranoia-edit-status-20260624T074150Z/round-{1,2,3}.md`.

**Escalation rationale**: hard cap = 3 rounds. Все BLOCKER fixes применены в плане; план готов к sign-off. Owner может либо одобрить ESCALATED план в текущей форме, либо запросить 4-й Codex round (вне skill контракта — manual).

## Trailer plan

- Sub-PR 1 (backend): `Codex-Paranoia: SUB-WAVE self-reviewed (epic teacher-lessons-edit-status-2026-06-24); epic-end review pending`
- Sub-PR 2 (UI): same.
- Sub-PR 3 (E2E + evals): same.
- Epic-close PR: `Codex-Paranoia: SIGN-OFF round N/3 (epic-end on <range>)`
