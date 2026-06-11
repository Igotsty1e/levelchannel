---
title: teacher-no-slots-mode — глобальный переключатель «без слотов» + reschedule + digest
status: SHIPPED
date: 2026-06-11
shipped: 2026-06-11 (PR #601 mode 42744f2 + PR #604 reschedule 0dd000f + PR #605 digest 13de620)
scope: 3-sub-PR epic (mode foundation + reschedule + digest)
owner: ivankhanaev
author: claude
depends_on: teacher-direct-assign-2026-06-11 (SHIPPED)
context_clean: no live users — migrations без backfill
---

# teacher-no-slots-mode (2026-06-11)

## 0. TL;DR

Достраиваем над фундаментом 2.2 три компонента, делающих режим «без слотов» полноценным:

1. **Mode-switch.** В `accounts.calendar_slot_mode` хранится `'open_slots'` или `'direct_assign'`. Toggle в `/teacher/settings/calendar`. При `direct_assign` у учителя скрываются кнопки create-slots / bulk-create; остаётся только «+ Назначить ученику». У ученика на `/cabinet` скрывается pickup-блок; показывается информационный banner «Учитель сам назначает занятия».
2. **Reschedule by learner.** В карточке booked-slot ученика появляется кнопка «Перенести». Modal с time picker → POST `/api/learner/slots/[id]/reschedule`. Внутри TX: cancel original + create new booked-slot с теми же teacher/learner/tariff/duration. Те же 24h-rule что на cancel.
3. **Email digest.** Если учитель назначает >5 занятий за час одному ученику (текущий rate-limit), хвост перестаёт silently skip — slot помечается `notify_pending=true`. Cron `learner-direct-assign-digest.mjs` каждый час групирует pending по learner и отсылает один digest-email вместо N писем.

## 1. Existing surface inventory

Survey (новые routes + mutations + cron):

```
rg -l "calendar_slot_mode|reschedule|notify_pending|direct-assign-digest" app lib scripts
```

Hits: 0 (вся фича новая).

Использую существующие primitives:
- `lib/auth/accounts.ts` — добавлю geter/setter.
- `lib/scheduling/slots/mutations-cancel.ts` — `cancelSlotForLearner()` для reschedule «cancel»-фазы.
- `lib/scheduling/slots/mutations-assign-direct.ts` — pattern зеркалю для reschedule «create»-фазы.
- `lib/email/dispatch.ts` — добавлю `sendLearnerDirectAssignDigestEmail`.
- `scripts/lib/email-hash.mjs` + audit pool — переиспользую инфраструктуру cron.

## 2. Sub-PR декомпозиция

### Sub-PR A — Mode foundation + teacher UI hide

**Migration 0123:**
```sql
alter table accounts
  add column calendar_slot_mode text not null default 'open_slots'
  check (calendar_slot_mode in ('open_slots', 'direct_assign'));
```

**Backend:**
- `lib/auth/accounts.ts`:
  - Add `calendar_slot_mode` to `Account` type.
  - `setCalendarSlotMode(accountId, mode)` helper.
- `app/api/teacher/settings/calendar/slot-mode/route.ts` (NEW): POST с body `{ mode: 'open_slots' | 'direct_assign' }`. Teacher session bind.

**Frontend:**
- `app/teacher/settings/calendar/page.tsx` — добавить toggle (radio group) под существующим Google Calendar блоком: «Как вы назначаете занятия» → «Ученики бронируют слоты» / «Я сам назначаю каждому».
- `app/teacher/calendar/page.tsx` — SSR fetch `slot_mode`, pass to client.
- `app/teacher/calendar/client.tsx` — если `slot_mode === 'direct_assign'`:
  - Hide desktop кнопка «+ Добавить слоты».
  - Hide chip-options «Один слот» + «Несколько» в FAB sheet — оставить только «Назначить ученику».
  - Default FAB action — open AssignDirectModal directly.

LOC: ~350.

### Sub-PR B — Learner cabinet hide + reschedule

**Backend:**
- `lib/scheduling/teacher-learners.ts` или новый file — `getTeacherCalendarSlotMode(teacherId)` simple SELECT.
- `lib/scheduling/slots/mutations-reschedule.ts` (NEW) — `rescheduleSlotByLearner(slotId, learnerAccountId, newStartAt)`:
  - advisory_lock(learner) — пер consumePackage shared
  - SELECT FOR UPDATE original slot (asserts learner ownership + status='booked' + cancel_window OK)
  - busy-cache check на newStartAt
  - UPDATE original → status='cancelled' (events += 'slot.reschedule_cancelled')
  - INSERT new slot (same teacher/learner/tariff/duration, status='booked', source='direct_assign', events += 'slot.reschedule_created')
  - try consumePackageUnit on new slot — если original имел consumption, restore + re-consume (атомарно в той же TX)
  - postpaid fallback если применимо
- `app/api/learner/slots/[id]/reschedule/route.ts` (NEW): POST body `{ newStartAt: ISO }`. Learner session bind.

**Frontend:**
- `app/cabinet/page.tsx` (SSR):
  - Fetch `getActiveTeacherForLearner()`.
  - Fetch `teacher.calendar_slot_mode`.
  - Если `direct_assign` → render `<DirectAssignBanner />` вместо pickup section.
- `app/cabinet/lessons-section.tsx`:
  - Для каждого booked-slot добавить кнопку «Перенести» (рядом с «Отменить»).
  - Mount `<RescheduleLessonModal />` при клике.
- `components/cabinet/reschedule-lesson-modal.tsx` (NEW) — modal с date+time picker. Submit POST → toast + reload.
- `components/cabinet/direct-assign-banner.tsx` (NEW) — info card «Учитель сам назначает занятия. Письмо придёт когда время выбрано.»

LOC: ~450.

### Sub-PR C — Email digest

**Migration 0124:**
```sql
alter table lesson_slots
  add column notify_pending boolean not null default false;
create index lesson_slots_notify_pending_idx
  on lesson_slots (learner_account_id, notify_pending)
  where notify_pending = true;
```

**Backend:**
- `app/api/teacher/slots/assign-direct/route.ts`:
  - При rate-limit hit — вместо silent skip:
    - `UPDATE lesson_slots SET notify_pending = true WHERE id = $slotId` (только что созданный slot).
    - Не email. Cron заберёт позже.

**Cron + email:**
- `lib/email/templates/learner-direct-assign-digest.ts` (NEW) — template со списком занятий (date+time для каждого).
- `lib/email/dispatch.ts` — `sendLearnerDirectAssignDigestEmail(to, learnerName, lessons[])`.
- `scripts/learner-direct-assign-digest.mjs` (NEW) — cron:
  - SELECT pending slots GROUP BY learner.
  - Per learner: build digest email, send via sendEmail.
  - UPDATE notify_pending=false (внутри TX чтобы не послать twice при retry).
- Schedule: `systemd timer` каждый час (operator wires post-merge).

LOC: ~300.

## 3. Acceptance criteria

1. Учитель в `/teacher/settings/calendar` видит toggle «Как вы назначаете занятия». При смене на «Я сам назначаю» — сохраняется + UI обновляется.
2. В режиме `direct_assign` на `/teacher/calendar`:
   - Нет кнопки «+ Добавить слоты» на desktop.
   - FAB на mobile открывает сразу AssignDirectModal (без chip-options).
3. У ученика, чей учитель в режиме `direct_assign`:
   - `/cabinet` не показывает «Выбрать слот».
   - Показывает info banner «Учитель назначит занятия сам».
4. Booked-slot карточка имеет кнопку «Перенести». Modal → POST → новое время в календаре + email.
5. Cancel-window политика та же что на reschedule (24h default).
6. Учитель массово назначает 10 занятий → first 5 → отдельные emails, остальные 5 → `notify_pending=true` → cron шлёт 1 digest.

## 4. Risks (self-review fallback, codex quota exhausted)

- **MEDIUM: Reschedule package consumption race.** Original slot имел package consumption. Cancel restores. Create-new consumes again. Если между restore и re-consume другой booking забирает unit — race. **Mitigation:** всё в одной TX + per-learner advisory_xact_lock (тот же ключ `pkg_consume:`).
- **MEDIUM: Cancel-window на reschedule.** Sub-PR B учитывает existing `LEARNER_CANCEL_WINDOW_HOURS`. Same gate, не bypass.
- **MEDIUM: Digest staleness.** Cron каждый час → ученик может ждать назначение до 60 минут. Acceptable trade-off для anti-spam. Если меньше — крутится чаще, OK для тех же 5-минут intervals.
- **LOW: Mode-mismatch UX.** Учитель меняет режим с `open_slots` на `direct_assign` когда уже есть open booked slots → они продолжают работать (booked = валидно в любом режиме). Только новые open slot creations блокируются UI.
- **LOW: Learner сам разлогинился между modal open и submit.** Existing session middleware handle.

## 5. Tests

Sub-PR A:
- Integration: POST slot-mode → DB column updated.
- Build green.

Sub-PR B:
- Integration: reschedule happy path (postpaid + package).
- Integration: reschedule blocked если cancel window expired.
- Integration: reschedule blocked если новое время — slot_collision.

Sub-PR C:
- Integration: assign 6 slots в час → 5 emails, 1 pending.
- Cron test: pending → digest sent → flag cleared.

## 6. Out of scope

- Bulk reschedule (множественный перенос). Single-slot only.
- Teacher reschedules learner slot (мог бы — но 2.2 уже даёт прямой assign на новое время = пересоздаёт).
- Conflict resolution mode-mismatch (имеющиеся открытые slots при переключении в direct_assign).
- Push notification вместо email digest.

## 7. Trailers

- `Skill-Used: codex-paranoia (plan SELF-REVIEW round 1/3 — codex quota exhausted)`
- Sub-PR A commit: `Codex-Paranoia: SUB-WAVE self-reviewed (epic teacher-no-slots-mode); epic-end review pending`
- Sub-PR B commit: same SUB-WAVE
- Sub-PR C commit (epic-close): `Codex-Paranoia: SELF-REVIEW SIGN-OFF round 1/3 (epic-end on teacher-no-slots-mode; codex quota exhausted; replay pending)`
