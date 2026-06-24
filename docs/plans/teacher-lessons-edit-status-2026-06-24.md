# Edit lesson status in past — undo / re-mark

**Date:** 2026-06-24
**Status:** PLAN — awaiting `/codex-paranoia plan` SIGN-OFF
**Owner:** Claude

## Context

Owner: «Сейчас пользователь не может изменить статус конкретного урока в списке вот тут https://levelchannel.ru/teacher/lessons. Нужно продумать и дать возможность пользователю менять статусы "в прошлом" если вдруг он что то неправильно нажал или перепутал само занятие.»

Текущее: `LessonHistoryClient` показывает list of past lessons. Каждая row:
- **Если ученik unmarked** — 2 inline buttons: «Провёл» / «Не пришёл».
- **Если ученik уже marked** — статус pill (Проведено / Не пришёл / Учитель не пришёл / Отменено / Не оплачено / Оплачено), **no edit affordance**.

Учитель ошибочно нажал «Не пришёл» вместо «Провёл» — нет undo.

## Owner-resolved decisions (2026-06-24)

- **Вариант А**: kebab-menu (`⋯`) на каждой row.
- **Time window**: безлимитно (изменить можно всегда).
- **Confirm**: «Точно изменить?» dialog.

## Existing surface inventory

```bash
rg -l 'mark-completed|mark-no-show|uncomplete' app/api lib components | head
```

Endpoints (verified):
- `POST /api/teacher/slots/:slotId/mark-completed` — отмечает completion.
- `POST /api/teacher/slots/:slotId/mark-no-show` — отмечает no-show.
- `POST /api/teacher/slots/:slotId/uncomplete` — снимает completion (exists in `app/teacher/learners/[id]/uncomplete-button.tsx` consumer).

Backend mutations (`lib/scheduling/slots/`):
- `markSlotByTeacher` (completed / no_show_learner / no_show_teacher).
- `uncompleteSlot` (revert completion).
- Race-safe через advisory lock `pkg_consume:<learnerId>` (existing pattern from teacher-reschedule wave 2026-06-16).

## Scope

### What can change

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

### Existing backend gap

- ❌ `uncompleteSlot` exists, но **no `unmarkNoShowLearner`** mutation. **Need to add** (Sub-PR backend).
- Backend also needs to handle **chain mutations** (e.g. «Проведено → Не пришёл» = uncomplete + mark-no-show as atomic op).

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

### Confirm dialog

```
┌─────────────────────────────────────────────────┐
│  Изменить статус занятия?                        │
│                                                  │
│  Ivan P · 23 июн., 16:03                         │
│  Было:  Проведено                                │
│  Станет:  Не пришёл                              │
│                                                  │
│  ⚠ Если занятие уже оплачено через пакет —      │
│  пакет восстановится. Долг ученика обновится.   │
│                                                  │
│         [Отмена]    [Изменить статус]            │
└─────────────────────────────────────────────────┘
```

## Implementation breakdown

### Sub-PR 1 — Backend: chain mutations

**New endpoint:** `POST /api/teacher/slots/:slotId/change-status`

**Body:**
```json
{
  "to": "completed" | "no_show_learner" | "no_show_teacher" | "booked",
  "reason"?: string  // optional explanation
}
```

**Backend logic** (`lib/scheduling/slots/change-status.ts`):
1. Read current slot status (with advisory lock).
2. Reject if `cancelled` (immutable from history).
3. Compute mutation chain:
   - `completed` → `booked`: uncomplete only.
   - `completed` → `no_show_learner`: uncomplete + mark-no-show.
   - `no_show_*` → `completed`: unmark-no-show + mark-completed.
   - etc.
4. Apply atomically (advisory lock + transaction).
5. Dispatch notification event `LessonStatusChangedByTeacher` (new event).
6. Insert audit log `audit_lesson_status_change` (new table).

**New migration:** `migrations/0141_lesson_status_change_audit.sql` — track all status changes for compliance.

**Backend tests:**
- `tests/payments/lesson-status-change.test.ts` — unit.
- `tests/integration/lesson-status-change-integration.test.ts` — full chain через Docker Postgres.

### Sub-PR 2 — UI: kebab menu + confirm dialog

**Files:**
- `components/teacher/lessons/lesson-history-client.tsx` — добавить kebab menu UI на marked rows.
- `components/teacher/lessons/StatusChangeMenu.tsx` (NEW) — popover/menu component.
- `components/teacher/lessons/StatusChangeConfirmModal.tsx` (NEW) — confirm dialog.

**Existing primitives reuse:**
- `<Button variant="ghost">` for kebab.
- `<Banner>` for warning text.
- Modal pattern from `feed.tsx` (decline / refund modals).

### Sub-PR 3 — E2E + evals

- Add `tests/e2e/teacher-lessons-status-change.spec.ts` — covers kebab → menu → confirm → success.
- Add `FLOW-TEACHER-LESSONS-STATUS-CHANGE-001` row в `evals/PRODUCT_FLOWS.md` section D.

## Edge cases

| Case | Handling |
|---|---|
| Slot was paid через package (consumption) | Mutation also restores package count + adjusts learner debt. Notify learner. |
| Slot was paid через `payment_claim` (confirmed) | Refund flow remains untouched (separate state); status change adjusts only `slot.status`, не claim. Show warning in confirm dialog. |
| Two teachers race (shouldn't happen — single-teacher slots) | Advisory lock per learner OR per slot (`change-status:<slotId>`) protects. |
| Concurrent user edits same slot through different surface | Last-write-wins per ETag / `updated_at` token returned in API. UI shows toast if 409. |
| Original mutation triggered email/TG event | New `LessonStatusChangedByTeacher` event sends a correction email to learner («Учитель изменил статус занятия 23 июн. с «Не пришёл» на «Проведено»»). |
| Audit trail | `audit_lesson_status_change` table: slot_id, teacher_id, from_status, to_status, reason, ts. Visible only to admin. |

## Risks

- **R-1**: Chain mutations (uncomplete + remark) могут leave slot в inconsistent state if mid-failure. **Mitigation**: atomic transaction.
- **R-2**: Notification spam if учитель меняет status touchpoint. **Mitigation**: rate-limit notifications per slot+teacher per day.
- **R-3**: Status change может изменить billing (debt / package count). UI должен это явно показать в confirm dialog.
- **R-4**: Owner asked unlimited time window — но для slots старше 6 months може быть unintended. Consider soft warning «Это занятие давно прошло (более 6 месяцев). Точно?» для extra-stale slots.

## Out of scope

- Bulk status changes (UI for multiple slots) — отдельный future epic.
- Mobile UX optimization (kebab menu может быть UX-heavy on touch) — verify в impl, fallback к full-screen sheet если sjuoy.
- `cancelled` → anything edits — separate state machine.

## Verification

### Tests
- `npm run test:run` — unit + integration green.
- `npm run test:integration` — Docker Postgres + new lesson-status-change-integration.test.ts.
- `npm run test:e2e:product-flows` — teacher-lessons-status-change.spec.ts.

### Manual
- Login as teacher → /teacher/lessons → find marked row → kebab → menu → confirm → status updated.
- Verify learner получает notification.
- Verify package count restored (если applicable).

## Open questions

- **Q-1**: Email/TG notification to learner — обязательная или optional? Default: optional toggle for teacher («Уведомить ученика?») in confirm dialog.
- **Q-2**: Show reason text input в confirm dialog? Default: optional textarea (chat-friendly, not enforced).
- **Q-3**: Admin reverting teacher's change — отдельный flow или same endpoint? Default: same, но audit log shows actor.
- **Q-4**: Mobile UX — kebab menu vs bottom sheet? Default: same menu, попробуем kebab, если плохо UX — переключим на sheet.
- **Q-5**: Time-based extra-stale warning (R-4)? Default: no — owner explicitly said unlimited.

## Sign-off

- **Plan checkpoint:** pending `/codex-paranoia plan`.
- **Implementation:** not started — awaiting plan SIGN-OFF + owner Q-1..Q-5 answers.

## Trailer plan

- Sub-PR 1 (backend): `Codex-Paranoia: SUB-WAVE self-reviewed (epic teacher-lessons-edit-status-2026-06-24); epic-end review pending`
- Sub-PR 2 (UI): same.
- Sub-PR 3 (E2E + evals): same.
- Epic-close PR: `Codex-Paranoia: SIGN-OFF round N/3 (epic-end on <range>)`
