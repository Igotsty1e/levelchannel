# Codex code-quality + design review (2026-06-18)

> **TL;DR (30 секунд для owner):**
> 1 **[BLOCKER]** — учнический ICS feed это бессрочный bearer URL, утёкшая ссылка = долгоживущий доступ к расписанию + email учителя. Fix немедленно.
> 10 **[WARN]** — design-system дрейф продолжается (2 button-системы, banner-примитив байпасит токены, recent-past-card использует `.btn-ghost` которого нет в CSS); TZ-баги в 5 свежих компонентах + finance-summary считает UTC-окно вместо teacher-local; teacher-side double-click guard не закрыт; payment retro-window задублирован UI/server.
> 2 **[INFO]** — icon library OK, тезис «7/11 примитивов не используются» был неправ — все 11 в проде.

## Контекст

- **Источник:** `/codex-paranoia wave HEAD~30..HEAD` (round 1, ~95 файлов, 6421 LOC additions).
- **Запрос owner:** «давненько Codex не смотрел наш проект. Аудит прогон по качеству кода + дизайн ревью».
- **Codex модель:** через `/Applications/Codex.app/Contents/Resources/codex` (gpt-5.X frontier coding model, `model_reasoning_effort=high`).
- **Verdict:** `BLOCK` round 1 — 1 BLOCKER не закрыт. Owner просил findings (broad audit), не paranoia loop, поэтому round 2 не запускаем — фиксы оформляем отдельными PR.
- **Прежние audits как baseline:** `docs/audit/2026-06-17-design-and-payment-audit.md`, `docs/audit/2026-06-17-finance-and-tz-audit.md`. Многие WARN здесь — drift по тем же темам, что зафиксированы там.

---

## 1. Design-System Cohesion

### 1.1 [WARN] Две несовместимые системы кнопок и радиусов всё ещё живут параллельно

Legacy `.btn-primary` / `.btn-secondary` в `app/globals.css:192-238` — `16px` текст + `12px` radius. Новый примитив `<Button>` в `components/ui/primitives/button.tsx:41-57,97-108` — `13/14/15px` + `8px` radius.

Свежий teacher-home продолжает использовать legacy CSS-кнопку: `app/teacher/page.tsx:327-333`. Единый button contract не наступил.

**Impact:** ученики/учителя видят inconsistent кнопки на разных страницах, любой новый разработчик копирует один из двух паттернов случайно.

### 1.2 [WARN] Token-layer сам противоречит design-system

Шкала в `app/globals.css:79-91` объявляет `12/13/15/17/22/28/34`. Тут же:
- `.text-h2` зашит `18px` в `app/globals.css:239-253` (вне шкалы).
- `.card` живёт с `16px` radius в `app/globals.css:273-279` (нет такого token).

Это не «остаточный мусор», а **источник нового дрейфа** — новый экран копирует существующий код и нарушает доку.

### 1.3 [WARN] Примитивы сами обходят токены

`components/ui/primitives/banner.tsx:14-30` хардкодит `rgba(...)` + `#9BDF9B` для info/success вместо semantic tokens (`var(--success)` / `var(--success-bg)` — они объявлены).

Свежие страницы продолжают: `app/teacher/settings/calendar/page.tsx:253-280`, `app/teacher/settings/cancel-policy/form.tsx:101-105`.

**Это тот же класс проблем, что зафиксирован 2026-06-17 audit — за месяц не закрыт.**

### 1.4 [WARN] Cabinet-страницы пишут off-scale типографику inline

- `app/cabinet/settings/calendar/page.tsx:140-155` — H1 `24px`, body `14px`.
- `app/cabinet/settings/page.tsx:59-60` — lead-copy `14px`.

После «polish» шкала не load-bearing.

### 1.5 [INFO] SVG-иконки нормальные

`components/ui/icons/index.tsx:23-33,36-123` — единый `24x24/currentColor/stroke=2`, навигация потребляет консистентно (`components/cabinet/learner-cabinet-nav.tsx:119-125`). Проблема не в иконах, а в дисциплине потребления UI-layer.

---

## 2. TZ Critical Bugs

### 2.1 [WARN] Teacher finance-summary считает UTC-окно вместо teacher-local недели

`app/teacher/page.tsx:183-200` передаёт `new Date().toISOString().slice(0, 10)` в `getTeacherFinanceSnapshot`, а `lib/calendar/summary.ts:55-72` трактует это как начало недельного окна.

Блок «Ожидается на этой неделе» = **скользящие 7 дней от UTC-today**, а не Mon-Sun в teacher TZ.

**Impact:** для учителя в +07 в пятницу вечером блок показывает не «эту неделю», а «последние 7 дней включая прошлый понедельник».

### 2.2 [WARN] `Date.now() - N*24h` антипаттерн жив в 3 свежих местах

- `app/cabinet/lessons-section.tsx:174-179` (learner UI «история за 30 дней»)
- `app/teacher/lessons/page.tsx:71-74` (teacher history)
- `lib/payments/sbp-claims.ts:661-670` (server-side retro-window)

Окно «30 дней» переключается по UTC-миллисекундам, а не по локальному календарному дню. Пользователь, который вечером смотрит «занятия за 30 дней», может потерять одно занятие на границе UTC-полуночи.

### 2.3 [WARN] `toLocaleTimeString('ru-RU')` без `timeZone` — 5 свежих компонентов

- `app/cabinet/profile-editor.tsx:79-81`
- `app/teacher/learners/[id]/rename-form.tsx:83-87`
- `components/teacher/digest-settings/bind-code-modal.tsx:42-46`
- `components/teacher/profile/profile-card.tsx:133-136`
- `components/cabinet/learner-telegram-binding.tsx:145-148`

Все рендерят время в timezone окружения (на серверной стороне = UTC; на клиенте = browser TZ). Не cosmetic — продукт явно стал multi-timezone.

---

## 3. Payment-Flow Race Conditions

### 3.1 [WARN] Teacher-side double-click guard не закрыт

Learner-side fix есть: `components/cabinet/pay-lesson-modal.tsx:56-61,106-110` — синхронный `useRef` guard ДО `setBusy(true)`.

Teacher-side `markPaid` в `app/teacher/payments/unpaid-learners.tsx:114-141` полагается **только на асинхронный `setBusy(true)`** — два быстрых клика всё ещё могут отправить два POST'а.

Advisory lock в `lib/payments/sbp-claims.ts:72-79,697-703` спасает БД от дубля, но UI может показать success + лишнюю 409/error.

**Fix паттерн:** добавить `submittingRef = useRef(false)` + проверку ДО первого `await`.

---

## 4. UI Component Library Utilization

### 4.1 [INFO] Тезис «7 из 11 примитивов не используются» был неправ

На HEAD все 11 в продакшене:
- `EmptyState` → `app/cabinet/packages/page.tsx:6`, `app/teacher/payments/feed.tsx:9`
- `DatePicker` → `components/calendar/BulkAddSlotsModal.tsx:5`
- `TimePicker` → `components/calendar/RescheduleByTeacherModal.tsx:5`
- `Combobox` → `components/teacher/pricing/issue-package-modal.tsx:5`
- `ChipGroup` → `components/teacher/pricing/package-create-sheet.tsx:5`
- `FloatingActionButton` → `components/teacher/pricing/package-list.tsx:287-291`
- `Banner` → `components/cabinet/pay-lesson-modal.tsx:12`

### 4.2 [WARN] Bypass library contract там, где примитив уже есть

`components/teacher/home/recent-past-card.tsx:203-209` использует `className="btn-ghost"`. В `app/globals.css:192-238` определены **только** `.btn-primary` и `.btn-secondary` — `.btn-ghost` не существует как класс, поэтому стиль вообще не применяется.

При этом ghost-вариант существует в `<Button>`: `components/ui/primitives/button.tsx:73-84`.

**Это чистый bypass library contract** — рисует невидимую/unstyled кнопку.

---

## 5. Overall Code Quality + Arch

### 5.1 [BLOCKER] Учнический ICS feed — бессрочный bearer URL без revoke

- Токен детерминированно считается из `accountId` + глобального секрета: `lib/calendar/learner-ics.ts:22-32`
- Полный URL генерируется и публикуется в UI: `app/cabinet/settings/calendar/page.tsx:233-236`
- Route принимает без срока жизни, отдаёт публично кэшируемый feed: `app/api/learner/calendar.ics/route.ts:35-49,93-98`
- Feed содержит teacher email + полное расписание: `lib/calendar/learner-ics.ts:80-84`

**Security boundary defect:**
1. Один утёкший URL (история браузера, синхронизация в облако, отправка коллеге) = долгоживущий доступ к календарю.
2. Per-link revoke невозможен — единственный способ отозвать = ротация глобального секрета **для всех учеников**.
3. Feed содержит PII (teacher email).

**Fix scope (минимум для unblock):**
- Добавить `expires_at` или `version` в token payload (HMAC over `accountId|version|expiresAt` вместо detached `learner-ics:v1:${accountId}`).
- Per-account `ics_token_version` в `accounts`-table — bump при revoke.
- Опциональный TTL (30 дней default), with auto-rotation при login.
- Из feed убрать teacher email (заменить на ник/«учитель»).

### 5.2 [WARN] Payment retro-window задублирован UI/server

- `app/cabinet/lessons-section.tsx:174-179` — клиентский фильтр по 30-day cutoff.
- `lib/payments/sbp-claims.ts:661-670` — серверный `PAYMENT_RETRO_WINDOW_DAYS = 30`.

Оба места **комментариями признают, что «должно совпадать»** — leaky abstraction. Следующий change inevitably сломает one side first.

**Fix:** вынести в `lib/payments/policy.ts` или `lib/payments/retro-window.ts` единым константой; импортировать в обоих местах.

---

## Recommended order of follow-ups

| Priority | Finding | Fix scope | Estimated PR |
|---|---|---|---|
| **P0** | [BLOCKER] §5.1 ICS feed token-versioning + TTL | mig + server + UI rotate | 1 PR, M |
| **P1** | [WARN] §3.1 teacher-side useRef guard | 5 LOC | 1 PR, XS |
| **P1** | [WARN] §2.3 toLocaleTimeString timezone — 5 файлов | helper + 5 callsites | 1 PR, S |
| **P1** | [WARN] §2.1 finance-summary teacher-local week | server logic | 1 PR, S |
| **P2** | [WARN] §2.2 Date.now()-30d — 3 файла | extract policy | 1 PR, S |
| **P2** | [WARN] §5.2 retro-window dedup | extract const | 1 PR, XS |
| **P2** | [WARN] §4.2 recent-past-card btn-ghost fix | заменить на `<Button variant="ghost">` | 1 PR, XS |
| **P3** | [WARN] §1.1-1.4 design-system unification | архитектурное движение, отдельная epic | 1 epic, L |

**Quick-wins для одного дня:** §3.1 + §4.2 + §5.2 — 3 XS-PR без эпик-оверхеда.

---

## Что НЕ нашли (negative findings)

- Icon library: чистая, SVG-glyphs консистентные (§1.5).
- Auth boundary: anti-spoof проверки в `sbp-claims.ts` — теплый. Не нашли gaps в anti-spoof по этому слою.
- Никаких новых N+1 query / database hot-paths за последние 30 коммитов.

---

## Codex raw output

Полный output round 1 — `/tmp/codex-paranoia-20260618T064014Z/round-1.md`.
Tokens used: **454 443**. Estimated cost: ~$2-3 (gpt-5 reasoning).

---

*Generated via `/codex-paranoia wave HEAD~30..HEAD` round 1, 2026-06-18 by Claude Opus 4.7.*
