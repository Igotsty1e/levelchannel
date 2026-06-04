---
title: Onboarding tooltips — spec
status: PLANNING (round-3 BLOCK 2026-06-04 — 6 BLOCKER + 2 WARN + 1 INFO; closures pending; see onboarding-flows §0c)
date: 2026-05-31
---

# Onboarding tooltips — спецификация

Спецификация tooltip-каталога для onboarding-волны. Декомпозиция волны на 4
sub-PR (A foundation → B teacher → C learner → D nice-to-have). Журни покрыты
в `docs/plans/onboarding-flows-2026-05-31.md`; здесь — детали каждого hint
slot'а, persistence schema, recovery surfaces, mobile/a11y considerations.

---

> **§0e/§0f UPDATE 2026-06-04 (supersedes §1 ID/key contract below):** wire/storage key is **snake_case `hintKey`** matching `lib/onboarding/keys.ts ONBOARDING_HINT_KEYS`. The kebab-case "ID" field below is a HUMAN-READABLE LABEL ONLY — not the wire value, not the JSONB key. Mapping (kebab-case ID → snake_case persistence key) lives in `lib/onboarding/keys.ts`. Reset route + admin CLI move to Sub-PR D (nice-to-have); Sub-PR A scope = dismiss API + cabinet redirect fix + per-account purge + tests (see flows §0f).

## §1 Tooltip catalog

Контракт-поля каждого hint:
- **ID** — kebab-case, human-readable label (NOT the wire/storage key; see §0e/§0f superseding contract above).
- **Route/Component** — file:line where mounted.
- **Trigger** — mount-time / action / SSR conditional.
- **Copy** — русский, plural-aware через `pluralRu` из `lib/copy/plural-ru.ts`.
- **Dismiss** — X button / «Понятно» / auto-after-action.
- **Persistence key** — JSONB key в `account_onboarding_state.dismissed_hints`.
- **Priority** — must-have / nice-to-have.
- **Persisted?** — yes (запись в JSONB) / no (static UI, не requires dismiss).

### §1.1 Must-have teacher (5)

#### `teacher-home-setup-checklist`

- **Route:** `app/teacher/page.tsx` (top of mobile-first home, выше «Ближайшие
  занятия»).
- **Trigger:** SSR — render when ANY of the 4 checklist items incomplete:
  1. Профиль заполнен: `account_profiles.display_name IS NOT NULL`.
  2. Создан хотя бы один тариф: `SELECT 1 FROM pricing_tariffs WHERE
     teacher_id = $1 LIMIT 1`.
  3. Подключён календарь: `getGoogleIntegrationMeta(teacher_id)?.syncState ===
     'active' || ...?.syncState === 'degraded'`. ⚠️ Реальное поле —
     `syncState` (camelCase), enum `'active' | 'degraded' | 'disconnected'`
     (verified — `lib/calendar/integrations.ts:34`). Никаких `.status` /
     `'connected'` / `'errored'` нет.
  4. Отправлено хотя бы одно приглашение: `SELECT 1 FROM teacher_invites
     WHERE teacher_account_id = $1 LIMIT 1`. ⚠️ Колонка
     **`teacher_account_id`** (verified — `migrations/0057_teacher_invites.sql:23`).
- **Copy:** «Настройте кабинет, чтобы начать преподавать:» + 4 строки с
  checkboxes (зачёркнутые когда completed).
- **Dismiss:** X button «Скрыть пока что» (записывает
  `dismissed_hints.teacher_setup_checklist = <iso-ts>`).
- **Persistence key:** `teacher_setup_checklist`.
- **Priority:** must-have. **Persisted?** yes.

#### `teacher-tariff-first-create-hint`

- **Route:** `app/teacher/tariffs/` (empty state, нет ни одного tariff).
- **Trigger:** SSR — `pricing_tariffs` count = 0 для teacher_id.
- **Copy:** «Тариф = цена одного занятия. После того как тариф используется в
  расписании, его цена закрепляется в snapshot'е — менять можно, но старые
  занятия сохранят старую цену.»
- **Dismiss:** auto-dismiss после создания первого tariff.
- **Persistence key:** `tariff_first_create_hint`.
- **Priority:** must-have. **Persisted?** yes.

#### `teacher-packages-vs-tariffs-explainer`

- **Route:** `app/teacher/packages/` (empty state).
- **Trigger:** SSR — `lesson_packages` count = 0 для teacher_id.
- **Copy:** «Пакет — это предоплата за N занятий со скидкой (например, 8
  занятий за цену 7). Тариф — это цена одного занятия postpaid. Можно
  использовать одновременно — пакеты дают предсказуемый доход, тарифы — гибкость.»
- **Dismiss:** «Понятно» button.
- **Persistence key:** `packages_vs_tariffs_explainer`.
- **Priority:** must-have. **Persisted?** yes.

#### `teacher-invite-copy-feedback`

- **Route:** `app/cabinet/teacher-invite-section.tsx:113-120` (clipboard
  fallback после клика «Скопировать ссылку»).
- **Trigger:** action — после `clipboard.writeText()` resolve/reject. Show
  toast «Ссылка скопирована» (success) или «Не удалось скопировать
  автоматически — выделите ссылку ниже и скопируйте вручную» (fail).
- **Copy:** см. trigger.
- **Dismiss:** auto после 3s (toast pattern).
- **Persistence key:** none (не persists; toast — client-only).
- **Priority:** must-have. **Persisted?** no.

#### `teacher-invite-plan-limit-banner`

- **Route:** `app/cabinet/teacher-invite-section.tsx` (above invite list).
- **Trigger:** SSR conditional — count активных linked learners (M) vs N
  (plan limit):
  ```typescript
  if (M === N) renderHardLimitCopy()        // hard limit first (precedence)
  else if (M >= Math.ceil(0.8 * N)) renderSoftLimitCopy()
  else hidden
  ```
  Для Free тарифа N=1: M=0 → hidden; M=1 → hard-limit (button disabled).
- **Copy:**
  - **Soft-limit (80%, not at cap):** «На тарифе {planLabel} вы можете
    пригласить {N} {pluralRu(N, 'активный ученик', 'активных ученика',
    'активных учеников')}. Сейчас активных: {M}/{N}.»
  - **Hard-limit (M=N):** «Достигнут лимит активных учеников на тарифе
    {planLabel} ({M}/{N}). Чтобы пригласить ещё, обновите тариф или
    архивируйте неактивных учеников.» Invite button disabled.
- **Dismiss:** не dismissible (conditional banner, скрывается сам когда условие
  падает).
- **Persistence key:** none (conditional, не записывается).
- **Priority:** must-have. **Persisted?** no.
- **Plural-form contract:** `pluralRu(n: number, one, few, many)` из
  `lib/copy/plural-ru.ts:13-19`. Verify test cases:
  - N=1 → «1 активный ученик» (one)
  - N=2 → «2 активных ученика» (few)
  - N=5 → «5 активных учеников» (many)
  - N=11 → «11 активных учеников» (many, mod100=11 → many по rules в
    `lib/copy/plural-ru.ts:16`).
  Import: `import { pluralRu } from '@/lib/copy/plural-ru'`.

### §1.2 Must-have learner (5)

#### `learner-invite-from-teacher-name`

- **Route:** `app/register/page.tsx` (top of form, выше email input).
- **Trigger:** SSR — invite token присутствует в query, fetch
  `teacher_invites` row + JOIN `account_profiles`. ⚠️ Колонка
  **`teacher_account_id`** (verified mig 0057:23) — round-2 BLOCKER #3 закрыт;
  round-1 spec ошибочно ссылался на несуществующую колонку, см. r2 review.
  SQL:
  ```sql
  SELECT ap.display_name, ap.first_name, ap.last_name
    FROM teacher_invites ti
    JOIN account_profiles ap ON ap.account_id = ti.teacher_account_id
   WHERE ti.id = $1
     AND ti.used_at IS NULL
     AND ti.revoked_at IS NULL
     AND ti.expires_at > now()
   LIMIT 1;
  ```
- **Copy:** «Вас пригласил(-а) {teacher_display_name}. После регистрации вы
  сможете записываться на его/её занятия.»
- **Dismiss:** не dismissible (transient on register page).
- **Persistence key:** none (display-only).
- **Priority:** must-have. **Persisted?** no.

#### `learner-invite-already-registered-link`

- **Route:** `app/register/page.tsx` (error state — email already exists).
- **Trigger:** action — register form returns «email уже занят»; show link «У
  вас уже есть аккаунт? Войти и привязаться к учителю → /login?invite={token}».
- **Copy:** см. trigger.
- **Dismiss:** auto (transient).
- **Persistence key:** none.
- **Priority:** must-have **conditional на plan G shipping**. Если plan G
  drop → понижается до nice-to-have (Sub-PR D), либо ссылка убирается совсем
  (anti-enumeration > UX). Default: ship plan G.
- **Persisted?** no.

#### `learner-first-cabinet-tour-3steps`

- **Route:** `app/cabinet/page.tsx` (top of learner home).
- **Trigger:** SSR — render when учитель привязан AND `lesson_completions`
  count = 0 AND `dismissed_hints.learner_cabinet_tour IS NULL`.
- **Copy:** 3 шага inline:
  1. «Купить пакет занятий» → CTA → `/cabinet/packages`.
  2. «Выбрать удобное время» → CTA → `/cabinet/book`.
  3. «Подключить Telegram для напоминаний» → CTA → `/cabinet/profile#telegram`.
- **Dismiss:** «Понятно» button (записывает
  `dismissed_hints.learner_cabinet_tour = <iso-ts>`).
- **Persistence key:** `learner_cabinet_tour`.
- **Priority:** must-have. **Persisted?** yes.

#### `learner-book-tz-reminder`

- **Route:** `app/cabinet/book/[ymd]/page.tsx:128` (выше времён сетки).
- **Trigger:** client-side — после mount, если detected `Intl.DateTimeFormat().
  resolvedOptions().timeZone !== teacher_tz`. SSR рендерит баннер с
  `data-pending-tz-check="true"` + `visibility: hidden` (preserves space);
  client hook удаляет attribute если match, или показывает если mismatch.
- **Copy:** «Времена показаны в вашем часовом поясе ({localTz}). Не в вашем?
  [Поменять в профиле →]» (без self-contradicting «зона указана неверно»).
- **Dismiss:** «Понятно» button (один раз на browser session — `localStorage`
  fallback, since это client-only detection).
- **Persistence key:** `tz_hint` (записывается в `dismissed_hints` для
  cross-device persistence).
- **Priority:** must-have. **Persisted?** yes.
- **Design fix deferred:** замена IANA `Europe/Moscow` на human-readable
  «Москва (UTC+3)» — отдельный design polish PR, не входит в onboarding scope.

#### `learner-after-book-reminder-channel`

- **Route:** `app/cabinet/book/[ymd]/page.tsx` (success banner после booking).
- **Trigger:** action — booking success response received AND `learnerTgBound
  === false` AND `LEARNER_REMINDERS_TELEGRAM_ENABLED` operator setting = 1.
  Master switch resolver: `resolveOperatorSetting('LEARNER_REMINDERS_TELEGRAM_ENABLED')`
  из `lib/admin/operator-settings.ts:341-346` (verified). Если switch OFF →
  suppress silently (не обещаем канал, который operator не включил).
- **Copy:** «Занятие записано! Подключите Telegram в [Профиле →
  Уведомления](/cabinet/profile#telegram), чтобы получать напоминания за 24
  часа.»
- **Dismiss:** «Подключить» (deep-link на profile) ИЛИ «Позже» (записывает
  `dismissed_hints.learner_reminder_hint`).
- **Persistence key:** `learner_reminder_hint`.
- **Priority:** must-have. **Persisted?** yes.
- **Implementation note:** binding UI **УЖЕ live** с 2026-05-19/20
  (`components/cabinet/learner-telegram-binding.tsx` — verified;
  `app/cabinet/profile/page.tsx:128` mount — verified). Hint promotes
  existing feature, не строит её.

### §1.3 Must-have cross-cutting (2)

#### `ct-mobile-bottom-nav-clearance`

- **Type:** CSS utility, не tooltip.
- **Implementation:** все tooltip popovers, рендерящиеся в fixed bottom
  position (toast, celebration card), получают:
  ```css
  margin-bottom: calc(env(safe-area-inset-bottom, 0px) + var(--sticky-nav-height, 0px) + 16px);
  ```
  с `--sticky-nav-height: 56px` устанавливаемым только в mobile media
  query (`@media (max-width: 900px)`). На iPad split-view (≥768px) и
  landscape iPhone — sticky nav не рендерится, `--sticky-nav-height`
  остаётся `0px` → нет лишней дырки.
- **Priority:** must-have. **Persisted?** no.

#### `ct-onboarding-reset-from-settings`

- **Surfaces (debug-style):**
  1. `/teacher/settings` footer (under HUB_ITEMS) (footer of settings hub) — «Показать
     подсказки снова» button (visible для teacher-role).
  2. `/cabinet/profile` (внизу страницы) — та же кнопка (visible для
     learner-role).
- **Behaviour:** POST `/api/onboarding-state/reset` → `UPDATE
  account_onboarding_state SET dismissed_hints = '{}'::jsonb WHERE account_id
  = $1` → возвращает 200 → client reload.
- **Hybrid teacher+learner:** один row `account_onboarding_state`; reset из
  любой surface зануляет всё (teacher AND learner hints).
- **Visibility condition:** показывать button ВСЕГДА (даже если
  `dismissed_hints = '{}'::jsonb`) — учителю/ученику может понадобиться
  «отслеживать прогресс заново». Это упрощает SSR (не нужен дополнительный
  query для visibility).
- **Priority:** must-have. **Persisted?** no (это action, не hint).

### §1.4 Nice-to-have (Sub-PR D scope)

Краткий список из round-1 spec'а, фиксируется в Sub-PR D после shipping
must-have:

- `teacher-first-learner-arrived-celebrate` (T7 celebration card).
- `teacher-calendar-skip-for-now` (T3 alt path).
- `teacher-forgot-link-emphasis` (T-forgot, login page).
- `teacher-reset-token-validity-hint` (T-forgot).
- `teacher-logout-where` (logout discoverability).
- `learner-postpaid-explained` (L3 alt path).
- `learner-first-completed-celebrate` (L6).
- `learner-forgot-link-emphasis` (L-forgot).
- `account-deletion-recovery-on-login` (T-delete reverse — owner-gated).
- `ct-network-failure-retry` (CT3).
- `pwa-install-prompt` (Android Chrome only).
- `profile-saved-next-step` (post-profile-save guidance).

Persistence: каждый, требующий dismiss-once, добавляет key в
`ONBOARDING_HINT_KEYS` whitelist (см. §2.3). Static UI copy без dismiss — не
требует persistence.

---

## §2 Persistence

### §2.1 Schema

- **New table:** `account_onboarding_state` (mig 0100_account_onboarding_state.sql).
- **Schema:**
  ```sql
  create table if not exists account_onboarding_state (
    account_id uuid primary key references accounts(id) on delete cascade,
    dismissed_hints jsonb default '{}'::jsonb not null,
    updated_at timestamptz not null default now()
  );
  ```
- **Rationale per-tab JSONB:**
  - Один row на account, не N миграций на каждый новый hint.
  - `account_id` PK = O(1) lookup per SSR pass.
  - `dismissed_hints` JSONB shape: `{ "<hint_key>": "<iso-timestamp>" }`.
    Timestamp используется для regression-detection и audit.
  - Совместимо с pattern `teacher_account_daily_digests.diagnostics` JSONB
    (mig 0067).

### §2.2 Migration `migrations/0100_account_onboarding_state.sql`

Минимальный contract:
- `CREATE TABLE` + PK + default `'{}'::jsonb` для `dismissed_hints`.
- `ON DELETE CASCADE` от `accounts(id)`.
- `updated_at` для audit.
- Никаких индексов поверх `dismissed_hints` keys — все lookup'и идут по PK.

### §2.3 Helper contract — IMPORTANT

**File:** `lib/onboarding/state.ts` (new, Sub-PR A).

API:
```typescript
export type OnboardingState = {
  accountId: string
  dismissedHints: Record<string, string>  // key → ISO timestamp
  updatedAt: string
}

export async function getOnboardingState(accountId: string): Promise<OnboardingState>
export async function dismissOnboardingHint(accountId: string, key: string): Promise<void>
export async function resetOnboardingState(accountId: string): Promise<void>
```

⚠️ **No schema mutation in helpers.** `getOnboardingState()` /
`dismissOnboardingHint()` / `resetOnboardingState()` — ТОЛЬКО SELECT/UPDATE.
Никакого DDL (`create table if not exists`, `alter table`, `ensureSchema()` calls)
— это вызовет ACCESS EXCLUSIVE lock и hang SSR query, который параллельно
читает `lesson_slots` / `lesson_completions` (см. memory
`postgres_create_table_locks_during_active_tx.md`). Schema создаётся только
миграцией `migrations/0100_account_onboarding_state.sql`. Если попадаем на
старую DB без mig 0100 → graceful 500 / fall-through на default state, не
CREATE TABLE.

**Whitelist:** новый файл `lib/onboarding/keys.ts` экспортирует:
```typescript
export const ONBOARDING_HINT_KEYS = [
  'teacher_setup_checklist',
  'tariff_first_create_hint',
  'packages_vs_tariffs_explainer',
  'tz_hint',
  'learner_cabinet_tour',
  'learner_reminder_hint',
  'pwa_install',
  'first_completed_celebrated',
  'postpaid_explained',
  'first_mark_completed_hint',
  'first_learner_celebrated',
  // (Sub-PR D additions — list grows here, no migration needed)
] as const

export type OnboardingHintKey = (typeof ONBOARDING_HINT_KEYS)[number]
```

`dismissOnboardingHint(accountId, key)`: schema-validates key against
`ONBOARDING_HINT_KEYS` (unknown ключи rejected с 400). Это predawns против
client'а, который пишет arbitrary JSONB keys.

**Whitelist ownership:** Sub-PR D editor добавляет nice-to-have keys в этот
массив при добавлении nice-to-have hint'а. Sub-PR A ships initial list (must-have
keys выше).

### §2.4 Per-hint persistence table

| Hint ID | Persistence key | Persisted? | Notes |
|---------|-----------------|------------|-------|
| `teacher-home-setup-checklist` | `teacher_setup_checklist` | yes | dismiss-once |
| `teacher-tariff-first-create-hint` | `tariff_first_create_hint` | yes | auto-dismiss on create |
| `teacher-packages-vs-tariffs-explainer` | `packages_vs_tariffs_explainer` | yes | «Понятно» dismiss |
| `teacher-invite-copy-feedback` | — | no | toast, transient |
| `teacher-invite-plan-limit-banner` | — | no | conditional |
| `learner-invite-from-teacher-name` | — | no | transient on register |
| `learner-invite-already-registered-link` | — | no | error-state transient |
| `learner-first-cabinet-tour-3steps` | `learner_cabinet_tour` | yes | «Понятно» dismiss |
| `learner-book-tz-reminder` | `tz_hint` | yes | client-detected, persists |
| `learner-after-book-reminder-channel` | `learner_reminder_hint` | yes | «Позже» dismiss |
| `ct-mobile-bottom-nav-clearance` | — | no | CSS utility |
| `ct-onboarding-reset-from-settings` | — | no | action button |

### §2.5 Migration plan для будущих hint'ов

JSONB shape позволяет добавлять новые hint'ы **без новых миграций**: просто
добавь key в `ONBOARDING_HINT_KEYS` whitelist (`lib/onboarding/keys.ts`),
напиши UI component вызывающий `dismissOnboardingHint(accountId,
'new_hint_key')`, готово. Pattern проверен в `teacher_account_daily_digests.diagnostics`
JSONB (mig 0067) — schema-flexible, type-safe via TS whitelist.

---

## §3 Recovery surfaces

### §3.1 «Показать подсказки снова» button

Surfaces:
1. `/teacher/settings` footer (under HUB_ITEMS) (footer of settings hub) — для teacher-role.
2. `/cabinet/profile` (внизу страницы) — для learner-role.

Button POST `/api/onboarding-state/reset` → helper `resetOnboardingState()` →
`UPDATE account_onboarding_state SET dismissed_hints = '{}'::jsonb WHERE
account_id = $1` → возвращает 200 → client reload.

Hybrid teacher+learner: один row, reset из любой surface зануляет все hints
(teacher AND learner). Это документировано в UI tooltip над кнопкой: «Сброс
подсказок применяется ко всему кабинету».

### §3.2 Auto-resurfacing после regression detection

Если key в `dismissed_hints` старше 6 месяцев AND условие hint'а снова стало
true (например, teacher разорвал TG-binding) → auto-resurface (помечаем key
как stale в helper, скрываем при SSR). TBD condition по hint type — owner
decision; не входит в Sub-PR A scope.

### §3.3 Admin CLI `scripts/onboarding-reset.ts`

- **Run-time:** node CLI, не Next API route.
- **Args:** `node scripts/onboarding-reset.ts <account_id>` (UUID).
- **Validation:** account exists в `accounts` table → если нет, exit 1.
- **Action:** `UPDATE account_onboarding_state SET dismissed_hints = '{}'::jsonb
  WHERE account_id = $1`.
- **Audit:** INSERT в `auth_audit_events` (НЕ `payment_audit_events` — там
  `invoice_id NOT NULL` + FK на `payment_orders`, не подходит для
  non-payment событий). Расширить existing CHECK constraint новым
  `event_type = 'auth.onboarding.reset'` через mig 0100 (pattern из
  mig 0057:47 — drop+re-add). Actor = operator email из env
  `OPERATOR_EMAIL`, target = account_id.
- **Auth gate:** implicit — SSH-доступ к VPS + `DATABASE_URL` env (pattern из
  `scripts/db-retention-cleanup.mjs`, `scripts/teacher-daily-digest.mjs`).
- **Status:** ships в Sub-PR A с тем же contract что existing scripts.

---

## §3.5 Mobile considerations

- **Bottom-nav clearance:** см. §1.3 `ct-mobile-bottom-nav-clearance` CSS
  pattern. Использует `env(safe-area-inset-bottom)` + `var(--sticky-nav-height)`.
- **iPad split-view (≥768px):** sticky nav не рендерится (desktop nav active);
  `--sticky-nav-height: 0px` → tooltip не получает лишний bottom margin.
- **Landscape iPhone:** sticky nav может скрываться зависит от viewport
  height; safe-area-inset-bottom ≈ 0 → CSS resolves корректно.
- **iPhone SE 320px portrait:** все must-have hints стэкаются вертикально как
  `<section>` cards в normal flow; setup-checklist вверху home может сдвинуть
  «Ближайшие занятия» вниз — это acceptable trade-off (checklist важнее для
  пустого аккаунта).
- **Foldable Android:** split-screen → используем same media query pattern;
  не требует separate code path.

---

## §3.6 z-index strategy

| Slot type | Z-index | Position |
|-----------|---------|----------|
| Banner (SSR `<section>`) | normal flow | normal flow |
| Hover tooltip (calendar-dot) | 100 | absolute relative to anchor |
| Toast (`teacher-invite-copy-feedback`) | 1000 | fixed bottom-right |
| Celebration card | normal flow | normal flow |
| Tooltip overlay (modal-style) | 8000 | fixed centered |
| (reference: modal) | 7000 | (existing) |
| (reference: toast — already shipped) | 9000 | (existing) |

Только ONE toast одновременно (queue-based: если уже есть один — replace).
Tooltip overlay 8000 ниже toast 9000 — если показывается одновременно, toast
overlay'ит tooltip (intentional — toast — это feedback на actor).

---

## §3.7 Google OAuth callback (T3 calendar connect)

4 failure modes:

| Mode | Detection | UI |
|------|-----------|----|
| `consent_denied` | redirect c `?error=access_denied` | Red toast: «Вы отменили подключение календаря. Без него мы не сможем показать вашу занятость» |
| `partial_scope` | scope ≠ requested set | **Backend not implemented** — deferred to Sub-PR D + backend epic; пока silent fall-through на 'degraded' |
| `token_revoked` | sync error 401 invalid_grant | Yellow banner: «Подключение Google Calendar истекло. Подключите календарь заново» + CTA |
| `callback_db_write_fail` | DB error в OAuth callback handler | Generic «Что-то пошло не так. Попробуйте ещё раз через минуту» + retry |

**Tri-state calendar dot** (sidebar/nav indicator):

| State | Color | Trigger condition |
|-------|-------|-------------------|
| Connected | green | `getGoogleIntegrationMeta(teacher_id)?.syncState === 'active'` |
| Pending | amber | row отсутствует (`getGoogleIntegrationMeta() === null`) OR `syncState === 'degraded'` |
| Failed | red | `syncState === 'disconnected'` (verified — enum `lib/calendar/integrations.ts:34`) OR `lastError !== null` |

⚠️ **Backend reality (closes round-3 BLOCKER #1):** `getGoogleIntegrationMeta`
возвращает `{ syncState: 'active'\|'degraded'\|'disconnected', lastError, ... }`.
Никаких `.status` / `'connected'` / `'errored'` нет в enum. Если
Sub-PR B ships без backend — dot никогда не покажет red. Owner decision: или
(a) defer tri-state на Sub-PR D вместе с backend, или (b) ship Sub-PR B
backend extension одновременно. **Default:** (a) — Sub-PR B рендерит
two-state (connected/pending), Sub-PR D добавляет errored detection + red.

---

## §4 Sub-PR phasing

### §4.1 Dependency graph

```
A (foundation, no parallel work safe)
├── A0.1 pre-req: <DangerZone /> mount on /teacher/profile (separate PR)
├── A0.2 pre-req: verify-email role-aware redirect (SHIPPED in PR #458 ✓)
├── A0.3 pre-req: /login?invite=<token> redeem (DEFERRED to plan G)
├── mig 0100_account_onboarding_state.sql
├── lib/onboarding/keys.ts (whitelist)
├── lib/onboarding/state.ts (helper, NO DDL)
├── app/api/onboarding-state/reset/route.ts
└── scripts/onboarding-reset.ts (CLI)

B (teacher hints — depends on A)
├── app/teacher/page.tsx (setup-checklist, plan-limit-banner mount)
├── app/teacher/tariffs/ (tariff-first-create-hint)
├── app/teacher/packages/ (packages-vs-tariffs-explainer)
├── app/cabinet/teacher-invite-section.tsx (copy-feedback toast)
├── CT1 verify-email-pending-banner integration on /teacher/*
└── (Sub-PR B does NOT touch /cabinet/page.tsx learner section)

C (learner hints — depends on A; merge after B)
├── app/register/page.tsx (invite-from-teacher-name, already-registered-link)
├── app/cabinet/page.tsx (cabinet-tour-3steps)
├── app/cabinet/book/[ymd]/page.tsx (tz-reminder, after-book-reminder-channel)
├── app/cabinet/danger-zone.tsx (account-deletion-grace-explainer copy
│   — NOT mount; mount is in A0.1 / pre-existing in /cabinet/profile)
└── (rebases on B for shared `app/cabinet/page.tsx`)

D (nice-to-have polish — depends on A/B/C)
├── nice-to-have list из §1.4
├── pwa-install prompt (Android Chrome only)
├── auto-resurfacing TBD
├── tri-state calendar dot backend extension (if owner approves)
└── (Sub-PR D editor adds keys to ONBOARDING_HINT_KEYS whitelist)
```

⚠️ **B и C share `app/cabinet/page.tsx`** через CT-shared component
(`TeacherSection` + learner home). Merge conflict expected. Объявляем порядок:
**B → C** (учитель первый, learner вторая волна). C rebases на B.

⚠️ **B и C share `app/cabinet/danger-zone.tsx`** — Sub-PR A0.1 mount'ит
компонент на `/teacher/profile`; Sub-PR C добавляет copy внутри компонента
(`account-deletion-grace-explainer`). A merges first → C rebases на A.
Sub-PR B не трогает `danger-zone.tsx`.

### §4.2 Estimates

| Sub-PR | Solo / parallel | Estimate |
|--------|-----------------|----------|
| A (foundation) | solo, no parallel | ~6-8h |
| A0.1 (DangerZone mount) | included in pre-req PR | ~0.5h |
| A0.2 (verify-email redirect) | shipped в PR #458 | ✓ |
| A0.3 (/login?invite redeem) | requires owner decision | ~3-4h or 0h if drop |
| B (teacher must-have 5) | solo, после A | ~6h |
| C (learner must-have 5+2) | solo, после A + rebase B | ~5h |
| D (nice-to-have polish) | solo, после B,C | ~4h |

Sequential single-author total: ~22h. If A0.3 dropped: ~18h.

---

## §5 Open questions

1. **`/login?invite=<token>` redeem route** — pre-req для
   `learner-invite-already-registered-link`. Описан в plan G
   (`docs/plans/2026-05-31-cleanup-and-bugs.md`). Owner decision: ship plan G
   или drop hint.
2. **Tri-state calendar dot backend** — defer всё в Sub-PR D или ship в Sub-PR B?
   Default: defer.
3. **Auto-resurfacing condition** — какие hints возвращать через 6+ месяцев?
   TBD; не блокирует Sub-PR A.
4. **`account-deletion-recovery-on-login`** (Sub-PR D, nice-to-have): owner
   decision требует — если откажет от exposing `softDeleted: true` flag в
   `/api/auth/login` response (anti-enumeration valid concern), hint
   DROPPED из Sub-PR D scope. Default: drop (anti-enumeration > UX).
5. **PWA install prompt** — `beforeinstallprompt` event только на Android
   Chrome/Edge; iOS требует manual «Add to Home Screen». Sub-PR D ships
   Android-only prompt + iOS instruction tooltip как разные slots.

---

## §6 ZBA pre-req PRs

- **A0.1:** mount `<DangerZone />` on `/teacher/profile` (NEW PR before Sub-PR A).
- **A0.2:** verify-email role-aware redirect — ✅ **SHIPPED** в PR #458
  (commit be99ff4, `app/api/auth/verify/route.ts:81-86` теперь возвращает
  `/teacher` для teacher / `/admin/slots` для admin / `/cabinet` для остальных).
- **A0.3:** `/login?invite=<token>` redeem route — **DEFERRED** to plan G
  (`docs/plans/2026-05-31-cleanup-and-bugs.md`).

---

**End of onboarding-tooltips-spec-2026-05-31.md (round-2 closure → round-3 paranoia pending).**
