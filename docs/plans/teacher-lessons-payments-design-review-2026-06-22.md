# Design review: `/teacher/lessons?kind=payments`

**Status:** **SHIPPED** 2026-06-22 — Epic 2 closed (PRs #721/#722/#723/#724 + hotfixes #725/#726)
**Owner:** Claude (session 2026-06-22)
**Date:** 2026-06-22
**Scope:** дизайн/UX/content/a11y ревью. **НЕ payment-domain refactor, НЕ изменение payment business logic.**

> **Codex paranoia status.** Codex CLI 0.141.0 restored 2026-06-22. Plan прошёл **8 rounds** Codex paranoia (cap exceeded — owner-authorized в session 2026-06-22). **SIGN-OFF round 8/8**. See §9 for full sequence.

---

## 0. Context

Страница — единственная точка входа учителя в журнал оплат: pending claims от учеников, ручная отметка оплат, политика начислений, список заканчивающихся абонементов, история, CSV для налоговой. Шипнута в волне `teacher-payments-sbp-self-service` (2026-06-07) + перенесена в `app/teacher/lessons?kind=payments` в bug-bash 2026-06-19. С тех пор дизайн-eyes-ревью не проводилось.

**Surface reviewed live** (qa-fixture-teacher@levelchannel.test, http://localhost:3000):
- desktop 1440×900
- mobile 375×812
- kind=payments default state (1 unpaid learner Дима Лебедев, 2 unpaid slots; 0 pending claims; 0 expiring)
- expanded «Должны оплатить» с раскрытыми слотами + Способ + Отметить оплачено

**Code-level sweep:**
- `app/teacher/lessons/page.tsx` (server root, server-branching по kind)
- `components/teacher/lessons/payments-section.tsx` (server, fetch + composition + локальный `<SummaryCard>`)
- `components/teacher/lessons/kind-routing-cards.tsx` (client, 3-card nav)
- `app/teacher/payments/feed.tsx` (client, tabs + claim card + decline modal + refund modal)
- `app/teacher/payments/explainer.tsx` (client, Banner)
- `app/teacher/payments/unpaid-learners.tsx` (client, expandable rows + mark-paid)
- `app/teacher/payments/policy-editor.tsx` (client, 2 checkboxes + save)
- `lib/payments/sbp-claims.ts:305-367` (`listUnpaidSlotsForPair` — label builder для B-1)
- `app/api/teacher/payment-claims/unpaid-slots/route.ts` (route → helper)
- `tests/payments/teacher-feed-prop-resync.test.tsx` (1 unit-test касается ClaimsFeed tabs)

**Reference contracts:**
- `docs/design-system.md` v2.0 (tokens, primitives, anti-patterns)
- `docs/content-style.md` (audience matrix, forbidden words, microcopy patterns) — **authority wins on conflict** (см. doc-drift в I-3 ниже)
- `components/ui/primitives/index.ts` (Button, ChipGroup, Pill, Banner, EmptyState, FAB, Checkbox, Combobox, DatePicker, TimePicker, CollapsibleCard)
- `components/cabinet/lessons-tabs-client.tsx` (accessible tabs pattern с `role="tablist"` + `aria-selected` — **существующий surface**, не дублировать)

---

## 1. Existing surface inventory (survey)

```bash
rg -l 'SummaryCard|tabBtnStyle|modalOverlay|role="dialog"|role="tablist"|unpaid-slots|listUnpaidSlotsForPair' app components lib tests
```

| Pattern | Hits | Disposition |
|---|---|---|
| `SummaryCard` (имя) | `components/teacher/lessons/payments-section.tsx:228` (local function) | **Unrelated.** Локальный helper только этой страницы. Не пере-используется. **Не предлагаем primitive** — single use-site. |
| `tabBtnStyle` (имя) | `app/teacher/payments/feed.tsx:618` (local helper) | **Refactor.** Есть accessible analog в `components/cabinet/lessons-tabs-client.tsx` с `role="tab"` + `aria-selected` + bracket-style indicator. Не дублировать второй раз — переиспользовать паттерн (inline mimic с правильным a11y; **не вынесение в primitive — out-of-scope**). |
| `modalOverlay` / `modalCard` (имена) | `app/teacher/payments/feed.tsx:583/594` (local consts) | **Out-of-scope.** 27 модалок в репо без единого primitive — recurring debt; отдельный эпик `cabinet-modal-primitive`. В рамках текущей задачи: тон-фиксы внутри модалок, без рефакторинга самого pattern. |
| `role="dialog"` | 28 файлов | Same as above. |
| `role="tablist"` | 5 файлов (вкл. `cabinet/lessons-tabs-client.tsx`, `combobox.tsx`, `admin/dashboard/period-tabs.tsx`, `admin/legal/versions-manager.tsx`, `slots-view-switcher.tsx`) | См. tabBtnStyle row. |
| `listUnpaidSlotsForPair` | `lib/payments/sbp-claims.ts:305` (definition) + `app/api/teacher/payment-claims/unpaid-slots/route.ts:5,26` (single consumer) | **Refactor (label only).** Status `'booked'\|'completed'\|'no_show_learner'\|'cancelled'` инлайнится в label на `sbp-claims.ts:358`. 1 consumer chain (route → unpaid-learners.tsx). Изменение label safe. |
| `← на главную` | `app/teacher/lessons/page.tsx:142` (1 hit) | **Unrelated single use-site**, удаление безопасно (другие teacher pages не имеют такого footer link). |
| `ClaimsFeed` import в тестах | `tests/payments/teacher-feed-prop-resync.test.tsx:6` | **Selector risk** — тест использует `getByRole('button', { name: /История \(N\)/ })`. Замена `<button>` → `role="tab"` сломает этот тест. **Mitigation: обновить test selector → `getByRole('tab', ...)`** в той же PR. |

**Вывод:** ревью не создаёт новые files. Все правки — внутри 9 уже перечисленных файлов (7 frontend + 1 lib + 1 test). SURVEY-BEFORE-PLAN trigger не активируется (нет новых route/handler/lib).

---

## 2. Findings

Severity:
- **BLOCKER** — нарушение содержательного контракта (content-style §4 forbidden words; security/legal/payment correctness).
- **HIGH** — заметно ухудшает UX, visual hierarchy ИЛИ a11y. Ship-blockable per a11y-team contract.
- **MED** — соответствует design-system но низкого приоритета — стоит фиксить за компанию.
- **LOW** — nice-to-have / cosmetic.

> **Recalibration after self-review round 1:** изначальные B-2/B-3/B-4/B-5 понижены до HIGH (UX/a11y, но не correctness BLOCKER). Только B-1 остаётся BLOCKER per content-style §4 violation (internal status DB на английском в UI). Это снижает «BLOCKER count» с 5 до 1 — что matches `/codex-paranoia` правильное использование severity tier (BLOCKER = correctness only).

---

### B-1. **BLOCKER** — Internal DB statuses (`booked`, `completed`) показаны учителю

**Где:** `lib/payments/sbp-claims.ts:352-358` — label builder включает `${row.status}` raw. В UI: `app/teacher/payments/unpaid-learners.tsx:252` рендерит `{s.label}`. Live screenshot подтверждает:

```
25 июн., 14:00 · 60 мин · booked            1 600 ₽
19 июн., 13:00 · 60 мин · completed         1 600 ₽
```

**Почему BLOCKER:**
- `content-style.md §4`: «paid_not_granted → Оплачено, но пакет не выдан. **Никогда не показывать имя статуса БД пользователю.**» Тот же принцип для `booked` / `completed` / `no_show_learner` / `cancelled`.
- Английские слова в UI — нарушение §3 «Plain Russian first».

**Fix path (owner Q-4 resolved — Variant B: русский Pill):**

В `lib/payments/sbp-claims.ts:352-358`:
- Убрать `${row.status}` из основного `label` (label = `«25 июн., 14:00 · 60 мин»` только).
- Добавить новое поле в return type: `statusLabel: 'запланировано' | 'прошло' | 'не пришёл' | 'отменено'`.
- Map: `booked → 'запланировано'`, `completed → 'прошло'`, `no_show_learner → 'не пришёл'`, `cancelled → 'отменено'`.

В `unpaid-learners.tsx:252`:
- Рендерить `{s.label}` как раньше + рядом `<Pill tone="default" size="sm">{s.statusLabel}</Pill>`.

Trace: 1 consumer chain (route 1:1 helper, 1 UI). Safe.

**Verification (Codex round-1 + round-2 fixes + owner Q-4):**
- Unit test для `listUnpaidSlotsForPair` — assert label не содержит английских slug AND `statusLabel` есть в return для всех 4 статусов с русскими значениями.
- **Route-level integration test** (`tests/api/teacher/payment-claims-unpaid-slots.test.ts`) — assert JSON response slot.label clean AND `slot.statusLabel` русский.
- **Codex round-2 BLOCKER fix + round-3 WARN-4 scope tightening — same-wave E2E coverage:** добавить spec `tests/e2e/teacher-payments.spec.ts`. Style per `tests/e2e/product-flows-authenticated.spec.ts:115`. Minimum assertions:
  - Teacher session authenticated.
  - Response 200 на `/teacher/lessons?kind=payments`.
  - Exact URL preserved (no redirect).
  - Stable anchors (substring): `Оплаты`, `Должны оплатить`, `Ждут (` (count regex), `История (` (count regex), `Скачать CSV`.
  - Absence: `booked|completed|no_show_learner|cancelled` в DOM.
  - **NOT тестировать** `Сейчас нет заявок` (это seed-state, не route contract — per Codex round-3 WARN-4).
- **Codex round-2/3/4 BLOCKER fix — evals row (exact PRODUCT_FLOWS.md schema per `evals/PRODUCT_FLOWS.md:12-25`):**

  Добавить ОДНУ row в section **D. Teacher cabinet** (line 181) в `evals/PRODUCT_FLOWS.md` (НЕ в section H — там Resolved ambiguities). Альтернативный target: section F. Payment / package UX (line 279) если хочется group по domain. **Default: D (Teacher cabinet)** — surface principally teacher-owned:

  ```markdown
  ### FLOW-TEACHER-PAYMENTS-001

  - **Area:** teacher / payment
  - **Starting URL:** `/teacher/lessons?kind=payments`
  - **Expected final URL:** `/teacher/lessons?kind=payments`
  - **Allowed redirects:** none (for verified teacher)
  - **Forbidden redirects:** `/login`, `/cabinet`, `/teacher` без kind, `?kind=` со значением вне `lessons|deals|payments`
  - **Required UI anchors:** `Оплаты`, `Должны оплатить`, `Ждут (`, `История (`, `Скачать CSV`
  - **Forbidden UI anchors:** `booked`, `completed`, `no_show_learner`, `cancelled`, `Скоро будет`, `TODO`
  - **Role required:** teacher (+ verified + current SaaS-offer consent)
  - **Risk:** **High** (payment surface; counts state-conditional)
  - **Automation status:** **e2e** (`tests/e2e/teacher-payments.spec.ts`)
  - **Notes:** Counts in tab anchors (`Ждут (N)`, `История (N)`) are state-conditional and not asserted as exact numbers — only the substring `Ждут (` / `История (` is required. qa-fixture seed: 1 unpaid learner (Дима Лебедев), 0 pending claims, 0 expiring packages — assert e2e in that fixture-state.
  ```

---

### B-2. **HIGH** *(downgraded from BLOCKER)* — Нет суммы при «Отметить оплачено» — учитель не видит preview суммы

**Где:** `app/teacher/payments/unpaid-learners.tsx:301-308` — кнопка «Отметить оплачено» в expanded view.

**Что происходит:** user отмечает чекбоксы (default — все выбраны), жмёт «Отметить оплачено». Сумма (`total = items.reduce(...)`) **не отображается до клика**. После — post-hoc `setInfo('Отмечено как оплачено: 1 600 ₽.')`.

**Почему HIGH (не BLOCKER):** money-action без preview — UX issue, но не нарушение контракта. Учитель ошибается галочкой → отметит не ту сумму → может откатить (нет, кстати — mark-paid не имеет undo, поэтому **upgrade рассмотри**). 

> Self-review note: на втором взгляде upgrade обратно до BLOCKER не нужен — учитель **выбрал** галочки сам. Это его явный выбор. Risk — accidental misclick. Mitigation: динамический label кнопки. **HIGH остаётся.**

**Fix:**
- Динамический label кнопки: `«Отметить ${plural} — ${formatRub(total)}»`. Например «Отметить 2 занятия — 3 200 ₽».
- Над/у кнопки — summary bar: «Выбрано: 2 занятия · 3 200 ₽».

---

### B-3. **HIGH** *(downgraded from BLOCKER)* — Tabs в `feed.tsx` без `role="tablist"` + `aria-selected`

**Где:** `app/teacher/payments/feed.tsx:214-237` — `<div>` с двумя `<button>` «Ждут / История».

**Почему HIGH:** WCAG 4.1.2 violation (name/role/value); accessible analog существует. Не correctness BLOCKER — функция доступна visually. Ship-blockable per a11y team contract.

**Fix:**
- Контейнер: `<div role="tablist" aria-label="Заявки на оплату">`.
- Каждая `<button>` — `role="tab" aria-selected={active}`.
- **Codex round-2 WARN fix (applies здесь тоже):** **НЕ добавлять `aria-controls` / `<div role="tabpanel">`** — feed.tsx тоже рендерит ОДИН `renderList` per tab state (`feed.tsx:210` ternary). Same problem что в B-5. Consistent с `lessons-tabs-client.tsx`.
- **Test selector migration (mandatory same-PR):** `tests/payments/teacher-feed-prop-resync.test.tsx:51,60` — заменить `getByRole('button', { name: /История \(N\)/ })` → `getByRole('tab', { name: /История \(N\)/ })`.
- Keyboard nav (Left/Right стрелки) — defer.

---

### B-4. **HIGH** *(downgraded from BLOCKER; Codex round-1 fix)* — Native `<input type="checkbox">` вместо `<Checkbox>` primitive

**Где:**
- `app/teacher/payments/policy-editor.tsx:74-80, 100-105` — 2 чекбокса политики.
- `app/teacher/payments/unpaid-learners.tsx:246-251` — чекбоксы выбора слотов внутри expanded.

**Почему HIGH:** design-system §10.5 anti-pattern (hardcoded styling в новом коде). Primitive `components/ui/primitives/checkbox.tsx` существует — uses tokens, `tone="accent"`, SVG checkmark.

**Pre-req: Checkbox primitive нужен focus-visible state.** Codex round-1: текущий primitive (`checkbox.tsx:48-77`) **не рисует visible focus state вообще** — input визуально скрыт через `visuallyHidden`, custom box не реагирует на `:focus-visible`. Migration без этого fix **ухудшает keyboard UX** vs текущие native checkboxes.

**Pre-req fix (в PR-1 включается):**
- `checkbox.tsx:boxStyle()` — добавить `&:has(input:focus-visible)` или wrap-level approach: `input:focus-visible + .box { outline: 2px solid var(--accent); outline-offset: 2px; }` (требует CSS file, не inline). Альтернатива: state `[data-focused]` + onFocus/onBlur handlers (inline решение).
- **Default:** добавить CSS-class-based focus ring в `globals.css` для `.lc-checkbox-box` selector; обновить primitive рендерить через class, не inline.

**Migration fixes:**
- В `policy-editor.tsx` заменить `<label><input type=checkbox> + <span>` на `<Checkbox label={<strong>...</strong>} hint={...} checked onChange>`. Primitive supports `label` + `hint` ReactNode.
- В `unpaid-learners.tsx` slot-toggle: **критически — сохранить row-wide hit area** (Codex round-1 WARN). Текущий `<label>` оборачивает весь ряд (date + price). Migration:
  ```tsx
  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
    <Checkbox checked={selected.has(s.id)} onChange={() => toggleSlot(...)} label={s.label} />
    <span style={{ marginLeft: 'auto' }}>{formatRub(s.expectedKopecks)}</span>
  </label>
  ```
  **НЕТ — `<Checkbox>` сам рендерит `<label>` внутри** (см. `checkbox.tsx:50`). Двойной label invalid. Решение: использовать Checkbox label-only для slot string + цена ВНЕ Checkbox но ВНУТРИ wrapper `<label>` который связан с другим control... сложно.

  **Default decision:** оставить native `<input type=checkbox>` для slot rows (keep current row-label structure). Заменить только в `policy-editor.tsx` где layout проще. Acknowledge что slot-row checkbox style не matches primitive — known minor visual inconsistency, fix отдельным PR после Checkbox primitive получит slot-row variant.

---

### B-5. **HIGH** *(downgraded from BLOCKER; Codex round-1 fix — semantic correction)* — KindRoutingCards: weak active state + missing tabs ARIA + legacy tokens

**Где:** `components/teacher/lessons/kind-routing-cards.tsx:33-113` — `<nav>` с 3 `<button>` для kind=lessons/deals/payments.

**Codex round-1 fix:** план изначально предлагал `aria-current="page"` (navigation pattern). Но existing analog (`components/cabinet/lessons-tabs-client.tsx:35`) использует `role="tab"` + `aria-selected` — semantically точнее (segmented control over URL state, не navigation между разными resources). Меняем подход.

**Fix (Codex round-1 + round-2 corrected):**
- Контейнер: `<div role="tablist" aria-label="Разделы занятий">` (не `<nav>`, не `<button>` группа).
- Каждая card: `<button role="tab" aria-selected={active}>`.
- **Codex round-2 WARN fix:** **НЕ добавлять `aria-controls` + `id` + `<div role="tabpanel">`** — page.tsx server-branches и рендерит ОДИН panel per URL. Два неактивных tab указали бы на non-existent panel ids. Consistent с existing `lessons-tabs-client.tsx:33` — там тоже только `role="tab"` + `aria-selected` без `aria-controls`.
- Усилить visual contrast active state: `var(--accent-bg-strong)` fill + `var(--accent)` border + `font-weight: 600` на title.

**Note:** keyboard arrow nav (Left/Right между tabs) — defer (отдельный a11y polish PR).

---

### H-1. **HIGH** *(Codex round-1 fix — location)* — Page header subtitle не state-aware

**Где:** `app/teacher/lessons/page.tsx:131-133`.

**Codex round-1 fix:** план изначально предлагал хранить subtitle map в `lib/teacher/lessons-kind.ts` — но это routing/helper module, не UI. Codex поправил: subtitle — UI copy, должно жить в UI слое. **Decision:** local const в `app/teacher/lessons/page.tsx` (3 строки в самом page file, рядом с `parseKind` use-site). Если pattern распространится — выделим в `lib/teacher/lessons-i18n.ts` отдельно (не туда же где парсер).

**Fix:** local `KIND_SUBTITLE: Record<LessonsKind, string>` const в `page.tsx`:
- lessons → «История проведённых занятий и личные дела.»
- deals → «Личные события в календаре — выполненные и отменённые.»
- payments → «Заявки от учеников, ваши отметки оплат и сводка долгов.»

---

### H-2. **HIGH** — Heading hierarchy сломана: 3 `<h2>` внутри одного `<section>`

**Где:**
- `payments-section.tsx:84` — `<h2>Оплаты</h2>` (заголовок секции).
- `payments-section.tsx:143` — `<h3>Заканчиваются абонементы</h3>` (подсекция, OK).
- `unpaid-learners.tsx:159` — `<h2>Должны оплатить</h2>` (подсекция, должна быть h3).
- `policy-editor.tsx:57` — `<h2>Политика по неоплаченным занятиям</h2>` (подсекция, должна быть h3).
- `feed.tsx` decline modal `<h2>Не пришло</h2>` + refund modal `<h2>Оформить возврат</h2>` (modal headings, OK — отдельный landmark).

**Fix:**
- `<h2>Должны оплатить</h2>` → `<h3>` + fontSize 17 per design-system §4.
- `<h2>Политика по неоплаченным занятиям</h2>` → `<h3>` + fontSize 17.

**Test impact:** grep tests на presence headings:

```bash
rg "'Должны оплатить'|'Политика по неоплаченным'" tests/
```

→ нет hits. Safe.

---

### H-3. **HIGH** — Inline-стиль на summary cards: fontSize не от scale + tabular-nums отсутствует

**Где:** `payments-section.tsx:240-272` — `<SummaryCard>` local function.

**Fix:**
- `fontSize: 24` на value → `22` (matches H2 scale).
- Add `fontVariantNumeric: 'tabular-nums'` на value div.

**Risk noted (R-7):** tabular-nums делает digits same-width; на summary card «0» и формат «1 600 ₽» рядом — currency ₽ имеет свою ширину, не digit. Визуально OK (рубль ВКЛ один symbol), но **проверить on impl mobile screenshot**.

---

### H-4. **HIGH** — Banner-explainer текст слишком длинный

**Где:** `app/teacher/payments/explainer.tsx:40-47`.

**Fix:** сократить до 2 строк:

> **Как устроен учёт оплат.** Платформа не держит деньги — ученики платят вам напрямую. Здесь — журнал: кто заплатил, кто должен, у кого заканчивается абонемент.

Tabs explainer («Ждут / Должны оплатить») вынести в tooltip-иконки `?` рядом с разделами (deferred — отдельный polish; в этой PR оставить только сокращение длины).

**Dismiss-hint contract:** `payments-section.tsx:56` использует `'teacher_payments_explainer'` hint key. Текст меняется — key остаётся; учителя, кто dismissed prior version, не увидят новую. Это **известный compromise** (не migrate hint key). Documented.

---

### H-5. **HIGH** *(owner Q-10 resolved — Variant B: ChipGroup upgrade in Epic 4 first)* — `<select>` нативный для «Способ: СБП / Другой»

> Owner 2026-06-22: ChipGroup primitive улучшается в Epic 4 (отдельный PR), затем 3 `<select>` в этой странице переезжают на ChipGroup.

**Где:** `app/teacher/payments/unpaid-learners.tsx:272-282` (channel), `feed.tsx:524-537` (refund reason), methodId.

**Fix (после Epic 4):**
- Native `<select>` channel → `<ChipGroup aria-label="Способ оплаты" value={channel} options={[{value:'sbp',label:'СБП'},{value:'other',label:'Другой'}]} disabled={busy} onChange={setChannel}>`.
- Native `<select>` refund reason → `<ChipGroup aria-label="Причина возврата" ...>` с 5 options. Epic 4 решает 375px overflow.
- methodId — variable count (1-N phone+bank pairs), оставить `<select>` styled.

**Где:** `app/teacher/payments/unpaid-learners.tsx:272-282`.

**Codex round-1 finding:** ChipGroup primitive **не поддерживает текущий contract**:
- `chip-group.tsx:31` uses `name` prop как `aria-label` (English string in code). Если передать `name="channel"` — screen reader получит «channel» (English).
- ChipGroup **не имеет `disabled` prop**. Текущий `<select>` использует `disabled={busy}` в `unpaid-learners.tsx:277`.

**Default decision (revised):** оставить styled native `<select>` для всех 3 use-sites (channel в unpaid-learners + reason в refund modal + methodId). Не trigger ChipGroup migration пока primitive не получит:
- `aria-label` prop (Russian string).
- `disabled` prop.
- 5-option overflow test на 375px.

ChipGroup upgrade — отдельная primitive-evolution PR (out-of-scope текущего ревью).

**Fix в этой PR:** ничего — оставить `<select>` styled. **Снижение severity до MED?** Нет, оставить HIGH как «known styling gap» — записано в open question Q-10.

### H-5a. **HIGH** *(new round-1)* — Native `<select>` без dark-mode styling

**Где:**
- `unpaid-learners.tsx:321-328` — `selectStyle` уже tokens. OK.
- `feed.tsx:601-611` — `inputStyle` — tokens OK, но `<select>` browser-renders option list с system colors.

**Fix:** оставить current `selectStyle`/`inputStyle` (уже tokens). Option list rendering — browser default — out-of-scope (Chrome/Safari behave differently; нужен `<Combobox>` primitive для full control). **Document как known limitation.**

---

### H-6. **HIGH** — `padding: 24` без token + section rhythm нарушен

**Где:**
- `payments-section.tsx:141` — expiring card.
- `unpaid-learners.tsx:158` — Должны оплатить card.
- `policy-editor.tsx:56` — policy card.

**Fix:**
- `padding: 24` на больших cards — OK per scale (24 разрешён). Оставить.
- `marginBottom: 24` заменить на `var(--space-section)` ИЛИ обернуть в `<section className="lc-section">`. Это даст responsive 32/24 + автоматический last-child reset.

---

### H-7. **HIGH** — Не используется `lc-section` класс на root payments `<section>`

**Где:** `payments-section.tsx:72` — `<section style={{ maxWidth: 880, margin: '0 auto' }}>`.

**Fix:** добавить `className="lc-section"`. Сравнить с `deals-section.tsx:67-94` (правильное использование).

---

### H-8. **HIGH** *(Codex round-1 fix — consumer copy)* — «Не пришло» — button label не отражает действие

**Где:** `app/teacher/payments/feed.tsx:386` + decline modal H2 `feed.tsx:438` («Не пришло»).

**Codex round-1 finding:** label «Не пришло» учит consumers в **двух местах**:
- `app/cabinet/payments/page.tsx:94` (learner explainer: «учитель сможет нажать «Не пришло»»).
- `app/saas/learn/sbp/page.tsx:93` (public SaaS FAQ: «можешь нажать «Не пришло»»).

**Если меняем — sync обновление в обоих consumers ОБЯЗАТЕЛЬНО в той же PR.**

**Fix:**
- Button «Не пришло» → «Отклонить заявку» (consistent с modal CTA).
- Modal H2 «Не пришло» → «Отклонить заявку».
- `app/cabinet/payments/page.tsx:94` — обновить explainer copy: «учитель сможет нажать «Отклонить заявку»».
- `app/saas/learn/sbp/page.tsx:93` — обновить FAQ: «можешь нажать «Отклонить заявку»».
- Альтернатива (более мягко): «Деньги не пришли». Action-clarity ниже. **Default: «Отклонить заявку»**.
- **Owner Q-1 escalation:** если owner предпочитает оставить «Не пришло» (mercy tone) — pull change целиком, не trigger consumer sync.

---

### H-9. **HIGH** — Modal styling: inline overlay без primitive

**Где:** `feed.tsx:583-599` (modalOverlay + modalCard) + 26 аналогов в репо.

**Текущая правка:** оставить inline styles, но добавить:
- `aria-describedby` на dialog (сейчас только `aria-labelledby`).
- Decline modal: одну `<p>` hint над textarea: «Этот комментарий увидит ученик» (was L-4 в initial; promoted в H).
- Refund modal: `<input type="number">` без `inputMode` (round-1 finding). Add `inputMode="decimal"` — refund поддерживает decimals (`Number(refundAmountRub) * 100` в коп; e.g. «1500.50» → 150050).
- **Modal label↔input wiring** (round-2 finding): сейчас `<label>` стоит над input БЕЗ `htmlFor`. Screen reader не связывает label с input. Fix: добавить `id` на каждый `<textarea>` / `<input>` / `<select>` + `htmlFor={id}` на матчинг `<label>`. Касается 4 inputs (decline note textarea + refund amount input + refund reason select + refund note textarea).

---

### H-11. **HIGH** *(new round-2 — owner-flagged)* — Vertical rhythm между cards непоследователен (16 → 24 → 24 mix вместо `var(--space-section)`)

**Где (gaps сверху вниз на kind=payments):**

| Переход | Текущий gap | Источник |
|---|---|---|
| `<header>` → KindRoutingCards | **16** | `page.tsx:120` header marginBottom |
| KindRoutingCards → PaymentsExplainer | **16** | `kind-routing-cards.tsx:41` nav marginBottom |
| PaymentsExplainer → SummaryCards grid | **16** | `explainer.tsx:32` wrapper marginBottom + `banner.tsx:50` Banner internal (collapse → 16) |
| SummaryCards grid → UnpaidLearners card | **24** | `payments-section.tsx:112` summary grid marginBottom |
| UnpaidLearners card → expiring card | **24** | `unpaid-learners.tsx:158` card marginBottom |
| expiring card → ClaimsFeed wrapper | **24** | `payments-section.tsx:141` expiring card marginBottom |
| ClaimsFeed wrapper → PolicyEditor card | **24** | `payments-section.tsx:202` ClaimsFeed wrapper marginBottom |
| PolicyEditor card → CSV link | **24** | sibling collapse: PolicyEditor card marginBottom 24 + CSV wrapper marginTop 24 → 24 |

**Почему HIGH:**
- `design-system.md §5.1`: `--space-section: 32px (desktop, ≥600px) / 24px (mobile, <600px)`. Все section-level gaps должны идти через `.lc-section` class ИЛИ `marginBottom: 'var(--space-section)'`. Текущие 16 (для верхних 3 переходов) — **sub-scale**, не section rhythm. 24 — OK для mobile, но **не реагирует на desktop ≥600px**.
- Желаемое (per spec): 32 на desktop, 24 на mobile, **одинаково для всех 8 переходов**. Сейчас — 16/16/16/24/24/24/24/24 mix.
- Visual: на desktop screenshot видно — после summary cards «расстояние резко увеличивается». Это симптом конфликта между sub-section (16) и section (24) ритмами в одной поверхности.

**Дополнительно — Banner double-margin redundancy:**

`explainer.tsx:32` оборачивает Banner в `<div style={{ marginBottom: 16 }}>`. Banner primitive (`banner.tsx:50`) уже имеет `marginBottom: 16`. CSS margin collapse делает effective 16 (не 32), но код **избыточный**.

**Fix (Codex round-1: Banner primitive deferred to spacing-foundation):**

Banner primitive `marginBottom: 16` removal — **в отдельной волне** (`spacing-system-foundation-2026-06-22.md` §3.3). В текущей PR оставляем primitive как есть; удаляем только redundant wrapper в explainer.

**Vertical rhythm fix (Codex round-4 + round-5 final — Опция B dropped):**

Hard pre-req: `spacing-system-foundation-2026-06-22.md` merged first. Опция B fallback removed целиком.

**Codex round-5 BLOCKER #2 fix — full layer tree:**

Текущий tree `app/teacher/lessons/page.tsx:118`:
```tsx
<main maxWidth: 980>
  <header marginBottom: 16>           // current
  <KindRoutingCards marginBottom: 16>  // current (от self)
  {panel}                              // payments-section or deals or lessons-client
</main>
```

После removal inline margins из header / KindRoutingCards / panel — top-level siblings collapse to **0 gap**. Это новый regression.

**Fix:** обернуть `<main>` content в `<div className="lc-stack-section">` (это родитель «семей» — header, nav, panel):

```tsx
<main maxWidth: 980>
  <div className="lc-stack-section">
    <header>                       // no margin
    <KindRoutingCards>             // no margin
    {panel}                        // payments-section uses internal lc-stack-card
  </div>
</main>
```

Внутри panel (payments-section.tsx) — `<section className="lc-stack-card">` (24/16) для 7 inner cards.

**Конкретные правки:**

A) Top-level (page.tsx):
- `page.tsx:118` — добавить `<div className="lc-stack-section">` wrapper.
- `page.tsx:120` header — убрать `marginBottom: 16`.
- `kind-routing-cards.tsx:41` — убрать `marginBottom: 16` (self-owned).

B) Inside payments-section.tsx:
- `payments-section.tsx:72` `<section>` — добавить `className="lc-stack-card"`.
- `payments-section.tsx:80` header — убрать `marginBottom: 24`.
- `payments-section.tsx:112` summary grid — убрать `marginBottom: 24`, gap `16` → `'var(--space-intra)'`.
- `payments-section.tsx:141` expiring card — убрать `marginBottom: 24`.
- `payments-section.tsx:202` ClaimsFeed wrapper — убрать `marginBottom: 24`.
- `payments-section.tsx:208` CSV wrapper — убрать `marginTop: 24`.

C) Inside other components:
- `unpaid-learners.tsx:158` card — убрать `marginBottom: 24`.
- `policy-editor.tsx:56` card — убрать `marginBottom: 24`.
- `explainer.tsx:32` — удалить `<div marginBottom: 16>` wrapper.

**Known limitation closed:** Banner primitive `marginBottom: 16` removal — в foundation §3.3, обязательная pre-req. После foundation merged, explainer→summary gap = 24 (от `.lc-stack-card`), а не 16+collapse.

**Verification:** mobile/desktop screenshot до/после impl должны показать единый rhythm между всеми cards. **Known limitation:** Banner primitive `marginBottom: 16` остаётся (Banner cleanup deferred); explainer→summary gap = 16 (collapsed внутри Banner), не 24. Fix позже в `spacing-banner-cleanup` epic.

---

### H-12. **HIGH** *(new round-1)* — `role="alert"` отсутствует на error `<p>`

**Где:**
- `feed.tsx:240-243` — `<p style={{ color: 'var(--danger)', ...}}>{err}</p>` без role.
- `unpaid-learners.tsx:172-176` — то же.
- `policy-editor.tsx:117-121` — то же.

**Почему HIGH:** screen reader не получает live error announce.

**Fix:** обернуть error `<p>` в `<div role="alert" aria-live="polite">{err}</div>` (info `<p>` оставить как `<p>`).

---

### M-1. **MED** — Heading «Занятия» (page H1) 24px вместо 28 (scale H1)

**Где:** `app/teacher/lessons/page.tsx:122-128`.

**Fix:** `fontSize: 28` per `design-system.md §4 --text-28`.

---

### M-2. *(REMOVED — Codex round-1)* — Empty state в ClaimsFeed

**Codex round-1:** не doc-backed нарушение. Design-system §9.5 разрешает action **ИЛИ** explanation; current empty state даёт explanation («Когда ученики отправят заявки... они появятся здесь»). Это уже соответствует контракту. Finding снят как inflated.

---

### M-3. *(REMOVED — Codex round-1)* — Кнопка «Сохранить»

**Codex round-1:** не doc-backed. `content-style.md §5.1` запрещает только `ОК/Далее/Применить` как одиночные; «Сохранить» — глагол в imperative, проходит §5.1. Finding снят как invented.

---

### M-4. **MED** — Три формулировки одного состояния

- Summary card: «Ждут подтверждения»
- Tabs: «Ждут (0)»
- Empty state: «Сейчас нет заявок»

**Fix:** унифицировать на одно имя — «Ждут подтверждения» (полное) + «Ждут» (короткое в табе). Empty state: «Заявок пока нет» (избегаем «сейчас»).
- Глоссарий в `docs/content-style.md`: «pending claim → заявка ждёт подтверждения».

---

### M-5. **MED** — CSV link → Button

**Где:** `payments-section.tsx:208-222`.

**Fix:** заменить `<a>` на `<Button variant="ghost" size="sm" href="...">Скачать CSV за 3 месяца</Button>`. «(для налоговой)» → tooltip/hint.

---

### M-6. **MED** — `«Заявка {date} · СБП»` — лишнее слово «Заявка»

**Где:** `feed.tsx:281-284`.

**Fix:** убрать «Заявка» (тип сущности понятен из таба).

---

### M-7. **MED** — При expanded mark-paid нет ссылки «выбрать всё / снять всё»

**Где:** `unpaid-learners.tsx:232-260`.

**Fix:** inline link «Снять все» / «Выбрать все» (state-aware) над списком.

---

### M-8. **MED** — Money/count nodes без tabular-nums

**Где:**
- `unpaid-learners.tsx:206`: `{pluralLessons(l.unpaidCount)} · {formatRub(l.unpaidAmount)}`.
- `feed.tsx:288`: `{formatRub(c.amountKopecks)}`.
- `payments-section.tsx:258`: SummaryCard value (covered by H-3).

**Fix:** добавить `fontVariantNumeric: 'tabular-nums'` на money-bearing nodes.

---

### M-9. **MED** — Status pills «Ждёт подтверждения» слишком длинный label

**Где:** `feed.tsx:33-44` — `statusPill()` returns labels.

**Fix:**
- «Ждёт подтверждения» → «Ждёт».
- «Отменено учеником» → «Отменено».

---

### L-1. **LOW** — `KindRoutingCards` на mobile занимает 3 строки subtitle

**Где:** `kind-routing-cards.tsx:38-43`.

**Fix:** на mobile (< 600px) — `minHeight 64 → 48` через media query ИЛИ убрать subtitle на mobile.

---

### L-2. **LOW** — Mobile spacing summary cards — OK (documented для полноты)

---

### L-3. **LOW** — В expanded view нет separator между slot list и controls

**Где:** `unpaid-learners.tsx:261-310`.

**Fix:** `borderTop: '1px solid var(--border)'` для visual separation.

---

### L-4. **LOW** *(removed — promoted to H-9)*

---

### L-5. **LOW** — Pluralization currency formatting — OK (documented)

---

### L-6. **LOW** *(Codex round-1 fix — not isolated)* — `← на главную` link — family-wide pattern

**Где:**
- `page.tsx:140-144` (kind=payments path).
- `components/teacher/lessons/lesson-history-client.tsx:321-324` (kind=lessons / default path).
- Возможно DealsSection (если есть тот же footer link — grep подтверждает что в `deals-section.tsx` нет).

**Codex round-1:** не isolated single hit — family-wide pattern в `/teacher/lessons`. Удаление в одном файле создаёт inconsistency.

**Fix:**
- **Опция A (default):** удалить в обоих файлах (`page.tsx` + `lesson-history-client.tsx`). Bottom-nav (mobile) + sidebar (desktop) дают same affordance.
- **Опция B:** оставить как есть — family pattern; удаление эпиком позже.

**Default: Опция A** (удалить в обоих). Sweep исчерпывающий, sibling-consistent.

---

### I-1. **INFO** *(new round-1)* — PaymentsSection full-empty сценарий не описан

(see below — I-1 → I-4)

---

### H-13. **HIGH** *(new Codex round-1)* — KindRoutingCards uses legacy `var(--surface)` + raw rgba

**Где:** `components/teacher/lessons/kind-routing-cards.tsx:91-92`:

```tsx
background: active
  ? 'var(--accent-soft, rgba(80, 130, 255, 0.06))'
  : 'var(--surface)',
```

**Codex round-1 finding (not in initial plan):**
- `var(--surface)` — design-system §3.1 marked as **LEGACY** (line 53): «Не использовать в новом коде — оставлено для лендинга».
- `rgba(80, 130, 255, 0.06)` — raw hardcoded color, нарушает §10.5 (Hardcoded цвета).
- `var(--accent-soft, ...)` fallback на raw rgba — token `--accent-soft` отсутствует в globals.css? Нужно проверить.

**Fix:**
- `var(--surface)` → `var(--surface-1)` (per design-system §3.1 cabinet dark stack).
- Active fill: `var(--accent-bg)` (existing token `rgba(216,138,130,0.10)` — design-system §3.4) ИЛИ `var(--accent-bg-strong)` для усиленного state (B-5).
- Удалить raw rgba fallback.

**Verification:** grep `--accent-soft` в globals.css. Если нет — token undefined, current code использует fallback raw rgba (silent legacy).

Если 0 unpaid + 0 expiring + 0 claims + 0 history → учитель видит explainer + summary 0/0 + empty state «Сейчас нет заявок» + policy + CSV. Это **OK** — fall-through есть. Documented для полноты.

---

### I-2. **INFO** *(new round-1)* — focus-management при open expand не реализован

Нет focus jump на первый checkbox после раскрытия. UX/a11y polish — defer.

---

### I-3. **INFO** *(new round-1)* — design-system §11 doc-drift «ты vs вы»

`docs/design-system.md` §11 говорит «К учителю — на «ты»». `docs/content-style.md` §2 говорит «всегда «вы»». Код использует «вы» (already aligned с content-style; content-style.md `Authority: this guide wins on conflict`).

**Action:** в этой же PR обновить `docs/design-system.md` §11 — заменить «К учителю — на «ты»» на «К учителю и ученику — на «вы»». Однострочная правка.

---

### I-4. **INFO** *(new round-1)* — Decline/refund modal content fixes

- Decline modal H2 «Не пришло» → «Отклонить заявку» (covered by H-8).
- Decline modal hint над textarea (covered by H-9).
- Refund modal `inputMode="numeric"` (covered by H-9).
- Refund modal H2 «Оформить возврат» — OK.
- Refund modal `<p>` disclaimer — OK.

---

---

## 3. Spacing system enforcement (Stage 1 — FORKED OUT)

> **Codex paranoia round-1 BLOCKER:** scope creep — page-review plan превратился в repo-wide spacing migration. Forked в `docs/plans/spacing-system-foundation-2026-06-22.md`.
>
> Текущий page review **hard-depends** на spacing foundation: foundation merged first → page review consume'ит classes. Опция B (параллельный ship с inline tokens) **dropped** per Codex round-4/5 — нет fallback.

**Full spec** на foundation — `docs/plans/spacing-system-foundation-2026-06-22.md` (tokens + classes + AGENTS rule + Banner cleanup + LEARNINGS candidate).

---

## 3.1 Out-of-scope (НЕ делаем в этом ревью)

- **Modal primitive рефакторинг** (27 файлов). Отдельный эпик `cabinet-modal-primitive`.
- **Tabs primitive экстракция** в `components/ui/primitives/`.
- **Payment business logic.**
- **API contracts** (`/api/teacher/payment-claims/*`). Кроме B-1.
- **Прод data.**
- **CloudPayments / SBP integration.**
- **Keyboard arrow nav для tabs** (deferred a11y polish).
- **Focus-management для expand** (deferred a11y polish).
- **`<Combobox>` для refund reason** — попробуем оставить styled `<select>`; если визуально неприятно, отдельная итерация.
- **Tabs explainer tooltip-иконки `?`** — отдельная итерация.

---

## 4. Remediation scope + split

> **Self-review round 1 finding:** изначальный план 29 fixes × 7 files в одной PR превышает AGENTS.md §0 порог («жирный эпик >5 файлов или >500 строк → дроби на sub-PR в одном эпике»). Split на 2 sub-PR + 1 epic-close PR.

**Epic name:** `teacher-payments-design-polish-2026-06-22`.

### 4.1 PR-1a — Correctness + a11y (Codex round-2 split)

> Codex round-2 WARN #5 — original PR-1 12 файлов слишком жирная mix correctness/a11y/copy/spacing. Split.

**Files (6 edits + 3 new = 9 total touch):**

Edits (6):
- `lib/payments/sbp-claims.ts` (B-1 helper label)
- `app/teacher/payments/unpaid-learners.tsx` (B-2 sum preview; H-5 acknowledge styled-select)
- `app/teacher/payments/feed.tsx` (B-3 tabs ARIA, H-9 modal a11y, H-12 role=alert)
- `app/teacher/payments/policy-editor.tsx` (B-4 Checkbox primitive, H-12 role=alert)
- `tests/payments/teacher-feed-prop-resync.test.tsx` (B-3 selector migration)
- `evals/PRODUCT_FLOWS.md` (FLOW-TEACHER-PAYMENTS-001 row append to existing section D)

New (3):
- `tests/api/teacher/payment-claims-unpaid-slots.test.ts` (B-1 route serialization)
- `tests/payments/sbp-claims-unpaid-label.test.ts` (B-1 helper)
- `tests/e2e/teacher-payments.spec.ts` (E2E)

**Hard pre-req:** `spacing-system-foundation-2026-06-22.md` PR merged first (B-4 Checkbox primitive migration depends on §3.6 focus-visible fix; нет fallback Опция B для PR-1a).

**Trailer (per CLAUDE.md §Two-checkpoint paranoia pipeline):**
```
Codex-Paranoia: SUB-WAVE self-reviewed (epic teacher-payments-design-polish-2026-06-22); epic-end review pending
```

### 4.1b PR-1b — Copy + spacing + tokens

**Файлы (6 edits):**
- `app/teacher/payments/explainer.tsx` (только redundant wrapper cleanup — H-4 text change pulled per owner Q-2)
- `app/teacher/lessons/page.tsx` (H-1 local subtitle map; H-11 top-level `.lc-stack-section` wrapper)
- `components/teacher/lessons/payments-section.tsx` (H-2, H-3, H-6, H-7, H-11 `.lc-stack-card`)
- `components/teacher/lessons/kind-routing-cards.tsx` (B-5 tabs ARIA, H-11 marginBottom removal, H-13 legacy tokens)
- ~~`app/cabinet/payments/page.tsx`~~ (H-8 pulled per owner Q-1)
- ~~`app/saas/learn/sbp/page.tsx`~~ (H-8 pulled per owner Q-1)

E2E spec и PRODUCT_FLOWS row — целиком в PR-1a, **PR-1b их не трогает**.

**Hard pre-req:** `spacing-system-foundation-2026-06-22.md` merged first (H-11 vertical rhythm uses `.lc-stack-card` classes; Опция B fallback dropped per Codex round-4).

**Trailer:** same SUB-WAVE format as PR-1a.

### 4.2 PR-2 — MED + LOW polish

**Файлы (8 edits — Codex round-8 ownership corrected):**
- `app/teacher/lessons/page.tsx` (M-1 page H1 28px; L-6 footer link удаление)
- `components/teacher/lessons/payments-section.tsx` (M-5 CSV button)
- `app/teacher/payments/feed.tsx` (M-4 unified copy; M-6 «Заявка» убрано; M-9 status pill labels сокращены)
- `app/teacher/payments/unpaid-learners.tsx` (M-7 select-all link; M-8 tabular-nums)
- `components/teacher/lessons/kind-routing-cards.tsx` (L-1 mobile minHeight)
- `components/teacher/lessons/lesson-history-client.tsx` (L-6 sibling consistency)
- `docs/design-system.md` (I-3 doc-drift §11 «ты/вы»)
- `docs/content-style.md` (M-4 глоссарий)

**Removed from PR-2** (Codex round-1): M-3 (invented).

**Trailer:** same as PR-1, sub-PR-2.

### 4.3 PR-3 — Epic-close (deferred items + doc sweep + ASK gate)

После всех sub-PRs merged → epic-end checkpoint:

1. Run `/codex-paranoia wave <epic-commit-range>` на агрегированном diff.
2. Если BLOCKER surfaces — follow-up fix-PR.
3. `/document-release` final sweep на агрегате.

**Epic-close PR trailer (per CLAUDE.md):**
```
Codex-Paranoia: SIGN-OFF round N/3 (epic-end on <commit-range>)
```

Если PR-3 пустой (sweep clean) — этот trailer ставится на последнюю sub-PR (PR-1b или PR-2) как часть epic-close.

---

## 5. Verification plan

### 5.1 Automated tests

- `npm run test:run` — green.
- `npm run check:content-style` — обязательно (copy changes).
- `npm run check:env-contract` — не задето.
- `npm run build` — typecheck + Next build.
- `npm run test:integration` (Docker Postgres) — если задеваем `unpaid-slots` endpoint.
- `tests/payments/teacher-feed-prop-resync.test.tsx` — selector migration обязательна в PR-1.

### 5.2 Manual visual (playwright MCP)

После имплементации:
- desktop 1440×900 — full page + expanded «Должны оплатить» + open decline modal + open refund modal.
- mobile 375×812 — same.
- mobile 360×800 (Android) — sanity.

### 5.3 Acceptance checklist (PR-1a — correctness + a11y)

**Hard pre-req:** `spacing-system-foundation-2026-06-22.md` merged first.

**PR-1a owns ONLY (Codex round-4 ownership):**
- [ ] B-1: `booked`/`completed`/`no_show_learner`/`cancelled` не видны учителю. Helper unit test + route serialization test asserts.
- [ ] B-2: кнопка «Отметить оплачено» показывает сумму до клика.
- [ ] B-3: feed-tabs `role="tablist"` + `role="tab"` + `aria-selected`. БЕЗ `aria-controls`/`tabpanel`. Test selector migration.
- [ ] B-4: `<Checkbox>` primitive в `policy-editor.tsx` (только). Slot-toggle native сохраняется.
- [ ] H-5: 3 `<select>` (channel + refund reason) → `<ChipGroup>` (после Epic 4 ChipGroup upgrade merged). methodId остаётся `<select>` styled.
- [ ] H-9: `aria-describedby` + textarea hint + `inputMode="decimal"` + `<label htmlFor>` 4 inputs.
- [ ] H-12: error `<p>` обёрнуты в `<div role="alert" aria-live="polite">{err}</div>` в 3 файлах (feed/unpaid-learners/policy-editor). Info `<p>` остаются как есть.
- [ ] **E2E**: `tests/e2e/teacher-payments.spec.ts` создан + green в CI.
- [ ] **evals**: `FLOW-TEACHER-PAYMENTS-001` row в `evals/PRODUCT_FLOWS.md`.

### 5.4 Acceptance checklist (PR-1b — copy + spacing + tokens)

**Hard pre-req:** PR-1a merged + foundation merged.

- [ ] H-1: subtitle local const в `page.tsx`.
- [ ] H-2: 3 подсекции на h3 + fontSize 17.
- [ ] H-3: summary value 22px + tabular-nums.
- [ ] H-4: banner text **остаётся как есть** (owner Q-2 pulled); только wrapper `<div marginBottom: 16>` в `explainer.tsx:32` удалён (spacing fix).
- [ ] H-6/H-7: section rhythm tokens применены.
- [ ] H-8: **pulled** (owner Q-1) — «Не пришло» остаётся. Consumer files (`cabinet/payments`, `saas/learn/sbp`) НЕ трогаем.
- [ ] H-11: 7 cards → `.lc-stack-card` parent; inline marginBottom удалён.
- [ ] B-5: kind-routing-cards `role="tab"` + `aria-selected` + усиленный active state.
- [ ] H-13: `var(--surface)` → `var(--surface-1)`; raw rgba → `var(--accent-bg)`.

### 5.5 Acceptance checklist (PR-2)

- [ ] M-1: page H1 28px.
- [ ] M-4: copy unified + глоссарий в content-style.md.
- [ ] M-5: CSV → Button.
- [ ] M-6: «Заявка» убрано.
- [ ] M-7: «Снять все/Выбрать все» link.
- [ ] M-8: tabular-nums на money/count.
- [ ] M-9: status pill labels сокращены.
- [ ] L-1: mobile minHeight уменьшен.
- [ ] L-3: separator в expanded view.
- [ ] L-6: «← на главную» удалён в **обоих** `page.tsx` + `lesson-history-client.tsx` (family-wide consistency).
- [ ] I-3: design-system §11 обновлён.

**Removed from PR-2** (Codex round-1): M-2 (not doc-backed — empty state explanation already complies §9.5), M-3 (not doc-backed — «Сохранить» проходит §5.1).

---

## 6. Risks

- **R-1.** Замена label на endpoint `unpaid-slots` — 1 consumer chain verified (`route.ts` → `listUnpaidSlotsForPair` → `unpaid-learners.tsx`). Safe. **Coverage:** helper unit test + route serialization test добавлены в PR-1.
- **R-2.** ChipGroup для всех 3 use-sites — **deflected** (primitive не готов). Оставляем styled `<select>`. ChipGroup upgrade — отдельный primitive-evolution PR.
- **R-3.** Heading downgrade `<h2>` → `<h3>` — grep tests подтвердил **нет hits** на «Должны оплатить» / «Политика по неоплаченным». Safe.
- **R-4.** Checkbox primitive — controlled mode используется уже (`useState`); migration сводится к replace shape.
- **R-5.** Subtitle меняется по kind → SEO OK (`robots: { index: false }`).
- **R-6.** *(new round-1)* `getByRole('button', { name: /История/ })` в test → migration на `getByRole('tab', ...)` обязательна в PR-1.
- **R-7.** *(new round-1)* tabular-nums на summary cards — visual sanity check на mobile screenshot в impl PR.
- **R-8.** *(new round-1)* `<select>` browser-renders option list — known limitation, не блокер.
- **R-9.** *(new round-1)* Dismiss-hint `'teacher_payments_explainer'` key reuse при изменении text — учителя кто dismissed prior не увидят новый text. Compromise documented.
- **R-10.** *(Codex round-1)* H-8 «Не пришло» → «Отклонить заявку» — consumer copy в `app/cabinet/payments/page.tsx:94` + `app/saas/learn/sbp/page.tsx:93` обновляется в той же PR. **Если owner override — pull change целиком, не trigger consumer sync.**
- **R-11.** *(Codex round-1)* B-4 Checkbox primitive focus-visible — pre-req CSS fix в primitive. Если не делаем — keyboard UX regression vs native checkboxes.
- **R-12.** *(Codex round-1)* B-4 slot-row hit area — миграция на Checkbox primitive ломает row-wide click target. **Решение:** оставить native checkbox для slot rows; Checkbox primitive только в policy-editor.
- **R-13.** *(Codex round-1)* L-6 удаление footer link в обоих файлах. Sibling consistency mandatory.

---

## 7. Open questions

- **Q-1.** *(RESOLVED owner 2026-06-22)* Оставить «Не пришло» (mercy tone). H-8 **pulled** — no rename. Consumer files (`app/cabinet/payments/page.tsx`, `app/saas/learn/sbp/page.tsx`) НЕ трогаем.
- **Q-2.** *(RESOLVED owner 2026-06-22)* Banner-explainer оставить как есть (5 строк). H-4 **pulled** — no text changes. Redundant wrapper `<div marginBottom: 16>` в `explainer.tsx:32` всё ещё удаляется (это spacing fix, не copy).
- **Q-3.** *(RESOLVED Codex round-1 + round-2)* KindRoutingCards → `role="tab"` + `aria-selected` pattern, без `aria-controls` (page renders one panel). ChipGroup migration отдельным PR (Q-10). aria-current отвергнут — это tabs не navigation.
- **Q-4.** *(RESOLVED owner 2026-06-22)* B-1 — **Variant B**: добавить русские `statusLabel` мапу + рендерить как `<Pill tone="default">`. Map: `booked → 'запланировано'`, `completed → 'прошло'`, `no_show_learner → 'не пришёл'`, `cancelled → 'отменено'`.
- **Q-5.** *(RESOLVED owner 2026-06-22)* Split на 3 PR (default — PR-1a + PR-1b + PR-2).
- **Q-6.** *(forked to spacing-foundation plan)* Banner primitive `marginBottom: 16` removal — теперь в `spacing-system-foundation-2026-06-22.md` §3.3.
- **Q-7..Q-9.** *(forked to spacing-foundation plan)* class names / Stage 2 timeline / LEARNINGS promotion — теперь в spacing foundation plan §8.
- **Q-10.** *(RESOLVED owner 2026-06-22)* **Variant B**: ChipGroup primitive upgrade — **Epic 4** становится pre-req для Epic 2 PR-1a (где H-5 заменяет 3 `<select>` на ChipGroup). Epic 4 шипается между Epic 1 и Epic 2.
- **Q-11.** *(new Codex round-1)* Checkbox primitive focus-visible — fix в spacing-foundation PR (стиль primitive) или в этом PR (page review)? **Default: в spacing-foundation** (primitive evolution group).
- **Q-12.** *(RESOLVED Codex round-4/5)* Spacing foundation merged first — hard pre-req. Опция B (parallel ship) dropped.

---

## 8. Sources

- Live screenshots: `teacher-lessons-payments-desktop-1440.png`, `teacher-lessons-payments-mobile-375.png`, `teacher-lessons-payments-mark-paid-expanded-1440.png`, `teacher-lessons-payments-mobile-expanded-375.png`.
- Files reviewed: список в § 0.
- Reference contracts: `docs/design-system.md`, `docs/content-style.md`.
- Codex paranoia attempt log: `/tmp/codex-paranoia-20260622T071117Z/round-1.md` (model unavailable error documented; fallback to self-review per SKILL §7).

---

## 9. Sign-off

**Codex paranoia rounds applied** (cap-exceeded — owner-authorized 2026-06-22):

| Round | Outcome | BLOCKER | WARN | Disposition |
|---|---|---|---|---|
| 1 | BLOCK | 2 | 10 | Fixes applied: forked §3a → foundation plan; Banner deferred; ChipGroup deferred; B-5 → role=tab; new H-13; M-2/M-3 removed; H-1 location; B-1 verification |
| 2 | BLOCK | 2 | 4 | Fixes: Checkbox owner → foundation §3.6; E2E same-wave; aria-controls dropped; Q-3 RESOLVED; PR-1 split 1a/1b |
| 3 | BLOCK | 1 | 5 | Fixes (inline): B-3 acceptance row sync; evals row full schema; E2E scope tightened; Banner inventory named |
| 4 | BLOCK | 2 | 4 | Fixes: trailer contract SUB-WAVE; Опция B dropped; full PRODUCT_FLOWS schema; PR-1a/1b acceptance split; status block rewritten |
| 5 | BLOCK | 2 | 3 | Fixes: Checkbox CSS selector → `:focus-within`; H-11 added `.lc-stack-section` для top-level siblings; Опция B references removed; PRODUCT_FLOWS section D not H; count discrepancies |
| 6 | BLOCK | 2 | 3 | Fixes: foundation final Опция B residuals; Banner inventory 21/13 (was 17/10 — multiline opens missed); PR-1a header count corrected; Checkbox verification jsdom-aware; status sync |
| 7 | BLOCK | 1 | 4 | Fixes: foundation §3.3 sweep workflow command corrected (no trailing space); §6.4 stale "17" → "21/13"; Checkbox focus ring verification → existing use-site (not policy-editor); H-12 wrap shape sync; H-11 stale «Banner not updated» removed; placeholder line cleanup |
| 8 | **SIGN-OFF** | 0 | 4 + 1 | Fresh pass clean. Remaining WARN/INFO applied post-SIGN-OFF: header status sync; PR-2 file mapping fix (M-1/M-9 ownership); H-5 demoted to known-limitation; F-2 stale «15+» → «21»; duplicate `## 3` heading renumbered. |

**Trailers (per CLAUDE.md §Two-checkpoint paranoia pipeline):**
- Sub-PRs (PR-1a / PR-1b / PR-2): `Codex-Paranoia: SUB-WAVE self-reviewed (epic teacher-payments-design-polish-2026-06-22); epic-end review pending`
- Epic-close PR (после `/codex-paranoia wave`): `Codex-Paranoia: SIGN-OFF round N/3 (epic-end on <commit-range>)`

**Implementation start blocked on:**
1. Foundation plan SIGN-OFF + merged first.
2. Owner sign-off on Q-1..Q-12.
3. Codex round 7 SIGN-OFF (round 8 fresh pass).
