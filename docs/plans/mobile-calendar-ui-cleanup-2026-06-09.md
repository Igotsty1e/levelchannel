# Mobile calendar UI cleanup — unified «Создать» с toggle

**Status**: round 1 — pre-implementation self-review
**Owner**: @ivankhanaev
**Codex-Paranoia**: SELF-REVIEW round 2/2 (Codex quota exhausted до 2026-06-11)

## 1. Что не так сейчас (мобильный `/teacher/calendar`)

Owner-screenshot (2026-06-09 22:31, iPhone):
1. На странице календаря **две кнопки создания слотов** одновременно:
   - Розовая «**+ Добавить слоты**» в правом верхнем углу (пуш в `BulkAddSlotsModal` — мой PR #567 от сегодня).
   - Floating «**+ Создать**» в правом нижнем углу (`MobileCreateFab` — single-slot быстрое создание).
   Это дублирование. На мобилке place real-estate дорогой.
2. Под календарём, в пустом состоянии, ненужная подсказка: **«Откройте календарь с компьютера, чтобы создать первое.»** — даёт пассивно-агрессивный сигнал «в мобиле создавать нельзя» хотя FAB прямо рядом.

## 2. Что хочется (owner answer)

- **Одна** кнопка создания на мобиле — **«+ Создать»** (использовать существующий FAB).
- В модалке создания **toggle/switcher** с подписью «**Создавать несколько слотов**».
  - OFF (по умолчанию) → старая форма одного слота (текущая `MobileCreateFab`).
  - ON → переключается на bulk-форму (`BulkAddSlotsModal`).
- Текст «Откройте календарь с компьютера, чтобы создать первое» → удалить полностью.
- Десктоп НЕ трогаем (там оба surface валидны: drag-paint + кнопка «Добавить слоты»).

## 3. Файлы, которые трогаем

```
components/calendar/MobileCreateFab.tsx     EDIT — добавляем toggle в форму
components/calendar/BulkAddSlotsModal.tsx   keep as-is (используется отдельно на десктопе)
app/teacher/calendar/client.tsx             EDIT — скрыть «+ Добавить слоты» на мобилке через CSS
components/calendar/MobileFallback.tsx      EDIT — убираем second line «Откройте календарь с компьютера…»
```

## 4. Тех-дизайн

### 4.1. Скрытие «+ Добавить слоты» на мобилке

Кнопка живёт в шапке `app/teacher/calendar/client.tsx:128-146`. Оборачиваем в `className="bulk-add-desktop-only"` + CSS:
```css
@media (max-width: 760px) {
  .bulk-add-desktop-only { display: none !important; }
}
```

### 4.2. MobileCreateFab — toggle режима

Существующий FAB → bottom sheet с одним слотом (текущее поведение). Добавляем:

```tsx
<label>
  <input type="checkbox" checked={bulkMode} onChange={...} />
  <span>Создавать несколько слотов</span>
</label>
```

Когда `bulkMode === true`:
- Внутри той же модалки заменяем тело формы на `BulkAddSlotsModal`-shape: date-range + days-of-week + times[] + duration + preview + create.
- Не открываем второй modal поверх (анти-pattern на мобилке).

**Альтернатива (проще)**: при включении toggle закрываем текущий FAB-modal и сразу открываем `BulkAddSlotsModal`. Состояние toggle запоминается через `localStorage` чтобы сохранить выбор между открытиями.

**Моё предложение**: **альтернатива** — меньше дубль-кода, переиспользуем существующий `BulkAddSlotsModal` целиком вместо переносить его внутренности.

### 4.3. MobileFallback — убрать вторую строку

В `MobileFallback.tsx:108-109`:
- Было:
  ```
  На этой неделе занятий нет.
  Откройте календарь с компьютера, чтобы создать первое.
  ```
- Станет:
  ```
  На этой неделе занятий нет.
  ```
  (опционально — добавить мелким текстом «Нажмите + Создать справа снизу», но это **anti-pattern duplicate** — FAB и так визуально яркий. Оставляю просто короткую строку.)

## 5. Self-review (round 1)

### 5.1. Закрыто
- Файлы пинпойнтнуты (3 EDIT).
- Не плодим новый кофигурационный shape — переиспользуем `BulkAddSlotsModal` целиком (option B в §4.2).
- Десктоп не трогается — `media-query` only для скрытия топовой кнопки.

### 5.2. Открытые риски
- **R1**: Toggle позиция в FAB-form. Сейчас FAB-modal — короткая single-slot форма. Добавление toggle на самый верх формы — это лишний клик «выбрать режим до начала ввода». **Mitigation**: ставим toggle компактно, как первый элемент сверху, текст «Создавать несколько слотов» + helpered tooltip-подсказка не нужна.
- **R2**: При flip toggle ON во время заполнения single-form данные теряются. **Acceptable** — single-form очень короткая (одно время + дата). Owner expects переключение режима осознанным.
- **R3**: Если у учителя нет тарифов, `BulkAddSlotsModal` показывает «— нет тарифов —» в select. Single-form FAB тоже падает на этом state? **Action перед impl**: проверить, как single-form ведёт себя без тарифов; если падает silently — это отдельный баг, не в этом PR.
- **R4**: Mobile `@media (max-width: 760px)` — стандартный breakpoint в codebase (см. landing-v3). Сверил против `BulkAddSlotsModal` mobile sheet — там тоже `640px`. Несостыковка breakpoint'ов: модал переключается на full-screen sheet с 640px, но мы скрываем top-button с 760px. **Решение**: использую 760px для обоих — единый mobile threshold (соответствует cabinet's `cabinet-nav` breakpoint и landing-v3).
- **R5**: `localStorage` ключ для запоминания режима — `lc_calendar_create_bulk_mode`. Не критично — если нет, default OFF.
- **R6**: A11y — checkbox label должен быть `<label>` обёртка вокруг input + text. Standard.

### 5.3. Что НЕ делаем (out of scope)
- НЕ объединяем single-form и bulk-form в один UI компонент (это рефакторинг на полнедели). Toggle = два отдельных модальных окна, контекстно переключаемых.
- НЕ убираем drag-paint с десктопа.
- НЕ меняем эмпти-стейт на десктопе (только мобильный fallback).

### 5.4. Тест-план (manual)
1. Mobile (390×844) `/teacher/calendar`:
   - Top «+ Добавить слоты» скрыто.
   - FAB «+ Создать» видим.
   - Тап на FAB → modal с toggle сверху.
   - Toggle OFF → single-form.
   - Toggle ON → BulkAddSlotsModal full-screen sheet.
   - LocalStorage запомнил режим.
   - Пустое состояние без второй строки.
2. Desktop (1280) `/teacher/calendar`:
   - Top «+ Добавить слоты» видна (как было).
   - FAB не показывается (default behaviour).
   - Drag-paint работает.

## 6. Decomposition

Single PR, ≤120 строк diff. CSS + JSX changes + один localStorage helper.

## 7. Готовность
Plan-doc round 1 self-reviewed. Auto-mode → implement now.
