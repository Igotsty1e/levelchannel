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
