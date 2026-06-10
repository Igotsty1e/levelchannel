---
title: Package issuance UX — выдача пакетов и тарифов ученикам (v3 финал после R7-R15)
status: PLAN
date: 2026-06-10
owner: ivankhanaev
author: Claude
skill-used: claude-code-frontend-design (design-system-architect + form-designer + mobile-specialist + onboarding-specialist + accessibility-specialist + b2b-saas-specialist)
supersedes: v1 (2026-06-10), v2 (2026-06-10)
scale-assumption: ≤30 активных учеников у одного учителя
---

# Package issuance UX — выдача пакетов и тарифов ученикам (v3)

## 0. Что нашёл (root-cause)

### 0.1 Главный баг

`POST /api/teacher/packages/[id]/issue` + `POST /api/teacher/tariffs/[id]/access` существуют, протестированы, **не вызываются ниоткуда в UI**. Учитель не может выдать пакет/тариф без curl.

### 0.2 Дополнительный пробел

`/teacher/learners/[id]` имеет только переключатель способа оплаты. Секций «Пакеты ученика», «Доступ к тарифам» — нет. CTA «Выдать пакет» / «Открыть доступ» — нигде.

### 0.3 Тарифы в карточке ученика

Сейчас отсутствуют. Закрывается этим планом — §3.3.

### 0.4 Backend audit checklist (ОБЯЗАТЕЛЬНО до Phase B)

| # | Вопрос | Default-ответ принят в v3 |
|---|---|---|
| 1 | Idempotency TTL у `withIdempotency` для `/issue` — что если 24h блокирует второй legitimate issue после revoke? | **TTL 60s** или ключ включает `revokedAt` timestamp. Проверить в Phase A.1. Если TTL длиннее — изменить ключ. |
| 2 | `package_purchases.notes` — visible ученику в `/cabinet/packages`? | **Не используем поле notes в v3 UI**. Учительская заметка добавится в отдельном PR после privacy-аудита. |
| 3 | Индекс `package_consumptions(package_purchase_id, restored_at)` — есть? | Полагаю что есть. Phase A.1 — `\d+` проверка. Если нет — отдельный migration PR. |
| 4 | `learner_not_linked` — различать «account-missing» vs «link-inactive»? | **Не различаем в UI**. Generic Banner + CTA на `/teacher/learners`. |
| 5 | `GET /api/teacher/learners` endpoint нужен? | **Нет**. Embed список (≤30) в SSR JSON-prop. |
| 6 | Revoke с активными `package_consumptions` — какой backend behavior? | UI **disabled [Отозвать]** с tooltip-объяснением. Phase A.1 — посмотреть SQL поведение, добавить `hasActiveConsumptions` boolean в shape возвращаемых пакетов. |

---

## 1. Бизнес-цель + activation funnel

JTBD: «Создал пакет — кому выдать?». Сейчас продукт молчит → учитель теряется.

Funnel targets:
- `created_package` → 100%
- `saw_post_create_nudge` → 100%
- `clicked_issue_cta` → **≥40%**
- `issued_package` → **≥60% от opened**
- `teacher_package_first_issue` (per-account один раз) → **активационный milestone**

---

## 2. Информационная архитектура

```
/teacher/packages           — каталог пакетов
  └── tile «10 уроков»
       ├── ··· DropdownMenu (CatalogTileActionsMenu)
       │    ├── Выдать ученику      ← открывает IssuePackageModal
       │    └── Архивировать
       ├── footer: <Pill>Выдан N ученикам</Pill>
       └── после успешного create → <Banner tone="success">
            «Пакет создан · [Выдать ученикам →]»

/teacher/tariffs            — каталог тарифов (симметрично)

/teacher/learners/[id]      — карточка ученика
  ├── Способ оплаты (есть)
  ├── 🆕 Секция «Пакеты этого ученика» (collapsed-by-default на mobile, counter)
  └── 🆕 Секция «Доступ к тарифам» (то же)
```

---

## 3. Поверхности (UI) — детально

### 3.1 Каталог `/teacher/packages` — выдача из плитки

**Меню `···`** (DropdownMenu, ad-hoc в `CatalogTileActionsMenu`):
- «Выдать ученику» → открывает singleton `IssuePackageModal` с `packageId={p.id}`
- «Архивировать» → существующий action

Архивный пакет (`isActive === false`): пункт «Выдать ученику» скрыт.

**Footer плитки:** `<Pill tone="default">{plural(n, 'Выдан 1 ученику', 'Выданы 2 ученикам', 'Выдан 5 ученикам')}</Pill>`. Если n=0 — `<Pill>Никому не выдан</Pill>`.

**Aggregation:** counter подгружается **одним SQL** для всего каталога:
```sql
select package_id, count(distinct account_id) as n
  from package_purchases
 where lesson_packages.teacher_id = $1
   and revoked_at is null
   and expires_at > now()
 group by package_id
```

### 3.2 Onboarding nudge после create

После успешного `POST /api/teacher/packages`:

`<Banner tone="success" role="status" aria-live="polite">`:
- основной текст: `Пакет «{titleRu}» создан`
- CTA: `<Button variant="primary" size="sm">Выдать ученикам →</Button>`
- close-X

Banner живёт до dismiss или follow-CTA или route change.

**Branches:**
- `learnersCount > 0` → CTA `Выдать ученикам →` открывает `IssuePackageModal` (без preselected учеников)
- `learnersCount === 0` → текст: `Пакет создан. Пригласите ученика, чтобы выдать.` + CTA `Пригласить →` → `/teacher/learners`

После dismiss Banner НЕ возвращается. Учитель использует `···` меню на плитке.

Симметрично §3.4 для тарифов.

### 3.3 Карточка ученика — секции «Пакеты» и «Доступ к тарифам»

**Layout:**
- `<Card>` (border-radius 12, padding 20, gap 12; DS §6)
- На mobile <640px: collapsed-by-default, `<button aria-expanded aria-controls={sectionId}>` для toggle. Анимация chevron + height (200ms ease-out)
- На desktop ≥640px: всегда expanded

**Секция «Пакеты этого ученика»:**

```
┌──────────────────────────────────────────────┐
│  Пакеты (2)             [▾ collapse mobile]  │
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

**Кнопка `[Отозвать]`:**
- `disabled` если `hasActiveConsumptions === true` (R15-6)
- В этом случае: `<button disabled title="Сначала отмените забронированные занятия">[Отозвать]</button>`
- На success → `router.refresh()` + announcement (см. ниже)

**Empty state (через `<EmptyState>` примитив, DS §9.5):**
- title: `Пакетов пока нет`
- body: `Выдайте пакет, чтобы ученик мог записываться на занятия по предоплате.`
- cta:
  - Если `teacherHasAnyPackage` → `<Button>+ Выдать пакет</Button>`
  - Иначе → `<Button href="/teacher/packages">Создать пакет →</Button>`

**После revoke:** Если секция была collapsed — раскрывается через `useEffect` перед мутацией. Затем `<div role="status" aria-live="polite">Пакет «10 уроков» отозван.</div>` (4 сек), затем `router.refresh()`.

**Числа:** все через `formatRub()` + `tabular-nums`.

**Pluralization:** «N из M осталось» — N + helper. «1 из 10 осталось», «3 из 10 осталось».

### 3.4 Каталог `/teacher/tariffs` — симметрично §3.1 + §3.2

Меню `···` + footer counter + Banner после create. CTA «Открыть доступ ученикам →» / `GrantTariffAccessModal`.

### 3.5 `IssuePackageModal` (singleton на странице)

**Chrome:** centered modal ≥640px, bottom-sheet <640px. Та же `sheetStyle` chrome что у `BulkAddSlotsModal`.

**State ownership:** Modal — **singleton на странице**. State `{open, packageId, learnerId?}` живёт в page-level (либо `useState`, либо тонкий React Context). Каждая trigger-кнопка вызывает `openIssueModal(packageId)`.

**Форма:**
```
┌─────────────────────────────────────────────┐
│  Выдать «10 уроков»                  ×      │
├─────────────────────────────────────────────┤
│  Ученик                                     │
│  <Combobox value={learnerId} options=...>   │
│    (рендерит displayName, скрытый ID)       │
│                                             │
│  ☐ Разрешить стэкинг с активным пакетом    │
│    Ученик будет владеть несколькими         │
│    пакетами одновременно. Каждое занятие    │
│    списывает один пакетный слот.            │
│                                             │
│  <Banner tone="danger" role="alert">err</B> │
│                                             │
│  [<Button secondary>Отмена</Button>]        │
│  [<Button primary loading={busy}>Выдать</Button>] │
└─────────────────────────────────────────────┘
```

**Поля:**
- **Ученик** — `<Combobox>`, required. Submit disabled пока не выбран.
- **Стэкинг** — checkbox с inline-объяснением под ним (FD-R2-3).
- **Заметка** — **НЕ показываем в v3** (R15-2). Добавим в v4 после privacy-аудита.

**Submit btn:** `disabled={busy || !learnerAccountId}`, `loading={busy}`. Error не сбрасывает `busy=false` сразу — пользователь видит retry-state.

**Error states (5 кейсов):**

| Backend reply | UI treatment |
|---|---|
| `200 granted` | Модал закрывается + status announcement (см. ниже) |
| `404 package_not_found` | Banner: «Пакет не найден или удалён. Обновите страницу.» + close-only |
| `422 package_inactive` | Banner: «Этот пакет архивирован. Активируйте его в каталоге.» + close-only |
| `409 already_owns_active_package` | Banner: «У ученика уже есть активный пакет той же длительности.» + чекбокс «Разрешить стэкинг» highlight через `var(--accent) border` + сообщение «Включите стэкинг ниже, чтобы выдать всё равно» |
| `403 learner_not_linked` | Banner: «Этот ученик не привязан к вашему учителю.» + CTA `<Button>Открыть список учеников →</Button>` к `/teacher/learners` |
| `404 learner_account_missing` | Banner: «Учётная запись ученика не найдена.» + close-only |
| `network error` | Banner: «Нет связи. Попробуйте ещё раз.» + retry-кнопка inline (R11-2) |

ARIA: Banner для error — `role="alert"` + `aria-live="assertive"`.

**Focus management:**
- Open → `useEffect` ставит focus на Combobox
- Close → focus возвращается на trigger button (через ref)
- ESC → close
- Tab → trapped внутри (для desktop centered)

**Touch targets:** все интерактивные `minHeight: 44`. На mobile bottom-sheet — submit row sticky внизу + `max-height: 92vh` + `overflow-y: auto`.

**После успеха:**
- Модал закрывается с `cubic-bezier(0.16, 1, 0.3, 1)` 200ms (DS §8)
- Рендерится `<div role="status" aria-live="polite">Пакет «{title}» выдан {learnerName}</div>` (живёт 4с, по соглашению A11Y-R2-3)
- `router.refresh()` — обновляет каталог counter «Выдан N ученикам» и опционально текущую секцию на карточке ученика, если открыли из неё

### 3.6 `GrantTariffAccessModal`

Симметрично §3.5. Поле — только «Ученик» (Combobox). Стэкинг irrelevant. Те же error states (без `409 already_owns_active_package` — этого нет для tariff access).

---

## 4. Технические компоненты

### 4.1 Новые React-компоненты

| Компонент | Путь | Зависит от |
|---|---|---|
| `<Combobox>` (Phase A.0) | `components/ui/primitives/combobox.tsx` | DS-A1 — новый primitive |
| `IssuePackageModal` | `components/teacher/pricing/issue-package-modal.tsx` | `<Combobox>`, `<Button>`, `<Banner>` |
| `GrantTariffAccessModal` | `components/teacher/pricing/grant-tariff-access-modal.tsx` | то же |
| `LearnerPackagesSection` | `components/teacher/learners/learner-packages-section.tsx` | `<Card>`, `<EmptyState>`, `<Button>`, `<Pill>` |
| `LearnerTariffAccessSection` | `components/teacher/learners/learner-tariff-access-section.tsx` | то же |
| `PostCreateNudgeBanner` | `components/teacher/pricing/post-create-nudge-banner.tsx` | `<Banner>`, `<Button>` |
| `CatalogTileActionsMenu` | `components/teacher/pricing/catalog-tile-actions-menu.tsx` | ad-hoc DropdownMenu (DS-roadmap) |

### 4.1.1 `<Combobox>` primitive

**API:**
```tsx
<Combobox<TOption>
  value={value}
  onChange={setValue}
  options={options}                  // Array<{ value, label, sub? }>
  getLabel={(o) => o.label}
  getValue={(o) => o.value}
  placeholder="Выберите ученика"
  emptyMessage="Никого не найдено"
  searchable={true}                  // client-side filter по label/sub
  loading={false}
  disabled={false}
  size="md"
  renderTrigger={(props) => <Button {...props} />} // optional
/>
```

**Поведение (≤30 опций — client-side всё):**
- Mobile <600px → tap открывает full-screen sheet (как `TimePickerSheet`) с search-input + список
- Desktop ≥600px → click открывает inline dropdown под trigger. Width = max(trigger width, 240px)
- Keyboard: ↑/↓ навигация, Home/End в начало/конец, Enter — select, Esc — close, type-ahead для поиска
- ARIA: `role="combobox"` на trigger, `aria-expanded`, `aria-controls`, `aria-activedescendant` на focused option

**Z-index на mobile внутри другого модала:** Combobox sheet `z-index: 1200` (выше модала 1000). Tap вне закрывает только Combobox sheet, не parent modal.

**Loading/error/empty:**
- `loading={true}` → spinner inline в dropdown
- options пустой → `emptyMessage`
- options-fetch failed (R11-3) → `<Banner tone="danger" inline>Ошибка поиска</Banner>` inline в dropdown

### 4.1.2 Чекбокс — pragmatic

Native `<input type="checkbox">` с:
- `accentColor: var(--accent)`
- Wrapping `<label>` с `padding: 12px` (gives ≥44 touch target — R4.1)
- `:focus-visible { outline: 2px var(--accent); outline-offset: 2px; }` (A11y)
- Native scale хороша; не делаем custom render

`<Checkbox>` primitive в DS — отдельный roadmap-PR (§11).

### 4.1.3 Form validation

| Поле | Required | Validate | Error placement |
|---|---|---|---|
| `learnerAccountId` (Combobox) | yes | submit | Submit disabled + Banner внизу |
| `allowStacking` (checkbox) | no | n/a | n/a |

Submit `<Button loading={busy}>`. Network errors fail → Banner с retry, `busy=false` после catch.

### 4.2 Backend helpers (без новых routes)

| Helper | Файл | Возвращает |
|---|---|---|
| `listLearnerPackagesByTeacher(teacherId, learnerId)` | `lib/billing/packages/purchases.ts` | `Array<{ id, titleRu, countRemaining, countInitial, expiresAt, grantedAt, hasActiveConsumptions }>` (R15-6: новое поле) |
| `listLearnerTariffAccessByTeacher(teacherId, learnerId)` | `lib/billing/learner-tariff-access.ts` | `Array<{ id, tariffId, titleRu, amountKopecks, openedAt }>` |
| `listTeacherLearnersForPicker(teacherId)` | `lib/teacher/learners.ts` | `Array<{ id, label }>` — `label = displayName ?? email` (R10-2: НЕ возвращаем raw email отдельно), `limit 50` (с запасом для 30+) |
| `aggregateActiveLearnersByPackage(teacherId)` | `lib/billing/packages/purchases.ts` | `Map<packageId, distinctLearnerCount>` — один SQL для footer counter (R8-3) |
| `aggregateActiveLearnersByTariff(teacherId)` | `lib/billing/learner-tariff-access.ts` | то же |

### 4.3 API endpoints — все готовы

| Endpoint | Использование |
|---|---|
| `POST /api/teacher/packages/[id]/issue` | новые UI consumers (IssuePackageModal) |
| `POST /api/teacher/tariffs/[id]/access` | новые UI consumers (GrantTariffAccessModal) |
| `DELETE /api/teacher/packages/[id]/revoke` | `[Отозвать]` в секции |
| `DELETE /api/teacher/tariffs/[id]/access?learnerId=X` | `[Закрыть доступ]` в секции |

**Никаких новых endpoints.** `GET /api/teacher/learners` НЕ нужен — embed список через SSR JSON-prop (R15-5).

CSRF: все POST/DELETE через `enforceTrustedBrowserOrigin` (S6-1, наш стандарт).

---

## 5. UX-детали

### 5.1 Анимация (DS §8)

- Модал enter: 200ms `cubic-bezier(0.16, 1, 0.3, 1)`
- Banner enter: fade+slide-down 200ms ease-out
- Section collapse/expand: 200ms ease-out
- `prefers-reduced-motion: reduce` → instant

### 5.2 Empty states

Все 3 — через `<EmptyState>` primitive (DS §9.5). Title + body + CTA.

### 5.3 Mobile-first behavior

- Модал — bottom-sheet на <640px, centered ≥640px (та же media-query)
- Секции — collapsed-by-default на mobile, expanded на desktop
- CTA в empty state — `fullWidth`
- Touch targets ≥44px
- iOS safe-area — `padding-bottom: calc(20px + env(safe-area-inset-bottom))`

### 5.4 Числа и форматирование

- Все цены и счётчики — `formatRub()` (общий helper)
- `fontVariantNumeric: 'tabular-nums'`
- Pluralization — `plural(n, one, few, many)` helper (есть в `finance-summary.tsx`, reuse)
- Дата выдачи / истечения — `formatDayYmdRu()`

### 5.5 Аналитика + observability

Events (registry в `lib/analytics/registry.ts`):
- `teacher_package_post_create_nudge_shown` (NEW)
- `teacher_package_issue_modal_opened` (NEW)
- `teacher_package_issue_modal_closed_without_action` (NEW)
- `teacher_package_issued` (NEW)
- `teacher_package_first_issue` (NEW — per-account один раз)
- `teacher_package_issue_failed{reason}` (NEW)
- `teacher_package_revoke_initiated` (NEW)
- `teacher_package_revoke_confirmed` (NEW)
- симметричные для tariff_access

**Sentry breadcrumbs:** на каждом POST issue/grant добавляется breadcrumb `category: 'package-issuance'` с `{ teacherId, learnerId, packageId, duration_ms }`. PII (email/learnerName) НЕ в breadcrumb.

**Structured-log line:** `console.info('[teacher.packages.issue] success', { teacherId, packageId, duration_ms })` на сервере для prometheus-scraping.

### 5.6 Privacy

- Combobox label = `displayName ?? email` в **одном** поле. Не отдельно email.
- Заметка-учителя — не показываем в v3 (R15-2).
- Banner success: `«Пакет «{titleRu}» создан»` — без PII.

---

## 6. Фазы (sub-PR strategy)

| Phase | Цель | LOC | Зависит от |
|---|---|---|---|
| **A.0** | DS `<Combobox>` primitive + tests | ~250 | — |
| **A** | 4 backend helpers + SSR JSON-prop intergration | ~200 | A.0 (shape) |
| **A.1** | Backend audit (idempotency TTL check, index check, revoke-with-consumptions behavior). Если что-то не так → отдельный migration PR. | ~50 | — |
| **B.1** | `IssuePackageModal` + `PostCreateNudgeBanner` | ~300 | A.0 + A |
| **B.2** | `GrantTariffAccessModal` | ~250 | B.1 |
| **C** | `CatalogTileActionsMenu` + footer counter + Banner wiring в каталог-страницы | ~250 | B.1 + B.2 |
| **D** | `LearnerPackagesSection` + `LearnerTariffAccessSection` + revoke flow | ~400 | A + B |
| **E** | Playwright screenshots + e2e (create → issue → learner sees → revoke) | ~150 | C + D |
| **F** | Acceptance + final tweaks | ~50 | E |

**Total estimate:** ~1700 LOC = 8-9 sub-PR в одном epic. Не монолит.

---

## 7. Open questions — все с defaults

1. Стэкинг — checkbox (не диалог), default OFF
2. Меню `···` — DropdownMenu в правом верхнем углу плитки
3. Архивный пакет — пункт «Выдать ученику» скрыт
4. Picker размер — все 30 учеников client-side, без debounce
5. Доступ к тарифу — бессрочный
6. После dismiss Banner — не возвращается
7. Banner показывается для каждого нового пакета (не differentiate первый/повторный)

---

## 8. Acceptance Checklist

### Каталог
- [ ] Меню `···` с «Выдать ученику» / «Открыть доступ» на каждой плитке
- [ ] Footer `<Pill>` показывает «Выдан N ученикам» с правильной pluralization
- [ ] После create — `<Banner tone="success">` с CTA
- [ ] `learnersCount === 0` → CTA меняется на «Пригласить ученика»
- [ ] Empty state каталога — через `<EmptyState>`

### Модалы
- [ ] Open → focus на Combobox
- [ ] ESC → close → focus возвращается на trigger
- [ ] Tab trapped внутри (desktop)
- [ ] Banner error: `role="alert"`, `aria-live="assertive"`
- [ ] Banner success на странице: `role="status"`, `aria-live="polite"`
- [ ] Submit `loading={busy}` + `disabled={busy || !learnerAccountId}`
- [ ] Все 7 error states обработаны inline (§3.5)
- [ ] Stale picker error (R7-1): «Данные устарели. Обновите страницу.» + retry
- [ ] Network failure: «Нет связи. Попробуйте ещё раз.» + retry

### Карточка ученика
- [ ] Секция «Пакеты» с counter `(N)`
- [ ] Секция «Доступ к тарифам» с counter
- [ ] Mobile <640px: collapsed-by-default + `aria-controls` (A11Y-R2-2)
- [ ] Desktop ≥640px: всегда expanded
- [ ] Empty states через `<EmptyState>` + контекстный CTA
- [ ] `[Отозвать]` disabled если `hasActiveConsumptions` + tooltip
- [ ] Touch target ≥44px на всех CTA
- [ ] После revoke: `router.refresh()` + status announcement

### Combobox primitive
- [ ] Mobile <600px → bottom-sheet с z-index 1200 поверх parent modal
- [ ] Desktop ≥600px → inline dropdown
- [ ] Keyboard: ↑/↓/Home/End/Enter/Esc
- [ ] Type-ahead search (client-side)
- [ ] ARIA combobox pattern полностью
- [ ] Unit-тесты на mount + select + keyboard
- [ ] Loading state + error fallback внутри dropdown

### Cross-cutting
- [ ] Build + TS clean
- [ ] Все analytics events registered + injected
- [ ] Playwright screenshots на 390×844 и 1280×900
- [ ] e2e: create → issue from Banner → ученик видит на `/cabinet/packages` → revoke
- [ ] Pluralization работает: 1 ученику, 2 ученикам, 5 ученикам
- [ ] Email НЕ рендерится отдельным полем в picker (R10-2)
- [ ] Sentry breadcrumbs без PII (R12-1)
- [ ] CSRF на новых fetch (S6-1)
- [ ] Plan-doc Status → SHIPPED

### A11y (S-5)
- [ ] TAB-обход всех новых элементов в правильном порядке
- [ ] ESC закрывает модалы / dropdowns
- [ ] Combobox keyboard nav полностью
- [ ] Screen reader (VoiceOver на iOS) озвучивает Banner-ошибки и empty-state CTA
- [ ] Чекбокс focus-visible outline

---

## 9. Codex paranoia

Quota exhausted до 2026-06-11. Self-review **тройной** (R1-R15). После возврата квоты — `/codex-paranoia plan v3`.

---

## 10. Метрики успеха

См. §1 funnel + §5.5 events.

Targets:
- ≥40% click-through на CTA в Banner
- ≥60% conversion в модале (opened → issued)
- ≥1 issued package per teacher в течение 7 дней после первого пакета

---

## 11. Out-of-scope (roadmap)

1. `<Checkbox>` primitive в DS
2. `<DropdownMenu>` primitive в DS
3. Home-page hint для «empty packages» (B2B-R2 в R5)
4. Email/push при revoke пакета ученику (S-4)
5. Массовая выдача 5 ученикам сразу
6. Templates grants
7. Срочные tariff-access с expiry
8. Return-flow после invite (B2B-R2-2)
9. Deep-linking в модал (`?issue=X`)
10. Optimistic update при revoke (S6-5)
11. Заметка-учителя при выдаче (notes-privacy-audit)
12. Cap-checking при revoke/recreate (R13-2)
13. Re-link UX flow (R13-1)
14. Server-side search в Combobox (если когда-то будет 100+ учеников)
