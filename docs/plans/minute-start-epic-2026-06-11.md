---
title: minute-start epic — drop 30-min grid в start_at + design-system date/time pickers
status: PLAN
date: 2026-06-11
scope: 4-sub-PR epic (DB+backend gate removal → DS pickers → Grid pixel-precise → bulk+reschedule)
owner: ivankhanaev
author: claude
context_clean: no live users — migrations clean drop, no backfill
---

# minute-start epic (2026-06-11)

## 0. TL;DR

Учитель и ученик могут указывать время с минутной точностью **везде** (не только длительность, как в Option 2). И параллельно — заменяем HTML5 native date/time input'ы на собственные design-system pickers.

## 1. Existing surface inventory

```
rg -l "SLOT_GRID_MINUTES|start_30min_aligned|input type=\"time\"|input type=\"date\"" app lib components migrations
```

**Backend (drop 30-min gates):**
- `migrations/0031_lesson_slots_domain_invariants.sql` — CHECK `lesson_slots_start_30min_aligned` (drop через new migration).
- `lib/scheduling/slots/types.ts:12` — `SLOT_GRID_MINUTES = 30` (keep, переименовать в `LEGACY_*` или дроп).
- `lib/scheduling/slots/validation.ts` — `start_not_30min_aligned` check (drop).
- `lib/scheduling/slots/mutations-assign-direct.ts:39` — same check (drop).
- `lib/scheduling/slots/mutations-reschedule.ts:73` — same check (drop).
- `lib/calendar/recurrence.ts` — start times currently HH:MM with implicit 30-min alignment (allow any HH:MM).

**Frontend (HTML5 → DS pickers):**
- `app/cabinet/lessons-section.tsx:678-700` — `<input type="date">` + `<input type="time" step={1800}>` в RescheduleLessonModal.
- `components/calendar/TimeRangeRow.tsx` — `<input type="time" step={60}>` для «До» (already minute-precise, нужен DS wrap).
- `components/calendar/MobileCreateFab.tsx` — `<input type="date">` для single slot.
- `components/calendar/BulkAddSlotsModal.tsx` — `<input type="date">` для start/end + TimePickerSheet для времени.
- `components/calendar/AssignDirectModal.tsx` — `<input type="date">` + TimePickerButton (30-min).
- `components/calendar/TimePickerButton.tsx` + `TimePickerSheet.tsx` — 30-min cell grid (full redesign на minute granularity).

**Grid (pixel-precise positioning):**
- `lib/calendar/view-model.ts` — pre-calc для slot block positions.
- `components/calendar/Grid.tsx` — SlotBlock rendering уже использует duration для height, но top offset считается via half-hour cell index → нужна minute-precise formula.
- `components/calendar/SlotBlock.tsx` — компонент slot.
- `lib/calendar/grid-hit-test.ts` — drag/click resolution (round to 5-min для UX).

## 2. Sub-PR декомпозиция

### Sub-PR A.1 — DB + backend gate removal

**Migration 0125** `drop_lesson_slots_start_30min_aligned.sql`:
```sql
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'lesson_slots_start_30min_aligned') then
    alter table lesson_slots drop constraint lesson_slots_start_30min_aligned;
  end if;
end $$;

-- Replace with a relaxed seconds=0 check (for sanity).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'lesson_slots_start_seconds_zero') then
    alter table lesson_slots
      add constraint lesson_slots_start_seconds_zero
        check (extract(second from (start_at at time zone 'Europe/Moscow')) = 0);
  end if;
end $$;
```

**App-level:**
- `lib/scheduling/slots/validation.ts` — drop 30-min check, keep MSK band + seconds=0.
- `assignSlotDirect` / `rescheduleSlotByLearner` — drop `SLOT_GRID_MINUTES` check.
- `lib/scheduling/slots/types.ts` — drop `start_not_30min_aligned` reason (replaced by sanity-only validations).
- `lib/calendar/recurrence.ts` — accept any HH:MM start.
- Tests: integration assert slot create at 10:13 works.

LOC: ~150.

### Sub-PR A.2 — Design-system date + time pickers

**New primitives:**
- `components/ui/primitives/date-picker.tsx` (NEW):
  - Trigger button с date label.
  - Bottom-sheet (mobile) / dropdown (desktop) с calendar grid (month view, navigable).
  - Date selection → callback.
  - Локалы: ru-RU. Selectable range = [today, today+365d].
- `components/ui/primitives/time-picker.tsx` (NEW):
  - Trigger button с time label.
  - Bottom-sheet (mobile) / dropdown (desktop) — два column scroll (HH 06-22, MM 00-59 step 1).
  - Optionally `granularity` prop: 1/5/15/30 минут (default 1).
- Re-export в `components/ui/primitives/index.ts`.

**Replace usages:**
- `AssignDirectModal`, `RescheduleLessonModal`, `MobileCreateFab`, `BulkAddSlotsModal`, `TimeRangeRow`.

**Delete legacy:**
- `TimePickerButton.tsx` + `TimePickerSheet.tsx` (заменены `TimePicker` primitive).

LOC: ~700.

### Sub-PR A.3 — Calendar Grid pixel-precise

- `lib/calendar/view-model.ts` — slot positioning formula:
  - `topOffset = ((slot.startMinutesFromGridStart) / 30) * cellHeight` (pixel-precise, не cell-index).
  - 47-min slot starting at 10:13 — top = (10*60+13 - 6*60)/30 * cellHeight.
- `components/calendar/Grid.tsx` — render SlotBlock с computed top/height.
- `lib/calendar/grid-hit-test.ts` — drag/click → round to 5-min steps для UX (avoid pixel-perfect requirement).
- `lib/calendar/paint-synth.ts` — accept minute-level cells (drop 30-min cellsPerSlot integer invariant).

LOC: ~400.

### Sub-PR A.4 — Bulk recurrence + AssignDirectModal minute-level (epic-close)

- `BulkAddSlotsModal` recurrence picker — accept minute-level start times array.
- `AssignDirectModal` — replace 30-min picker с DS time picker (granularity=1).
- `RescheduleLessonModal` — drop `step={1800}`, use DS picker.
- Integration test: assign-direct at 10:13 для tariff 47-min → slot booked.

LOC: ~250.

**Total epic A:** ~1500 LOC, 4 sub-PR.

## 3. Acceptance criteria

1. Учитель и ученик могут указывать время с шагом 1 минута во всех модалках (assign-direct, bulk, reschedule, mobile FAB single).
2. Date/time pickers выглядят consistent (DS): dark cabinet, accent, focused state, accessible (radio role).
3. Grid правильно рисует slot 10:13—10:47 — block положен между 10:00 и 11:00 ячейками pixel-precise.
4. Drag/click hit-test работает с 5-min resolution (`floor(minutes/5)*5`).
5. Bulk-recurrence accept «10:13» как start time.
6. Migration 0125 chuyển CHECK `start_30min_aligned` → `start_seconds_zero`.
7. Existing slots с MM ∈ {00, 30} продолжают работать (`seconds=0` invariant сохраняется).

## 4. Risks (self-review fallback)

- **MEDIUM: Grid CSS regressions.** Visual change. Mitigation: playwright walkthrough на 1440/375/360 viewport'ах + screenshot diff.
- **MEDIUM: Existing 30-min slots в БД** не должны сломаться. Mitigation: `seconds=0` check sufficient; `MM ∈ {00,30}` это subset of `MM ∈ [0,59]`.
- **LOW: Time-picker UX на mobile.** Bottom-sheet vs HTML5 native — DS лучше для design fit, но HTML5 имеет accessibility wins (screen reader, system input methods). Decision: DS picker + ARIA attrs.
- **LOW: HTML5 date input был intuitive.** DS calendar grid тоже intuitive если built правильно.

## 5. Tests

- `npm run test:run` green.
- `npm run build` green.
- `npm run check:content-style` green.
- Integration: assign-direct at minute-precise start time.
- Playwright walkthrough на 3 viewport.

## 6. Trailers

- `Skill-Used: codex-paranoia (plan SELF-REVIEW round 1/3 — codex quota exhausted), design-with-claude:form-designer, design-with-claude:interaction-designer`
- Sub-PR commits: `SUB-WAVE self-reviewed (epic minute-start)` + epic-close `SIGN-OFF round 1/3`.

## 7. Out of scope

- Эпик B (bulk-assign + package picker + drop prepaid_packages) — отдельный эпик после A.
