---
title: create-slot — От/До в bulk + single приводим к стилю bulk (v2, после revert PR #577)
status: PLAN
date: 2026-06-10
owner: ivankhanaev
author: Claude
skill-used: claude-code-frontend-design (design-system-architect + form-designer)
revert-note: PR #577 откатил через PR #578 — переделал ВЕСЬ bulk-модал, владелец просил только заменить time-input
---

# create-slot — От/До в bulk + single → стиль bulk

## 0. Жёсткие рамки (что НЕЛЬЗЯ ломать)

1. **Bulk-модал визуально остаётся таким же**, как на скриншоте владельца («Вот такой дизайн был у нас топ! Визуально»):
   - centered modal, тёмно-серый фон, `borderRadius: 12`, `maxWidth: 520`
   - header «Добавить слоты» + close ×, разделённый `borderBottom: 1px solid var(--border)`
   - segmented switcher «Один слот / Несколько слотов» ниже header'а
   - те же поля: Дата начала/окончания (2-col grid), Дни недели (44×44 chips), Тариф (select), Предпросмотр + Создать, hint «Сначала нажмите «Предпросмотр»…»
   - media query: на ≤640px модал становится bottom-sheet (border-radius сверху, min-height 92vh)
   - **ИЗМЕНЯЕТСЯ ТОЛЬКО** «Время начала (МСК, шаг 30 мин)» — был `<input type="time">` + «+ Ещё время»; станет «От HH:mm → До HH:mm · N мин» row + «+ Ещё интервал»

2. **Single-модал ПЕРЕДЕЛЫВАЕМ визуально под стиль bulk-модала**:
   - тот же centered modal, тот же фон, те же borderRadius/maxWidth/header style
   - header «Новое занятие» + close ×
   - segmented switcher «Один слот / Несколько слотов»
   - body: Дата (full-width input) → «От/До» row → Тариф → Отмена + Создать
   - media query: bottom-sheet на ≤640px (как у bulk)
   - **НЕЛЬЗЯ оставить bottom-sheet стиль с «drag handle»** — текущий MobileCreateFab делал bottom-sheet с `borderTopLeftRadius` + handle bar; УБИРАЕМ это

3. **API/backend изменения**: только то, что нужно для «От/До»:
   - В `BulkAddSlotsModal` рассчитываем «До» как (от + общая длительность). Length по-прежнему берётся из тарифа (`assertTariffDurationMatches`).
   - В single — то же.
   - Никакого нового формата `intervals` на API стороне. POST остаётся: `times: ['18:00', '19:00'] + durationMinutes: 60`.
   - **НЕ ТРОГАЕМ** `lib/calendar/recurrence.ts`, `app/api/teacher/slots/preview-bulk/route.ts`, `app/api/teacher/slots/bulk-create/route.ts`.

---

## 1. Контекст (что было)

После PR #576 на проде:
- `BulkAddSlotsModal.tsx` — centered modal с правильным дизайном (см. скриншот «топ»). Time-input = `<input type="time" step="1800">` + «+ Ещё время».
- `MobileCreateFab.tsx` — bottom-sheet с handle bar. Header «Новое занятие» + switcher + Дата input + «Время начала» input + Длительность ChipGroup (30/60/90/120) + Тариф + Отмена/Создать.

PR #577 (откачен через #578) поломал визуал bulk-модала: я переделал в bottom-sheet стиль с overflow, и single тоже. Владелец недоволен — bulk был топом, single должен был стать как bulk.

---

## 2. Что меняем точечно

### 2.1 `components/calendar/BulkAddSlotsModal.tsx`

Изменения **только в блоке «Время начала»**:

Было (примерно lines 285-310):
```jsx
<div style={{ marginTop: 12 }}>
  <div style={{ fontSize: 13, color: 'var(--secondary)', marginBottom: 6 }}>
    Время начала (МСК, шаг 30 мин)
  </div>
  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
    {times.map((t, idx) => (
      <div key={idx} style={{ display: 'flex', gap: 6 }}>
        <input type="time" value={t} step={1800} ... />
        {times.length > 1 && <button onClick={() => removeTime(idx)}>−</button>}
      </div>
    ))}
    <button onClick={addTime}>+ Ещё время</button>
  </div>
</div>
```

Будет:
```jsx
<div style={{ marginTop: 12 }}>
  <div style={{ fontSize: 13, color: 'var(--secondary)', marginBottom: 6 }}>
    Интервалы (МСК, шаг 30 мин)
  </div>
  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
    {times.map((t, idx) => (
      <TimeRangeRow
        key={idx}
        from={t}
        durationMinutes={durationMinutes}
        onFromChange={(next) => updateTime(idx, next)}
        onDurationChange={setDurationMinutes}
        allowRemove={times.length > 1}
        onRemove={() => removeTime(idx)}
      />
    ))}
    <button onClick={addTime} style={addTimeBtnStyle}>+ Ещё интервал</button>
  </div>
</div>
```

`TimeRangeRow` — новый компонент. **«От»** редактируется per-row, **«До»** вычисляется как (от + durationMinutes); редактирование «До» меняет общую `durationMinutes` (соблюдается tariff-invariant `assertTariffDurationMatches`).

`addTime` теперь: новый «От» = последнее «От» + durationMinutes (а не статичные `18:00`).

ВСЁ остальное — header, fields layout, action buttons, hint text, styles `addTimeBtnStyle`/`removeBtnStyle`/`previewBtnStyle`/`submitBtnStyle` — НЕ ТРОГАЕМ.

### 2.2 `components/calendar/MobileCreateFab.tsx`

Полностью переписываем визуальную часть. Functional behavior сохраняется (segmented switch, localStorage preference).

Структура матчит `BulkAddSlotsModal`:
- Тот же `overlayStyle` с `alignItems: 'center'` (НЕ bottom-sheet)
- Тот же `sheetStyle` (`borderRadius: 12, maxWidth: 520, background: var(--bg), border 1px solid var(--border)`)
- Тот же header с `borderBottom`
- Тот же media-query для ≤640px (bottom-sheet)
- Body:
  - Дата (full-width)
  - Сегмент switcher («Один слот / Несколько слотов»)
  - Интервал — один `TimeRangeRow` (без `allowRemove`)
  - Тариф (если ≤3 → ChipGroup, иначе select — как сейчас)
- Action buttons «Отмена» + «Создать» в той же стилистике как bulk'овские (но без preview шага)

«Длительность» как отдельный ChipGroup — **удаляем**, она теперь живёт в «До» row'а.

### 2.3 Новый компонент `components/calendar/TimeRangeRow.tsx`

Pure presentational. Props:
```ts
{
  from: string // HH:mm
  durationMinutes: number
  onFromChange: (next: string) => void
  onDurationChange: (nextDur: number) => void
  allowRemove?: boolean
  onRemove?: () => void
}
```

Render:
```
┌──────────────────────────────────────────────────────┐
│ [ От 18:00 ] → [ До 19:00 ]   60 мин   [ × ]         │
└──────────────────────────────────────────────────────┘
```

- «От» chip — открывает picker (mobile bottom-sheet с 30-min grid 06:00–22:00; desktop — `showPicker()` на скрытом `<input type="time">`)
- «До» chip — то же; при изменении вычисляет нужную длительность, snap'ит к ALLOWED [30, 45, 60, 75, 90, 120], вызывает `onDurationChange(snappedDur)`
- «60 мин» — read-only label
- «×» — `onRemove` если `allowRemove`

Стиль chip: маленький rounded pill `borderRadius: 999`, `border: 1px solid var(--border)`, accent на active, `min-height: 36` (не 44 — это для desktop modal, не bottom-sheet, можно компактнее).

**ВАЖНО — отличие от PR #577**: компонент должен **встраиваться внутрь centered modal**, не диктовать собственный layout. Размер chip'ов компактный, чтобы row помещалась в одну строку на 520px maxWidth. Нет outer-card-стилей (`background: var(--bg)`, border) — row рисуется на фоне modal'а напрямую как inline-flex.

### 2.4 Поддержка picker'а

Сохраняем компоненты `TimePickerButton` + `TimePickerSheet` из PR #577 (они были OK, проблема была только в композиции). Но переразместим их инструкции:
- На desktop ≥600px: тап на chip → `showPicker()` на hidden native `<input type="time" step="1800">`. Если `showPicker` не поддержан — fallback на click+focus.
- На mobile <600px: тап → bottom-sheet picker (TimePickerSheet) с 30-min grid 06:00..22:00.

---

## 3. План — последовательность

### Phase A: Baseline (visual snapshot текущего проды)

1. Запустить dev server: `npm run dev`
2. Создать playwright-fixture учителя (если ещё нет): `qa-fixture-teacher@levelchannel.test`.
3. Снять скриншоты ТЕКУЩЕГО state (= после revert):
   - Mobile (390×844): bulk-модал «Несколько слотов» selected — это «топ-дизайн»
   - Mobile: single-модал «Один слот» selected — это что НЕ нравится
   - Desktop (1280×900): обе вариации
4. Сохранить в `/tmp/baseline/`.

### Phase B: Создание `TimeRangeRow` + picker компонентов

1. `components/calendar/TimePickerButton.tsx` — compact chip pill, ветвление desktop/mobile через `matchMedia('(min-width: 600px)')`.
2. `components/calendar/TimePickerSheet.tsx` — bottom-sheet 30-min grid (как было в PR #577).
3. `components/calendar/TimeRangeRow.tsx` — inline-flex row.
4. Unit тесты на TimeRangeRow (snap логика).

### Phase C: Bulk-модал минимальная замена

1. Импорт `TimeRangeRow` в `BulkAddSlotsModal.tsx`.
2. Замена ровно блока «Время начала» на «Интервалы» — НИКАКИХ других изменений.
3. Переименование label «Время начала (МСК, шаг 30 мин)» → «Интервалы (МСК, шаг 30 мин)».
4. `addTime` теперь auto-shift от последнего.
5. Build + visual smoke в playwright.

### Phase D: Single-модал — визуальная переделка под стиль bulk

1. Переписать render-часть `MobileCreateFab.tsx`:
   - Заменить bottom-sheet chrome на centered modal chrome (копируем структуру `overlayStyle`/`sheetStyle`/`headerStyle`/`closeBtnStyle` из `BulkAddSlotsModal`).
   - Убрать handle bar.
   - Поменять body layout: Дата → segmented switcher → TimeRangeRow → Тариф → Отмена/Создать.
   - Удалить старый «Длительность» ChipGroup.
2. Удалить старые inline styles `inputStyle`/`FieldLabel` — заменить на стили в духе bulk'а.
3. Build + visual smoke.

### Phase E: Playwright visual check + design review

1. Снять after-скриншоты в playwright (mobile + desktop, single + bulk).
2. Side-by-side diff с baseline:
   - Bulk: ТОЛЬКО блок интервалов должен отличаться. Заголовок, дата, дни, тариф, кнопки, hint — pixel-perfect одинаковые.
   - Single: должен визуально матчить bulk chrome (центрирование, border, header).
3. Дизайн-чек:
   - Spacing согласован
   - Typography согласована (font-size, font-weight)
   - Color tokens (var(--bg), var(--border), var(--text), var(--secondary))
   - Touch-target ≥44px на интерактивных элементах
   - Контраст текста ≥4.5:1
4. Если визуально расходится с baseline в чём-то кроме intervals — фиксим.

### Phase F: Один PR

1. Commit + push + open PR с before/after скриншотами.
2. Owner approves visually.
3. CI green → merge.

---

## 4. Open questions / default'ы

1. **«До» вне business hours**: если «От 21:30 + 60 мин = 22:30», то «До» выходит за 22:00. Решение: при `onDurationChange` валидируем, если новый `endMin > 22:00` — отказать (показать inline ошибку на row, не менять duration).
2. **Snap к ALLOWED durations**: ALLOWED = `[30, 45, 50, 60, 75, 90, 120]`. При редактировании «До» — round-up к ближайшему ≥. Если result > 120 → clamp 120.
3. **«+ Ещё интервал» first row default**: `from = 18:00`, `duration = 60` — как сейчас.
4. **Subsequent rows**: `from = lastFrom + duration`. Если выходит за 22:00 — `from = 18:00`.
5. **Animation при переключении single↔bulk**: НЕ ДЕЛАЕМ в этом PR. Сначала визуал, потом полировка.

---

## 5. Self-review round 1 — где я могу опять накосячить

### 5.1 Главные risk-точки

**R1. Опять переделаю bulk-модал больше чем нужно.** Из-за того что я переписываю файлы, есть соблазн «улучшить попутно». ЗАПРЕТ: единственное изменение в `BulkAddSlotsModal.tsx` — это lines 287-316 (блок «Время начала»). Всё остальное byte-for-byte как сейчас.
- **Защита**: `git diff` после правок должен показать изменения ТОЛЬКО в этой одной секции (+ возможно мелкий хелпер для addTime auto-shift).

**R2. Single-модал визуально не совпадёт с bulk.** Если я просто скопирую стили — на ≤640px должна включиться bottom-sheet media query.
- **Защита**: вынести CSS-стили в общий помощник `lib/calendar/modal-styles.ts` (или CSS module), импортировать в оба. Один источник правды для chrome.

**R3. TimeRangeRow слишком big для desktop modal.** maxWidth у bulk = 520. После padding 16, useful width = 488. Row должен помещаться в одну строку: от-pill (~70px) + arrow (~20px) + до-pill (~70px) + duration label (~50px) + remove (~36px) = ~246px минимум. Должно влезть.
- **Защита**: визуально проверить на 320px viewport. Если не влезает — стек по вертикали («От» / «→» / «До» / 60 мин / ×) с flex-wrap.

**R4. TimePickerButton на desktop через showPicker() ломается в Safari.** showPicker не во всех браузерах.
- **Защита**: fallback на focus+click. Если не сработает — пробуем `element.click()` напрямую.
- **Защита 2**: на десктопе можно показать picker всегда в виде нашей собственной sheet — но это противоречит «native feel». Решение: попробовать showPicker, если throws — fallback на нашу TimePickerSheet даже на desktop.

**R5. «Длительность» удалил из single — а где user меняет длительность?** Через «До»-chip в TimeRangeRow. Но это не очевидно. Когда single выбран и tariff фиксирует duration — «До» становится read-only? Или user всё равно может через «До» изменить?
- **Решение**: если tariff active И duration matches — «До» editable но при попытке выйти за tariff duration — refuse + tooltip «Длительность определяется тарифом». Если «Без цены» — «До» editable свободно.
- **Защита**: сначала спросить владельца? Нет, владелец сказал «делай не задавая вопросов». Default: «До» всегда editable, snap к ALLOWED. Если tariff active и duration mismatch — backend отлупит при submit. UI показывает ошибку.

**R6. Playwright fixture login.** Не уверен есть ли готовый `qa-fixture-teacher` для dev server.
- **Защита**: проверить `npm run seed:qa` или `tests/integration/fixtures/`. Если нет — придётся вручную через UI (register → verify). Если уж совсем нет — снять скриншоты на самом prod (что я уже делал).

**R7. Слепое копирование стилей bulk → single.** В bulk используется specific styles like `previewBtnStyle` (border, no fill) и `submitBtnStyle` (accent fill). Single должен использовать те же подходы, но «Отмена» как secondary + «Создать» как primary.
- **Защита**: использовать DS `<Button variant="secondary"|"primary">` из `@/components/ui/primitives` — но bulk их НЕ использует, у него inline-стили. Чтобы single визуально совпал — single должен использовать те же inline-стили, не DS-Button. Дублирование style consts в обоих файлах OK для этого PR.

### 5.2 Что точно надо в коде

- Никаких новых API-роутов.
- Никаких изменений в `recurrence.ts` или route handler'ах.
- НЕ ИСПОЛЬЗОВАТЬ `intervals: [...]` payload на route — POST остаётся `times + durationMinutes`.
- НЕ переименовывать файлы.
- Не удалять `BulkAddSlotsModal.tsx` или `MobileCreateFab.tsx` — оба обновляются in-place.

### 5.3 Что точно надо в плане → проверить ПЕРЕД кодом

- [x] §2.1 чётко указано что меняется в bulk (только time-input block)
- [x] §2.2 чётко указано что меняется в single (chrome переделка)
- [x] §4 default'ы установлены
- [x] R1-R7 risk-точки названы и есть «Защита» для каждой

---

## 6. Self-review round 2 — пере-читал план, нашёл новые проблемы

**R8. ChipGroup сам по себе не выглядит как pill `[Один слот] [Несколько слотов]` на скриншоте**. Посмотрел `components/ui/primitives/chip-group.tsx`: render — `borderRadius: 999` для каждого option. Активный — `accent` border, `accent-bg` fill. На скриншоте «топ-дизайна» — outline у inactive + filled accent у active. Совпадает с DS chip-group. OK, ничего менять не надо.

**R9. На моих PR #577 скриншотах «Дата начала / Дата окончания» отображаются как «9 Jun 2026 / 7 Jul 2026»**. На «топ-дизайне» скриншоте — то же. То есть native `<input type="date">` рендерит одинаково — это native. OK.

**R10. «Дни недели» 44×44 chip'ы на «топ-дизайне» — inactive имеют outline (border), active — filled accent**. Совпадает с тем что в коде уже. OK.

**R11. Текст hint'а внизу «Сначала нажмите «Предпросмотр»…» виден на «топ-дизайне». В моём PR #577 — отсутствовал**. Это важная часть UX (учит пользователя). СОХРАНЯЕМ.

**R12. Action buttons на «топ-дизайне» — «Предпросмотр» (outline) + «Создать» (filled accent)**. В bulk текущем — то же. OK.

**R13. **«+ Ещё время»** на «топ-дизайне» — dashed-border, маленький, align: flex-start**. Совпадает с `addTimeBtnStyle`. ОСТАВЛЯЕМ как было.

**R14. Что насчёт preview-box после «Создать»?** Bulk имеет `previewBoxStyle` который показывается после «Предпросмотр». В single — нет preview шага. ОК, не дублируем.

**R15. Critical-path check.** Проверить — `MobileCreateFab.tsx` или `BulkAddSlotsModal.tsx` в critical-path? Если да — нужен Codex-Paranoia trailer. Проверю `docs/critical-path.md` перед коммитом.

**R16. Tests.** Будут ли integration-тесты ломаться? Bulk использует POST `/api/teacher/slots/preview-bulk` с `times + durationMinutes` — НЕ ТРОГАЕМ payload, тесты должны пройти. Single использует POST `/api/teacher/slots/bulk-create` с `slots: [{startAt}] + durationMinutes` — НЕ ТРОГАЕМ, тоже OK.

**R17. На «топ-дизайн» скриншоте header'а: «Добавить слоты» (NOT «Новое занятие»)**. Single header сейчас — «Новое занятие». Какой использовать для single, если визуально под bulk? **Решение**: для single оставить «Новое занятие» (отражает scope = 1 слот), bulk — «Добавить слоты» (отражает scope = много). Это семантически правильно.

### 6.1 Round 2 — итог

Все risk-точки названы. План минимальный, нет переделок ради переделок. **Approve. Иду в Phase A.**

---

## 7. Acceptance Checklist (для PR review)

- [ ] **Visual baseline снят**: 4 скриншота /tmp/baseline/{single,bulk}-{mobile,desktop}.png
- [ ] **Bulk-модал**: визуальный diff ТОЛЬКО в блоке «Интервалы»
  - [ ] Header «Добавить слоты» — без изменений
  - [ ] Switcher «Один слот / Несколько слотов» — без изменений
  - [ ] Дата начала / окончания — без изменений
  - [ ] Дни недели — без изменений
  - [ ] Тариф select — без изменений
  - [ ] «Предпросмотр» + «Создать» buttons — без изменений
  - [ ] Hint «Сначала нажмите «Предпросмотр»…» — без изменений
  - [ ] **Блок «Интервалы»**: каждая row показывает «От HH:mm → До HH:mm · N мин» + remove
  - [ ] «+ Ещё интервал» dashed button — на месте
- [ ] **Single-модал**: chrome визуально совпадает с bulk
  - [ ] Centered modal с borderRadius 12, maxWidth 520
  - [ ] Header «Новое занятие» + borderBottom + close ×
  - [ ] Switcher «Один слот / Несколько слотов» (single active)
  - [ ] Body: Дата → Интервал (1 TimeRangeRow, без remove) → Тариф → Отмена/Создать
  - [ ] Bottom-sheet media query ≤640px (та же, что у bulk)
- [ ] **Playwright** проверка: оба модала открываются, switcher переключает, time-picker открывает sheet/native
- [ ] **Build clean**, **TS clean**
- [ ] **Calendar tests pass** (321/321)
- [ ] Plan-doc → status SHIPPED

---

## 8. Codex paranoia

Quota exhausted до 2026-06-11. Self-review (round 1 + round 2) выполнен.
Trailer: `Codex-Paranoia: SELF-REVIEW round 2/2 (Codex quota exhausted; visual-only fix after #577 revert)`.

После возврата квоты — `/codex-paranoia wave` на commit-range.
