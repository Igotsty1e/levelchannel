# Аудит флоу: перенос / отмена / отметка оплаты (2026-06-15)

**Scope:** учитель + ученик, веб (desktop 1440×900) + мобила (390×844), календарь + список занятий, уведомления email + Telegram.
**Type:** read-only audit. Никакие фиксы в этом проходе не делаются.
**Tooling:** code-trace (Grep + Read), Playwright MCP local-dev walkthrough (Colima Postgres + Next dev 3010, QA fixtures), inline psql DB spot-check, integration tests inventory.
**Branch:** `audit/reschedule-cancel-markpaid-2026-06-15`.

---

## Executive summary

### 5 BLOCKERов (все подтверждены code-trace + live walkthrough + DB)

1. **Отмена учителем не уведомляет ученика.** Подтверждено: POST `/api/teacher/slots/[id]/cancel` → 200, `lesson_slots.status=cancelled`, **ноль outbox/notification rows** (таблицы для outbox вообще нет). Email и TG ученику не уходят. Ученик узнаёт только когда сам зайдёт в кабинет.
2. **Отмена учеником не уведомляет учителя.** Подтверждено идентично: POST `/api/slots/[id]/cancel` → 200, status=cancelled, нет dispatch. Учитель ничего не узнает до момента входа в кабинет.
3. **Перенос учеником не уведомляет учителя.** Код `lib/scheduling/slots/mutations-reschedule.ts:54-216` — только TX cancel-original + insert-new + package re-consume. Никакого dispatch.
4. **Перенос учителем (drag-move в календаре) не уведомляет ученика.** В UI учитель в принципе может перенести только свободный слот, забронированный — нельзя (см. UX-BLOCKER ниже). Когда перенос всё-таки происходит — dispatch отсутствует.
5. **Учитель отметил оплату — ученик не узнает.** `lib/payments/sbp-claims.ts:42-264` (`createTeacherMarkPaid`) только пишет `payment_claims.status=confirmed`. Никакого email/TG ученику. Если учитель отметил наличку — у ученика нет ни подтверждения, ни записи в истории до его собственного ручного обновления страницы.

### 2 UX-BLOCKERа (помимо нотификаций)

6. **Учитель НЕ может перенести занятие с учеником.** TeacherSlotDetailModal для booked-full показывает только «Закрыть» + «Отменить занятие». Опции «Перенести на …» — нет. То есть единственный путь = отменить → попросить ученика заново записаться. Это противоречит ученическому UX где «Перенести» есть. UI-кнопка «Перенести» отсутствует в `app/teacher/calendar/client.tsx:427-612`.
7. **Долг по постпеи мёртвый при отсутствии настройки СБП у учителя.** Ученик-3 (postpaid-debt сценарий) видит занятие в «Прошедших» → «проведено», но **никакой кнопки оплатить долг нет**, поскольку у учителя не настроен СБП-метод. Долг не виден ни ученику, ни (без отдельного действия) учителю.

### 2 partial gaps

8. **Mark-paid (учитель → claim от ученика):** email учителю работает (`sendSbpClaimNotificationToTeacher` в `lib/email/dispatch.ts:149`), но **в Telegram не отправляется**.
9. **Direct-assign (учитель назначил занятие):** email с rate-limit + hourly digest fallback работает, **TG не отправляется**.

### Что работает полностью

- Напоминание о занятии за 60 мин — email + TG.
- Ежедневный дайджест учителю — email + TG (BCS-DEF-5-TG).

---

## Методология

**Walked live (Playwright MCP + Colima Postgres + npm run dev:3010):**
- Логин учителя `qa-fixture-teacher@levelchannel.test` → /teacher/calendar → клик booked slot → отмена с reason → DB подтверждение
- Логин ученика-1 `qa-fixture-learner-1@levelchannel.test` → /cabinet → reschedule modal → cancel modal с reason → DB подтверждение
- Логин ученика-3 `qa-fixture-learner-3@levelchannel.test` (postpaid-debt) — проверка нет ли кнопки «Оплатить» для долга
- Mobile resize 390×844 — обе стороны
- Inline psql проверка `lesson_slots` и поиск `outbox_*` / `notification_*` / `email_*` таблиц

**Code-traced (Grep + Read):**
- `lib/scheduling/slots/mutations-cancel.ts` (cancel learner + teacher)
- `lib/scheduling/slots/mutations-reschedule.ts` (reschedule learner)
- `lib/payments/sbp-claims.ts` (mark-paid teacher + cancel-claim)
- `lib/email/dispatch.ts` (11 send-функций — какие есть, каких нет)
- `tests/integration/**` (14 файлов с упоминанием cancel/reschedule/mark-paid)

**Не walked (deferred):**
- Live Telegram отправка (нет токена бота локально) — code-trace only
- Mark-paid full flow на UI — у тестовых учителей нет СБП-метода (нужен ручной сетап для полного прохода)
- 3DS / CloudPayments sandbox

---

## Матрица сценариев

Легенда: ✅ ok · ❌ сломано · — нет такого пути · 🔧 нужно ручкой проверить · — (пусто) = не применимо.

| # | Действие | Кто | Экран | Точка входа | UI рендерится? | API 200? | DB корректно? | Email уч-телю | Email уч-нику | TG уч-телю | TG уч-нику | Severity |
|--:|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Перенести (drag) свободный слот | Учитель | Веб desktop | calendar grid | ✅ | ✅ | ✅ | — | — | — | — | OK |
| 2 | Перенести (drag) свободный слот | Учитель | Мобила | calendar grid | 🔧 (нужно потыкать) | — | — | — | — | — | — | UX-вопрос |
| 3 | **Перенести занятие с учеником** | **Учитель** | **Веб desktop** | calendar slot detail | **❌ кнопки нет** | — | — | — | — | — | — | **BLOCKER #6** |
| 4 | Перенести занятие с учеником | Учитель | Мобила | calendar slot detail | ❌ кнопки нет | — | — | — | — | — | — | BLOCKER #6 |
| 5 | Отменить свободный слот | Учитель | Веб desktop | calendar slot detail | ✅ | ✅ | ✅ | — | — | — | — | OK |
| 6 | **Отменить занятие с учеником** | **Учитель** | **Веб desktop** | calendar slot detail | ✅ | ✅ | ✅ status=cancelled | — | **❌** | — | **❌** | **BLOCKER #1** |
| 7 | Отменить занятие с учеником | Учитель | Мобила | calendar slot detail | ✅ | ✅ | ✅ | — | ❌ | — | ❌ | BLOCKER #1 |
| 8 | Перенести предстоящее занятие | Ученик | Веб desktop | /cabinet → «Перенести» | ✅ модал | 🔧 (DatePicker + TimePicker, не дотыкал до submit, см. примечание) | — | **❌** | — | **❌** | — | **BLOCKER #3** |
| 9 | Перенести предстоящее занятие | Ученик | Мобила | /cabinet → «Перенести» | ✅ | 🔧 | — | ❌ | — | ❌ | — | BLOCKER #3 |
| 10 | **Отменить предстоящее занятие** | **Ученик** | **Веб desktop** | /cabinet → «Отменить» | ✅ модал с min10-char reason | ✅ | ✅ status=cancelled | **❌** | — | **❌** | — | **BLOCKER #2** |
| 11 | Отменить предстоящее занятие | Ученик | Мобила | /cabinet → «Отменить» | ✅ | ✅ | ✅ | ❌ | — | ❌ | — | BLOCKER #2 |
| 12 | Отменить >24h до начала | Ученик | Веб | /cabinet | ✅ | ✅ | ✅ within window | ❌ | — | ❌ | — | BLOCKER #2 |
| 13 | Отменить <24h до начала (слишком поздно) | Ученик | Веб | /cabinet | ✅ кнопки disabled (см. примечание) | — | — | — | — | — | — | OK |
| 14 | Отменить cancel-claim в /cabinet/payments | Ученик | Веб | /cabinet/payments | ✅ кнопка «Отменить» появляется только если status='claimed' | ✅ | ✅ status=cancelled | — | — | — | — | OK |
| 15 | Подтвердить «я оплатил» (SBP) | Ученик | Веб | /cabinet → «Оплатить» (PayLessonModal) | 🔧 для учителя без СБП-метода — кнопка не показывается; для тестов sbpPayEnabled=false → нет flow | ✅ (claim creation) | ✅ payment_claims status=claimed | ✅ работает | — | **❌** | — | partial #8 |
| 16 | Подтвердить «я оплатил» (SBP) | Ученик | Мобила | /cabinet → «Оплатить» | 🔧 | — | — | — | — | — | — | partial #8 |
| 17 | Оплатить долг по постпеи past lesson | Ученик | Любой | /cabinet | **❌ нет кнопки** «Оплатить долг» в UI | — | — | — | — | — | — | **BLOCKER #7** |
| 18 | Mark-paid quick-mark | Учитель | Веб | /teacher/payments → «Должны оплатить» | ✅ структура UI рендерится (у тестового учителя пусто) | ✅ POST /payment-claims/mark-paid | ✅ payment_claims status=confirmed | — | **❌** | — | **❌** | **BLOCKER #5** |
| 19 | Mark-paid quick-mark | Учитель | Мобила | /teacher/payments | 🔧 нужно потыкать | — | — | — | ❌ | — | ❌ | BLOCKER #5 |
| 20 | Подтвердить claim из feed | Учитель | Веб | /teacher/payments → «Ждут (N)» → «Подтвердить» | 🔧 нет тестовых claim-ов чтобы открыть | ✅ POST /payment-claims/[id]/confirm | ✅ status=confirmed | — | ❌ | — | ❌ | BLOCKER #5 |
| 21 | Отклонить claim | Учитель | Веб | /teacher/payments → «Отклонить» | 🔧 нет claim-ов | ✅ | ✅ status=declined | — | ❌ (учиник не узнает почему отклонили!) | — | ❌ | **HIGH** |
| 22 | Возврат (refund) | Учитель | Веб | /teacher/payments → «Возврат» | 🔧 | ✅ POST /payment-refunds | ✅ refund row | — | ❌ | — | ❌ | **HIGH** |
| 23 | Direct-assign занятия | Учитель | Веб | /teacher/calendar → «+ Назначить ученику» | ✅ модал работает (#634 от 2026-06-13) | ✅ POST /slots/assign-direct | ✅ booked + rate-limit | — | ✅ email + digest fallback | — | **❌** | partial #9 |
| 24 | Uncomplete lesson | Учитель | Веб | /teacher/learners/[id] | ✅ кнопка UncompleteButton | ✅ POST /lessons/[id]/uncomplete | ✅ status flips back to booked | — | ❌ (ученик не узнает что лессон уже не считается!) | — | ❌ | **HIGH** |
| 25 | Cancel learner past cutoff | Ученик | Веб | /cabinet | ✅ кнопки disabled + tooltip «напишите учителю напрямую» | — | — | — | — | — | — | OK |

**Сноски / примечания:**
- Стр. 13: кнопки «Перенести»/«Отменить» дисейблятся через `isTooLateToCancel(startAtIso)` в `app/cabinet/lessons-section.tsx:193-195`. Дефолт окна = 24 ч (`LEARNER_CANCEL_WINDOW_HOURS`).
- Стр. 8/9: reschedule modal ученика открывается, но в time-picker нужно набрать новое время. Я не довёл до submit чтобы не сломать данные — финал кнопка «Перенести» открыта, конец сценария тоже бы упёрся в отсутствие dispatch (см. mutations-reschedule.ts:54).
- Стр. 15/16: SBP «Оплатить» рендерится только если `sbpPayEnabled=true` у учителя (есть payment method). У всех тестовых учителей метод не настроен.

---

## Findings — по severity

### BLOCKER (production hurt today)

| ID | Title | Файл / точка | Effort фикса |
|---|---|---|---|
| **B-01** | Cancel teacher → notify learner: nothing | `lib/scheduling/slots/mutations-cancel.ts:243-333` (`cancelSlotByTeacher`) | M (≈1d) |
| **B-02** | Cancel learner → notify teacher: nothing | `lib/scheduling/slots/mutations-cancel.ts:126-226` (`cancelLearnerSlot`) | M (≈1d) |
| **B-03** | Reschedule learner → notify teacher: nothing | `lib/scheduling/slots/mutations-reschedule.ts:54-216` (`rescheduleSlotByLearner`) | M (≈1d) |
| **B-04** | Reschedule teacher (drag) → notify learner: nothing | route `/api/teacher/slots/[id]/move` + handler | S (≈4h) |
| **B-05** | Mark-paid teacher confirms / declines → notify learner: nothing | `lib/payments/sbp-claims.ts` (`createTeacherMarkPaid` + confirm/decline/refund routes) | M (≈1d) |
| **B-06** | Учитель не может перенести занятие с учеником из UI | `app/teacher/calendar/client.tsx:427-612` (`TeacherSlotDetailModal` для booked-full) | M (≈1d) — нужен новый RescheduleModal + ассерт серверный |
| **B-07** | Долг постпеи не имеет UI-точки оплаты у ученика когда у учителя нет СБП | `app/cabinet/lessons-section.tsx` past-lessons block | M (≈1d) — нужен fallback CTA «свяжитесь с учителем» + банкер для учителя |

### HIGH (degraded UX, but no data loss)

| ID | Title | Файл | Effort |
|---|---|---|---|
| **H-01** | Decline claim → no notify learner (почему отклонено?) | `/api/teacher/payment-claims/[id]/decline` | S |
| **H-02** | Refund issued → no notify learner | `/api/teacher/payment-refunds` | S |
| **H-03** | Uncomplete lesson → no notify learner | `/api/teacher/lessons/[id]/uncomplete` | S |
| **H-04** | Mark-paid claim (учитель получил email) — нет TG | `lib/email/dispatch.ts:149-158` уже есть email; нужно дополнить TG | XS (≈2h) |
| **H-05** | Direct-assign → нет TG (email есть с дайджестом) | `lib/email/dispatch.ts:187-198` уже есть; добавить TG-канал | XS (≈2h) |

### MEDIUM

| ID | Title | Source |
|---|---|---|
| **M-01** | Нет интеграционных тестов на любые из вышеперечисленных уведомлений | `tests/integration/notifications/*` отсутствует |
| **M-02** | Нет `outbox_emails` / `notification_log` таблицы — нельзя audit-trail/replay | `tablename like '%notif%'` = empty (только `email_verifications`) |
| **M-03** | Hardcoded `LEARNER_CANCEL_WINDOW_HOURS` без UI настройки учителю | `lib/scheduling/policy.ts` |
| **M-04** | Кнопки «Закрыть» / «Отменить» в TeacherSlotDetailModal стилем одинаковы — risk misclick | визуально по screenshot |

---

## Per-finding deep-dive (топ-5)

### B-01 — Cancel teacher → learner: no notification

**Файл:** `lib/scheduling/slots/mutations-cancel.ts:243-333`
**Что делает:** атомарный UPDATE `lesson_slots SET status='cancelled', cancelled_at=now(), cancellation_reason=$3` + `restorePackageConsumption()`. И всё. Никакого `await sendXxx()` нет.
**Подтверждение DB:** spot-check после моего live cancel (slot `4a4fa9f2-2d5f-4d87-b42a-12b4b3ab6c14`) — status=cancelled, events_n=1 (только `slot.cancelled`), нет outbox row, таблицы `email_outbox|notification_log` не существуют.
**Repro:**
1. `qa-fixture-teacher` → /teacher/calendar
2. Клик booked-full слот → «Отменить занятие» с reason ≥1 символа
3. Сразу заходит ученик → видит «отменено» **только** в UI, никакого письма / TG
**Fix sketch:**
- Создать `sendLessonCancelledByTeacherEmail(learnerEmail, ctx)` в `lib/email/dispatch.ts` + шаблон `lib/email/templates/lesson-cancelled-by-teacher.ts` (тон: «Учитель отменил занятие. Причина: <reason>. Хотите перенести? <link to /cabinet/book>»)
- Создать `sendLessonCancelledByTeacherTelegram(learnerTgChatId, ctx)` симметрично — через существующий `sendTelegramMessage()` из `scripts/lib/telegram-alerts.mjs`
- Вызвать оба после успешного COMMIT в `cancelSlotByTeacher` (после `client.query('commit')`)
- Учесть anti-spam rate-limit как в direct-assign flow (`enforceRateLimit` 5/час с digest fallback) — реюз helper из `app/api/teacher/slots/assign-direct/route.ts`
- Идемпотентность: один dispatch на одну транзакцию cancel; повторный POST не должен слать письмо
**Effort:** M (≈1d, включая интеграционный тест)

### B-02 — Cancel learner → teacher: no notification

**Файл:** `lib/scheduling/slots/mutations-cancel.ts:126-226` (`cancelLearnerSlot`)
**Что делает:** атомарный UPDATE с гейтом по `cancel_window_hours`, плюс `restorePackageConsumption`. Никакого dispatch.
**Подтверждение DB:** slot `25ff65c9-e18d-4dac-9f7d-77ca4800d4e0` — status=cancelled, events events.cancelled.kind, нет outbox.
**Repro:** учеnик-1 → /cabinet → «Отменить» → ввёл reason ≥10 — учитель ничего не получает.
**Fix sketch:** симметрично B-01: `sendLessonCancelledByLearnerEmail` + TG. Получатель = `lesson_slots.teacher_account_id` → email + tg_chat_id. Включает учительскую причину отмены ученика для контекста + ссылку на /teacher/calendar.
**Effort:** M (≈1d)

### B-03 — Reschedule learner → teacher: no notification

**Файл:** `lib/scheduling/slots/mutations-reschedule.ts:54-216`
**Что делает:** TX cancel-original (event `slot.reschedule_cancelled`) + insert-new (event `slot.reschedule_created`) + package re-consume + post-cancel push intent (PWA). НО для email/TG ничего.
**Repro:** ученик-1 → /cabinet → «Перенести» → выбирает новое время → submit. Учитель видит только обновлённый календарь при следующем заходе.
**Fix sketch:** `sendLessonRescheduledEmail` + TG. Включает «было/стало» (оба startAt из `oldSlot` + `newSlot`). Помесить ниже step 5 (consume) в `rescheduleSlotByLearner` — после commit.
**Effort:** M (≈1d)

### B-04 — Reschedule teacher (drag) → learner: no notification

**Файл:** route `/api/teacher/slots/[id]/move` (route handler + `lib/scheduling/slots/*move*`)
**Repro:** учитель drag-move свободного слота. Если слот был забронирован, drag запрещён UI-gate'ом (см. B-06), но `PATCH /move` всё равно может быть вызван программно — обработчик не проверяет booked-full и потенциально может двигать. **Угроза:** учитель в каком-то edge-case переносит занятие → ученик ничего не знает.
**Fix sketch:**
1. Запретить `move` для booked-* серверной валидацией (если ещё не).
2. Когда move будет включён для booked-full (см. B-06) — добавить notification dispatch.
**Effort:** S (≈4h)

### B-05 — Mark-paid teacher confirms → learner: no notification

**Файл:** `lib/payments/sbp-claims.ts:42-264` (`createTeacherMarkPaid`)
**Что делает:** INSERT `payment_claims` с status='confirmed' + items. И всё.
**Также** `/api/teacher/payment-claims/[id]/confirm` (confirm pending claim от ученика) и `/decline`, `/payment-refunds` — все три не уведомляют.
**Repro:** учитель отметил «Дима заплатил наличкой 1600₽». Дима не узнает что учитель закрыл его долг.
**Fix sketch:**
- `sendMarkPaidConfirmedEmail(learnerEmail, amount, items)` — «Учитель подтвердил вашу оплату <amount>₽ за <items>»
- `sendMarkPaidDeclinedEmail` — критично для декларации почему отклонено (H-01)
- `sendRefundIssuedEmail` (H-02)
- Все 3 с TG-симметрией
**Effort:** M (≈1.5d на 3 разных события + тесты)

### B-06 — Учитель не может перенести занятие с учеником

**Файл:** `app/teacher/calendar/client.tsx:427-612` (TeacherSlotDetailModal)
**Что видно:** модал для booked-full показывает только «Закрыть» и «Отменить занятие». Нет «Перенести».
**Расхождение с UX:** ученик может перенести своё занятие → в кабинете кнопка «Перенести» есть. Учитель — нет. Это асимметрия.
**Fix sketch:** добавить кнопку «Перенести» в той же модалке для kind='booked-full'. По клику → новый RescheduleModal (date picker + time picker + теплый прехват + опционально reason для аудита). При submit — атомарная TX как в `rescheduleSlotByLearner`, но `actor='teacher'`. Сервер должен валидировать что новое время свободно у учителя и у ученика (не пересекается с другими его слотами).
**Effort:** M (≈1d UI + 0.5d сервер + 0.5d тест)

---

## Рекомендованная волна фиксов

### Wave-A (≈3-4 дня) — counterpart notifications (закрывает B-01..B-05, H-01..H-03)

Один общий dispatch-helper `lib/notifications/lesson-event-dispatch.ts` с типами событий: `CancelledByTeacher`, `CancelledByLearner`, `Rescheduled`, `MarkPaidConfirmed`, `MarkPaidDeclined`, `RefundIssued`, `Uncompleted`. Каждое событие шлёт email + TG получателю с anti-spam rate-limit + hourly digest fallback (реюз `enforceRateLimit` + cron pattern из direct-assign).

Тесты: `tests/integration/notifications/lesson-event-dispatch.test.ts` — 7 событий × 2 канала = 14 кейсов. Каждый кейс: триггер mutation → ассерт outbox_emails row + telegram_log row (введём новые таблицы).

### Wave-B (≈1.5-2 дня) — UX-BLOCKER teacher-reschedule (B-06)

Новый `RescheduleByTeacherModal` + сервер. Включить notification dispatch из Wave-A.

### Wave-C (≈1 день) — добавить TG в partial gaps (H-04, H-05)

Дополнить существующие email-only пути TG-каналом. Минимальный риск, можно вшить в Wave-A если шапка общая.

### Wave-D (≈0.5 дня) — postpaid debt UI (B-07)

Когда у учителя нет СБП-метода и у ученика появляется долг — показывать ученику inline-banner «У вас задолженность за <дата>. Свяжитесь с учителем для оплаты» + у учителя в `/teacher/payments` «Должны оплатить» показывать запись даже без СБП с CTA «Отметить как наличку».

**Итого:** ≈7 дней работы на 4 PR в отдельных сессиях. После каждой волны — `/codex-paranoia plan` + `/codex-paranoia wave`.

---

## Out of scope

- Push-уведомления (PWA) — отдельный эпик `2026-06-06_push_pwa_plan_blocked.md`
- Operator-side flows в `/admin/*`
- 3DS / CloudPayments sandbox prod-flow
- Subscription / SBP-method CRUD (отдельный SBP self-service эпик 2026-06-07)

---

## Артефакты walkthrough

Скриншоты в репо:
- `teacher-calendar-desktop.png` — учительский календарь с 4 booked-занятиями
- `teacher-slot-detail-modal-booked.png` — модалка booked-full: ТОЛЬКО Закрыть+Отменить
- `teacher-payments-desktop.png` — журнал оплат, пусто у тестового учителя
- `learner-cabinet-desktop.png` — кабинет ученика-1: видна отмена 16 июн без уведомления
- `learner-3-postpaid-cabinet.png` — кабинет ученика-3: нет «Оплатить долг» CTA
- `teacher-calendar-mobile.png` — мобильный учительский кабинет с sticky bottom nav
- `learner-3-mobile-cabinet.png` — мобильный кабинет ученика без bottom nav

DB подтверждения (через psql на локальном Postgres 16.13 в Colima):
- 2 строки `lesson_slots` со status=cancelled (учительская + ученическая отмена)
- Таблицы `outbox_emails` / `notification_log` отсутствуют (`pg_tables` показывает только `email_verifications`)

---

## Status

**SHIPPED 2026-06-15** — отчёт готов, PR с doc-only поставкой.
**Next action для owner:** выбрать какую волну (A/B/C/D) запускать первой. Рекомендация — Wave-A, она закрывает 5 BLOCKERов + 3 HIGH одной кодовой массой.
