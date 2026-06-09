---
title: create-slot UX redesign — «От/До» time-range buttons + single/bulk consistency
status: PLAN
date: 2026-06-10
owner: ivankhanaev
author: Claude
skill-used: claude-code-frontend-design (form-designer + motion-designer + design-system-architect)
---

# create-slot UX redesign — «От/До» pattern + single/bulk consistency

## 0. TL;DR

1. **Bulk modal**: каждая строка времени становится парой «От HH:mm» / «До HH:mm» — визуально читается «размер» окна слота. Per-row duration (вместо одного глобального).
2. **Single sheet**: тот же «От/До»-паттерн, общий с bulk. Получается одна и та же UI-механика и для одиночного, и для нескольких слотов.
3. **Сегмент-свитчер** «Один слот / Несколько слотов» поднят в общий контейнер `CreateSlotSheet` — переключение делает плавный кросс-фейд тела формы (220 ms ease-out + 8 px translate, с `prefers-reduced-motion` fallback).
4. **Один PR** — последовательная имплементация: подготовка примитивов → bulk → single → объединение → animation.

---

## 1. Что не так сегодня (после PR #574 + #576)

### 1.1 Bulk-модал

- Time-entry — это `<input type="time" step="1800">` плюс кнопка «+ Ещё время». Пользователь видит **только точку начала**, размер слота вычисляется неявно из тарифа (60 мин hard-coded в `BulkAddSlotsModal:74`).
- Когда учитель ставит «18:00» — он не видит, что слот будет до 19:00. Размер окна неясен.
- Невозможно создать в одной серии слоты разной длительности (например, «вт 18:00–19:00» + «чт 19:00–20:30»).

### 1.2 Single-модал

- Использует свой собственный layout: отдельные label'ы `<FieldLabel>`, отдельный `<input type="time">`, отдельная ChipGroup для длительности.
- Bulk использует свой layout: `<select>` для тарифа, hardcoded 24×24 day-of-week кнопки, кастомные `addTimeBtnStyle`/`removeBtnStyle`.
- Стили дублируются, паттерны рассогласованы. После PR #576 сегмент-свитчер вверху каждого, но дальше формы выглядят как «два разных продукта».

### 1.3 Анимация переключения

- Кликнули «Несколько слотов» → один модал закрывается через `setOpen(false)`, второй открывается через `bulkOpen=true`. Это **жёсткий cut** — нет ощущения, что это «один и тот же экран в другом режиме». UX-разрыв.

---

## 2. Целевая UX-картина

### 2.1 Time-range entry («От/До»)

```
┌────────────────────────────────────────────────┐
│  ⏱  От  18:00  →  До  19:00      60 мин    ✕  │
└────────────────────────────────────────────────┘
┌────────────────────────────────────────────────┐
│  ⏱  От  19:30  →  До  20:30      60 мин    ✕  │
└────────────────────────────────────────────────┘
              + Ещё интервал
```

- Слева — fixed-width «От HH:mm» chip (44×44 hit, чтобы тапалось пальцем).
- Стрелка `→` через `aria-hidden`.
- «До HH:mm» chip — такой же.
- Справа от пары — durations-pill: `60 мин`, текстовый, всегда читается.
- Крестик ✕ — удаление row'а (минимум 1 row остаётся).

Каждая chip при клике открывает **bottom-sheet picker** — список времени с шагом 30 мин (06:00 → 22:00, по бизнес-правилам), скролл на длину «текущее время ± 6 ч». Подтверждение — тап (no extra confirm step). При выборе «От» — если новое начало позже текущего «До», то «До» автоматически передвигается на (start + предыдущая длительность). Если новое «До» раньше «От» — показываем ошибку «Время «до» должно быть позже «от»».

Длительность производная: `to - from`. Допустимые: 30/45/60/75/90/120 (см. `ALLOWED_DURATIONS` в `lib/calendar/recurrence.ts`). При невалидной длительности — inline ошибка.

### 2.2 Single и Bulk на одном паттерне

- Single = частный случай Bulk с 1 row + 1 date (не date range) + 1 day-of-week (= день этой даты).
- Both modals = один `CreateSlotSheet` с `mode: 'single' | 'bulk'`:
  - Common header: `ChipGroup` свитчер (как сейчас в PR #576).
  - Body conditional:
    - **single** mode: Дата → 1 «От/До» row → Тариф.
    - **bulk** mode: Дата начала + Дата окончания → Дни недели → Список «От/До» rows → Тариф.
  - Common footer: Cancel + Submit/Preview-Submit pair.

«От/До»-row — общий компонент `TimeRangeRow` для обоих.

### 2.3 Анимация переключения режима

- На уровне `CreateSlotSheet`: body — обёртка с CSS-анимацией: при изменении `mode` старое тело анимирует `opacity:1→0 + translateY(0→-8px)` за 140 ms ease-in, потом новое тело — `opacity:0→1 + translateY(8px→0)` за 220 ms ease-out. **Не одновременно**: cross-fade с задержкой 80 ms.
- Высота листа меняется плавно: `transition: min-height 220ms ease-in-out`. CSS-only, без JS-измерений (используем `auto` height + `overflow:hidden` контейнер).
- `prefers-reduced-motion: reduce` → animation off, instant swap.

---

## 3. Архитектура

### 3.1 Новые компоненты

**`components/calendar/CreateSlotSheet.tsx`** — единый владелец `mode` state, headers + footer.
- Props: `{ mode, onModeChange, tariffs, onCreated, onClose, isOpen }`
- Внутри: `<header>` с `<h2>` + `<X>` close + segmented `ChipGroup`.
- `<body>` ssrolling container; conditionally renders `<SingleSlotForm>` или `<BulkSlotsForm>` через `<AnimatedBodySwap>`.
- `<footer>` actions — `<SingleSlotForm>` / `<BulkSlotsForm>` экспортируют `submitButton` через render-prop или children pattern (см. §3.4).

**`components/calendar/TimeRangeRow.tsx`** — re-used. Props: `{ from: HHmm, to: HHmm, onChange, onRemove?, allowRemove, durationLabel?, error? }`.
- `<TimePicker>` для каждого из «От» и «До».
- Inline pill «60 мин» вычисляется.
- Кнопка-крестик при `allowRemove`.

**`components/calendar/TimePickerButton.tsx`** — chip-style button. Props: `{ label: 'От' | 'До', value: HHmm, onSelect: (next: HHmm) => void }`.
- При клике открывает bottom-sheet с `<TimePickerSheet>`.
- На desktop fallback: при клике рендерит inline нативный `<input type="time" step="1800" autoFocus>` если viewport ≥ 600 px, иначе sheet.

**`components/calendar/TimePickerSheet.tsx`** — мобильный picker.
- Список 30-min шагов (06:00 → 22:00 = 33 опции, scroll).
- Текущий value — highlight + auto-scroll to.
- Tap — выбирает и закрывает.

**`components/calendar/SingleSlotForm.tsx`** — Дата input + 1 `TimeRangeRow` + Тариф.

**`components/calendar/BulkSlotsForm.tsx`** — Дата начала/Дата окончания + Дни недели + список `TimeRangeRow` + Тариф + Preview/Create.

**`components/calendar/AnimatedBodySwap.tsx`** — обёртка для cross-fade. Использует CSS keyframes; на `prefers-reduced-motion` — `display:contents`.

### 3.2 Что удаляем / переименовываем

- `components/calendar/MobileCreateFab.tsx` — оставляем только **FAB-кнопку** (точка входа). Внутреннюю sheet-разметку выносим в `CreateSlotSheet`. По сути renames: `MobileCreateFab` → `CreateSlotFab`.
- `components/calendar/BulkAddSlotsModal.tsx` — удаляем полностью; функциональность переходит в `CreateSlotSheet` + `BulkSlotsForm`.

### 3.3 API contract change

**Текущий** `/api/teacher/slots/preview-bulk`:
```ts
{ startDate, endDate, daysOfWeek, times: string[], durationMinutes: number }
```

**Новый** (backwards-compatible):
```ts
{
  startDate, endDate, daysOfWeek,
  intervals: Array<{ from: HHmm, to: HHmm }>,  // NEW
  // legacy support: если есть times + durationMinutes, превращаем в intervals
  times?: string[],
  durationMinutes?: number,
}
```

Серверная нормализация в `app/api/teacher/slots/preview-bulk/route.ts`:
- Если приходит `intervals` — используем.
- Иначе `times.map(t => ({ from: t, to: addMinutes(t, durationMinutes) }))`.
- Передаём в `expandRecurrence` в новом формате (см. §3.5).

То же самое для `/api/teacher/slots/bulk-create`.

### 3.4 Form submission pattern

`SingleSlotForm` и `BulkSlotsForm` экспортируют:
- `state` (form state)
- `submit()` (async, performs the POST)
- `canSubmit` (bool)
- `busy` (bool)
- `error` (string | null)

Через `useImperativeHandle` либо через children-pattern: `<CreateSlotSheet>` рендерит footer с `<Button onClick={formRef.current.submit()}>`.

Альтернатива (проще): footer'ы у каждой формы свои. `<CreateSlotSheet>` рендерит чистый body, а формы инкапсулируют свой submit-row.

**Решение**: каждая форма владеет своим submit-row (избегаем `useImperativeHandle`). Sheet-обёртка только: chrome (header + close + segmented) + animated body container. Это проще и легче анимировать.

### 3.5 `lib/calendar/recurrence.ts` change

```ts
// Was:
expandRecurrence({ startDate, endDate, daysOfWeek, times, durationMinutes })

// New:
expandRecurrence({ startDate, endDate, daysOfWeek, intervals })
// intervals: Array<{ from: HHmm, to: HHmm }>
// durationMinutes derived per-interval as (to - from)
```

Внутри логика та же — pre-filter business-hours, 30-min alignment, etc — просто на каждом интервале своя duration.

`expandRecurrence` тестируется в `tests/calendar/recurrence.test.ts` (11 тестов сейчас). Нужны новые тесты для multi-duration intervals (5-6 шт.).

---

## 4. Имплементация (последовательно, один PR)

### Phase 1 — primitives + lib

1. `lib/calendar/recurrence.ts`: добавить новый формат `intervals`, поддержать legacy `times + durationMinutes`. Тесты.
2. `components/calendar/TimeRangeRow.tsx` + `TimePickerButton.tsx` + `TimePickerSheet.tsx` — изолированно, без интеграции.
3. Unit-тест `TimeRangeRow` (validation: end > start, 30-min align, 30-120 min range).

### Phase 2 — Bulk-форма на новых примитивах

1. `components/calendar/BulkSlotsForm.tsx` — отдельный файл (потом будет mounted внутри `CreateSlotSheet`).
2. Передаём `intervals` в `/api/teacher/slots/preview-bulk` (через расширенный API, legacy `times` остаётся).
3. Backend route обновляется поддерживать `intervals`.

### Phase 3 — Single-форма

1. `components/calendar/SingleSlotForm.tsx` — Дата + 1 `TimeRangeRow` + Тариф.
2. POST в `/api/teacher/slots/bulk-create` через тот же контракт `intervals: [{ from, to }]`.

### Phase 4 — Sheet-обёртка

1. `components/calendar/CreateSlotSheet.tsx` — chrome + segmented + animated body container.
2. `components/calendar/CreateSlotFab.tsx` — FAB кнопка, теперь только точка входа.
3. `app/teacher/calendar/client.tsx`: использует `<CreateSlotSheet>` + `<CreateSlotFab>`, выкидывает старые `MobileCreateFab` + `BulkAddSlotsModal`.

### Phase 5 — Animation polish

1. `components/calendar/AnimatedBodySwap.tsx`: CSS keyframe-based cross-fade.
2. `app/globals.css`: `@media (prefers-reduced-motion: reduce)` overrides.
3. Manual smoke на iPhone-viewport (390×844) + desktop (1280×800).

### Phase 6 — Cleanup

1. Delete `BulkAddSlotsModal.tsx`, `MobileCreateFab.tsx`.
2. Удалить unused styles.
3. Update plan-doc: status → SHIPPED.

---

## 5. Открытые вопросы / принятые defaults

1. **Picker design**: bottom-sheet с прокручиваемым списком 30-min шагов VS компактный wheel-picker. **Default**: список — он понятнее на 390 px, не требует gesture-learning.
2. **Business hours**: 06:00 → 22:00 как в `lib/calendar/recurrence.ts:38`. Если выбран час вне диапазона — sheet просто не показывает эти опции (не блокируем «потом-добавим» — нет UX-смысла).
3. **30-min alignment**: жёстко. Picker показывает только :00 и :30. Не даём ввести :15 или :45.
4. **Duration limits**: 30/45/60/75/90/120 минут. Если range не попадает (например, 45 мин) — допустимо. Если 50 — не допустимо. Inline ошибка.
5. **Default «от» и «до»**: 18:00 → 19:00 (как было `'18:00'` + 60 мин default).
6. **Tariff dropdown**: остаётся как сейчас, но больше не влияет на duration. Уточняющая копия: «Тариф определяет стоимость занятия. Длительность теперь — это «от/до».»
7. **«+ Ещё интервал» позиция**: под последним row, full-width dashed-border button (как сейчас «+ Ещё время»).

---

## 6. Что не делаем в этом PR (out-of-scope)

- Recurring presets («каждый чётный понедельник», «каждые 2 недели»).
- Drag-resize слотов на календаре desktop — это другая поверхность.
- Импорт расписания из Google Calendar — другая wave.
- Тарифы с автоматической длительностью — больше не нужны после этого редизайна.

---

## 7. Self-review (round 1)

### 7.1 Что могу проебать

- **Picker `TimePickerSheet` на desktop**: если рендерим bottom-sheet на 1440 px viewport — нелепо. Нужно condition: viewport ≥ 600 → inline `<input type="time">` или popover. Решение: ветвление в `TimePickerButton` через `useEffect + window.matchMedia('(min-width: 600px)')` + SSR guard.
- **Layout shift при cross-fade**: новое тело может иметь другую высоту, sheet прыгает. Решено `transition: min-height` — но это не animatable свойство в общем случае. Лучше: фиксированная min-height = max(single, bulk) либо CSS `grid-template-rows: 0fr → 1fr` трюк (animatable).
- **Bulk-form bulk_pref_key localStorage**: сейчас `lc_calendar_create_bulk_mode` сохраняется. При cleanup mode → 'closed' нельзя стирать ключ — он используется как «следующий тап на FAB → пойдёт в этот режим». Сохраняется как было.
- **`expandRecurrence` legacy bridge**: если кто-то вызывает старый API через старый клиент (cache на CDN?), сервер должен быть обратно совместим минимум 1 deploy-cycle. Серверный route аккумулирует `times + durationMinutes → intervals` (см. §3.3).
- **Per-row duration validation**: важно валидить на клиенте до preview-запроса. Если пользователь ввёл `от=18:00 до=18:50` — это 50 мин, не из ALLOWED_DURATIONS. Показать inline error «Длительность 50 мин не поддерживается. Используйте кратное 15 минутам.».
  - Но погоди: ALLOWED — 30/45/60/75/90/120. То есть 15-кратные кроме 15 и 105. **Уточнить**: либо в `recurrence.ts` ALLOWED_DURATIONS расширить, либо проще: round-up к ближайшему ALLOWED при `onBlur` «До»-picker'а. Решение: round-up к ближайшему ALLOWED ≥ value, при невозможности — ошибка.

### 7.2 Что улучшу в плане

- §3.3 API: формат `intervals` объявлен как `{ from: HHmm, to: HHmm }`. Но в API сейчас передаётся `times: ['18:00', '19:30']` + одно `durationMinutes`. Чтобы не сломать active clients, в течение этого PR:
  - Сервер принимает оба формата.
  - Клиент шлёт только новый.
- §5 question 4 — добавить **round-to-ALLOWED-duration на picker blur**.
- §3.1 `TimePickerButton`: ветвление desktop/mobile через `matchMedia` нужно явно прописать.
- §4 Phase 5 — добавить explicit step: проверить prefers-reduced-motion в Sentry/console на prod-deploy.

### 7.3 Что точно правильно

- Decomposition `CreateSlotSheet` + `CreateSlotFab` отдельно — это правильно. FAB — точка входа, Sheet — view.
- `BulkAddSlotsModal` → `BulkSlotsForm` (без overlay/header) + render внутри Sheet — снимает дублирование chrome.
- Поднять `mode` в Sheet — единственный способ дать плавную анимацию.
- Plan-doc + self-review **до** кода — подтверждается, что есть как минимум 4 точки где могу проебать (§7.1).

### 7.4 Round-2 self-review (после фиксов §7.2)

Перечитал. Главное добавление:

- В §3.1 `TimePickerButton`: на ≥600 px — inline `<input type="time" step="1800" autoFocus>` который автоматически фокусируется при клике на chip и open-ит нативный picker (на Mac/Win это standard browser UI). На <600 px — кастомная sheet. Реализация: один компонент с `useState(isPickerOpen)` и `useEffect(() => setIsDesktop(matchMedia('(min-width: 600px)').matches))`.

- В §5 question 4 (ALLOWED_DURATIONS): дополнить: «при `onBlur` "До"-picker'а — round-up до ближайшего ALLOWED ≥ value». Если value > 120 → set to 120. Если range < 30 → set to 30 (move «До» вперёд).

- В §3.4 Form submission pattern: чётко закрепить — **каждая форма владеет своим submit-row**, sheet рендерит только chrome.

- В §3.5 recurrence change: тесты — 5 новых:
  - mixed-duration intervals (60 + 90 мин в одной серии)
  - 45-min interval allowed
  - 75-min interval allowed
  - out-of-ALLOWED rejected (50, 100)
  - end ≤ start rejected

### 7.5 Decision after self-review

План одобряю. Приступаю к Phase 1.

---

## 8. Acceptance checklist (для PR review)

- [ ] Picker на mobile (390 px) — bottom-sheet со списком 06:00-22:00 шаг 30 мин
- [ ] Picker на desktop (≥600 px) — нативный browser time picker через `<input type="time" step="1800">`
- [ ] «От/До» pair показывает inline duration label «N мин»
- [ ] Per-row duration: можно создать «вт 18:00–19:00 + чт 18:00–19:30» в одной серии
- [ ] Single и Bulk используют одинаковую разметку для time-entry rows
- [ ] Свитчер «Один слот / Несколько слотов» плавно cross-fade'ит body (220 ms ease-out)
- [ ] `prefers-reduced-motion: reduce` отключает animation
- [ ] Layout shift при cross-fade < 8 px (через grid-rows 0fr→1fr или min-height fixed)
- [ ] API back-compat: route принимает legacy `times + durationMinutes`
- [ ] `expandRecurrence` tests passing (existing 11 + new 5)
- [ ] Build clean, TS clean
- [ ] Manual smoke на iPhone-viewport + desktop
- [ ] Old `BulkAddSlotsModal.tsx` deleted
- [ ] `lc_calendar_create_bulk_mode` localStorage preference works (next FAB tap → bulk if previously bulk)

---

## 9. Codex paranoia

Codex quota exhausted until 2026-06-11. Self-review applied per skill §7. Trailer: `Codex-Paranoia: SELF-REVIEW round 2/2 (Codex quota exhausted)`.

После возврата квоты — выполнить `/codex-paranoia wave` на commit-range этого PR.
