---
title: minute-duration — заменить chip-presets 30/45/60/90/120 на минутный input в тарифах, пакетах, слотах
status: PLAN
date: 2026-06-11
scope: 2-sub-PR epic (Pricing UI + Slot-create UI)
owner: ivankhanaev
author: claude
strategy: Option 2 (compromise) — duration minute-precision, start_at остаётся на 30-min grid
---

# minute-duration (2026-06-11)

## 0. TL;DR

Учитель может ставить точную длительность с шагом 1 минуту для:
- **тарифов** (`pricing_tariffs.duration_minutes`, диапазон 15-240, DB CHECK уже допускает);
- **пакетов** (`lesson_packages.duration_minutes`, 15-180, DB CHECK уже допускает);
- **слотов** (`lesson_slots.duration_minutes`, integer, без верхнего DB-ограничения — оставляем app-level 15-240).

**Что НЕ меняется (Option 2 compromise):**
- `lesson_slots_start_30min_aligned` DB CHECK — start_at остаётся выровнен по 30 мин. Учитель не назначает занятие в 10:13; это разумное UX-ограничение.
- Calendar Grid (30-min cell visual) — не trogaem. Slot block height вычисляется из duration_minutes precisely (60 мин → 2 cells, 47 мин → 47/30 ≈ 1.57 cells visually).
- Backend billing pipeline — agnostic к duration, ничего не меняем.

## 1. Existing surface

Patch existing (нет новых routes/handlers/lib файлов). Survey-before-plan skip.

### Pricing UI (Sub-PR A)
- `components/teacher/pricing/tariff-create-sheet.tsx` — `DURATION_CHIPS=[30,45,60,90,120]` + ChipGroup.
- `components/teacher/pricing/tariff-card.tsx` — edit form, аналогично.
- `components/teacher/pricing/package-create-sheet.tsx` — same.
- `components/teacher/pricing/package-card.tsx` — same.

### Calendar slot-create UI (Sub-PR B)
- `components/calendar/TimeRangeRow.tsx` — `ALLOWED_DURATIONS_MIN=[30,45,50,60,75,90,120]` + `snapToAllowedDuration()`. Drop snap → duration = (to_min - from_min); если < 0 wrap +24h как сейчас.
- `components/calendar/BulkAddSlotsModal.tsx` — наследует TimeRangeRow.
- `components/calendar/PaintConfirmModal.tsx` — drag-paint endcap → duration min input.
- `components/calendar/MobileCreateFab.tsx` — наследует TimeRangeRow.
- `components/calendar/AssignDirectModal.tsx` — duration read-only из тарифа; не trogаем (уже minute-aware: `selectedTariff?.durationMinutes ?? 60`).
- `components/calendar/TimePickerButton.tsx` + `TimePickerSheet.tsx` — это про START time (30-min) → НЕ trogaем для «От» (start). Для «До» (end) — нужно minute-level. Решение: HTML5 `<input type="time" step="60">` для «До».

## 2. Что меняем

### 2.1 Sub-PR A — Pricing UI (тарифы + пакеты)

Шаблон изменения (одинаковый паттерн в 4 файлах):

**Было:**
```tsx
const DURATION_CHIPS = [
  { value: '30', label: '30 мин' },
  { value: '45', label: '45 мин' },
  { value: '60', label: '60 мин' },
  { value: '90', label: '90 мин' },
  { value: '120', label: '120 мин' },
] as const
// ...
<ChipGroup name="duration" value={duration} options={DURATION_CHIPS} onChange={...} />
```

**Стало:**
```tsx
<input
  type="number"
  inputMode="numeric"
  min={15}
  max={240}  // 180 для package
  step={1}
  value={duration}
  onChange={...}
  aria-label="Длительность, минут"
  className="pricing-input pricing-input-minutes"
/>
<span className="pricing-field-hint">от 15 до 240 минут (от 15 до 180 для пакетов)</span>
```

CSS reuse — `.pricing-input` уже существует.

Валидация:
- Client-side: clamp(15, 240) для тарифов, clamp(15, 180) для пакетов.
- Server-side: existing CHECK constraint защищает (raise integrity_error → friendly message).
- Inline error если `< 15` или `> 240` (180).

### 2.2 Sub-PR B — Slot UI

#### TimeRangeRow:
**Было:**
```ts
const ALLOWED_DURATIONS_MIN = [30, 45, 50, 60, 75, 90, 120]
function snapToAllowedDuration(minutes) { ... }
// "От" + "До" TimePickerButtons; на смену "До" вызывается snapToAllowedDuration
```
**Стало:**
- Drop `ALLOWED_DURATIONS_MIN` + `snapToAllowedDuration`.
- «От» остаётся `TimePickerButton` (30-min steps).
- «До» меняется на HTML5 `<input type="time" step="60">` — minute-level.
- `onDurationChange(toMin - fromMin)`; если < 0 wrap +24h как сейчас.
- Display label справа: `{duration} мин` (tabular-nums).

#### PaintConfirmModal:
- На confirm после drag-paint user может корректировать duration в minute input.

#### BulkAddSlotsModal + MobileCreateFab:
- Наследуют TimeRangeRow обновлённую → работает автоматически.

#### TimePickerSheet:
- Не trogaem (всё ещё 30-min для start времени).

### 2.3 Grid отображение

Grid НЕ меняется. Cell = 30 мин. Slot block высота:
- 60 мин → 2 cells (как сейчас).
- 47 мин → высота = (47 / 30) * cellHeight (pixel-precise).
- 50 мин → 50/30 * cellHeight.

Существующий код (`view-model.ts`) уже вычисляет block высоту из `duration_minutes` напрямую, без snap'a. Verify в impl.

## 3. Sub-PR декомпозиция

### Sub-PR A — Pricing UI (small)
- `components/teacher/pricing/tariff-create-sheet.tsx` (modify)
- `components/teacher/pricing/tariff-card.tsx` (modify edit form)
- `components/teacher/pricing/package-create-sheet.tsx` (modify)
- `components/teacher/pricing/package-card.tsx` (modify edit form)
- `app/globals.css` — add `.pricing-input-minutes` if needed (или reuse existing).

LOC: ~150-200.

### Sub-PR B — Slot UI
- `components/calendar/TimeRangeRow.tsx` (modify — drop snap)
- `components/calendar/PaintConfirmModal.tsx` (modify — duration input)
- Grid verify (no change expected but read-through).
- New integration test: minutes-tariff bookable end-to-end (`tariff=47min` → `assign-direct` → `lesson_slots` row OK).

LOC: ~150-200.

Итого epic: ~300-400 LOC, 8 файлов, 2 sub-PR.

## 4. Acceptance criteria

1. **Тарифы:** учитель может ввести 47 / 50 / 75 / 100 минут в форме создания/редактирования. ChipGroup ушёл. Сохраняется, отображается, используется при booking.
2. **Пакеты:** аналогично, диапазон 15-180.
3. **Слоты:** при drag-paint duration = (to - from) с минутной точностью. На manual create — minute input.
4. **Existing 30/45/60/90/120 tariffs** продолжают работать без миграции.
5. **Calendar grid** отображает slot block правильно для любой duration_minutes.
6. **Backend tests** покрывают создание/использование тарифа с непривычной длительностью (47 мин).
7. **Validation:** out-of-range duration отвергается с понятной ошибкой.

## 5. Risks (self-review fallback, codex quota exhausted)

- **MEDIUM: Grid block отображение для нестандартной duration.** В существующем коде `view-model.ts` — block height = `duration_minutes / 30 * CELL_HEIGHT` (или подобный pixel-precise calc). Если хардкод 30/60/90 — проблема. **Mitigation:** read `view-model.ts` before impl + проверить через playwright (создать 47-min slot, скрин).
- **MEDIUM: TimePicker для «До» меняется на native input** — иногда HTML5 time input выглядит inconsistent на разных платформах. **Mitigation:** style `<input type="time">` consistently через CSS; на iOS spinner нативный = OK; на Android выглядит OK.
- **LOW: Existing tariffs (`amount_kopecks` immutable after first slot reference)** — `pricing_tariffs.duration_minutes` тоже immutable per migration 0046. Edit form в `tariff-card.tsx` должен это уважать (button disabled если есть slots).
- **LOW: snapToAllowedDuration был защитой от bad input** — после drop пользователь может ввести 0 / 1000. Mitigation: clamp client-side + server-side CHECK.
- **INFO: existing test fixtures используют 60/90/120 mins** — не сломаются (duration минутная всё ещё подмножество).

## 6. Tests

- `npm run test:run` — green.
- `npm run build` — green.
- `npm run check:env-contract` + `check:content-style` — green.
- `npm run test:integration` — добавить тест с 47-min tariff + assign-direct.
- Playwright walkthrough:
  - desktop 1440×900 — создать тариф 47 мин, использовать в assign-direct, проверить отображение.
  - mobile 375×812 — same.
  - Calendar grid screenshot для 47-min slot.

## 7. Trailers

- `Skill-Used: codex-paranoia (plan SELF-REVIEW round 1/3 — codex quota exhausted), design-with-claude:form-designer`
- Sub-PR A commit: `Codex-Paranoia: SUB-WAVE self-reviewed (epic minute-duration); epic-end review pending`
- Sub-PR B commit (epic-close): `Codex-Paranoia: SELF-REVIEW SIGN-OFF round 1/3 (epic-end on <range>; codex quota exhausted; replay pending)`

## 8. Out of scope

- Минутная точность для `start_at` (это Option 1; user явно выбрал Option 2).
- Grid редизайн (cell-size changes).
- Backend DB constraint changes (всё уже допускает минутную duration).
- Server-side server logic changes (booking, package consumption, etc. duration-agnostic).
