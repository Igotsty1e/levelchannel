---
title: Cabinet — обновить «скоро появится» лейблы под уже отгруженный функционал
status: SIGN-OFF — codex-paranoia round 10/3 (cap extended per user authorization «делай полноценно по нормальному»); R10-WARN#1 OAuth-jargon closure applied post-sign-off per protocol
date: 2026-06-02
owner: claude-orchestrator
---

# Cabinet — обновить «скоро появится» лейблы под уже отгруженный функционал

## Кратко

В кабинете ученика **И учителя** висят надписи **«это пока в работе»**, **«включается в ближайших обновлениях»**, **«добавим следующими версиями»** про функционал, частично **уже отгружен**, а частично — нет. Plan-doc'у нужно различать:

### A. Что реально отгружено и работает только при `active+fresh` (pull-side)

- `/cabinet/settings/calendar` lines 128-148 + 173-175 + teacher copy at `/teacher/settings/calendar` lines 126, 247 — описание Google Calendar pull/push/sync.

  **R1-BLOCKER#3 + R2-BLOCKER#1 nuance**: фоновый pull + скрытие занятых интервалов реально шипнуты (`lib/calendar/google/pull.ts`, `lib/calendar/hidden-slots.ts`, `lib/calendar/pull-runner.ts`), но **slot-hide kicks in только если `sync_state='active' AND last_pulled_at` свежий**. На `degraded` или `stale active` — учитель числится подключённым, а гейт не работает. Реальный enum (R2-BLOCKER#1 fix): `active | degraded | disconnected` (см. `lib/calendar/integrations.ts:11,34`). Поэтому copy не может говорить «работает сейчас» абсолютно — должен быть **state-aware** по 5-state матрице (R2-WARN#4 + R5-WARN#2 fix — 5 веток, не 4: no_integration + disconnected + active_fresh + active_stale + degraded):
    - `no integration row` → «**учитель пока не подключал Google Calendar**».
    - `sync_state='disconnected'` → «**учитель отключил Google Calendar**».
    - `sync_state='active' AND last_pulled_at >= now()-10min` → «**синхронизация работает**».
    - `sync_state='active' AND last_pulled_at < now()-10min` → final copy в §A.1 (active+stale ветка: «подключено, но синхронизация отстаёт; занятое в Google время может не скрываться»).
    - `sync_state='degraded'` → same текст, что и stale-active.

### B. Что отгружено везде (reminders)

- `/cabinet/settings/calendar` line 173-175: email-напоминания → `scripts/learner-reminder-dispatch.mjs` (operator_settings:`learner-reminders` scope). Работает unconditionally при включённом master switch.

### C. Что НЕ отгружено и плана нет

- Подключение календаря ученика (own calendar, OAuth от ученика) → отдельный эпик, не в скоупе этой волны.
- Lesson materials (планы, домашка, заметки учителя) → отдельный эпик.
- **R1-BLOCKER#1**: «История платежей» как dedicated transaction-history view — **НЕ отгружена** (cabinet рендерит только active packages + postpaid debt; `app/cabinet/billing-sections.tsx`). Поэтому в текущей волне НЕ заявляем её как shipped — и НЕ заявляем как «скоро». Просто убираем из соответствующего блока на `/cabinet/page.tsx` lines 314-330.

### D. Что отгружено по learner-side (история занятий)

- Past lessons показываются inline в `unified-timeline.tsx` (multi-teacher) под «Прошедшие и отменённые», и в `lessons-section.tsx` (single-teacher) под «Прошедшие». **Dedicated `/cabinet/history` страница НЕ нужна** — inline-блоки достаточны (verified в audit).

## Existing surface inventory (R6-BLOCKER#1 — survey-before-plan per COMPANY.md §151)

**Grep #1** (derive-status helper surface):
```
grep -rln "deriveStatus\|derive-status\|pullStatus\|pushStatus\|integrationStatus" app/ lib/ components/
```
Hits: **0** (zero) — no existing helper. → **parallel-justified**: новый файл `lib/calendar/derive-status.ts` шипится как первая реализация.

**Grep #2** (existing integration-status reads, R7-BLOCKER#1 — full enumeration):
```
grep -rn "getGoogleIntegrationMeta\|sync_state.*active\|integrationMeta" lib/ app/ components/
```
Hits (все 20):
- `lib/calendar/integrations.ts:11,72,208,335` — определение enum + helper `getGoogleIntegrationMeta(accountId)`, который возвращает `{ syncState, writeCalendarId, lastPulledAt, ... }`. → **refactor**: новый helper `derive-status.ts` ИСПОЛЬЗУЕТ `getGoogleIntegrationMeta` (не дублирует SQL); функция-обёртка превращает record → `pullStatus | pushStatus`.
- `lib/calendar/reconcile-runner.ts:148` — reconcile worker SQL `tci.sync_state in ('active','degraded')`. → **unrelated** (worker-side).
- `lib/calendar/intent-worker.ts:290,314` — intent worker comments + SQL filter `tci.sync_state in ('active','degraded')`. → **unrelated** (worker-side).
- `lib/calendar/hidden-slots.ts:68,87,142` — predicate `sync_state='active' AND last_pulled_at >= now() - interval '10 minutes'`. → **unrelated** (worker SQL, не TS-derivation; freshness threshold (10 min) — same value, я применю его в JS).
- `lib/calendar/channel-renewer.ts:302` — channel renewer SQL `sync_state in ('active','degraded')`. → **unrelated**.
- `lib/calendar/pull-runner.ts:26,350` — pull runner sets `sync_state='active'`. → **unrelated** (writer-side, не reader).
- `lib/calendar/push-worker.ts:495` — push gate `sync_state in ('active','degraded')` + write_calendar_id check. → **unrelated** (worker-side, derivation должна совпадать).
- `lib/scheduling/slots/booking.ts:68,395` — booking-side pull-fresh check (same SQL pattern). → **unrelated** (worker-side; logical parity required).
- `app/teacher/settings/calendar/page.tsx:7,79` — teacher cabinet page reads `getGoogleIntegrationMeta(session.account.id)`. → **refactor**: переписать через `derive-status.ts` (call-site становится `derivePullStatus(integration)` + `derivePushStatus(integration)`).
- `app/teacher/layout.tsx:10,83` — teacher layout reads `getGoogleIntegrationMeta(current.account.id)` для cabinet-nav dot. → **refactor**: использовать `derivePullStatus !== 'no_integration' && derivePullStatus !== 'disconnected'` вместо inline `syncState === 'active' || syncState === 'degraded'` (centralizes connected-check; иначе dot и copy дрейфуют).
- `components/teacher/cabinet-nav.tsx:47` — comment about `calendarConnected` prop sourcing. → **refactor-comment**: обновить comment в соответствии с новым helper'ом.

**Conclusion**: helper-design — единая TS-точка для status-derivation на серверном render. SQL-предикаты в worker'ах остаются прежними. Новый helper читает `getGoogleIntegrationMeta` + применяет 10-min TTL в JS (вычитает `Date.now() - lastPulledAt`), не дублирует SQL.

**Grep #3** (existing teaser strings to rewrite):
```
grep -n "Как будет работать\|по мере включения\|включится\|шипится\|следующих обновлений" app/teacher/settings/calendar/page.tsx app/cabinet/settings/calendar/page.tsx
```
Hits:
- `app/cabinet/settings/calendar/page.tsx:117,132,137` — learner page; **rewrite** per §A.1/§A.2/§A.3.
- `app/teacher/settings/calendar/page.tsx:146,148,231,247-248,255,262` — teacher page (2 surfaces: gated intro at 146-148 + "Как будет работать" list at 231-262); **rewrite** per §B (sections preserved separately, configReady=false branch untouched).

## Goal (R4-WARN#4 dedup — single section)

Чтобы ученик и учитель при заходе в кабинет видели **актуальное и state-aware** описание системы:
- что **уже работает** (по фактическому статусу интеграции): pull/push с Google Calendar учителя, email-напоминания, история занятий;
- что **не отгружено и не обещано**: собственный календарь ученика, материалы к занятиям (оба — отдельные эпики без roadmap-обещаний; см. §C, разделы "что НЕ в скоупе").

Не врать про функционал ни в одну, ни в другую сторону. Не обещать того, чего нет.

## Что менять

### A. `/cabinet/settings/calendar` (learner-side teacher integration view)

Раздел «Что это значит (по мере включения)»:

**Было** (3 пункта говорят про «включается в ближайших обновлениях») → **State-aware copy на server-side, 5 pull-вариантов + 4 push-варианта (R4-BLOCKER#1+#2 fix)**.

#### A.0 H2 + intro replacements (R9-BLOCKER#1)

H2 `Что это значит (по мере включения)` (`app/cabinet/settings/calendar/page.tsx:117`) → **`Как сейчас работает синхронизация`** (factual, no «по мере включения»).

Никаких intro-параграфов «появится в ближайших обновлениях» — секция начинается сразу с state-aware буллетов §A.1 + §A.2.

#### A.1 Pull-side derivation

1. Read `teacher_calendar_integrations.sync_state` + `last_pulled_at` для учителя текущего ученика. Если row отсутствует — статус `no_integration`.
2. Derive `pullStatus`: одно из `no_integration | disconnected | active_fresh | active_stale | degraded`.
   - `no_integration` — нет row.
   - `disconnected` — `sync_state='disconnected'`.
   - `active_fresh` — `sync_state='active' AND last_pulled_at >= now()-10min`.
   - `active_stale` — `sync_state='active' AND last_pulled_at < now()-10min` (или `last_pulled_at IS NULL`).
   - `degraded` — `sync_state='degraded'` (shares stale UX, но own cause).
3. Render по варианту:
   - `no_integration` → «Учитель пока не подключал Google Calendar. Время в расписании показывается как есть, без проверки занятости в чужом календаре.»
   - `disconnected` → «Учитель отключил Google Calendar. Время в расписании показывается как есть.»
   - `active_fresh` → «Когда учитель занят в Google Calendar другим делом, эти занятия автоматически исчезают из расписания — вы не сможете записаться на занятое время. ✓ Работает сейчас.»
   - `active_stale` → «Учитель подключил Google Calendar, но синхронизация сейчас отстаёт. Пока синхронизация не восстановится, занятое в Google время может не скрываться автоматически.»
   - `degraded` → «Учитель подключил Google Calendar, но Google сейчас отвечает с ошибками. Пока ошибки не пройдут, занятое в Google время может не скрываться автоматически.»

#### A.2 Push-side derivation

Реальный gate в `lib/calendar/push-worker.ts:481-495` — `sync_state IN ('active','degraded') AND write_calendar_id IS NOT NULL`. Recency `last_push_at` НЕ используется (idle integration ≠ broken).

1. Derive `pushStatus`: `no_integration | disconnected | no_write_calendar | works`.
   - `no_integration` — нет row.
   - `disconnected` — `sync_state='disconnected'` (write_calendar_id irrelevant).
   - `no_write_calendar` — `sync_state IN ('active','degraded') AND write_calendar_id IS NULL`.
   - `works` — `sync_state IN ('active','degraded') AND write_calendar_id IS NOT NULL`.
2. Render по варианту:
   - `works` → «Когда вы записываетесь, бронь сразу появляется у учителя в Google Calendar.»
   - `no_write_calendar` → «Бронь у учителя в Google Calendar не появится: учитель пока не выбрал, в какой календарь писать.»
   - `disconnected` → «Бронь у учителя в Google Calendar не появится: учитель отключил интеграцию.»
   - `no_integration` → «Бронь у учителя в Google Calendar не появится: учитель пока не подключал Google Calendar.»

#### A.3 Footer (operator reminder switch, R2-WARN#3 + R4-BLOCKER#3 fix)

«Учитель не выключил для вас» не существует в shipped системе. Читаем operator master switch server-side. **Не обещаем «собственный календарь ученика — добавим следующими версиями»** (R4-BLOCKER#3: §C классифицирует это как «не отгружено и плана нет»; повторный teaser восстанавливает паттерн, который эпик и удаляет):

```
{operatorMasterSwitchOn
  ? '✓ Email-напоминания приходят перед занятиями.'
  : 'Email-напоминания временно выключены оператором.'}
```

Никаких других строк в footer'е (никаких «скоро», «добавим», «в работе»).

Operator master switch читается через тот же `resolveOperatorSettingsForProbe('learner-reminders')`, что уже используется в `app/cabinet/profile/page.tsx:85` для Telegram-binding.

### B. `/teacher/settings/calendar` (teacher-side, R6-WARN#2 tighten — exact strings + dedicated matrix test)

**R1-BLOCKER#2 + R6-WARN#2**: teacher surface содержит 2 независимых блока teaser-копи:

#### B.0 H2 + intro rewrites on teacher page (R9-BLOCKER#1 expanded)

- H2 `Как будет работать (по мере включения)` (`app/teacher/settings/calendar/page.tsx:231`) → **`Как работает интеграция с Google Calendar`** (factual, no «по мере включения»).
- Intro paragraph at lines 126-129 («автоматическая синхронизация… появится в ближайших обновлениях») → переписать на state-aware (использует тот же `derivePullStatus` + `derivePushStatus`):
  - `active_fresh + works` → «Подключите ваш Google Calendar — мы будем учитывать вашу занятость в расписании и записывать туда же забронированные занятия. ✓ Работает сейчас.»
  - `active_fresh + no_write_calendar` → «Подключение установлено: занятость учитывается. Выберите календарь для записи занятий в настройках выше.»
  - `active_stale` / `degraded` → «Подключение установлено, но синхронизация сейчас отстаёт.»
  - `disconnected` / `no_integration` → «Подключите ваш Google Calendar — мы будем учитывать вашу занятость в расписании и записывать туда же забронированные занятия.» (call-to-action без teaser).
- Status row at lines 144-148 («ℹ Текущий статус интеграции: подключение готово, фоновая синхронизация… шипится отдельными обновлениями. Подключитесь сейчас — как только синхронизация включится…») → **удалить целиком**. State conveyed §B.1 derivation per pullStatus.

#### B.1 Gated intro block (lines 146-148 в `page.tsx`)

Текущий текст (configReady=true ветка) обещает: «фоновая синхронизация… когда включится, она автоматически заработает для вашего календаря».

**Rewrite** под state-aware (применяем результаты `derive-status.ts` для teacher's own integration):
- `pullStatus=active_fresh` → «✓ Фоновая синхронизация работает: занятия из вашего Google Calendar учитываются в расписании.»
- `pullStatus=active_stale` → «Подключение установлено, но синхронизация сейчас отстаёт. Учитываем последние известные занятия — ученики могут забронировать время, которое уже занято в Google.»
- `pullStatus=degraded` → «Подключение установлено, но Google сейчас отвечает с ошибками. Учитываем последние известные занятия — синхронизация восстановится автоматически.»
- `pullStatus=disconnected` → «Интеграция отключена. Расписание не учитывает занятия из вашего Google Calendar.»
- `pullStatus=no_integration` → существующий «Подключите ваш Google Calendar к LevelChannel» CTA (без teaser).

`configReady=false` branch (env-misconfig) **остаётся unchanged** (R1-INFO#5: «Эта функция активируется в ближайшем обновлении» — текст про env, не про unshipped feature).

#### B.2 «Как будет работать» list block (lines 231-262 в `page.tsx`)

4 буллета с «эта часть включится / шипится отдельным обновлением / появится вместе с фоновой синхронизацией / реальные синхронизации — следующие шаги». **Все 4 буллета сейчас лгут** — pull/push/conflict-detection отгружены (см. `lib/calendar/pull-runner.ts`, `lib/calendar/push-worker.ts`, conflict-detector в `tests/integration/calendar/conflict-detector.test.ts`).

**Rewrite**: тот же state-aware подход — буллеты отражают текущее состояние, не обещают «когда-нибудь»:
- Буллет 1 (read): "Читаем события из вашего календаря в окне «сегодня → +30 дней». Если на это время уже что-то запланировано, ваше свободное время в LevelChannel перестаёт показываться ученику." → suffix per state: `active_fresh` → «✓ Работает сейчас»; `active_stale`/`degraded` → «Сейчас синхронизация отстаёт — может срабатывать с задержкой»; `disconnected`/`no_integration` → буллет скрыт.
- Буллет 2 (write): "Записываем каждое забронированное занятие в ваш календарь." → suffix per pushStatus: `works` → «✓ Работает сейчас»; `no_write_calendar` → «Выберите календарь для записи в настройках выше»; `disconnected`/`no_integration` → буллет скрыт.
- Буллет 3 (conflicts): «Конфликты подсвечиваются красным…» — conflict-detection is post-pull (`lib/calendar/conflict-detector.ts`); НЕ зависит от write_calendar_id. Suffix по `pullStatus`:
  - `pullStatus=active_fresh` → «✓ Работает сейчас» (независимо от pushStatus — conflict-detection это pull-side feature).
  - `pullStatus=active_stale` или `degraded` → «Сейчас синхронизация отстаёт — конфликты могут подсвечиваться с задержкой».
  - `pullStatus=disconnected` или `no_integration` → буллет скрыт.
- Буллет 4 (token persistence, lines 266-269 — `Сейчас подключение фиксирует связь… отзыв доступа кнопкой «Отключить». Реальные синхронизации событий — следующие шаги.`): **rewrite** — удалить teaser-окончание + убрать `токены` + убрать `OAuth` jargon (R9-WARN#2 + R10-WARN#1 — plain Russian per `docs/content-style.md:19,52`). Новый текст: «Подключение даёт LevelChannel защищённый доступ к вашему календарю Google. Отозвать доступ — в любой момент кнопкой «Отключить».»
- Буллет 5 (disconnect behaviour) — фактическое описание, оставляем.
- Буллет 6 (privacy, lines 277-282 с `OAuth-токены` + `пароль Google`): **rewrite** для соответствия `docs/content-style.md:125` + plain Russian. Новый текст: «Не читаем заголовки событий ваших учеников и других людей за пределами окна «сегодня → +30 дней», не передаём данные третьим сторонам, не храним ваш пароль Google — соединение установлено напрямую с Google по защищённому каналу.»

#### B.3 Tests

`tests/teacher-cabinet-polish/calendar-page-state-matrix.test.tsx` (новый — R6-WARN#2): рендерит teacher page для тех же 5 pullStatus + 4 pushStatus permutations + assert exact copy. Pattern mirror'ит learner matrix-тест из §D.

Update `tests/teacher-cabinet-polish/calendar-page-gated-intro.test.tsx:131` — обновлённые copy assertions (configReady=false branch остаётся unchanged).

#### B.4 «Слот» sweep на той же teacher page (R8-BLOCKER#1 — поскольку wave уже трогает эту страницу, sweep обязателен)

Rewrite оставшихся `слот` строк в teacher/settings/calendar surface (verified `grep -n "слот\\|Слот" app/teacher/settings/calendar/{page.tsx,orphan-section.tsx} app/cabinet/settings/calendar/page.tsx`):

- `app/teacher/settings/calendar/orphan-section.tsx:65` — confirm-prompt `Очистить устаревшие связи на N слотах?` → `Очистить устаревшие связи на N занятиях?`.
- `app/teacher/settings/calendar/orphan-section.tsx:122` — «Эти слоты были связаны…» → «Эти занятия были связаны…».
- `app/teacher/settings/calendar/orphan-section.tsx:125` — «слот в LevelChannel останется» → «занятие в LevelChannel останется».
- `app/teacher/settings/calendar/page.tsx:245` (уже в B.2 buллет 1) — «ваш свободный слот в LevelChannel перестанет показываться» → «ваше свободное время в LevelChannel перестанет показываться».
- `app/teacher/settings/calendar/page.tsx:336` (FAQ details) — «В LevelChannel слот остаётся забронированным» → «В LevelChannel занятие остаётся забронированным».

Update existing tests in `tests/teacher-cabinet-polish/*calendar*` если они pin'ят старые строки. Negative regression в matrix-тесте: surface НЕ содержит подстроки `слот` (case-insensitive, кроме internal code-комментариев — assert на rendered DOM, не на source).

### C. `/cabinet/page.tsx` блок «Скоро здесь появится»

**R1-WARN#6 closure**: удаляем блок **целиком** (lines 314-330). История платежей не отгружена (`R1-BLOCKER#1`), материалы не отгружены, оба — отдельные эпики. Не врать в обе стороны.

### D. Tests (R1-WARN#4 + R2-WARN#4 + R3-BLOCKER#2 + R4-BLOCKER#1+#2 closure)

Заменить «no tests needed» на render matrix.

`tests/cabinet/calendar-settings-state-matrix.test.tsx` (R5-BLOCKER#1 fix — integration runner включает только `tests/integration/**/*.test.ts`, не `.tsx`; render-test cosistent с уже-работающим pattern `tests/teacher-cabinet-polish/*.test.tsx`, который гоняется под `npm run test:run`) — рендерит `/cabinet/settings/calendar` по двум независимым осям: **pull-axis** (5 вариантов) и **push-axis** (4 варианта). Каждый вариант pins concrete copy из §A.1 / §A.2.

**Pull-axis assertions** (по §A.1 derivation):
- `no_integration` → строка «Учитель пока не подключал Google Calendar…».
- `disconnected` → строка «Учитель отключил Google Calendar…».
- `active_fresh` (`sync_state='active' AND last_pulled_at >= now()-10min`) → строка «✓ Работает сейчас».
- `active_stale` (`sync_state='active' AND last_pulled_at < now()-10min OR NULL`) → строка «синхронизация сейчас отстаёт».
- `degraded` → строка «Google сейчас отвечает с ошибками».

**Push-axis assertions** (по §A.2 derivation):
- `works` (`sync_state IN ('active','degraded') AND write_calendar_id IS NOT NULL`) → строка «бронь сразу появляется у учителя в Google Calendar».
- `no_write_calendar` (`sync_state IN ('active','degraded') AND write_calendar_id IS NULL`) → строка «учитель пока не выбрал, в какой календарь писать».
- `disconnected` (`sync_state='disconnected'`) → строка «учитель отключил интеграцию».
- `no_integration` (no row) → строка «учитель пока не подключал Google Calendar».

**Footer assertions** (§A.3, R5-WARN#3 exact-equality fix — точки на конце совпадают между §A.3 и §D, чтобы избежать substring-drift):
- `operatorMasterSwitchOn=true` → exact-match `'✓ Email-напоминания приходят перед занятиями.'`.
- `operatorMasterSwitchOn=false` → exact-match `'Email-напоминания временно выключены оператором.'`.
- Negative regression: footer НЕ содержит подстрок `Добавим следующими версиями` / `скоро` / `в работе` / `следующих обновлений` (anti-teaser regression per R4-BLOCKER#3).

Combined permutation tests (pull × push) — минимум 3 cross-axis cases для регрессии:
1. `pullStatus=active_fresh + pushStatus=works` (golden state).
2. `pullStatus=active_fresh + pushStatus=no_write_calendar` (pull-healthy, push-broken — учит читателя, что это две независимые оси).
3. `pullStatus=no_integration + pushStatus=no_integration` (полный «учитель не подключал»).

Update `tests/teacher-cabinet-polish/calendar-page-gated-intro.test.tsx:131` — обновлённый copy assertions (учительская сторона: configReady=false branch остаётся unchanged).

## Что НЕ в скоупе

- Не добавляем подключение календаря ученика (это отдельный эпик; нужны OAuth-токены, сильный consent, push к календарю ученика).
- Не добавляем «материалы к занятиям» (отдельный эпик; storage, attachments, UI).
- Не делаем dedicated `/cabinet/history` page — existing inline «Прошедшие» секции достаточно (audit показал, что они уже работают).
- Не делаем dedicated transaction-history view (`R1-BLOCKER#1`): отдельный эпик. Сейчас просто удаляем misleading teaser с `/cabinet/page.tsx`.
- Не трогаем admin/UX surface'ы. Teacher `/teacher/settings/calendar` теперь **В СКОУПЕ** (R1-BLOCKER#2).

## Tests (R3-BLOCKER#1 deduped: see §D inside «Что менять» above)

Тестовый план содержится в §D «Tests». Дубликат удалён (R3-BLOCKER#1 closure: ранее этот раздел давал старую «3 state» формулировку, конфликтующую с 5-state матрицей в §D).

`npm run build` + `npm run test:run` + `npm run test:integration` все green. State-matrix test живёт в default vitest pool (`tests/cabinet/...`), не integration (R5-BLOCKER#1).

## Sub-PR phasing

**Single PR.** Скоуп: 6-7 файлов (learner page + teacher page + helper `lib/calendar/derive-status.ts` + 3 test files: learner matrix, teacher matrix, updated teacher gated-intro), ~350-450 строк.

## Codex-paranoia loop

- **Plan checkpoint:** `/codex-paranoia plan docs/plans/cabinet-stale-future-labels.md` — round 1.
- **Wave checkpoint:** `/codex-paranoia wave <commit>` — после implementation.

Per skill §1.5 standalone one-PR эпик: оба чекпойнта на одном PR.

## Open questions для paranoia (R3-WARN#3 closure)

- Q1 [RESOLVED]: НЕ-cabinet surface'ы — teacher `/teacher/settings/calendar` подхвачен (см. §B). Admin/landing surface не содержат таких лейблов (verified в audit).
- Q2 [RESOLVED]: Реальный enum — `active | degraded | disconnected` (`lib/calendar/integrations.ts:11,34`); 5-state pull-матрица в §A.1 (no_integration + disconnected + active_fresh + active_stale + degraded) + 4-state push-матрица в §A.2 (works + no_write_calendar + disconnected + no_integration) учитывают все permutations.
- Q3 [RESOLVED]: Учительский OAuth — отгружен (R1-INFO#5); `configReady=false` branch значит env-misconfig, preserved unchanged.
- ~~Q4: «Материалы к занятиям» — удалить блок (R1-WARN#6 closure; см. §C).~~ [RESOLVED — block deletion landed in §C].
