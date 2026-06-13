# LevelChannel Design System

**Version:** v2.0 (2026-06-07).
**Status:** living document — обновляется каждый раз, когда мы шлифуем экран и добавляем что-то общее.
**Owners:** Frontend / Design (Иван + Claude-агент).

> Заголовки на английском по соглашению репо. Примеры копи на русском — это язык продукта.

---

## 1. Что это

Контракт «как должен выглядеть и звучать LevelChannel-кабинет». Один источник правды для:

- Цветов / типографики / отступов / радиусов / теней.
- Поведения примитивов (Button, ChipGroup, Pill, Banner, EmptyState, FAB) — что они делают и в каких состояниях.
- Тона голоса: коротко, на «ты» к учителю / на «вы» к ученику, без жаргона.
- Анти-паттернов — конкретных ошибок, которые мы уже совершали и больше не хотим.

Чего здесь **нет**:

- Лендинговая поверхность (`/saas/v3`) — свой визуальный язык, см. `components/saas/landing-v3/`.
- Layout конкретных страниц — это решают плановые документы.
- Light-mode — кабинет dark-only. Light зарезервирован под legal/thank-you.

---

## 2. Принципы

1. **Кабинет — инструмент, не маркетинг.** Плотность информации важнее красоты. Если на экране есть полезная сводка (next lesson / week summary / unpaid debt) — она важнее иллюстрации.
2. **Не объясняй, что и так понятно.** Drag-paint в календаре, click для деталей — это UX feedback, не текстовая инструкция. Любая фраза вида «Тяните по сетке…» — кандидат на удаление в пользу полезной информации.
3. **Один токен — одно значение.** Никаких `#1f1f23`, `rgba(255,255,255,0.05)` в новом коде. Если оттенка нет — добавляй в `globals.css`.
4. **Кнопки > ссылки в потоке.** Действия с именем («Обновить тариф», «Создать ссылку», «Отменить занятие») — `<Button>`. Ссылки внутри статичных абзацев («Настройки календаря») — `<Link>` с подчёркиванием.
5. **Числа табулярные.** Балансы, счётчики, время — `fontVariantNumeric: 'tabular-nums'`. Иначе скачут на 0.5px при обновлении.
6. **Эмодзи — только в письмах/пушах, не в UI.** В интерфейсе — inline SVG / системные глифы (`⚠`, `→`, `·`).
7. **Без жаргона наружу.** «OAuth», «токен», «синхронизация», «write-доступ» — это для нас. Учителю говорим «Google», «событие», «настройки».
8. **Каждый empty state имеет CTA.** Пустой список без кнопки «что мне делать» — баг. Используй `<EmptyState>`.

---

## 3. Tokens (живут в `app/globals.css`)

Используются через `var(--name)`. Менять значение — только в `globals.css`.

### 3.1 Surfaces (dark stack)

| Token | Value | Где |
|---|---|---|
| `--background` | `#0a0a0c` | Корень страницы кабинета |
| `--surface-1` | `#141416` | Модалки, основные карточки |
| `--surface-2` | `#1C1C1F` | Вторичные поверхности (input, кнопка-secondary, hover) |
| `--surface-3` | `#26262A` | Активные / pressed |
| `--surface` | `#111113` | **Legacy.** Не использовать в новом коде — оставлено для лендинга. |

### 3.2 Border / texture

| Token | Value | Где |
|---|---|---|
| `--border` | `rgba(255,255,255,0.08)` | Все hairlines: input, card, divider |

### 3.3 Текст

| Token | Value | Где |
|---|---|---|
| `--text` | `#FFFFFF` | Основной текст |
| `--text-primary` | `#F5F5F7` | Заголовки (немного приглушённый белый) |
| `--text-secondary` / `--secondary` | `#A1A1AA` | Подзаголовки, лейблы, мета |
| `--text-tertiary` | `#6E6E76` | Disabled, плейсхолдеры |
| `--text-quaternary` | `#48484C` | Очень фоновое (timestamp в углу) |
| `--text-on-accent` | `#FFFFFF` | Текст на accent-кнопке |

### 3.4 Accent (бренд)

| Token | Value | Применение |
|---|---|---|
| `--accent` | `#D88A82` | Primary CTA, current-time line, today-cell, активный chip |
| `--accent-hover` | `#E29B92` | Hover для accent-кнопки |
| `--accent-pressed` | `#C47B72` | Pressed / active |
| `--accent-bg` | `rgba(216,138,130,0.10)` | Tinted bg активного chip-option, soft-hover |
| `--accent-bg-strong` | `rgba(216,138,130,0.18)` | Hover для chip-option |

### 3.5 Семантика

| Token | Value | Применение |
|---|---|---|
| `--warning` | `#F5C26B` | Soft-limit (≥80%), hidden-slots, near-expiry |
| `--warning-bg` | `rgba(245,194,107,0.10)` | Bg того же |
| `--danger` | `#FF6E6E` | Hard-limit, конфликты, destructive |
| `--danger-bg` | `rgba(255,110,110,0.12)` | Bg того же |

Success-токен пока не нужен (используем `#9BDF9B` локально в `<Pill tone="success">` и календарных done-states).

---

## 4. Typography

```
--text-12: 12px    — tooltip, label, мелкие badges
--text-13: 13px    — кнопка default, мета-строка, второй уровень body
--text-15: 15px    — стандартный body
--text-17: 17px    — H3, заголовок карточки
--text-22: 22px    — H2 секции
--text-28: 28px    — H1 страницы кабинета
--text-34: 34px    — H1 hero (редко, обычно только onboarding-welcome)
```

**Веса:**
- 400 — body
- 500 — UI-default (кнопки, лейблы, метаданные)
- 600 — заголовки H2/H3, primary CTA, активный chip
- 700 — только H1 страницы

**Line-height:**
- 1.2 — кнопки, заголовки, chip
- 1.3-1.4 — H3
- 1.5 — body

---

## 5. Spacing scale

Базовая единица 4px. **Используем только:** `4 · 6 · 8 · 10 · 12 · 16 · 20 · 24 · 32 · 40 · 56 · 80`.

Не используем `2 / 14 / 18 / 22 / 26 / 28 / 36 / 48 / 64` — обедняем выбор, выигрываем консистентность. Если нужно «между 12 и 16» — выбери одно из них.

### 5.1. Section rhythm

Расстояние между крупными карточками **одного экрана** (например на главной учителя — `header / setup-checklist / digest / upcoming / finance`) задаётся одним токеном:

- `--space-section: 32px` (desktop, ≥600px)
- `--space-section: 24px` (mobile, <600px)

Использовать через **класс `.lc-section`** на корне каждого блока — он добавит `margin-bottom: var(--space-section)`. Последний `.lc-section` в `<main>` автоматически обнуляет нижний марджин (`:last-child`), не нужно вручную счищать.

Inline-альтернатива: `style={{ marginBottom: 'var(--space-section)' }}`. Оба варианта эквивалентны.

**Не путать с внутренним ритмом карточки.** Внутри одной карточки промежутки между заголовком/строками остаются 12-16px. Токен — только для крупных «разделов экрана».

**Когда не использовать:**
- внутри grid/flex с собственным gap;
- между micro-блоками одной семьи (например, две связанные строки одной информации).

---

## 6. Radius

| Радиус | Применение |
|---|---|
| `4px` | Inline badges (цена в слоте, micro-pill) |
| `6px` | Inputs, мелкие кнопки secondary |
| `8px` | Slot card в календаре, мелкие cards, primary `<Button>` |
| `10px` | Banner (warning/danger), стат-блоки |
| `12px` | Большие карточки, модалки |
| `999px` | Pills, chips (counters + radio-options) |

---

## 7. Shadows

Минимально, потому что dark UI плохо принимает тени. Используем только для:

| Применение | Значение |
|---|---|
| FAB (floating action button) | `0 8px 24px rgba(0,0,0,0.35)` |
| Модалка (опц.) | `0 12px 40px rgba(0,0,0,0.45)` |

Карточки кабинета — без теней, только `--border`.

---

## 8. Motion

| Property | Duration | Easing |
|---|---|---|
| Hover background / border | 120ms | ease-out |
| Hover transform (lift) | 160ms | ease-out |
| Modal enter | 200ms | cubic-bezier(0.16, 1, 0.3, 1) |
| Progress bar fill | 240ms | ease-out |
| Page-level fade-in | 600-700ms | cubic-bezier(0.16, 1, 0.3, 1) |

**Reduced-motion:** все `transform`/`opacity` анимации > 200ms должны fallback'ить на instant. Хук — media query `(prefers-reduced-motion: reduce)` в `globals.css`.

---

## 9. UI Primitives (`components/ui/primitives/`)

**Источник:** `components/ui/primitives/index.ts`. Импортируем оттуда, не дублируем inline-стили.

### 9.1 `<Button>`

Универсальная кнопка. Props:
- `variant`: `primary` | `secondary` | `danger` | `ghost`
- `size`: `sm` | `md` | `lg`
- `href` (если задан — рендерится как `<Link>`, иначе `<button>`)
- `iconLeft` / `iconRight` (ReactNode)
- `loading` — заменяет content на `…`
- `fullWidth`

Примеры:
```tsx
<Button>Создать ссылку</Button>
<Button variant="danger" size="sm" href="/teacher/subscription">Обновить тариф</Button>
<Button variant="ghost" iconLeft={<GearIcon />}>Настройки</Button>
```

**Анти-паттерн:** `<button style={{padding, background, border, borderRadius, color, cursor}}>` — всё это уже умеет `<Button>`. Не дублируем.

### 9.2 `<ChipGroup>`

Радио-группа из pill-кнопок. Для 2-5 mutually-exclusive опций.

```tsx
<ChipGroup
  name="duration"
  value={duration}
  options={[
    { value: '30', label: '30 мин' },
    { value: '60', label: '60 мин' },
    { value: '90', label: '90 мин' },
  ]}
  onChange={setDuration}
/>
```

**Когда не ChipGroup, а `<select>`:** опций > 5 ИЛИ labels длиннее ~16 символов.

### 9.3 `<Pill>`

Read-only badge: статус, счётчик.

```tsx
<Pill tone="danger">5/5 учеников</Pill>
<Pill tone="warning">4/5 учеников</Pill>
<Pill tone="success">оплачено</Pill>
<Pill tone="default">черновик</Pill>
```

**Анти-паттерн:** clickable Pill. Если кликается — это `<Button variant="ghost">` или `<Link>`.

### 9.4 `<Banner>`

Page-level alert / status.

```tsx
<Banner
  tone="danger"
  icon="⚠"
  action={<Button variant="secondary" size="sm" href="/teacher/settings/calendar">Настройки</Button>}
>
  <strong>3 занятия пересекаются</strong> с событиями в Google Calendar.
</Banner>
```

**Tones:** `info` / `warning` / `danger` / `success`. Один banner на одно состояние — не лепи два рядом.

### 9.5 `<EmptyState>`

Для нулевых списков.

```tsx
<EmptyState
  title="Пока учеников нет"
  body="Создайте приглашение — ссылка действует 7 дней"
  action={<Button>Создать приглашение</Button>}
/>
```

**Правило:** каждый empty state имеет `action` ИЛИ объяснение, почему его нельзя сейчас сделать.

### 9.6 `<FloatingActionButton>`

Sticky bottom-right на мобиле. Одна FAB на экран.

```tsx
<FloatingActionButton
  label="Создать занятие"
  onClick={openCreate}
/>
```

**Когда FAB:** мобильный экран без видимого primary-action в шапке. На desktop FAB не используем — там кнопка в шапке секции.

---

## 10. Анти-паттерны (с примерами из истории)

### 10.1 `<details>` под параграфом

```tsx
// BAD
<p>
  Тяните по пустым клеткам, чтобы создать занятие.
  <details><summary>Подробнее</summary>...</details>
</p>
```

Если у тебя 2 строки + `<details>`, ты не уверен, какая половина важная. Выбор: либо короткая строчка in-line, либо tooltip-иконка `?`, либо вообще никакого текста (UX сам подскажет).

### 10.2 Длинные jargon-банеры

```tsx
// BAD
«1 урок пересекается с событиями в вашем Google Calendar. Конфликтные уроки
отмечены красной рамкой и значком ⚠ в расписании ниже — кликните по уроку,
чтобы выбрать действие: «я разрулю сам», «удалить событие в Google» (если
у LevelChannel есть write-доступ к источнику) или «отменить занятие».»

// GOOD
<Banner tone="danger" icon="⚠"
  action={<Button variant="secondary" size="sm" href="/teacher/settings/calendar">Настройки</Button>}>
  <strong>1 занятие пересекается</strong> с событием в Google. Кликните по занятию в сетке.
</Banner>
```

### 10.3 Дублирование заголовков

Если в навбаре уже выделено «Календарь» / «Главная» / «Ученики» — не дублируй H1 на странице с тем же текстом. Замени на:
- Контекст: «Добрый день, Анна» (приветствие на главной)
- Сводку: «5 учеников · 8 занятий на этой неделе»
- Полезное действие: кнопка справа в action-bar

### 10.4 Mixed форматы дат

В одном проходе видеть `07.06.2026` / `7 июня` / `Sun Jun 07` — больно.

**Правило:**
- В продукте: `«7 июня»` (год опускаем для текущего)
- В H2/details: `«воскресенье, 7 июня»`
- В машиночитаемом: ISO в `<time datetime="2026-06-07">`

### 10.5 Hardcoded цвета

Любой `#RRGGBB` / `rgba(...)` в новом коде вне `globals.css` — баг. Если оттенка нет — добавь токен.

### 10.6 «Слот» / «занятие» / «урок» вперемешку

Снаружи (UI, push, email) — только **«занятие»**. «Слот» / «slot» — внутренний термин, остаётся в коде.

### 10.7 Бесконечные labels

«На этой неделе» (когда вы уже на этой неделе) — переименовываем в «Сегодня». «Создать ссылку-приглашение» — терпимо. «Сохранить и продолжить настройку календаря» — длинно, разбей.

---

## 11. Tone of voice

- К учителю — **на «ты»**. К ученику — **на «вы»** (в кабинете ученика тоже «вы», потому что многие ученики — школьники, и их родители читают).
- Глаголы — императив или 2-е лицо: «Создайте», «Откройте», «Подключите». НЕ «Пользователь может создать…».
- Tooltip = объяснение one-liner («Удалит событие в Google, если у нас есть право записи»). НЕ повтор того, что уже на кнопке.
- Errors — что произошло + что делать. «Не получилось обратиться к Google. Переподключите календарь в настройках.» НЕ «Внутренняя ошибка обращения к API.»

---

## 12. Migration plan

Текущее состояние (2026-06-07):

- ✅ Tokens (`§3`) живут в `app/globals.css`.
- ✅ Primitives (`§9`) в `components/ui/primitives/`.
- ⚠ **Старые экраны** (admin, parts of cabinet) всё ещё с inline-стилями + hardcoded цветами. Мигрируем **по мере shipping'а** новых фич, не отдельным sweep'ом.
- ⚠ **Tailwind-классы** на лендинге (`.btn-primary` etc) — оставляем для лендинга. SaaS не использует.
- ❌ Светлая тема — НЕ делаем. Кабинет dark-only.

Правило миграции: если ты редактируешь файл и видишь там hardcoded `#RRGGBB` или ad-hoc button-стиль — **в той же правке** заменяешь на токен/примитив. Если правка не касается этой части — оставляешь и пишешь TODO с ref на этот документ.

---

## 13. Когда обновлять этот doc

Каждый раз, когда:

- Добавляешь новый токен в `globals.css` — добавь строчку в `§3`.
- Создаёшь новый примитив в `components/ui/primitives/` — добавь раздел в `§9`.
- Замечаешь новый recurring анти-паттерн — добавь в `§10`.

Если документация говорит одно, а код другое — **побеждает код**. Документацию обновляешь по факту.
