---
title: Package issuance UX — выдача пакетов и тарифов ученикам (v2 после R1-R3 self-review)
status: PLAN
date: 2026-06-10
owner: ivankhanaev
author: Claude
skill-used: claude-code-frontend-design (design-system-architect + form-designer + mobile-specialist + onboarding-specialist + accessibility-specialist + b2b-saas-specialist)
supersedes: docs/plans/package-issuance-ux-2026-06-10.md (v1)
---

# Package issuance UX — выдача пакетов и тарифов ученикам (v2)

## 0. Что нашёл (root-cause)

### 0.1 Главный баг

**API готов, UI отсутствует.** Endpoints `POST /api/teacher/packages/[id]/issue` (выдача пакета) и `POST /api/teacher/tariffs/[id]/access` (доступ к тарифу) **существуют и работают**, но **ни один UI-компонент их не дёргает**.

```
$ grep -rn "/api/teacher/packages.*issue\|/api/teacher/tariffs.*access" components/ app/teacher/
(пусто)
```

### 0.2 Дополнительный пробел

На карточке ученика (`/teacher/learners/[id]`) есть только переключатель **способа оплаты**, но НЕТ секций «активные пакеты», «доступ к тарифам» и CTA для выдачи/открытия доступа.

### 0.3 Тарифы в карточке ученика (ответ владельцу)

Сейчас секция отсутствует. Backend готов (`lib/billing/learner-tariff-access.ts` + endpoint от 2026-06-01). Закрывается этим же планом — §3.3.

---

## 1. Бизнес-цель + activation-funnel

«Job-to-be-done»: «Я создал пакет «10 уроков». Кому из учеников его выдать?» Сейчас продукт молчит → учитель теряется.

**Activation funnel (target):**
1. `created_package` → 100%
2. `saw_post_create_nudge` (Banner показан) → 100%
3. `clicked_issue_cta` (клик на «Выдать ученикам») → **≥40%**
4. `opened_issue_modal` → ~100% от прошлой
5. `issued_package` → **≥60% от opened**
6. `teacher_package_first_issue` (per-account один раз) → **активационный milestone**

---

## 2. Информационная архитектура

```
/teacher/packages           — каталог пакетов
  └── tile «10 уроков»
       ├── ··· (DropdownMenu)
       │    ├── Выдать ученику      ← NEW (через IssueModal)
       │    └── Архивировать
       ├── footer: «Выдан 3 ученикам»  ← NEW (S-2)
       └── после успешного create → <Banner tone="success" sticky>
            «Пакет создан · [Выдать ученикам →]»

/teacher/tariffs            — каталог тарифов (симметрично)
  └── tile «60 мин · 1 600 ₽»
       ├── ··· (DropdownMenu)
       │    ├── Открыть доступ ученикам ← NEW
       │    └── Архивировать
       └── после create → тот же Banner-паттерн «Открыть доступ →»

/teacher/learners/[id]      — карточка ученика
  ├── Способ оплаты (есть)
  ├── 🆕 Пакеты этого ученика
  │    ├── collapsed-by-default на mobile, counter «Пакеты (2)»
  │    ├── активные purchase'ы (карточки с remaining/expires)
  │    └── <Button fullWidth>+ Выдать пакет</Button>
  └── 🆕 Доступ к тарифам
       ├── collapsed-by-default на mobile, counter «Тарифы (1)»
       ├── открытые доступы (карточки с amount snapshot)
       └── <Button fullWidth>+ Открыть доступ</Button>
```

---

## 3. Поверхности (UI)

### 3.1 Каталог `/teacher/packages` — выдача из плитки

**Меню `···` на плитке:**
- «Выдать ученику» → открывает `IssuePackageModal` с `packageId={p.id}`
- «Архивировать» → существующее действие

Если пакет архивный (`isActive === false`) — пункт «Выдать ученику» скрыт (backend всё равно вернёт 422).

**Footer плитки:** одна строка серого текста: `Выдан N ученикам` (S-2). Источник — SQL `count(distinct account_id) where revoked_at is null and expires_at > now()`. Если 0 — текст «Никому не выдан».

### 3.2 Onboarding nudge после create

После успешного `POST /api/teacher/packages`:

- Вместо custom toast — **рендерим `<Banner tone="success">`** inline над списком пакетов (см. DS §9.4 Banner primitive)
- Содержит: основной текст `Пакет «{titleRu}» создан` + CTA `<Button variant="primary" size="sm">Выдать ученикам →</Button>` + close-X
- Banner живёт до dismiss или follow-CTA или route change

Branches (OB-2):
- Если `learnersCount > 0` → CTA «Выдать ученикам →» открывает IssueModal (без preselected learner)
- Если `learnersCount === 0` → текст меняется на `Пакет создан. Пригласите ученика, чтобы выдать.` + CTA `<Button>Пригласить →</Button>` ведёт на `/teacher/learners` с открытым invite-модалом

ARIA: Banner с `role="status"` + `aria-live="polite"`.

Симметрично §3.4 для тарифов.

### 3.3 Карточка ученика — секции «Пакеты» и «Доступ к тарифам»

Между «Способ оплаты» и «Журнал занятий» добавляются 2 секции.

**Layout:**
- `<Card>` (border-radius 12, padding 20, gap 12)
- На mobile <640px: collapsed-by-default. Header с counter — `<button aria-expanded>` для раскрытия. Анимация chevron + height (200ms ease-out).
- На desktop ≥640px: всегда expanded.
- Empty state: `<EmptyState title="..." body="..." cta={<Button>...</Button>} />` (DS §9.5 примитив)

**Секция «Пакеты этого ученика»:**

```
┌──────────────────────────────────────────────┐
│  Пакеты (2)                                   │
│  ──────────                                   │
│  ┌──────────────────────────────────────┐    │
│  │ 10 уроков           7 из 10 осталось │    │
│  │ до 1 сент 2026 · выдан 1 июня         │    │
│  │ [Отозвать]                            │    │
│  └──────────────────────────────────────┘    │
│                                              │
│  <Button fullWidth variant="secondary">     │
│    + Выдать пакет                            │
│  </Button>                                   │
└──────────────────────────────────────────────┘
```

Empty (для `<EmptyState>`):
- title: `Пакетов пока нет`
- body: `Выдайте пакет, чтобы ученик мог записываться на занятия по предоплате.`
- cta: `<Button>+ Выдать пакет</Button>` (если у учителя ≥1 пакет) ИЛИ `<Button href="/teacher/packages">Создать пакет →</Button>` (если каталог пуст)

Все числа — `tabular-nums`. «Выдан N ученикам» / «N из M осталось» / `R₽` — через `formatRub()` helper.

**Секция «Доступ к тарифам»** — симметрично, с теми же правилами.

### 3.4 Каталог `/teacher/tariffs` — симметрично §3.1+3.2

Те же паттерны: `···` меню на плитке + Banner после create. CTA — «Открыть доступ ученикам →» / open `GrantTariffAccessModal`.

### 3.5 Модал «Выдать пакет ученику» (IssuePackageModal)

**Chrome:** centered modal ≥640px, bottom-sheet <640px. Та же `sheetStyle` chrome что у `BulkAddSlotsModal` (M-2).

**Forma:**
```
┌─────────────────────────────────────────────┐
│  Выдать «10 уроков»                  ×      │
├─────────────────────────────────────────────┤
│  Ученик                                     │
│  <Combobox value={learnerId} options=...>   │
│                                             │
│  Заметка (необязательно)                    │
│  <textarea maxLength={500}>                 │
│                                             │
│  □ Разрешить стэкинг с активным пакетом    │
│    (по умолчанию выключено)                 │
│                                             │
│  <Banner tone="danger" alert>error</Banner> │
│                                             │
│  [<Button secondary>Отмена</Button>]        │
│  [<Button primary loading={busy}>Выдать</Button>] │
└─────────────────────────────────────────────┘
```

**Validation (FD-1):**
- `learnerAccountId` required → проверка на submit; кнопка disabled пока не выбран
- Стэкинг — checkbox (M-6: пока нативный input + accentColor; миграция на DS-Checkbox в Phase F если будет создан)

**Error states (S-1):**
- `package_inactive` (422) — модал отображает Banner: «Этот пакет архивирован. Активируйте его в каталоге.» + кнопка отключена
- `already_owns_active_package` (409) — Banner: «У ученика уже есть активный пакет той же длительности. Включите стэкинг ниже или отмените.» — чекбокс highlight через `var(--accent)` border
- `learner_not_linked` (403) — Banner: «Ученик не привязан к вашему учителю.» + CTA `<Button>Пригласить ученика →</Button>` к `/teacher/learners`
- `learner_account_missing` (404) — Banner: «Учётная запись ученика не найдена.» + close модал кнопка

ARIA для Banner-ошибки: `role="alert"` + `aria-live="assertive"`.

**Focus management (A11Y-1):**
- `useEffect` при open: ставит focus на Combobox
- `useEffect` cleanup при close: возвращает focus на trigger button через ref
- ESC закрывает модал
- Trap focus внутри (для desktop modal)

**Touch targets (A11Y-4):**
- Все интерактивные элементы `minHeight: 44`
- На mobile bottom-sheet кнопки full-width (M-3)

### 3.6 Модал «Открыть доступ к тарифу» (GrantTariffAccessModal)

Симметрично §3.5. Поля: Ученик + Заметка. Стэкинг irrelevant (один доступ — он или есть, или нет).

---

## 4. Технические компоненты

### 4.1 Новые React-компоненты

| Компонент | Путь | Зависит от |
|---|---|---|
| `<Combobox>` (Phase A.0) | `components/ui/primitives/combobox.tsx` | DS-A1 |
| `IssuePackageModal` | `components/teacher/pricing/issue-package-modal.tsx` | `<Combobox>`, `<Button>`, `<Banner>` |
| `GrantTariffAccessModal` | `components/teacher/pricing/grant-tariff-access-modal.tsx` | то же |
| `LearnerPackagesSection` | `components/teacher/learners/learner-packages-section.tsx` | `<Card>`, `<EmptyState>`, `<Button>` |
| `LearnerTariffAccessSection` | `components/teacher/learners/learner-tariff-access-section.tsx` | то же |
| `PostCreateNudgeBanner` | `components/teacher/pricing/post-create-nudge-banner.tsx` | `<Banner>`, `<Button>` (DS-9, OB-1) |
| `CatalogTileActionsMenu` | `components/teacher/pricing/catalog-tile-actions-menu.tsx` | DropdownMenu (вместо вызовов inline) |

### 4.1.1 Расширение DS — `<Combobox>` (DS-A1)

**Новый primitive.** API:

```tsx
<Combobox<TOption>
  value={value}
  onChange={setValue}
  options={options}        // Array<{ value: string; label: string; sub?: string }>
  getLabel={(o) => o.label}
  getValue={(o) => o.value}
  placeholder="Выберите ученика"
  emptyMessage="Никого не найдено"
  searchable={true}
  loading={busy}
  disabled={false}
  size="md"
/>
```

**Поведение:**
- Mobile <600px → tap открывает full-screen sheet с list + search-input (как `TimePickerSheet`).
- Desktop ≥600px → click открывает inline dropdown под trigger. Width = trigger width.
- Keyboard: ↑/↓ навигация по options, Enter — select, Esc — close, type-ahead для поиска.
- ARIA: `role="combobox"` на trigger, `aria-expanded`, `aria-controls`, `aria-activedescendant` на focused option, options с `role="option"`.

Composable variants: `<Combobox.Empty>` / `<Combobox.Loading>` если нужны. (По skill design-system-architect §composition.)

### 4.1.2 Checkbox — pragmatic path (M-6)

В этом PR используем нативный `<input type="checkbox">` со стилизацией `accentColor: var(--accent)` + label. **Создание `<Checkbox>` примитива — отдельный PR**, упомянуто в §11 roadmap.

### 4.1.3 Form validation rules (FD-1)

| Поле | Required | Validate | Error placement |
|---|---|---|---|
| `learnerAccountId` (Combobox) | yes | on submit | Banner внизу + disabled submit |
| `reason` (textarea) | no | максдлина 500 на submit | inline counter «N/500» |
| `allowStacking` (checkbox) | no | n/a | n/a |

`<Button primary>` показывает `loading={busy}` (FD-3).

### 4.2 Backend helpers (без новых routes)

| Helper | Файл | SQL |
|---|---|---|
| `listLearnerPackagesByTeacher(teacherId, learnerId)` | `lib/billing/packages/purchases.ts` | `select pp.*, count_initial - consumed as remaining from package_purchases pp where account_id = $1 and lesson_packages.teacher_id = $2 and revoked_at is null and expires_at > now()` |
| `listLearnerTariffAccessByTeacher(teacherId, learnerId)` | `lib/billing/learner-tariff-access.ts` | `select ... from learner_tariff_access where learner_account_id = $1 and teacher_id = $2 and revoked_at is null` |
| `listTeacherLearnersForPicker(teacherId)` | `lib/teacher/learners.ts` | `select id, display_name, email from accounts where ... order by display_name limit 100` (тонкий shape для Combobox) |
| `countDistinctLearnersOfPackage(packageId)` | `lib/billing/packages/purchases.ts` | для footer плитки §3.1 |

### 4.3 API endpoints — все готовы

Без новых endpoint'ов:
- `POST /api/teacher/packages/[id]/issue` ✅
- `POST /api/teacher/tariffs/[id]/access` ✅
- `DELETE /api/teacher/packages/[id]/revoke` ✅
- `DELETE /api/teacher/tariffs/[id]/access?learnerId=X` ✅
- `GET /api/teacher/learners` — **проверить**. Если только SSR-rendered — пробрасываем список как embedded JSON-prop в каталог-страницы и в карточку ученика (R3 решение, чтобы не плодить endpoint).

---

## 5. UX-детали (consolidated с консультаций R1-R2)

### 5.1 Анимация (DS-5)

- Модал enter: 200ms `cubic-bezier(0.16, 1, 0.3, 1)` (DS §8)
- Banner enter: fade+slide-down 200ms ease-out
- Section collapse/expand на mobile: 200ms ease-out
- `prefers-reduced-motion: reduce` → все animations instant

### 5.2 Empty states

Все 3 — через `<EmptyState>` primitive (DS-3). Title + body + CTA. Никаких «No data» (DS §2.8).

### 5.3 Mobile-first behavior (M-1, M-2, M-3)

- Модал — bottom-sheet на <640px, centered ≥640px (та же media-query что в `BulkAddSlotsModal`)
- Секции — collapsed по умолчанию на mobile
- CTA в empty state — `fullWidth`
- Touch targets ≥44px

### 5.4 Числа и форматирование (DS-4)

- Все цены и счётчики — `formatRub()` helper из `lib/billing/format.ts` (или новый, если нет)
- `fontVariantNumeric: 'tabular-nums'` на любых dynamic-meanings числах
- Дата выдачи / истечения через `formatDayYmdRu()`

### 5.5 Аналитика (B2B-1)

Минимум events (registry в `lib/analytics/registry.ts`):
- `teacher_package_create_succeeded` (есть)
- `teacher_package_post_create_nudge_shown` ← новый
- `teacher_package_issue_modal_opened` ← новый
- `teacher_package_issue_modal_closed_without_action` ← новый
- `teacher_package_issued` ← новый
- `teacher_package_first_issue` ← новый (per-account один раз; активация)
- `teacher_package_issue_failed{reason}` ← новый
- симметричные для `tariff_access`

---

## 6. Фазы

| Phase | Цель | Артефакты |
|---|---|---|
| **A.0** | DS primitive | `<Combobox>` + tests + DS-doc update |
| **A** | Backend helpers | 4 helpers (§4.2) + tests |
| **B** | Modals | `IssuePackageModal`, `GrantTariffAccessModal`, `LearnerPicker` thin wrapper |
| **C** | Catalog wiring | `CatalogTileActionsMenu` + footer counter в плитках + `PostCreateNudgeBanner` |
| **D** | Sections на карточке ученика | `LearnerPackagesSection` + `LearnerTariffAccessSection` |
| **E** | Visual smoke + Playwright | screenshots mobile + desktop для всех 4 поверхностей |
| **F** | Acceptance + e2e | create → issue → learner sees → revoke |

---

## 7. Open questions (defaults)

1. **Стэкинг** — checkbox (не диалог), по умолчанию выключен.
2. **Меню `···`** — DropdownMenu в правом верхнем углу плитки, появляется через keyboard nav (Tab → Enter).
3. **Архивный пакет** — пункт «Выдать ученику» скрыт.
4. **Picker размер** — лениво подгружаем по 25, search-debounce 200ms.
5. **Доступ к тарифу** — бессрочный.

---

## 8. Acceptance Checklist

### Каталог пакетов / тарифов

- [ ] На каждой плитке есть меню `···` с пунктом «Выдать ученику» / «Открыть доступ»
- [ ] Footer плитки показывает «Выдан N ученикам» / «N ученикам открыт доступ»
- [ ] После create — `<Banner tone="success">` с CTA «Выдать ученикам →» / «Открыть доступ →»
- [ ] Если у учителя 0 учеников — Banner текст и CTA меняется на «Пригласить ученика»
- [ ] Empty state каталога — через `<EmptyState>` примитив (DS-3)

### Модалы issue / grant-access

- [ ] Open: focus автоматически переходит на Combobox (A11Y-1)
- [ ] ESC закрывает, focus возвращается на trigger button
- [ ] Tab навигация работает, нет focus traps вне модала
- [ ] Banner для ошибок: `role="alert"`, `aria-live="assertive"`
- [ ] Submit button показывает `loading={busy}` (DS Button primitive)
- [ ] Все 5 error states обработаны inline (§3.5)

### Карточка ученика

- [ ] Секция «Пакеты» с counter `(N)` в header
- [ ] Секция «Доступ к тарифам» с counter
- [ ] Mobile <640px: обе секции collapsed-by-default
- [ ] Desktop ≥640px: обе всегда expanded
- [ ] Empty states через `<EmptyState>` примитив с CTA
- [ ] `[Отозвать]` / `[Закрыть доступ]` — touch target ≥44 (A11Y-4)
- [ ] После revoke — `router.refresh()` обновляет список

### Combobox primitive

- [ ] Mobile <600px → bottom-sheet
- [ ] Desktop ≥600px → inline dropdown
- [ ] Keyboard: ↑/↓/Home/End/Enter/Esc работают
- [ ] Type-ahead search
- [ ] ARIA combobox pattern полностью
- [ ] Unit-тесты на mount + select + keyboard

### Cross-cutting

- [ ] Build + TS clean
- [ ] Все analytics events инжектированы и регистрированы
- [ ] Playwright screenshots на 390×844 и 1280×900 (M-2, S-3, S-5)
- [ ] e2e test: create-package → issue-from-banner → ученик видит в `/cabinet/packages` → revoke (S-3)
- [ ] Plan-doc Status → SHIPPED

### A11y test (S-5)

- [ ] TAB-обход всех новых элементов в правильном порядке
- [ ] ESC закрывает модалы / dropdown menu
- [ ] Combobox arrow keys + Enter
- [ ] Screen reader (VoiceOver) озвучивает Banner-ошибки и empty-state CTA

---

## 9. Codex paranoia

Codex quota exhausted до 2026-06-11. Self-review **двойной**:
- R1 + R2 + R3 (документ выше)
- **R4-R6** ниже после v2

После возврата квоты: `/codex-paranoia plan docs/plans/package-issuance-ux-2026-06-10-v2.md`.

---

## 10. Метрики успеха

См. §1 funnel + §5.5 events. Targets:
- ≥40% click-through на CTA «Выдать ученикам» в Banner
- ≥60% conversion в модале (opened → issued)
- ≥1 issued package per teacher within 7 days после первой регистрации тарифа

---

## 11. Out-of-scope (roadmap)

1. **`<Checkbox>` primitive в DS** — отдельный PR
2. **`<DropdownMenu>` primitive в DS** — отдельный PR (сейчас используется ad-hoc) либо pragmatic ad-hoc реализация в `CatalogTileActionsMenu`
3. **Home-page hint для empty packages** — «У вас 2 пакета не выданы. Выдать сейчас →» (B2B-2)
4. **Email/push при revoke пакета** ученику (S-4)
5. **Массовая выдача 5 ученикам сразу**
6. **Templates grants** («автоматически выдавать пакет X новому ученику»)
7. **Срочные tariff-access с expiry**
