---
title: Package issuance UX — выдача пакетов и тарифов ученикам
status: PLAN
date: 2026-06-10
owner: ivankhanaev
author: Claude
skill-used: claude-code-frontend-design (onboarding-specialist + b2b-saas-specialist + dashboard-designer)
---

# Package issuance UX — выдача пакетов и тарифов ученикам

## 0. Что нашёл (root-cause)

### 0.1 Главный баг

**API готов, UI отсутствует.** Endpoints `POST /api/teacher/packages/[id]/issue` (выдача пакета) и `POST /api/teacher/tariffs/[id]/access` (доступ к тарифу) **существуют и работают**, но **ни один UI-компонент их не дёргает**.

Проверка:
```
$ grep -rn "/api/teacher/packages.*issue\|/api/teacher/tariffs.*access" components/ app/teacher/
(пусто)
```

`components/teacher/pricing/package-list.tsx` и `tariff-list.tsx` дёргают **только CRUD-эндпоинты** (`POST/PATCH/DELETE /tariffs`, `/packages`) для каталога. Кнопки «Выдать ученику» нигде нет.

→ Учитель создаёт пакет в каталоге → видит его в списке → НЕ МОЖЕТ выдать ученику кроме как через `curl`/admin.

### 0.2 Дополнительный пробел

На карточке ученика (`/teacher/learners/[id]`) есть только переключатель **способа оплаты** («постоплата» / «пакеты» / «не выбрано»), но НЕТ:
- секции «активные пакеты этого ученика»
- кнопки «Выдать пакет»
- секции «доступ к тарифам»
- кнопки «Открыть доступ к тарифу»

В итоге учитель не понимает связь между «создать пакет в каталоге» и «передать конкретному ученику».

### 0.3 Ответ на вопрос про тарифы в карточке ученика

Сейчас в `learners/[id]/page.tsx` секции с тарифами ученика **нет вообще**. Server-side endpoint `POST /api/teacher/tariffs/[id]/access?learnerId=X` + helper `lib/billing/learner-tariff-access.ts` готовы (T3 Sub-PR A, 2026-06-01) — но UI не сделан. Это **тот же паттерн отсутствия surface-уровня**, что и с пакетами.

Решается этим же планом — в §3.3 добавляем секцию «Тарифы» на карточку ученика.

---

## 1. Бизнес-цель

Учитель должен:
1. Создать пакет/тариф в каталоге
2. **Тут же** выдать его ученикам, не уходя со страницы
3. На карточке ученика видеть и менять выданные ему пакеты и тарифы

«Job-to-be-done» формулировка: «Я только что создал пакет «10 уроков за 12 000₽». Какой следующий шаг? Кому из учеников его выдать?». Сейчас ответ продукта — никакого, и учитель теряется.

---

## 2. Информационная архитектура

```
/teacher/packages           — каталог пакетов
  └── tile «10 уроков»
       ├── меню действий [···]
       │    ├── Выдать ученику      ← NEW
       │    └── Архивировать
       └── после создания → success-toast + CTA «Выдать ученикам?» ← NEW

/teacher/tariffs            — каталог тарифов
  └── tile «60 мин · 1 600 ₽»
       ├── меню действий [···]
       │    ├── Открыть доступ ученикам     ← NEW
       │    └── Архивировать
       └── после создания → success-toast + CTA «Открыть доступ?» ← NEW

/teacher/learners/[id]      — карточка ученика
  ├── Способ оплаты (есть)
  ├── 🆕 Пакеты этого ученика     ← NEW
  │    ├── активные purchase'ы (список)
  │    └── [Выдать пакет ▾] — picker из каталога
  ├── 🆕 Доступ к тарифам         ← NEW
  │    ├── выданные тарифы (список)
  │    └── [Открыть доступ к тарифу ▾]
  └── ...
```

---

## 3. Поверхности (UI) — детально

### 3.1 На `/teacher/packages` — выдача из каталога

**На каждой плитке пакета** появляется меню `[···]` или прямая кнопка «Выдать ученику». При клике — модал `IssuePackageToLearnerModal`:

```
┌─────────────────────────────────────────────┐
│  Выдать «10 уроков»                  ×      │
├─────────────────────────────────────────────┤
│  Ученик                                     │
│  [picker «выберите ученика» — searchable]   │
│                                             │
│  Заметка (необязательно)                    │
│  [textarea]                                 │
│                                             │
│  ☐ Разрешить стэкинг с активным пакетом     │
│    (по умолчанию выключено)                 │
│                                             │
│  [Отмена]                  [Выдать]         │
└─────────────────────────────────────────────┘
```

Picker подгружает учеников через `GET /api/teacher/learners` (или существующий helper). Если у ученика уже есть активный пакет той же длительности — backend возвращает `409 already_owns_active_package`, фронт показывает inline-предупреждение и предлагает либо «Разрешить стэкинг», либо отменить.

Анти-spoof:
- `package_id` идёт из URL (доверенный)
- `learnerAccountId` — из picker'а (фронтенд)
- Бэкенд проверяет `package.teacher_id === session.teacher_id` AND learner linked → нельзя выдать чужой пакет чужому ученику.

### 3.2 Onboarding nudge — сразу после создания пакета

В `PackageList` после успешного `POST /api/teacher/packages` (создание):
- Стандартный success-toast «Пакет создан» **+** кнопка-CTA «Выдать ученикам →»
- Клик по CTA → открывается тот же `IssuePackageToLearnerModal` с предзаполненным package_id

Альтернативно (если у учителя ещё нет учеников):
- Toast: «Пакет создан. Чтобы выдать — пригласите ученика.»
- CTA «Пригласить ученика» → `/teacher/learners` с открытым invite-модалом

### 3.3 На карточке ученика — секции «Пакеты» и «Доступ к тарифам»

Добавляются **2 новые секции** между «Способ оплаты» и «Журнал занятий». Каждая — server-rendered.

**Секция «Пакеты этого ученика»**:
```
┌──────────────────────────────────────────────┐
│  Пакеты                                       │
│  ──────────                                   │
│  · «10 уроков» — осталось 7 из 10            │
│    до 2026-09-01 · выдан 2026-06-01          │
│    [Отозвать]                                │
│                                              │
│  · «5 уроков premium» — осталось 5 из 5      │
│    до 2026-12-01 · выдан 2026-06-08          │
│    [Отозвать]                                │
│                                              │
│  [+ Выдать пакет ▾]   ← открывает picker    │
└──────────────────────────────────────────────┘
```

Empty state:
```
┌──────────────────────────────────────────────┐
│  Пакеты                                       │
│  ──────────                                   │
│  У ученика пока нет активных пакетов.        │
│  [+ Выдать пакет ▾]                          │
└──────────────────────────────────────────────┘
```

**Секция «Доступ к тарифам»** (параллельно структуре):
```
┌──────────────────────────────────────────────┐
│  Доступ к тарифам                             │
│  ──────────                                   │
│  · «Урок 60 минут» · 1 600 ₽ — открыт        │
│    [Закрыть доступ]                          │
│                                              │
│  [+ Открыть доступ ▾]                        │
└──────────────────────────────────────────────┘
```

`[+ Выдать пакет ▾]` — открывает `IssuePackageToLearnerModal` с предзаполненным `learnerId`.
`[+ Открыть доступ ▾]` — открывает `GrantTariffAccessModal` с предзаполненным `learnerId`.

### 3.4 На странице `/teacher/tariffs` — параллельный нюдж после создания

Симметрично §3.2: после успешного `POST /api/teacher/tariffs` показываем success-toast + CTA «Открыть доступ ученикам →».

---

## 4. Технические компоненты

### 4.1 Новые React-компоненты

| Компонент | Путь | Назначение |
|---|---|---|
| `IssuePackageToLearnerModal` | `components/teacher/pricing/issue-package-modal.tsx` | POST `/api/teacher/packages/[id]/issue` |
| `GrantTariffAccessModal` | `components/teacher/pricing/grant-tariff-access-modal.tsx` | POST `/api/teacher/tariffs/[id]/access` |
| `LearnerPackagesSection` | `components/teacher/learners/learner-packages-section.tsx` | список активных пакетов + CTA «выдать» |
| `LearnerTariffAccessSection` | `components/teacher/learners/learner-tariff-access-section.tsx` | список выданных тарифов + CTA «открыть доступ» |
| `LearnerPicker` | `components/teacher/pricing/learner-picker.tsx` | reusable combobox (search + select) для модалов выдачи |
| `PackagePicker` | `components/teacher/pricing/package-picker.tsx` | reusable combobox для секций на карточке ученика |
| `TariffPicker` | `components/teacher/pricing/tariff-picker.tsx` | то же для тарифов |

### 4.2 Новые backend-запросы

Нужны для рендера секций на карточке ученика:

| Helper | Файл | Что делает |
|---|---|---|
| `listLearnerPackagesByTeacher(teacherId, learnerId)` | `lib/billing/packages/purchases.ts` | возвращает active `package_purchases` для этой пары |
| `listLearnerTariffAccessByTeacher(teacherId, learnerId)` | `lib/billing/learner-tariff-access.ts` | возвращает активные `learner_tariff_access` rows для этой пары |
| `listTeacherLearnersForPicker(teacherId)` | `lib/teacher/learners.ts` | минимальный shape для combobox: `{id, displayName, email}` |

### 4.3 API-эндпоинты — уже готовы

| Endpoint | Статус | Что делает |
|---|---|---|
| `POST /api/teacher/packages/[id]/issue` | ✅ есть, не используется в UI | Выдаёт пакет ученику |
| `POST /api/teacher/tariffs/[id]/access` | ✅ есть, не используется в UI | Открывает доступ к тарифу |
| `DELETE /api/teacher/packages/[id]/revoke` | ✅ есть | Отзывает пакет |
| `DELETE /api/teacher/tariffs/[id]/access?learnerId=X` | ✅ есть | Закрывает доступ к тарифу |
| `GET /api/teacher/learners` | нужно проверить — может быть только server-rendered в `learners/page.tsx` | для picker'а |

→ Никаких новых endpoint'ов писать НЕ нужно. Работа чисто фронтовая + 3 helper'а.

---

## 5. UX-детали (consulted skills: onboarding-specialist + b2b-saas-specialist + dashboard-designer)

### 5.1 «Success-toast → next action» (onboarding-specialist)

После создания пакета:
- Toast не просто «Готово», а **«Готово · [Выдать ученикам →]»**
- Кнопка автоматически фокусируется (`autoFocus`)
- Toast не пропадает за 4 секунды как обычные — у него **«sticky» behavior до dismiss** (или клика на CTA)

Это паттерн «moment-of-success → immediate next step», ключевой для активации в B2B-SaaS (Linear, Notion, Stripe).

### 5.2 Empty states секций на карточке ученика

«У ученика пока нет активных пакетов. **Выдать пакет**» — explain-what-will-appear + CTA. Если у учителя нет ни одного пакета в каталоге — CTA меняется на «Создать пакет →» к `/teacher/packages`.

### 5.3 Picker UX

LearnerPicker — combobox с поиском по `displayName` + `email`. На мобиле — bottom-sheet (как у нас уже сделано в `TimePickerSheet`). На desktop — inline dropdown.

Если у учителя **0 учеников** — picker заменяется на «У вас пока нет учеников. **Пригласить ученика →**».

### 5.4 Анимация и feedback

- При успешной выдаче — toast «Пакет выдан Анне», модал закрывается.
- При `already_owns_active_package` — inline-warning в модале, чекбокс «Разрешить стэкинг» расфокусивается + подсветка.
- При `learner_not_linked` — модал показывает «Сначала пригласите ученика» с CTA на `/teacher/learners`.

---

## 6. Фазы реализации

### Phase A — backend helpers (cheap)
1. `listLearnerPackagesByTeacher(teacherId, learnerId)` — SELECT с JOIN на `package_purchases` + `lesson_packages`
2. `listLearnerTariffAccessByTeacher(teacherId, learnerId)` — SELECT по `learner_tariff_access`
3. `listTeacherLearnersForPicker(teacherId)` — минимальный shape
4. Unit-тесты

### Phase B — IssuePackageToLearnerModal + GrantTariffAccessModal
1. Два модала + LearnerPicker
2. Wire-up на каталог `/teacher/packages` и `/teacher/tariffs`: меню `[···]` или прямая кнопка
3. Form validation, error handling по `already_owns_active_package` / `learner_not_linked` / etc

### Phase C — Onboarding nudges
1. Sticky-toast с CTA «Выдать ученикам →» после `POST` создания пакета
2. То же для тарифа
3. Бранчи: «нет учеников» / «есть ученики»

### Phase D — Sections на карточке ученика
1. `LearnerPackagesSection` SSR + revoke CTA
2. `LearnerTariffAccessSection` SSR + close-access CTA
3. Empty states со ссылками на каталог

### Phase E — Visual smoke + Playwright
1. Mobile + desktop screenshots для всех новых поверхностей
2. e2e: create → issue → learner sees in cabinet → consume → revoke

---

## 7. Open questions (defaults принятые в плане)

1. **«Разрешить стэкинг» — checkbox в модале или отдельный диалог?**
   *Default:* checkbox. Минимальный UI, владелец сможет легко поправить если хочет «подтверждающий диалог».
2. **Где меню `[···]` на плитке пакета?**
   *Default:* три точки в правом верхнем углу плитки. Стандартный паттерн design-system'а.
3. **Можно ли учителю выдать **архивный** пакет ученику?**
   *Default:* нельзя — backend отдаст `422 package_inactive`. Фронт скроет CTA «Выдать» у архивных плиток.
4. **Что показываем в LearnerPicker если есть **много** учеников (>50)?**
   *Default:* лениво подгружаем по 25 через search-debounce. Если меньше 25 — рендерим сразу.
5. **«Открыть доступ» к тарифу — это бессрочно или с истечением?**
   *Default:* бессрочно (как сейчас в `learner_tariff_access` — нет `expires_at`). Если нужен срок — другой план.

---

## 8. Acceptance Checklist

- [ ] На `/teacher/packages` у каждой плитки есть «Выдать ученику» CTA
- [ ] После создания пакета — sticky-toast с CTA «Выдать ученикам →»
- [ ] `IssuePackageToLearnerModal` работает: учеников видит, выдача проходит, errors показываются
- [ ] То же для `/teacher/tariffs` + `GrantTariffAccessModal`
- [ ] На `/teacher/learners/[id]` — секция «Пакеты» со списком активных purchases + revoke
- [ ] На `/teacher/learners/[id]` — секция «Доступ к тарифам» со списком + close-access
- [ ] Empty states с CTAs в обеих секциях
- [ ] Ученик после issue видит пакет на `/cabinet/packages`
- [ ] Build + tests clean
- [ ] Mobile (390px) + desktop screenshots сняты в playwright

---

## 9. Codex paranoia

Codex quota пока exhausted. Self-review round 1 + 2 ниже.

### Self-review round 1

**R1:** Без backend изменений — снижает риск. Никаких миграций, никаких новых indices, никаких политик. Это чистый UI + 3 helper'а.

**R2:** Анти-spoof уже есть на стороне backend (учтены в `issueTeacherPackageGrant` и `grantTariffAccess`). Фронт может довериться, но не должен полагаться: всё равно отображаем сообщения об ошибках, не «глотаем» 403/404/422.

**R3:** Если `GET /api/teacher/learners` отсутствует (а сейчас, кажется, нет — `/learners/page.tsx` рендерит server-side), нужно либо создать endpoint, либо сделать LearnerPicker'у пройти через server action или embedded JSON-prop с SSR-rendered учеников.
*Решение:* пробросить список через server-rendered JSON в каталог-страницы. Не плодим endpoint'ы.

**R4:** `IssuePackageToLearnerModal` нужно вызывать с разных мест (каталог-плитка, onboarding-toast, секция на карточке). Чтобы не дублировать state — модал должен быть **standalone** компонентом, принимающим `packageId?`, `learnerId?`, `onClose`, `onIssued`. Любая страница рендерит его и контролирует open/close.

**R5:** На карточке ученика секция «Пакеты» обновляется после revoke — нужен `router.refresh()` после API-вызова (стандартный паттерн).

### Self-review round 2

**R6:** Дополнить план описанием **что показывает ученик в кабинете**. Сейчас `/cabinet/packages/page.tsx` рендерит `listAccountActivePackages` — это включает teacher-grant'ы (account_id = learner). Так что НИКАКИХ изменений на стороне ученика не нужно — он увидит пакет автоматически, как только teacher issue его через UI.

**R7:** Не упоминаю **аудит** — но все эти действия уже логируются в `payment_audit_events` через `issueTeacherPackageGrant`. UI не должен ничего знать про это.

**R8:** На мобильной карточке ученика секции «Пакеты» и «Доступ к тарифам» могут быть сильно overgrown — стоит добавить collapse-on-empty или сделать collapsed-by-default. **Default:** показываем полностью, у нас уже есть «Способ оплаты» секция там — будут консистентно. Если страница станет визуально тяжёлой — отдельная задача.

---

## 10. Метрики успеха

- **Funnel «создал пакет → выдал ученику»** должен быть ≥60% в первую неделю после релиза
- **Снижение тикетов** «как выдать пакет ученику?»
- **Снижение «пустых» пакетов** в каталоге (созданы, но не выданы) — должен спасть на ~50%

Эвенты в analytics (уже есть инфраструктура):
- `teacher_package_issue_modal_opened`
- `teacher_package_issued`
- `teacher_package_issued_after_create_nudge` (отличаем onboarding-flow от каталога)
- `teacher_tariff_access_granted`

---

## 11. Что НЕ делаем в этом плане

- Не меняем backend.
- Не вводим «срочные» grants с expiry.
- Не делаем массовую выдачу (выдать 5 ученикам сразу) — оставим на следующую итерацию.
- Не делаем «templates» grants («автоматически выдавать пакет X новому ученику»).
