---
title: Onboarding flows — teacher + learner
status: PLANNING (round-3 BLOCK 2026-06-04 — 6 BLOCKER + 2 WARN + 1 INFO; closures pending; see /tmp/codex-paranoia-20260604T060827Z-onboarding/round-3.md and §0c at end of file)
date: 2026-05-31
owner: claude-orchestrator
---

# Onboarding flows — teacher + learner

## Goal

От регистрации до первого состоявшегося урока — измеримой точки
`lesson_completions` insert (см. `migrations/0092_lesson_completions.sql:34-48`,
колонка `teacher_id`). Это единственный billable-event SoT; `lesson_slots.status =
'completed'` — производная (forward trigger в mig 0092:77-89). Onboarding считаем
завершённым по факту первого insert'а в `lesson_completions` от учителя.

**Scope:** spec покрывает 2 happy-path journey (T0-T9 учитель, L0-L6 ученик), 3
edge-flow (T-forgot/T-resend/T-delete), 2 learner edge-flow (L-forgot,
L-multi-teacher-invite), и 3 cross-cutting concerns (CT1-CT3). Pain points
привязаны к real routes/files; каждый pain закрывается hint slot'ом из tooltip
spec'а (см. `onboarding-tooltips-spec-2026-05-31.md`).

**Persistence:** один shared table `account_onboarding_state` с JSONB
`dismissed_hints`; helper НЕ делает DDL (см. memory
`postgres_create_table_locks_during_active_tx.md`). Подробности в tooltip spec'е
§2-§2.3.

---

## §1.1 Teacher journey (T0-T9)

Маршрут от первого захода на сайт до первого «провёл» в админ-UI.

### T0 — Register

- **Route:** `app/register/page.tsx` с query-param `?role=teacher`.
- **What user sees:** форма регистрации, ниже — короткий explainer
  «LevelChannel — это инструмент для учителей: вы выставляете цены, ведёте
  расписание, приглашаете учеников. Денежные расчёты — напрямую между вами и
  учеником, без удержания платформой».
- **Pain point:** учитель не понимает, что платформа НЕ держит деньги — pre-pivot
  фрейминг (мы были payment processor) до сих пор живёт в памяти инвайт-владельцев.
  Без явного disclosure он будет ожидать webhook deposits через 5 минут после
  первого ученика.
- **Hint slot:** `teacher-register-saas-explainer` (must-have, см. tooltip spec §1.1).

### T1 — First login → /teacher

- **Route:** `app/teacher/page.tsx:1-50` (mobile-first home, 4 блока после PR #460:
  ближайшие занятия / приглашение / digest preview tile / мои ученики).
- **What user sees:** пустой timeline, пустой список учеников, инвайт-блок с
  CTA «Создать ссылку-приглашение».
- **Pain point:** учитель видит только timeline и invite-CTA — он не знает, что
  до первого приглашения **нужно** создать тариф (цена занятия) и подключить
  календарь. Setup-checklist отсутствует на главной.
- **Hint slot:** `teacher-home-setup-checklist` (must-have, SSR-rendered, 4
  пункта: профиль / тариф / календарь / первый инвайт). Trigger condition в
  tooltip spec §1.2 пункт 4 — `SELECT 1 FROM teacher_invites WHERE
  teacher_account_id = $1 LIMIT 1` (verified column name из mig 0057:23).

### T2 — Setup profile

- **Route:** `app/teacher/settings/page.tsx` (settings hub) →
  `app/teacher/profile/page.tsx`.
- **What user sees:** ProfileEditor (`displayName`, `firstName`, `lastName`,
  `timezone`).
- **Pain point:** профиль = опциональный по UI, но требуется для public
  teacher-slug (см. mig 0082) и для корректного RU plural в digest. Учитель
  пропускает шаг, потом digest приходит с `email@example.com` вместо имени.
- **Hint slot:** в `teacher-home-setup-checklist` (один из 4 пунктов).

### T3 — Connect calendar

- **Route:** `app/teacher/settings/calendar/` (connect-card).
- **What user sees:** «Подключить Google Calendar» CTA + value-prop card.
- **Pain points:**
  1. OAuth consent denied → 4 failure modes (см. tooltip spec §3.7).
  2. Token revoked через 6 месяцев → нужен «переподключите календарь»
     banner.
  3. Partial scope (только read) → degraded state (см. WARN #14 в r2 review).
- **Hint slot:** `teacher-calendar-dot-tooltip` (tri-state: connected/pending/failed)
  + tooltip spec §3.7 detailed failure-mode handling.

### T4 — Create tariff (цена занятия)

- **Route:** `app/teacher/tariffs/` (см. PR #458 — header renamed «Тарифы» →
  «Цены занятий» для UX clarity).
- **What user sees:** TariffEditor (titleRu, amountKopecks). Slug
  auto-derived на сервере (`tariff-editor.tsx:13-18` — нет slug picker).
- **Pain point:** учитель видит «Создать тариф» без объяснения, что это **цена
  одного занятия в копейках**, не подписка. Также не понимает, что после первой
  привязки к slot'у тариф immutable (цена закрепляется в snapshot'е).
- **Hint slot:** `teacher-tariff-first-create-hint` (must-have, empty-state).

### T5 — Create package (опционально)

- **Route:** `app/teacher/packages/`.
- **What user sees:** PackageEditor (count, total price).
- **Pain point:** учитель путает «тариф» и «пакет». Пакет = предоплата за N
  занятий со скидкой; тариф = цена за одно занятие postpaid. Без объяснения он
  создаёт пакет на 1 занятие = same as tariff, потом удивляется billing.
- **Hint slot:** `teacher-packages-vs-tariffs-explainer` (must-have, empty-state).

### T6 — Invite learner

- **Route:** `TeacherInviteSection` (`app/cabinet/teacher-invite-section.tsx` —
  переиспользуется на `/teacher` главной).
- **What user sees:** «Создать ссылку» → invite-row с copy-button.
- **Pain points:**
  1. Clipboard fail silent: `copyToClipboard` catch проглатывает ошибку без
     UI feedback (`teacher-invite-section.tsx:113-120` — verified).
  2. Plan-limit pressure: free тариф = 1 активный ученик. Без banner'а учитель
     не знает лимита до момента отказа сервера.
- **Hint slots:**
  - `teacher-invite-copy-feedback` (must-have, toast после клика — успех ИЛИ
    fallback с «выделите ссылку и скопируйте вручную»).
  - `teacher-invite-plan-limit-banner` (must-have, conditional: `M ≥ ceil(0.8 *
    N)` OR `M = N`, precedence — hard-limit first; RU plural через
    `pluralRu(n, 'активный ученик', 'активных ученика', 'активных учеников')`
    из `lib/copy/plural-ru.ts:13-19`).

### T7 — Learner registered

- **Event:** ученик прошёл `/register?invite=<token>` → `accounts` row + n:m
  link `learner_teacher_links`.
- **What user sees:** список «Мои ученики» (через `TeacherLearnersSection`)
  растёт на одну строку.
- **Pain point:** учитель не получает email/TG-notification «ваш ученик
  зарегистрировался». На главной просто увеличивается счёт — он может это не
  заметить, если был занят несколько дней.
- **Hint slot:** возможно `teacher-first-learner-arrived-celebrate` (nice-to-have,
  Sub-PR D).

### T8 — Learner booked slot

- **Event:** ученик создал/выбрал slot через `/cabinet/book/[ymd]`.
- **What user sees:** в timeline появляется новый slot со статусом `booked`.
- **Pain point:** учитель не знает, что после booking ему нужно вручную нажать
  «провёл» по факту состоявшегося занятия — нет автоматического trigger'а на
  `slot.end_at + 1h`.
- **Hint slot:** см. T9.

### T9 — First lesson completed

- **Event:** учитель кликает «провёл» → POST в API → insert в
  `lesson_completions` (verified: `migrations/0092_lesson_completions.sql:38`,
  колонка **`teacher_id`** — round-2 BLOCKER #3 закрыт; round-1 spec ошибочно
  использовал несуществующую колонку, см. r1 review).
- **What user sees:** slot переходит в `completed` (forward trigger в
  mig 0092:77-89); в `/teacher/learners/<id>` появляется ledger entry.
- **Pain point:** если учитель НИКОГДА не кликнет «провёл», `lesson_slots`
  остаётся `booked` навсегда → onboarding не «завершается». Это **edge** для
  postpaid (см. memory `pkg_learner_buy_activated.md` — debit happens on
  completion).
- **Hint slot:** `teacher-first-slot-mark-completed` (must-have, SSR-rendered
  banner когда есть `lesson_slots` со status='booked' AND `start_at < now()`
  AND нет соответствующей строки в `lesson_completions`).
- **SQL contract:**
  ```sql
  -- T9 hint visibility predicate:
  WITH past_booked AS (
    SELECT id FROM lesson_slots
     WHERE teacher_account_id = $1
       AND status = 'booked'
       AND start_at < now()
     LIMIT 1
  )
  SELECT (
    EXISTS (SELECT 1 FROM past_booked)
    AND NOT EXISTS (
      SELECT 1 FROM lesson_completions
       WHERE teacher_id = $1
         AND created_at > now() - interval '30 days'
       LIMIT 1
    )
  ) AS show_hint;
  ```
  ⚠️ Колонка `marked_by_account_id` (mig 0092:46) НЕ используется — она пишется
  только при admin/operator un-mark.

---

## §1.2 Learner journey (L0-L6)

### L0 — Invite email

- **Trigger:** учитель кликает «Скопировать ссылку», шлёт ученику в любом
  канале (email/TG/WhatsApp — наша сторона ничего не доставляет автоматически).
- **Pain point:** ученик получает голую URL без preview. Если он откроет в
  desktop где залогинен под другим аккаунтом — попадёт на confusing page.

### L1 — Register via invite link

- **Route:** `app/register/page.tsx:14-19` (verified — preview API out of scope).
- **What user sees:** форма регистрации; имя учителя НЕ показано в форме (нужно
  делать `/api/teacher/invites/<id>/preview` — sub-PR C).
- **Pain point:** ученик не уверен, кого именно он «принимает» (см. r1 BLOCKER
  ничего, но это известный gap из spec'а).
- **Hint slot:** `learner-invite-from-teacher-name` (must-have, SSR-fetch
  `teacher_account_id` из `teacher_invites` mig 0057:23 → load
  `account_profiles.display_name`).

### L2 — First login → /cabinet

- **Route:** `app/cabinet/page.tsx:1-50` (mobile-first learner home).
- **What user sees:** «Мои занятия» (пусто), «Пакеты», «Профиль», banner
  email-verification если не verified.
- **Pain point:** ученик не понимает, что делать дальше — нужен 3-step tour
  «Купить пакет → Выбрать slot → Подключить TG».
- **Hint slot:** `learner-first-cabinet-tour-3steps` (must-have).

### L3 — Buy package (опционально для postpaid)

- **Route:** `app/cabinet/packages/page.tsx`.
- **What user sees:** список пакетов учителя с CTA «Купить».
- **Pain point:** ученик не понимает разницу пакет vs postpaid. Учителю
  выгоднее, чтобы ученик купил пакет (предоплата); ученик не понимает выгоду.
- **Hint slot:** опциональный (nice-to-have, Sub-PR D — `learner-postpaid-explained`).

### L4 — View slots

- **Route:** `app/cabinet/book/page.tsx`, `app/cabinet/book/[ymd]/page.tsx:128`.
- **What user sees:** сетка времени учителя в его tz (см. mig 0082 → teacher
  timezone). Текст «Времена показаны в [Europe/Moscow]» — это hardcoded IANA
  id, не human label. **Design fix deferred** в onboarding scope (раздельный
  design polish PR должен заменить IANA на label).
- **Pain points:**
  1. tz confusion: учитель в Europe/Moscow, ученик в Asia/Yekaterinburg →
     ученик смотрит на «10:00» думая что это его 10:00 локально.
  2. Hardcoded «50 мин» и «📹 Ссылку на встречу пришлёт учитель — обычно за
     день до занятия» (PR #458 закрыл false-promise; см. book/page.tsx:144-145
     verified) — но 50 мин всё ещё hardcoded; это отдельный bug-fix вне
     onboarding scope.
- **Hint slot:** `learner-book-tz-reminder` (must-have, copy без
  self-contradiction: «Времена показаны в вашем часовом поясе ({tz}). Не в
  вашем? [Поменять в профиле →]»).

### L5 — Book slot

- **Event:** ученик кликает на slot → POST `/api/learner/book` → slot.status
  переходит на `booked`, ученик receives confirmation.
- **What user sees:** redirect на `/cabinet` с success banner.
- **Pain point:** после booking ученик не подключил TG → не получит reminder
  за 24 часа. Email reminder отправляется, но Telegram channel **уже live** с
  2026-05-19/20 (см. memory `2026-05-19-20-epic-wave.md`,
  `components/cabinet/learner-telegram-binding.tsx`, mig 0070).
- **Hint slot:** `learner-after-book-reminder-channel` (must-have, deep-link на
  `/cabinet/profile#telegram` — UI live; respects master switch
  `LEARNER_REMINDERS_TELEGRAM_ENABLED` из `lib/admin/operator-settings.ts:341-346`,
  resolver helper из той же модули).

### L6 — First completed lesson

- **Event:** учитель кликает «провёл» (см. T9) → insert в `lesson_completions`.
- **What user sees:** ничего автоматического в `/cabinet` UI — нет «1 урок
  состоялся» celebration card.
- **Pain point:** L6 завершает onboarding для ученика, но нет visible feedback.
- **Hint slot:** nice-to-have `learner-first-completed-celebrate` (Sub-PR D).

---

## §1.5 Teacher edge journeys (T-extra)

Закрывают round-1 BLOCKER #1 — пропущенные системные flow.

### T-forgot — Forgot password

- **Routes:** `app/login/page.tsx` → ссылка «Забыли пароль?» → `app/forgot/page.tsx`
  → submit form → `app/api/auth/reset-request/route.ts` → email с reset
  link → `app/reset/page.tsx`. Все routes verified существуют.
- **Pain points:**
  1. На `/login` нет prominent «Забыли пароль?» ссылки в первом экране формы —
     учитель не находит её без скролла.
  2. Validity period reset token'а (24h) нигде не показан — учитель кликает на
     старую ссылку через неделю, видит generic error «недействительно» без
     instructions «запросить новую».
- **Hint slots:**
  - `teacher-forgot-link-emphasis` (nice-to-have, Sub-PR D — добавить отдельную
    ссылку под формой login).
  - `teacher-reset-token-validity-hint` (nice-to-have, Sub-PR D).

### T-resend — Verify email resend

- **Routes:** `app/api/auth/resend-verify/route.ts` УЖЕ существует (verified);
  `<ResendVerifyButton />` уже встроен в `app/cabinet/page.tsx:212` (см. r1
  INFO #15).
- **Pain point:** route есть, кнопка есть, но **на `/teacher` главной**
  banner verify-email-pending **отсутствует**. Учитель, который пришёл на /teacher
  с непроверенным email, не видит призыва verify; он узнаёт о проблеме только
  когда попадает на `/cabinet` (старая поверхность).
- **Hint slot:** см. CT1 cross-cutting (header banner).

### T-delete — Account deletion grace

- **Routes:** `app/cabinet/danger-zone.tsx:12-13` (verified — 30-day grace,
  reversible by operator).
- **Pain points:**
  1. Учитель кликнул «Удалить аккаунт» по ошибке — нет UI affordance «вернуть
     обратно в grace window». Restore — admin-only.
  2. `<DangerZone />` смонтирован только в `/cabinet/profile/page.tsx:135`
     (verified). На `/teacher/profile/page.tsx:132` его НЕТ → учитель не видит
     «Выход» и «Удалить аккаунт» в своём mobile-first flow. **Pre-req A0.1**.
- **Hint slot:** `account-deletion-grace-explainer` (must-have, добавляется
  как copy внутри `<DangerZone />` — Sub-PR C, после Sub-PR A pre-req A0.1
  смонтировал компонент на teacher-side).

---

## §1.6 Learner edge journeys (L-extra)

### L-forgot — Forgot password

То же что T-forgot но из learner-side; те же routes, тот же flow. Pain points
идентичны. Hint slots — `learner-forgot-*` (nice-to-have, Sub-PR D).

### L-multi-teacher-invite

**Scenario:** ученик А учится у учителя А1; учитель А2 приглашает ученика А по
`/register?invite=<token>`. Но ученик уже зарегистрирован → форма register
выдаст «email уже занят», ученик в тупике.

- **Pre-req gap:** `/login?invite=<token>` redeem route НЕ существует
  (`app/login/page.tsx` не обрабатывает `?invite` query param — verified).
  Это **plan G** в `docs/plans/2026-05-31-cleanup-and-bugs.md`.
- **Hint slot:** `learner-invite-already-registered-link` (must-have, **depends
  on plan G** route shipping). Если plan G dropped → hint понижается до
  nice-to-have в Sub-PR D, иначе становится 404 dead-end.

---

## §1.7 Cross-cutting (CT1-CT3)

### CT1 — Header banner verify-email-pending

- **Surface:** все authenticated routes (`/teacher/*`, `/cabinet/*`). Currently
  banner живёт только в `/cabinet/page.tsx:212-220` (ResendVerifyButton).
- **Pain point:** учитель на mobile-first `/teacher` главной не видит
  напоминания → email верификация откладывается на дни/недели.
- **Hint slot:** `verify-email-pending-banner` (must-have, SSR — переиспользует
  ResendVerifyButton). Sub-PR B touches `app/teacher/page.tsx` + shared layout.

### CT2 — Mobile bottom-nav clearance для tooltip popovers

- **Pain point:** sticky bottom-nav (cabinet + teacher mobile-first, см. memory
  `cabinet_mobile_first_restructure.md`) overlap'ет с tooltip popover'ами,
  которые рендерятся в bottom-of-viewport. Tooltip обрезается на 56px.
- **Pattern (см. tooltip spec §3.5):**
  ```css
  margin-bottom: calc(env(safe-area-inset-bottom, 0px) + var(--sticky-nav-height, 0px) + 16px);
  ```
  с `--sticky-nav-height: 56px` только в mobile media query (`max-width: 900px`).
- **Hint slot:** `ct-mobile-bottom-nav-clearance` (must-have, CSS utility +
  applied to all tooltip variants).

### CT3 — Network failure recovery

- **Pain point:** учитель/ученик потерял сеть в середине action (create tariff,
  book slot). Сейчас — generic error toast без retry option.
- **Surface:** `lib/api/postAuthJson` (existing). Spec'у нужно добавить
  «Connection lost — retry?» UX pattern.
- **Hint slot:** nice-to-have (Sub-PR D — `ct-network-failure-retry`).

---

## §2 Pain-points summary table

| ID | Route / file:line | Pain | Hint slot | Priority |
|----|-------------------|------|-----------|----------|
| T0 | `app/register/page.tsx` (role=teacher) | Учитель думает что мы payment processor | `teacher-register-saas-explainer` | must |
| T1 | `app/teacher/page.tsx:1-50` | Нет setup checklist на пустом home | `teacher-home-setup-checklist` | must |
| T2 | `app/teacher/profile/page.tsx:132` | Профиль опционален по UI, не по факту | (в T1 checklist) | must |
| T3 | `app/teacher/settings/calendar/` | 4 OAuth failure modes silent | `teacher-calendar-dot-tooltip` (tri-state) | must |
| T4 | `app/teacher/tariffs/` | «Тариф» ≠ ясно что цена занятия | `teacher-tariff-first-create-hint` | must |
| T5 | `app/teacher/packages/` | Путаница «пакет» vs «тариф» | `teacher-packages-vs-tariffs-explainer` | must |
| T6.1 | `app/cabinet/teacher-invite-section.tsx:113-120` | Clipboard fail silent | `teacher-invite-copy-feedback` | must |
| T6.2 | `app/cabinet/teacher-invite-section.tsx` | Plan-limit без warning | `teacher-invite-plan-limit-banner` (cond) | must |
| T7 | `TeacherLearnersSection` | Нет notify «ученик зарегистрировался» | `teacher-first-learner-arrived-celebrate` | nice |
| T8 | `/teacher/calendar` | Нет «надо нажать провёл» | (в T9 banner) | must |
| T9 | mig 0092: `lesson_completions.teacher_id` | Учитель не помечает completed | `teacher-first-slot-mark-completed` | must |
| L1 | `app/register/page.tsx:14-19` | Имя учителя не показано | `learner-invite-from-teacher-name` | must |
| L2 | `app/cabinet/page.tsx:1-50` | Нет 3-step tour | `learner-first-cabinet-tour-3steps` | must |
| L4.1 | `app/cabinet/book/[ymd]/page.tsx:128` | tz confusion | `learner-book-tz-reminder` | must |
| L4.2 | `app/cabinet/book/page.tsx:144-145` | 50 мин hardcoded | (отдельный bug-fix PR, не tooltip) | n/a |
| L5 | `components/cabinet/learner-telegram-binding.tsx` | TG binding live, но не promoted | `learner-after-book-reminder-channel` | must |
| L6 | (нет UI) | Нет celebration «1 урок состоялся» | `learner-first-completed-celebrate` | nice |
| T-forgot | `app/login/page.tsx` | «Забыли пароль?» не prominent | `teacher-forgot-link-emphasis` | nice |
| T-resend | `app/teacher/page.tsx` | Verify-email banner only на /cabinet | (CT1) | must |
| T-delete | `app/teacher/profile/page.tsx:132` | DangerZone отсутствует | `account-deletion-grace-explainer` + pre-req A0.1 | must |
| L-multi | `app/login/page.tsx` (no `?invite` handling) | Email занят → тупик | `learner-invite-already-registered-link` (depends on plan G) | must (conditional) |
| CT1 | shared layout `/teacher/*` | Verify-email banner отсутствует | `verify-email-pending-banner` | must |
| CT2 | global CSS | Bottom-nav overlap tooltip | `ct-mobile-bottom-nav-clearance` | must |
| CT3 | `lib/api/postAuthJson` | Network failure без retry | `ct-network-failure-retry` | nice |

**Must-have total:** 12 (5 teacher + 5 learner + 2 cross-cutting). Nice-to-have:
~10 (Sub-PR D scope, см. tooltip spec §4).

---

## §3 Open questions

1. **Verify-email role-aware redirect** — ✅ **SHIPPED** в PR #458 (commit
   be99ff4, `app/api/auth/verify/route.ts:81-86`). Закрыто.
2. **`/login?invite=<token>` redeem route** — pre-req для
   `learner-invite-already-registered-link`. Описан в plan G
   (`docs/plans/2026-05-31-cleanup-and-bugs.md`).
3. **`lesson_completions` insert trigger** — manual «провёл» button vs auto на
   `slot.end_at + 1h`? Owner decision. **Default:** manual (соответствует
   текущему flow; auto-trigger требует separate epic).
4. **Free тариф edge для plan-limit banner** — M=0, N=1 → банер скрыт. M=1,
   N=1 → банер показан как hard-limit. Precedence в SQL: `if (M === N) hard;
   else if (M >= ceil(0.8 * N)) soft; else hidden`.
5. **RU plural verify** — для `pluralRu(1, "активный ученик", "активных ученика",
   "активных учеников")`:
   - N=1 → «активный ученик» (nominative singular)
   - N=2 → «активных ученика»
   - N=5 → «активных учеников»
   - N=11 → «активных учеников» (mod100 = 11 → many)
   Verify против `tests/scripts/plural-ru.drift.test.mjs` (если существует).
6. **`<DangerZone />` mount на `/teacher/profile`** — pre-req A0.1 (Sub-PR A
   мерджит mount; Sub-PR C добавляет copy внутри `<DangerZone />`).

---

## §4 ZBA pre-req PRs

Ordered list pre-requisite PRs, которые должны merge ДО первого Sub-PR
основной волны (Sub-PR A foundation).

### A0.1 — Mount `<DangerZone />` on `/teacher/profile`

- **File:** `app/teacher/profile/page.tsx:132` (currently renders только
  `<ProfileEditor />`).
- **Change:** добавить `<DangerZone />` import + render после ProfileEditor.
- **Estimate:** ~0.5h.
- **Status:** NEW PR before Sub-PR A.

### A0.2 — Verify-email role-aware redirect

- ✅ **SHIPPED** in PR #458 (commit be99ff4). `app/api/auth/verify/route.ts:81-86`
  теперь возвращает `/teacher` для teacher-role / `/admin/slots` для admin /
  `/cabinet` для остальных. Verified.

### A0.3 — `/login?invite=<token>` redeem route

- **Deferred** to plan G (`docs/plans/2026-05-31-cleanup-and-bugs.md`).
- **Status:** owner decision pending — ship before Sub-PR A OR drop
  `learner-invite-already-registered-link` hint.
- **Default:** ship via plan G as separate PR before Sub-PR C.

---

## §5 Cross-references

- Tooltip catalog: `docs/plans/onboarding-tooltips-spec-2026-05-31.md`.
- Cleanup wave + paranoia tracking: `docs/plans/2026-05-31-cleanup-and-bugs.md`.
- Memory: `~/.claude/projects/-Users-ivankhanaev-LevelChannel/memory/postgres_create_table_locks_during_active_tx.md`
  (no schema mutation в helpers).
- Memory: `~/.claude/projects/-Users-ivankhanaev-LevelChannel/memory/cabinet_mobile_first_restructure.md`
  (mobile-first nav layout).

---

**End of onboarding-flows-2026-05-31.md (round-2 closure → round-3 paranoia pending).**

---

## §0c — Plan-paranoia round-3 findings (recorded 2026-06-04, BLOCK; closures deferred)

Codex paranoia round 3 returned BLOCK with 6 BLOCKERs + 2 WARNs + 1 INFO. Raw output: `/tmp/codex-paranoia-20260604T060827Z-onboarding/round-3.md`. **Foundation files (`lib/onboarding/state.ts`, `lib/onboarding/keys.ts`, `auth.onboarding.reset` audit event, mig 0100) ALREADY exist in main** — the plan-pair is stale relative to shipped state, and Sub-PR A scope needs to be re-evaluated (extend the existing helper vs rename to a new module).

| # | Severity | Summary | Closure approach |
|---|---|---|---|
| 1 | BLOCKER | Sub-PR A missing the principal mutation-surface contract: pair describes `lib/onboarding/state.ts`, reset-route, and CLI but NOT `POST /api/onboarding/dismiss-hint` body shape, `requireAuthenticated`, self-only `accountId` derivation, account-scoped rate-limit, idempotent repeat-dismiss, 400 on unknown key. (pair:761-807, 849-879, 952-960) | Add `§Sub-PR A.2 — dismiss-hint API contract` to tooltip spec: body `{ hintId: string }`, auth = `requireAuthenticated`, account scope from session (NEVER from body), `enforceAccountRateLimit('onboarding-dismiss', N/min)`, key whitelist via `ONBOARDING_HINT_KEYS` constant, 400 `unknown_key` / 401 anon / 429 rate-limit / 200 idempotent. |
| 2 | BLOCKER | CT1 (verify-email banner on `/teacher/*`) targets an unreachable state — current SSR gate redirects unverified teachers from `/teacher` to `/cabinet` (`app/teacher/layout.tsx:50-60`; pinned in `evals/URL_REDIRECT_CONTRACT.md:57-65`). | Either drop CT1-teacher from spec OR ship explicit gate change + redirect-contract update first (separate epic). Default: drop. |
| 3 | BLOCKER | `learner-after-book-reminder-channel` mounted at wrong route. Spec puts hint on `app/cabinet/book/[ymd]/page.tsx`, but real post-book success path is `router.push('/cabinet?booked=1')` → banner in `LessonsSection` (`app/cabinet/lessons-section.tsx:457-483`). Must-have hint would never render. | Re-mount the hint on `app/cabinet/page.tsx` SSR block reading `?booked=1` query, OR in `LessonsSection` next to the post-book banner. |
| 4 | BLOCKER | `learner-book-tz-reminder` reads wrong SoT. Spec compares browser tz vs `teacher_tz`, but booking flow renders times in learner profile tz (`app/cabinet/book/[ymd]/page.tsx:55-57,121-129`; `app/cabinet/book/[ymd]/time-list.tsx:23-29,54-57`). | Rewrite §learner-book-tz-reminder copy + trigger to compare against learner-profile-tz (the actual SoT) instead of teacher_tz. |
| 5 | BLOCKER | T9 SQL contradicts wave-completion definition: §Goal says "onboarding complete on first `lesson_completions` insert", but T9 SQL hides the hint only if completion was in last 30 days. After day 31 the "first completed" hint re-appears. (pair:12-16, 156-177) | Rewrite `teacher-first-slot-mark-completed` predicate to `EXISTS(SELECT 1 FROM lesson_completions WHERE teacher_id=$1)` (ever-completed), not rolling 30d. |
| 6 | BLOCKER | Privacy/deletion gap — `account_onboarding_state` lives in a separate row keyed by `account_id`, but `scripts/db-retention-cleanup.mjs` anonymisation pass doesn't scrub it. Per-account behavioral state survives purge. (pair:734-757; `app/api/account/delete/route.ts:21-27`; `scripts/db-retention-cleanup.mjs:133-245`) | Add explicit purge-hook + integration test to `db-retention-cleanup.mjs` covering `account_onboarding_state`. Plan must include the scrub SQL + test. |
| 7 | WARN | **Plan stale relative to main.** Pair describes mig 0100, `lib/onboarding/keys.ts`, `lib/onboarding/state.ts`, `auth.onboarding.reset` as future foundation — these are already shipped. Sub-PR A scope must be re-decided: extend existing helper vs new `dismiss-hint.ts` module. (`lib/onboarding/state.ts:1-109`; `lib/onboarding/keys.ts:1-42`; `lib/audit/auth-events.ts:38-48`) | Rewrite §Sub-PR A: foundation = DONE (mark explicitly); remaining Sub-PR A scope = `POST /api/onboarding/dismiss-hint` route + component shell. Tighten the spec to reflect what's already in main. |
| 8 | WARN | Sub-PR A test matrix absent. For an auth-boundary + whitelist + reset/dismiss + delete/purge coupling, "4 integration cases" is too thin. Existing repo coverage is unit on keys only. | Spec Sub-PR A test matrix explicitly: auth (anon 401, learner self 200, teacher self 200, learner-A-on-learner-B 403); whitelist (unknown key 400); idempotent (repeat-dismiss same key 200); rate-limit (>N/min 429); purge (`db-retention-cleanup` clears the row). |
| 9 | INFO | mig 0100 indexes adequate — helper reads/writes by `account_id` only, PK gives needed btree; no JSONB-key index needed until query-by-content lands. | No change required; document the decision in §schema for traceability. |

**Round-4 prep work (deferred):** rewrite Sub-PR A scope (foundation already shipped), add dismiss-hint API contract + test matrix to tooltip spec, fix CT1/learner-tz/T9 contracts, add purge-hook + test. Estimated 150-250 plan-doc lines + decision on extend-vs-rename helper.

---

## §0d — Round-3 closures (2026-06-04, supersede contradictions in §0c)

This section is the authoritative closure for the round-3 findings recorded in §0c. Where §0d contradicts older inline text, §0d wins.

### Closure #1 (BLOCKER#1 — dismiss-hint API contract)

**Fact:** `lib/onboarding/state.ts` already exports `dismissOnboardingHint(accountId, key)` and `getOnboardingState(accountId)` + `resetOnboardingState(accountId)` (SHIPPED in main). There is NO HTTP endpoint yet — the helper is callable only from server contexts.

**Closure:** add the canonical mutation surface `POST /api/onboarding/dismiss-hint`:

- **File:** `app/api/onboarding/dismiss-hint/route.ts` (NEW).
- **Method:** POST.
- **Body:** `{ hintId: string }` — the kebab-case key from `lib/onboarding/keys.ts` whitelist.
- **Auth:** `requireAuthenticatedAccount(request)` from `lib/auth/guards.ts` — accept ANY authenticated account (learner/teacher/admin), reject anonymous with 401. **`accountId` derives from session** — never from body (anti-spoof).
- **Rate-limit:** `enforceAccountRateLimit('onboarding-dismiss', 30 / minute)` per account (small ceiling — repeated dismissal is idempotent but no need for spam).
- **Whitelist:** validate `hintId` against `ONBOARDING_HINT_KEYS` constant from `lib/onboarding/keys.ts`; unknown key → 400 `unknown_key`.
- **Idempotency:** repeated dismiss returns 200 with the same shape; no error.
- **Return shape:** `{ ok: true, hintId, dismissedAt: iso8601 }`.
- **Origin gate:** `enforceTrustedBrowserOrigin(request)` (same-site-only, per cabinet convention).
- **Tests:** see §0d Closure #8 test matrix.

### Closure #2 (BLOCKER#2 — drop CT1 verify-email banner for /teacher/*)

**Fact:** the SSR gate in `app/teacher/layout.tsx:50-60` redirects unverified teachers from `/teacher/*` to `/cabinet`. `evals/URL_REDIRECT_CONTRACT.md:57-65` pins this redirect. A banner on `/teacher/*` is unreachable.

**Closure:** DROP the CT1 verify-email banner from the spec entirely for teachers. The verify-email surface lives at `/cabinet` (where the unverified teacher actually lands). Either:
- Surface the verify-email reminder on `/cabinet/page.tsx` when the redirected account has `role='teacher'` AND `verified_at IS NULL` (showing role-aware copy "Подтвердите email чтобы вернуться в кабинет учителя").
- OR drop the teacher-side CT1 entirely; the existing `/cabinet` verify-email flow already handles this.

Default: drop CT1 for teachers (the redirect itself already communicates the gate; an additional banner is noise).

### Closure #3 (BLOCKER#3 — learner-after-book-reminder mount location)

**Fact:** post-book success path is `app/cabinet/book/[ymd]/[slotId]/confirm-form.tsx:51-54` → `router.push('/cabinet?booked=1')`. Banner lives in `app/cabinet/lessons-section.tsx:457-483`. The tooltip-spec mount on `app/cabinet/book/[ymd]/page.tsx` would never render.

**Closure:** re-mount `learner-after-book-reminder-channel` on `app/cabinet/page.tsx` reading `?booked=1` SSR. The hint sits adjacent to the success banner in `LessonsSection`. Specifically:

- **Trigger:** SSR — `searchParams.booked === '1'` AND `dismissed_hints.learner_after_book_reminder_channel === undefined`.
- **Copy:** «Чтобы не забыть про занятие, подключите напоминания: Telegram или email» + CTA to `/cabinet/settings/reminders`.
- **Mount file:** `app/cabinet/page.tsx` (top of `LessonsSection`'s post-book branch — see line 457+).

### Closure #4 (BLOCKER#4 — learner-book-tz-reminder SoT)

**Fact:** `app/cabinet/book/[ymd]/page.tsx:55-57,121-129` and `app/cabinet/book/[ymd]/time-list.tsx:23-29,54-57` render times in **learner profile timezone**, not teacher_tz. Comparing browser tz to teacher_tz raises false positives.

**Closure:** rewrite `learner-book-tz-reminder` trigger + copy:

- **Trigger:** browser tz (from `Intl.DateTimeFormat().resolvedOptions().timeZone`) differs from learner-profile tz (from `account_profiles.timezone` per mig 0069). If learner-profile tz is missing OR equals browser tz, hide the hint.
- **Copy:** «Времена показаны в вашем часовом поясе ({learner_tz}). Если вы сейчас в другом, обновите часовой пояс в профиле перед бронированием.»
- **CTA:** `/cabinet/profile#timezone`.

### Closure #5 (BLOCKER#5 — T9 hint condition is ever-completed)

**Fact:** §Goal at line 12-16 says "onboarding complete on first `lesson_completions` insert". T9 SQL at line 156-177 uses a rolling-30-day window for the `teacher-first-slot-mark-completed` hint — after day 31 the hint re-appears for an already-onboarded teacher.

**Closure:** change the predicate from rolling-30d to ever-completed:

```sql
-- T9 trigger predicate
SELECT NOT EXISTS (
  SELECT 1 FROM lesson_completions
   WHERE teacher_id = $1
) AS hint_needed;
```

If a teacher has ANY completion ever, the hint is hidden. This matches the §Goal definition of "onboarding complete".

### Closure #6 (BLOCKER#6 — db-retention-cleanup scrubs account_onboarding_state)

**Fact:** `app/api/account/delete/route.ts:21-27` schedules anonymization via `db-retention-cleanup.mjs:133-245`; the script does NOT scrub `account_onboarding_state`. Per-account behavioral state survives the purge.

**Closure:** add `account_onboarding_state` to the cleanup script's table list:

- **File:** `scripts/db-retention-cleanup.mjs`.
- **Add to the anonymization sweep:** `DELETE FROM account_onboarding_state WHERE account_id IN (<grace-expired-account-ids>)`.
- **Integration test:** verify a grace-expired account's onboarding row is deleted by the cleanup pass.

This is Sub-PR A scope (foundation purge-hook lives alongside the API route).

### Closure #7 (WARN — plan stale; foundation shipped)

**Fact:** `mig 0100_account_onboarding_state.sql`, `lib/onboarding/state.ts`, `lib/onboarding/keys.ts`, `auth.onboarding.reset` audit event — all SHIPPED in main.

**Closure:** the spec's "Sub-PR A foundation" scope is REDUCED to:
- New: `app/api/onboarding/dismiss-hint/route.ts` (Closure #1).
- New: `scripts/db-retention-cleanup.mjs` extension (Closure #6).
- New: integration test file `tests/integration/onboarding/dismiss-hint.test.ts` (Closure #8).
- New: optional `<HintCard />` component shell (deferred to Sub-PR B/C; foundation does NOT need a default UI).

The helper + migration + keys + audit are already SHIPPED. The spec's "Sub-PR A creates `lib/onboarding/dismiss-hint.ts`" is wrong — that module already exists as `lib/onboarding/state.ts`.

### Closure #8 (WARN — Sub-PR A test matrix)

**Closure:** integration test cases for `POST /api/onboarding/dismiss-hint`:

1. **Auth:** anonymous → 401.
2. **Auth:** learner self-call → 200 + state row written.
3. **Auth:** teacher self-call → 200 + state row written.
4. **Auth boundary:** learner A cannot affect learner B's state (body `accountId` ignored — derived from session only).
5. **Whitelist:** unknown `hintId` → 400 `unknown_key`.
6. **Idempotent:** repeat-dismiss same key → 200 (same response shape).
7. **Rate-limit:** > N/min → 429.
8. **Purge:** `db-retention-cleanup.mjs` against a grace-expired account → onboarding row deleted (Closure #6).

### Closure #9 (INFO — mig 0100 indexes)

No change. PK already gives needed btree; helper queries by `account_id` only. JSONB-key index unnecessary until query-by-content lands.

---

**Status after §0d applied:** round-3 BLOCKER findings each have a written closure. Round-4 codex run will verify: (a) closures are coherent, (b) no new BLOCKERs opened, (c) Sub-PR A remaining scope is correctly bounded (API + purge-hook + tests).

---

## §0e — Round-4 closures (2026-06-04, supersedes contradictions in §0d)

Round 4 surfaced 3 BLOCKERs + 1 WARN + 1 INFO against §0d. All closed concretely; §0e supersedes §0d where they conflict.

### Closure for BLOCKER #1 (Closure #6 — purge belongs per-account, not bulk-table)

§0d's "add to anonymization sweep" wording is wrong. `scripts/db-retention-cleanup.mjs:141 purgeAccounts()` is per-account: it selects grace-expired accounts, opens a TX per account, re-runs `deletionGuardForAccount()` inside the TX, and **skips** purge when the guard reports an in-flight package grant. A blind `DELETE FROM account_onboarding_state WHERE account_id IN (...)` table-level sweep would delete state even for deferred accounts.

**Fix:** the `account_onboarding_state` delete lives INSIDE the per-account TX, AFTER the deletion-guard check passes, BEFORE the per-account commit. Concretely (pseudocode inside `purgeAccounts` per-account loop):

```js
// scripts/db-retention-cleanup.mjs (per-account TX body, after guard pass)
await client.query('begin')
const guard = await deletionGuardForAccount(client, account.id)
if (!guard.ok) {
  await client.query('commit')  // commit nothing — guard deferred
  continue
}
// Existing anonymisation steps (UPDATE accounts SET email=anon, ...; etc.)
// NEW: scrub onboarding state in the SAME TX so guard-deferred accounts retain it.
await client.query(
  `delete from account_onboarding_state where account_id = $1`,
  [account.id],
)
await client.query('commit')
```

Integration test extends to:
1. Account A grace-expired, no guard hit → onboarding row deleted alongside other anonymisation.
2. Account B grace-expired, deletion-guard defers (in-flight package grant) → onboarding row PRESERVED until guard clears.

### Closure for BLOCKER #2 (Closure #2 — CT1 reachable verify path)

§0d's "drop CT1, existing /cabinet verify banner already handles unverified teachers" is wrong. The route graph creates a redirect loop:

- `/teacher/*` redirects unverified teacher to `/cabinet` (`app/teacher/layout.tsx:50`).
- `/cabinet/page.tsx:90+` (added 2026-06-02) redirects teacher-only accounts (no `student` role) BACK to `/teacher`.

For a teacher-only unverified account, this is unreachable surface, not "existing".

**Fix:** the `/cabinet` teacher-only redirect must NOT fire when the teacher is also unverified — keep them on `/cabinet` so the existing verify-banner is visible. Concretely amend `app/cabinet/page.tsx` redirect:

```typescript
// app/cabinet/page.tsx:90+ (existing teacher-only redirect)
// CURRENT (creates loop with /teacher/layout redirect):
if (isTeacher && !isStudent) redirect('/teacher')
// FIX (Closure #2): unverified teacher-only stays on /cabinet to see verify banner.
if (isTeacher && !isStudent && account.verifiedAt !== null) redirect('/teacher')
```

With that one-line change:
- Unverified teacher: `/teacher` → `/cabinet` (no further redirect because `verifiedAt === null` short-circuits the cabinet teacher-only redirect). Verify-email banner renders. CT1 hint can now be hosted on `/cabinet` for the unverified-teacher case. 
- Verified teacher: `/teacher` renders normally; `/cabinet` still redirects to `/teacher`.
- Learner / admin paths unchanged.

This is a **prerequisite for Sub-PR A** that lands in the SAME PR (`app/cabinet/page.tsx` one-line change + integration test for the verify-banner-on-cabinet path for unverified teacher-only). After that, CT1 can either:
- (a) Stay in the spec as a Sub-PR C item (hint on `/cabinet` with key `verify_email_reminder`) — RECOMMENDED.
- (b) Drop entirely if the existing verify-banner is judged sufficient — Sub-PR D decides.

§0d's "default drop" is rescinded; CT1 stays planned, target route is `/cabinet`, hint key TBD in spec finalization.

### Closure for BLOCKER #3 (Closures #1, #3 — namespace + helper names)

§0d conflated kebab-case **Hint IDs** (from tooltip spec §1) with snake_case **persistence keys** (from `lib/onboarding/keys.ts:15` `ONBOARDING_HINT_KEYS`). They are different namespaces. §0d also referenced helpers that do not exist (`requireAuthenticatedAccount`) or have a different signature (`enforceAccountRateLimit`).

**Fix — single source of truth = `ONBOARDING_HINT_KEYS` (snake_case persistence keys):**

- API body field is `hintKey: string` (snake_case), NOT `hintId`. Server validates `hintKey` is in `ONBOARDING_HINT_KEYS`.
- Tooltip spec §1 entries get an explicit `Persistence key` field that names the `ONBOARDING_HINT_KEYS` entry. The kebab-case Hint ID stays in the spec as the human-readable label but is NOT the wire value.
- Component-side: `<HintCard hintKey="teacher_setup_checklist">` (snake_case), NOT `<HintCard hintId="teacher-home-setup-checklist">`.
- The §0d kebab-case-key API contract is REPLACED in §0e.

**Fix — actual helper signatures:**

- Auth: `requireAuthenticated(request)` from `lib/auth/guards.ts:16-30` (verified). Returns `{ ok: true, account } | { ok: false, response }`. NOT `requireAuthenticatedAccount`.
- Rate-limit: `enforceAccountRateLimit(accountId, scope, limit, windowMs)` from `lib/security/account-rate-limit.ts:24` (verified). Concretely:
  ```typescript
  const rl = await enforceAccountRateLimit(
    account.id,
    'onboarding-dismiss-hint',
    30,           // 30 dismisses per
    60_000,       // ... 60 seconds
  )
  if (rl) return rl  // 429 response if rate-limited
  ```
- Origin gate: `enforceTrustedBrowserOrigin(request)` (existing helper from `lib/security/request.ts`).

**Final §0e API contract for `POST /api/onboarding/dismiss-hint`:**

```typescript
import { enforceTrustedBrowserOrigin } from '@/lib/security/request'
import { requireAuthenticated } from '@/lib/auth/guards'
import { enforceAccountRateLimit } from '@/lib/security/account-rate-limit'
import { isValidOnboardingHintKey } from '@/lib/onboarding/keys'
import { dismissOnboardingHint } from '@/lib/onboarding/state'  // existing helper

export async function POST(request: Request) {
  const origin = enforceTrustedBrowserOrigin(request)
  if (origin) return origin
  const auth = await requireAuthenticated(request)
  if (!auth.ok) return auth.response
  const rl = await enforceAccountRateLimit(auth.account.id, 'onboarding-dismiss-hint', 30, 60_000)
  if (rl) return rl

  let body: unknown = null
  try { body = await request.json() } catch { /* empty → 400 below */ }
  const hintKey = (body && typeof body === 'object')
    ? String((body as { hintKey?: unknown }).hintKey ?? '').trim()
    : ''
  if (hintKey === '') {
    return NextResponse.json({ error: 'hint_key_missing' }, { status: 400, headers: NO_STORE })
  }
  if (!isValidOnboardingHintKey(hintKey)) {
    return NextResponse.json({ error: 'unknown_hint_key' }, { status: 400, headers: NO_STORE })
  }
  // Idempotent: repeated dismiss is a no-op via the helper's UPSERT.
  await dismissOnboardingHint(auth.account.id, hintKey)
  return NextResponse.json(
    { ok: true, hintKey, dismissedAt: new Date().toISOString() },
    { headers: NO_STORE },
  )
}
```

This matches the actual exports verified at the cited file:line.

### Closure for WARN #4 (Sub-PR A scope reconciliation)

§0d Closure #7 said remaining Sub-PR A = dismiss API + purge + tests. Tooltip spec still holds reset route + admin CLI in Sub-PR A scope. Two sources disagree.

**Fix — single Sub-PR A scope (defined here, supersedes tooltip spec):**

- IN Sub-PR A: `POST /api/onboarding/dismiss-hint` route + `account_onboarding_state` purge inside `purgeAccounts` per-account TX + integration tests (8 cases per §0d Closure #8) + the `/cabinet` redirect guard from BLOCKER #2 closure above + matching integration test for the verify-banner-on-cabinet path for unverified teacher-only.
- DEFERRED to Sub-PR D (nice-to-have): reset route (`POST /api/onboarding-state/reset`), admin CLI for ops support.
- The tooltip spec §6 Sub-PR decomposition is amended in this §0e to mark reset + admin CLI as Sub-PR D.

### Closure (INFO #5) — Closure #5 SQL is correct

No change; `lesson_completions.teacher_id` exists and indexed.

---

**Status after §0e applied:** round-4 BLOCKER findings each have a written closure verified against live helpers and route graph. Round-5 codex verifies. Sub-PR A scope finally bounded: dismiss API + cabinet redirect fix + purge per-account + tests.

---

## §0f — Round-5 closures (2026-06-04)

Round 5 surfaced 3 BLOCKERs + 2 WARNs + 1 INFO — all spec-precision issues, no architecture concerns. Closed in §0f:

### Clarification of plan-mode vs impl

§0e wording said "fix applied" for purge + redirect. Codex correctly read this as a claim that LIVE CODE was changed; in plan-mode it just specifies the contract Sub-PR A implementation will satisfy. **§0f explicit phrasing:** all "closures" in §0c/§0d/§0e/§0f are CONTRACTS that Sub-PR A code must satisfy — not assertions that the code is already changed. The plan-paranoia gate verifies the contract is sound; the wave-paranoia gate (run on Sub-PR A's diff) verifies the implementation actually matches.

### Closure for BLOCKER #1 (purge contract phrasing)

**Contract for Sub-PR A:** the `account_onboarding_state` delete MUST land inside `purgeAccounts()` per-account TX, after the deletion-guard pass, before the per-account `commit`. The contract is SPECIFIED in §0e Closure for BLOCKER #1; Sub-PR A IMPLEMENTS it; the wave-paranoia round on Sub-PR A verifies the diff matches. No live-code change is part of this plan-only PR.

### Closure for BLOCKER #2 (field name — emailVerifiedAt)

The `app/cabinet/page.tsx` redirect uses field `account.emailVerifiedAt`, NOT `verifiedAt`. **Fixed contract** for Sub-PR A:

```typescript
// app/cabinet/page.tsx existing teacher-only redirect (line 98 in main):
// CURRENT (creates loop with /teacher/layout redirect for unverified teacher-only):
if (isTeacher && !isStudent) redirect('/teacher')
// FIX (Sub-PR A): keep unverified teacher-only on /cabinet so verify banner is reachable.
if (isTeacher && !isStudent && account.emailVerifiedAt !== null) redirect('/teacher')
```

Note the correct field name `emailVerifiedAt` per `app/cabinet/page.tsx:70`. §0e's `verifiedAt` was a transcription error.

### Closure for BLOCKER #3 (helper name — isOnboardingHintKey)

`lib/onboarding/keys.ts:41` exports `isOnboardingHintKey`, NOT `isValidOnboardingHintKey`. **Fixed contract** for the dismiss API:

```typescript
import { isOnboardingHintKey } from '@/lib/onboarding/keys'  // NOT isValidOnboardingHintKey
// ...
if (!isOnboardingHintKey(hintKey)) {
  return NextResponse.json({ error: 'unknown_hint_key' }, { status: 400, headers: NO_STORE })
}
```

§0e's helper name was a transcription error; §0f restores the canonical export.

### Closure for WARN #4 (tooltip spec stale text)

`onboarding-tooltips-spec-2026-05-31.md` has a stale §1 ID/key contract + stale Sub-PR A scope mentions. **Action taken in this commit:** tooltip-spec gets a §0e/§0f UPDATE banner at the top of §1 (lines 16-17) that:
- Declares snake_case `hintKey` matching `ONBOARDING_HINT_KEYS` as the canonical wire/storage key.
- Marks the kebab-case "ID" field below as human-readable label only.
- Defers reset route + admin CLI to Sub-PR D.

Spec text below the banner remains for context but the banner supersedes any contradiction.

### Closure for WARN #5 (evals/URL_REDIRECT_CONTRACT.md)

The cabinet redirect change in §0e/§0f Closure for BLOCKER #2 amends the redirect ladder. **Sub-PR A file list MUST include** `evals/URL_REDIRECT_CONTRACT.md` — EXTEND with the new condition: "teacher-only `/cabinet` → `/teacher` only when `account.emailVerifiedAt IS NOT NULL`; unverified teacher-only stays on `/cabinet` so the verify-email surface is reachable." Both PRODUCT_FLOWS.md and URL_REDIRECT_CONTRACT.md updates land in the SAME PR as the route change.

### Closure for INFO #6 (CT1 hint key)

`verify_email_reminder` is NOT in the canonical `ONBOARDING_HINT_KEYS` whitelist (verified `lib/onboarding/keys.ts:15-30`). CT1 hint is NOT in Sub-PR A scope — it lands in Sub-PR C (learner-side hints). Sub-PR A only needs the `/cabinet` redirect fix that makes CT1's mount reachable; the hint copy + key choice happens in Sub-PR C. Document: when Sub-PR C ships CT1, add `verify_email_reminder` to `ONBOARDING_HINT_KEYS` and the corresponding tooltip-spec entry.

---

**Status after §0f applied + tooltip-spec banner edit:** all round-5 findings closed. §0f says explicitly that closures are CONTRACTS for Sub-PR A, not live-code changes. Round-6 codex verifies coherence.

---

## §0g — Round-6 closures (2026-06-04)

Round 6 returned BLOCK with 1 BLOCKER + 2 WARNs + 1 INFO. The BLOCKER was cross-file scope drift — tooltip-spec body still listed reset+CLI+CT1-on-/teacher in Sub-PR A and treated `lib/onboarding/state.ts` as new work, even though the §0e/§0f banner at the top of §1 declared otherwise.

### Closure for BLOCKER (cross-file scope drift)

**Action taken in this commit:** rewrote the §0e/§0f banner at the top of tooltip-spec §1 to an explicit SUPERSESSION block that enumerates every body section it overrides (§1, §2.3, §3.4, §4.1). Each stale claim is named verbatim with the new authoritative contract:
- wire key is snake_case `hintKey`, not kebab-case ID.
- foundation files already shipped in main (§2.3 "new, Sub-PR A" is historical draft).
- Sub-PR A scope: dismiss API + redirect fix + purge + tests + evals updates.
- Sub-PR D scope: reset route + CLI (§3.4/§4.1 listings stale).
- CT1 mount: `/cabinet`, not `/teacher/*`; key choice in Sub-PR C.

Body sections remain readable as historical drafting, but the banner wins on every contradiction. Any future implementer who reads the file starts at the banner and the §0e/§0f/§0g contract in flows.

### Closure for WARN #2 (banner overstated "mapping lives in keys.ts")

The previous §0e/§0f banner said "mapping kebab-case ID → snake_case persistence key lives in `lib/onboarding/keys.ts`". That was inaccurate — `lib/onboarding/keys.ts` exports `ONBOARDING_HINT_KEYS`, `OnboardingHintKey`, `isOnboardingHintKey`. There is no ID→key mapping module.

**Fix:** the rewritten banner now says: "mapping is one-to-one and lives in the per-hint table of §1 (column `Persistence key`)". Each tooltip-spec §1.x entry pairs the kebab-case human label with the canonical `ONBOARDING_HINT_KEYS` value.

### Closure for WARN #3 (tooltip-spec frontmatter stale)

`onboarding-tooltips-spec-2026-05-31.md:3` previously said `round-3 BLOCK ... closures pending`. After §0e–§0g closures recorded in this flows file, that frontmatter no longer reflects the current state.

**Fix taken in this commit:** frontmatter now says `PLANNING — round-6 BLOCK 2026-06-04 (1 BLOCKER on cross-file scope drift); §0c–§0f closures live in flows file; §0g pending in this file`. Round-7 codex confirmation flips this to `SIGN-OFF` if accepted.

### Closure (INFO #4) — field + helper anchors

No change; the §0f field name + helper export fixes are confirmed correct.

---

**Status after §0g + tooltip-spec banner rewrite:** all round-6 findings closed. Cross-file consistency is enforced via an explicit supersession banner that enumerates every stale section by line. Round-7 codex verifies.
