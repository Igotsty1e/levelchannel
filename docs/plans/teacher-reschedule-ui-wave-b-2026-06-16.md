# Wave-B: Teacher reschedule UI для booked-занятий (impl-ready)

Status: SHIPPED 2026-06-16 · Owner: claude
Parent epic: `docs/plans/teacher-master-flow-2026-06-15.md` (Wave 4 / эпик D)
Source: `docs/audit/2026-06-15-reschedule-cancel-markpaid-audit.md` — UX-BLOCKER B-06 + notification BLOCKER B-04

Shipped PRs (range `2585030..18d998a`):
- PR #654 (2585030) — Sub-PR 1 backend: `rescheduleSlotByTeacher` mutation + POST endpoint + `LessonRescheduledByTeacher` dispatch event
- PR #655 (18d998a) — Sub-PR 2 frontend: «Перенести» кнопка в TeacherSlotDetailModal + новая `RescheduleByTeacherModal` компонент

Codex-Paranoia: self-review fallback SIGN-OFF round 1/3 (Codex CLI binary unavailable). 4 WARN documented inline; 0 BLOCKER at wave-time.

---

## Context

Аудит выявил: `TeacherSlotDetailModal` для booked-full занятия показывает только «Закрыть» + «Отменить занятие». Учитель **не может перенести** занятие — только отменить и попросить ученика перезаписаться. Асимметрия с ученическим UX (там «Перенести» есть).

Wave-B закрывает:
- **UX-BLOCKER B-06**: добавляет кнопку «Перенести» в TeacherSlotDetailModal + новую модалку
- **BLOCKER B-04 (notifications)**: после успешного reschedule учителя — ученик получает email + TG через Wave-A dispatch helper

Wave-A foundation готов, нужно только новое событие `LessonRescheduledByTeacher` + integration.

## Scope

### Backend
1. **Новая mutation `rescheduleSlotByTeacher`** в `lib/scheduling/slots/mutations-reschedule.ts` — симметрична `rescheduleSlotByLearner` (`:54`), но:
   - actor=`teacher`, gate = teacher owns slot (не learner)
   - **БЕЗ** cancel-window gate (учитель может перенести в любое время; если поздно, ученик уже на пути — но это всё равно лучше чем «отменить» что мы имеем сейчас)
   - Reason обязателен (booked = ученик ждёт пояснения)
   - Атомарный cancel + insert новый slot + package re-consume (тот же advisory lock per learner)
   - Возвращает `oldSlot` + `newSlot`
2. **Route** `app/api/teacher/slots/[id]/reschedule/route.ts` — POST `{ newStartAt: string, reason: string }`. Auth: `requireTeacherWithCurrentSaasOfferConsent`. Rate-limit: 30/мин per IP (как `/cancel`).
3. **Новое событие** `LessonRescheduledByTeacher` в `lib/notifications/lesson-event-dispatch.ts`:
   - Recipient: learner
   - Payload: actor (teacher name), oldSlotStartAtIso, newSlotStartAtIso, durationMinutes, reasonText, cabinetUrl
   - Email + TG templates (HTML/MarkdownV2 escape для reason)
   - Dispatch вызывается ПОСЛЕ commit
4. **Integration test** для end-to-end: register teacher+learner, book, teacher POST reschedule → DB old=cancelled, new=booked, `notification_log` row.

### Frontend
1. **TeacherSlotDetailModal** в `app/teacher/calendar/client.tsx`:
   - Кнопка «Перенести» для `slot.kind === 'booked-full'` (рядом с «Отменить занятие»)
   - Клик → переход в новую модалку `kind: 'teacher-reschedule'` в существующей `CalendarModalState` discriminated union
2. **Новый компонент** `components/calendar/RescheduleByTeacherModal.tsx`:
   - Header: «Перенести занятие <ученик> с <старая дата>»
   - DatePicker + TimePicker (минимум сегодня)
   - Textarea «Что сказать ученику» (обязательно, min 5 символов)
   - Submit → POST `/api/teacher/slots/[id]/reschedule`
   - Error handling: `external_conflict` / `slot_collision` / `start_out_of_band` / `in_past`
   - ESC + backdrop close guarded by `busy`
   - На success → `onCreated(newSlot)` + toast + reload calendar
3. **Re-use existing primitives**: `DatePicker`, `TimePicker`, `Button`, `Banner`. Pattern from `RescheduleByLearnerModal` в `app/cabinet/lessons-section.tsx`.

## Self-review WARN checklist (для Sub-PR 1 BEFORE merge)

- [ ] Race-safety: используется `pg_advisory_xact_lock('pkg_consume:'||learnerId)` — same key as bookSlot/assignSlotDirect/learner-reschedule. ✓ pattern reuse.
- [ ] Privacy guard: recipient=learner, role check через `resolveRecipient` (Wave-A). ✓ already in place.
- [ ] dedup_key iter_seq = newSlot.events.length. ✓ same pattern as learner-reschedule.
- [ ] **WARN**: teacher reschedule НЕ имеет cancel-window. Это design decision — учитель должен иметь полномочия. Документировать, не блокер.
- [ ] **WARN**: если slot имеет confirmed payment_claim — что с деньгами при reschedule? Old slot становится cancelled, new slot booked. Payment_claim прикреплён к slot_id → старый slot_id stays cancelled, new slot нужен отдельный claim. Это **acceptable**: reschedule НЕ переносит payment automatically — учитель должен решить (refund + new mark-paid, или just keep as overlapping). Документировать as known limitation.
- [ ] **WARN**: external_conflict с Google Calendar busy intervals — reuse существующего check из learner reschedule. ✓.
- [ ] Reason text: обязательный, проходит через `MAX_REASON_LEN` (500 chars) + HTML/TG escape в template.

## Architecture decision: extend learner-reschedule vs new function

**Decision: новая функция `rescheduleSlotByTeacher`.**

Reasons:
- Different ownership gate (`teacher_account_id` vs `learner_account_id`)
- Different cancel-window logic (none vs 24h)
- Different reason requirement (required vs optional)
- Different actor in events JSONB

Code duplication ~80 строк — acceptable за чистоту контракта. Helper `prepareRescheduledSlot()` для общих частей (busy check, package consume) можно выделить, но не сейчас — wait until 3-я версия (admin reschedule в будущем).

## Sub-PR разбивка

### Sub-PR 1 (~0.7d): backend
- `lib/scheduling/slots/mutations-reschedule.ts` — `rescheduleSlotByTeacher` function
- `app/api/teacher/slots/[id]/reschedule/route.ts` — POST route
- `lib/notifications/lesson-event-dispatch.ts` — add `LessonRescheduledByTeacher` kind
- `lib/notifications/templates.ts` — add render для email + TG
- Unit tests
- Integration test (Docker postgres) для end-to-end + notification_log

### Sub-PR 2 (~0.8d): UI
- `app/teacher/calendar/client.tsx`:
  - Расширить `CalendarModalState` kind `'teacher-reschedule'` с `{ row: CalendarRow }`
  - Кнопка «Перенести» в `TeacherSlotDetailModal` для booked-full
  - Mount `<RescheduleByTeacherModal />` в основном render
- `components/calendar/RescheduleByTeacherModal.tsx` — новый компонент
- Component test: open modal → fill → submit → success
- Playwright walkthrough (когда CI пройдёт): открыть booked → «Перенести» → выбрать время → submit → проверить календарь refresh

## Critical-path note

`lib/scheduling/slots/mutations-reschedule.ts` — НЕ в `docs/critical-path.md` (item 15 — только `mutations-cancel.ts`). Но reschedule имеет дyadic effect (cancel + insert), и Wave-A integration test уже доказал безопасность learner-reschedule. Trailer: `Codex-Paranoia: SUB-WAVE self-reviewed (epic teacher-reschedule-wave-b); epic-end review pending` — стандартная.

## Verification (epic-end)

- `npm run test:run` — все + новые тесты
- `npm run test:integration -- reschedule` — Docker postgres
- `npm run build`
- `npm run check:env-contract` + `content-style` + `migration-prefixes`
- Browser walkthrough: открыть `/teacher/calendar` (когда CI пройдёт) → клик booked-full → «Перенести» → выбрать новое время → submit → проверить календарь + notification_log row + sentry release

## Out of scope

- Bulk reschedule (несколько занятий разом) — отдельный эпик
- Reschedule запросы от ученика к учителю (proposal/accept flow) — отдельно
- Drag-and-drop reschedule в календарной сетке — это **B-04 partial** уже работает для open slots; для booked slots — отдельный эпик (рискованно UX)
- Payment claim transfer между old и new slot — manual operator action для сложных кейсов
