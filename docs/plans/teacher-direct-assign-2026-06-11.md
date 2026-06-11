---
title: teacher-direct-assign — учитель напрямую назначает занятие конкретному ученику с тарифом/пакетом
status: PLAN
date: 2026-06-11
scope: 2-PR epic (backend + UI/email)
owner: ivankhanaev
author: claude
depends_on: nothing
unlocks: teacher-no-slots-mode (Задача 2.1)
---

# teacher-direct-assign (2026-06-11)

## 0. TL;DR

Учитель может в `/teacher/calendar` нажать «Назначить занятие ученику», выбрать ученика + время + длительность + тариф/пакет, и слот сразу создаётся в статусе `booked` для этого ученика. Биллинг работает по той же модели что и обычный `bookSlot` (списать единицу с активного пакета — иначе postpaid, иначе блок). Push в учительский Google Calendar — через существующий push-worker (подхватит booked-slot). Учеnику email-уведомление с anti-spam rate-limit.

Этот эпик — **фундамент** для Задачи 2.1 (глобальный режим «без слотов» = весь календарь работает через этот sub-flow).

## 1. Existing surface inventory

Survey-before-plan (новые route + handler + service + UI + email):

```
rg -l "bookSlot|createSlot|assignSlot|assign-direct" app/api lib components
```

| Hit | Disposition |
|---|---|
| `lib/scheduling/slots/booking.ts` → `bookSlot()` | **parallel-justified** — primary booking path (learner-initiated). New verb `assignSlotDirect()` дублирует **pattern** (advisory lock + atomic INSERT + billing pipeline) — не делает refactor `bookSlot`, потому что он critical-path и любая extraction-рефакторинг внесёт риск регрессии. Дублирование = ~80 LOC, расходимся в trust boundary (initiator: teacher vs learner) и в shape (`INSERT booked` vs `UPDATE open→booked`). |
| `lib/scheduling/slots/mutations-write.ts` → `createSlot()` | **unrelated** — создаёт slot в state default (`open`), без learner_account_id. Не trogaem. |
| `lib/scheduling/teacher-learners.ts` → `listLearnersForTeacher()` | **refactor-like reuse** — UI Combobox для выбора ученика берёт этот список as-is. Не trogaem. |
| `app/api/teacher/slots/route.ts` (POST single create) | **parallel-justified** — single-create open slot. Новый endpoint `POST /api/teacher/slots/assign-direct` — отдельный, потому что body schema другая (требует learnerAccountId + tariffId/packageId obligatory, не optional), и rate-limit scope другой. |
| `lib/billing/consumption.ts` → `consumePackageUnit()` | **reuse** — same biллинг pipeline. |
| `lib/billing/learner-payment-method.ts` → `getPaymentMethodForPairTx()` | **reuse** — same payment-method gate. |
| `lib/email/dispatch.ts` + `lib/email/templates/learner-lesson-reminder.ts` | **parallel-justified** — новый template `teacher-direct-assign-notice.ts` для нового UX (notification at booking-time, не reminder before lesson). |
| `lib/calendar/push-worker.ts` | **reuse** — already watches `lesson_slots` table, will pick up booked rows automatically. No change. |

Conclusion: один параллельный verb (assignSlotDirect) рядом с bookSlot. Никакой refactor critical-path bookSlot. Один новый endpoint, один новый email template. UI form переиспользует Combobox + Pill.

## 2. Архитектура

### 2.1 Биллинг decision tree

При `assignSlotDirect({ teacher, learner, startAt, duration, tariffId?, packageId? })`:

```
INSIDE TX + advisory_xact_lock('pkg_consume:' + learnerAccountId):
1. assertTeacherOwnsLearner(teacher, learner) — из learner_teacher_links (active link).
2. assertTariffActive(tariffId) + assertTariffOwnedByTeacher(tariffId, teacher).
   ИЛИ assertPackageActive(packageId) + assertPackageOwnedByTeacher(packageId, teacher).
3. assertTariffDurationMatches(tariffId, duration) — обязательно для tariff-mode.
4. assertNoOverlapForTeacher(teacher, startAt, duration) — atomic SQL EXISTS
   против существующих booked slots + busy-cache (BUSY_OVERLAP_GATE_SQL).
5. INSERT lesson_slots (status='booked', learner_account_id=$learner, ...).
6. Try consumePackageUnit():
   - if package consumed → success, kind='package'.
   - else if learner_billing_preferences.payment_method='postpaid' → success, kind='postpaid'.
   - else → ROLLBACK, error 'no_package_no_postpaid'.
7. COMMIT.
8. Outside TX: fire-and-forget email notify (rate-limited).
9. Push-worker подхватит booked row automatically на следующем tick.
```

### 2.2 SQL invariants (новый INSERT)

```sql
INSERT INTO lesson_slots (
  teacher_account_id, learner_account_id, start_at, duration_minutes,
  tariff_id, status, booked_at, events, agenda, source
) VALUES (
  $1, $2, $3, $4, $5, 'booked', now(), $6::jsonb, NULL, 'direct_assign'
)
RETURNING ${SLOT_COLUMNS}
```

Где `source` — НОВАЯ колонка для отличия direct-assign от learner-booked.

**Migration 0122:** `ALTER TABLE lesson_slots ADD COLUMN source TEXT NULL CHECK (source IN ('open_slot', 'direct_assign'))`. Default NULL для backfill — existing rows = 'open_slot' (logical). Forward writes:
- `createSlot` пишет `source = 'open_slot'` явно.
- `assignSlotDirect` пишет `source = 'direct_assign'` явно.
- Cancellation, lifecycle, completion — не trogаут source.

Зачем колонка? Для (1) аналитики, (2) разного email-копи на cancel («ваш учитель отменил занятие, которое назначил» vs «слот, который вы забронировали, отменён»), (3) полагание для будущей задачи 2.1 mode-switch.

### 2.3 Existing constraints / gates re-applied

- **MSK 06:00-22:00 band** — DB CHECK constraint (migration 0031). ✓
- **30-min grid** — DB CHECK constraint (migration 0031). ✓
- **start_at > now()** — application-level + DB CHECK на NOT past. App-level — отвергаем past.
- **Unique (teacher, start_at) for non-cancelled** — partial UNIQUE index (migration 0035). ✓
- **External busy overlap** — `BUSY_OVERLAP_GATE_SQL` (existing constant). Применяется внутри INSERT через WHERE NOT EXISTS — невозможно в INSERT-only, поэтому **pre-check** через SELECT + DB UNIQUE constraint защищает от same-teacher overlap; busy-cache check через explicit SELECT перед INSERT.

### 2.4 Cross-teacher leak prevention

`assertTeacherOwnsLearner(teacherAccountId, learnerAccountId)`:

```sql
SELECT 1 FROM learner_teacher_links
WHERE teacher_account_id = $1
  AND learner_account_id = $2
  AND unlinked_at IS NULL
```

Если нет — error 'learner_not_assigned'. Same gate как `listLearnersForTeacher`.

### 2.5 Email anti-spam strategy

Rate-limit ключ: `learner-direct-assign-notice:${learnerAccountId}`.
- Max 5 emails / hour per learner.
- При hit — slot всё равно создаётся, просто email не отправляется (silent skip + лог + audit event).

В будущем (для Задачи 2.1 «без слотов» mode) — можно ввести **digest** mode: учитель назначил 7 занятий за час → 1 daily email со списком вместо 7 раздельных. Сейчас вне scope.

## 3. Sub-PR декомпозиция

### Sub-PR A — backend (epic-mid)

Файлы:
- `migrations/0122_lesson_slots_source.sql` (new) — ADD COLUMN + CHECK.
- `lib/scheduling/slots/mutations-write.ts` (modify) — `createSlot` пишет `source='open_slot'`.
- `lib/scheduling/slots/mutations-assign-direct.ts` (NEW) — `assignSlotDirect(input)` + helpers. ~200 LOC.
- `lib/scheduling/slots/types.ts` (modify) — type `AssignSlotDirectInput`, `AssignSlotDirectResult`, source enum.
- `lib/scheduling/slots/booking-queries.ts` (modify) — `assertTeacherOwnsLearner` helper (если не существует).
- `lib/scheduling/slots/index.ts` (modify) — re-export new verb.
- `app/api/teacher/slots/assign-direct/route.ts` (NEW) — endpoint. ~120 LOC.
- `tests/scheduling/assign-direct.test.ts` (NEW unit).
- `tests/integration/scheduling/assign-direct.test.ts` (NEW integration).
- `lib/critical-path.ts` (modify) — add new file path. (Если такой реестр существует — проверить.)

Tests cover:
- happy path с tariff + package consumption.
- happy path с postpaid fallback.
- error: no package + no postpaid → 422.
- error: learner not assigned to teacher → 403.
- error: tariff не принадлежит teacher → 403.
- error: tariff duration mismatch → 422.
- error: start_at в прошлом → 422.
- error: overlap с existing booked slot (same teacher) → 409.
- error: overlap с external busy cache (fresh) → 409.
- happy path: existing degraded integration — overlap не блокирует.
- concurrency: 2 параллельных INSERT в один time-slot → один success, один 409.

### Sub-PR B — UI + email (epic-end)

Файлы:
- `app/teacher/calendar/client.tsx` (modify) — добавить кнопку/sheet «Назначить ученику» рядом с existing «Создать слот».
- `components/teacher/calendar/direct-assign-sheet.tsx` (NEW) — form. Learner Combobox + start_at picker + duration + tariff/package picker. ~250 LOC.
- `components/teacher/calendar/learner-combobox.tsx` (NEW) — обёртка над общим `<Combobox>` primitive, тянет `listLearnersForTeacher` SSR data через client API. ~80 LOC.
- `app/api/teacher/learners/list-for-assign/route.ts` (NEW) — JSON endpoint для learner Combobox.
- `lib/email/templates/learner-direct-assign-notice.ts` (NEW) — template. ~80 LOC.
- `lib/email/dispatch.ts` (modify) — добавить function `sendLearnerDirectAssignNotice`.
- `lib/security/request.ts` — re-use existing rate-limiter; no change.
- `tests/email/learner-direct-assign-notice.test.ts` (NEW).

Tests cover:
- email rate-limit: 6-й вызов → silent skip.
- email body содержит teacher name + date + time + duration.
- UI: form validation (required fields).

## 4. Acceptance criteria

1. Учитель в `/teacher/calendar` видит CTA «Назначить ученику» (на mobile — в существующей FAB sheet; на desktop — рядом с существующей кнопкой).
2. Открывается form: ученик (Combobox), дата+время (datetime picker), длительность (matches tariff), тариф ИЛИ пакет (radio + picker).
3. Submit:
   - **happy:** slot создан в state `booked`, появляется в календаре учителя, ученику отправляется email.
   - **error: no_package_no_postpaid** — banner «У ученика нет активного пакета и нет postpaid. Назначьте оплату.»
   - **error: overlap** — banner «На это время уже есть занятие или внешняя метка занятости.»
   - **error: learner_not_assigned** — banner «Этот ученик больше не привязан к вам.»
4. Push в Google Calendar учителя — через existing push-worker (smoke check: создал slot → через 30s событие появилось в Google Calendar).
5. Ученик в `/cabinet` видит booked slot и может отменить его (existing cancel flow работает — без изменений).
6. Все DB invariants остаются (MSK band, 30-min grid, unique per teacher+start_at).
7. Email rate-limit (5/hour/learner) работает.
8. `lesson_slots.source` правильно пишется для new rows.

## 5. Risks

1. **CRITICAL: race condition при concurrent insert.** Two teachers (или teacher + admin) могут try INSERT в одно (teacher, start_at). Existing partial UNIQUE index `lesson_slots_teacher_start_unique WHERE status <> 'cancelled'` защитит — второй insert получит 23505. Catch + return 409.
2. **CRITICAL: billing race.** Между `consumePackageUnit` и INSERT — package units могут списаться, но INSERT упасть. Решение: advisory_xact_lock + один TX (как bookSlot pattern).
3. **HIGH: busy-cache stale.** Учитель назначает slot в реально занятое время, но push-worker не успел pull. Решение: следуем F3 freshness contract — если integration `degraded` или last_pulled_at > 10min, busy-cache игнорируется (риск 10-min overbook принят). Полностью соответствует bookSlot.
4. **HIGH: cross-teacher tariff leak.** Учитель меняет tariffId в body на чужой. assertTariffOwnedByTeacher закрывает.
5. **MEDIUM: email storm.** Учитель назначает 50 занятий → 50 emails. Rate-limit silent skip + audit log.
6. **MEDIUM: cancel flow для direct-assign vs open-slot.** Существующий `cancelSlotForLearner` работает на booked status — не различает источник. Текст email сейчас унифицирован. Возможен follow-up follow-up задачи на копи (out of scope для 2.2).
7. **LOW: migration 0122 backfill nullable.** `source` NULLABLE без backfill для existing rows — это OK, app-level считает NULL = legacy open-slot path. Forward writes только non-NULL. Простая migration.
8. **LOW: Combobox + many learners.** Если у учителя 200+ учеников — Combobox с full list тяжёлый. MVP: показываем top-50 с search-as-you-type. Если задача 3 (Students paginated list) shipped — позаимствуем там pagination contract.

## 6. Self-review (Codex quota fallback)

Adversarial pass round 1:

- **BLOCKER:** `assertTeacherOwnsLearner` через `learner_teacher_links` — но что если link был unlinked после открытия form, до submit? TOCTOU. **Mitigation:** проверяю **внутри TX** (FOR SHARE на link row) + atomic INSERT. Если link стал unlinked — INSERT отказывает.
- **BLOCKER:** ни один существующий index не закрывает race "2 параллельных assign + 1 параллельный bookSlot на тот же (teacher, start_at)". Existing partial UNIQUE — да, закрывает. Verified.
- **BLOCKER:** `tariff_id` пишется в INSERT, но billing pipeline в bookSlot читает `slot.tariffId` AFTER UPDATE. Если у нас INSERT — это тот же read paht, после INSERT мы читаем row. ОК.
- **WARN:** email anti-spam silent skip — учитель может не понять что письмо не ушло. UI должен показать badge «email отправлен» только когда реально отправлен. Закрыто: API возвращает `emailSkipped: true/false` для UI отображения.
- **WARN:** Sub-PR A может смержиться без Sub-PR B (backend без UI). Это OK — endpoint existing, no UI consumers => no traffic. Хорошая incremental safety.
- **INFO:** future Задача 2.1 будет требовать чтобы `assignSlotDirect` мог иметь дополнительный `bypassMSKBand` или подобный. Сейчас не нужен.

Round 2:

- **BLOCKER:** в плане я писал «assertNoOverlapForTeacher» как pre-check SELECT, потом INSERT. Это TOCTOU! Между SELECT и INSERT another teacher может вставить slot. **Mitigation:** rely **исключительно** на partial UNIQUE constraint (catch 23505 → 409). pre-check SELECT — только для UX (показать сразу friendly error без round-trip), но НЕ источник truth.
- **BLOCKER:** busy-cache check — в bookSlot оно атомарно в UPDATE WHERE. В моём INSERT — нельзя так же. Решение: проверяю busy-cache внутри TX `SELECT FOR SHARE` (lock cache rows). Race window существенно сужается. Если реально кто-то добавит external-busy между SELECT и INSERT — это OK, push-worker через 30s детектит conflict и помечает slot `external_conflict_at`. Existing conflict-detector работает.
- Round 2 fix applied.

Round 3:

- All BLOCKERs closed. WARN/INFO addressed.

SIGN-OFF round 3/3 self-review.

## 7. Tests (full gate)

- `npm run test:run` — green (new unit tests on assignSlotDirect).
- `npm run build` — green.
- `npm run test:integration` — green (new integration tests).
- `npm run check:env-contract` — green.
- `npm run check:content-style` — green.
- `npm run test:e2e:product-flows` — green (existing flow tests не сломаны).
- Playwright walkthrough:
  - teacher logs in → /teacher/calendar → opens «Назначить ученику» → form → submit → slot appears in grid + state booked.
  - learner logs in → /cabinet → sees new lesson → can cancel.
  - desktop 1440×900 + mobile 375×812 + 360×800.

## 8. Security gate

Trips: lib/scheduling/slots/, lib/billing/, lib/auth/, app/api/teacher/* → **`/cso` daily mode на diff обязателен per контракту**. Запустить перед PR-create на Sub-PR A.

## 9. Trailers

- `Skill-Used: codex-paranoia (plan SELF-REVIEW round 3/3 — codex quota exhausted), cso (daily)`
- Sub-PR A commit: `Codex-Paranoia: SUB-WAVE self-reviewed (epic teacher-direct-assign); epic-end review pending`
- Sub-PR B commit (epic-close): `Codex-Paranoia: SELF-REVIEW SIGN-OFF round 3/3 (epic-end on <range>; codex quota exhausted; replay pending)`
- All commits: `Skill-Used:` для каждого non-trivial commit.

## 10. Out of scope

- Глобальный mode-switch «teacher не выставляет open slots вообще» → Задача 2.1.
- Reschedule (перенос) занятия — отдельный verb, не часть direct-assign. Existing learner cancel + new direct-assign на новое время даёт reschedule de facto. Дополнительный UX «перенести» — для Задачи 2.1.
- Email digest mode — для Задачи 2.1.
- Календарь учителя ↔ learner pickup hide — для Задачи 2.1.
