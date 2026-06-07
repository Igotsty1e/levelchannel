# teacher-payments-sbp-self-service

**Status**: SHIPPED 2026-06-07 via PR #550 (squash `985e377`) + debt fixes from Codex paranoia round 1 in same PR.
**Created**: 2026-06-07. **Last update**: 2026-06-07 (shipped).
**Owner**: ivankhanaev. **Epic ID**: `pay-sbp-ss`.

## Shipped state

- ✅ A1: methods CRUD + UI
- ✅ C: learner pay flow + teacher feed (decline + confirm)
- ✅ D extras: mark-paid + UnpaidLearners dashboard
- ✅ E: refunds + cancelled-after-paid hint
- ✅ F partial: email notify to teacher on new claim, CSV export, expiring packages, explainer banner
- ✅ Codex round-1 fixes: package/CP-paid debt exclusions, late-cancel window, server-side amount_mismatch, streaming CSV with teacher tz
- 📋 Deferred (next PR): per-pair pricing UI (needs lesson_slots trigger update), multi-teacher learner pay flow, Telegram/push notifications, 3 explainer banners (learner-side), focus-trap on teacher decline/refund modals
- 📋 Reverted from PR #551 cleanup (need own follow-up): app/privacy/page.tsx, lib/security/request.ts (DEV_EXTRA_ALLOWED_ORIGINS), calendar copy refresh teacher+learner sides, /teacher/subscription refactor, /thank-you copy

---

---

## 0. TL;DR

Платформа НЕ держит деньги. Ученик переводит учителю напрямую через СБП
(или иным способом). Платформа — это:

1. реестр СБП-реквизитов учителя (телефон + банк),
2. журнал заявленных и подтверждённых оплат + возвратов,
3. дашборд учителя «кто должен / кто оплатил / у кого пакет
   заканчивается»,
4. история ученика по своим переводам.

**Opt-out by default**: учитель не видит ни одной новой вкладки,
пока сам не добавит первый платёжный метод.

**Round-2 расширения**: бесплатные занятия, per-pair цены, no-show
политика, оплата другим каналом, backfill, mismatch-принятие,
refund-цепочка, privacy snapshot, налоговая CSV-выгрузка.

---

## 1. Что строим / не строим

### 1.1 Goals (in scope)

- Учитель регистрирует 1+ СБП-метод (телефон + банк), назначает
  default, может закрепить разные методы за разными учениками.
- Учитель видит индивидуальную цену для каждого ученика (per-pair
  override).
- Учитель настраивает no-show / late-cancel политику (взимать / нет).
- Ученик в кабинете видит реквизиты, переводит, нажимает «Я оплатил».
- Учитель в кабинете видит feed заявок, одним кликом подтверждает
  или отклоняет.
- Учитель сам может отметить оплату («Я уже получил наличкой»).
- Backfill: учитель вносит прошлые оплаты задним числом.
- Refunds: возвраты фиксируются как явные строки в журнале.
- Mismatch (ученик заплатил больше / меньше): принимается, помечается.
- История у ученика и у учителя с фильтрами по периоду в их tz.
- CSV-выгрузка для налоговой (учитель).
- Privacy snapshot: имя ученика на момент оплаты сохраняется в claim,
  чтобы при удалении аккаунта ученика журнал учителя не «забыл», кто
  заплатил.

### 1.2 Non-goals

- Не делаем платёжный шлюз. Деньги мимо нас.
- Не делаем эскалации / арбитраж по спорам.
- Не делаем валюты ≠ RUB.
- Не делаем group-lessons (1 слот = 1 ученик).
- Не делаем семейные / детские sub-аккаунты (один аккаунт — один
  ученик; родитель просто логинится за ребёнка).
- Не делаем PDF-квитанции / receipts.
- Не возвращаем CloudPayments-UI обратно (отдельный эпик).
- Не делаем wallet / prepaid-credit за пределами пакетов.

### 1.3 Принципы

- **Доверие, не принуждение**. Платформа — журнал, а не суд.
- **Append-only журнал**. Все переходы — новые строки. Никаких
  in-place мутаций, кроме `note_teacher` / `note_learner` / `status`
  на самой строке (см. §2.3 — статус меняется один раз: claimed →
  confirmed/declined).
- **Opt-out**. Учитель без методов не видит UI.
- **Per-pair flexibility**. Цена и платёжный метод могут отличаться
  для разных пар (учитель, ученик).
- **Snapshot semantics**. На момент создания row фиксируем имена,
  суммы, реквизиты — историю не теряем при последующих изменениях.

---

## 2. Domain-модель

### 2.1 `teacher_payment_methods` (новая)

Список СБП-реквизитов учителя.

```
id              uuid pk
teacher_account_id uuid not null fk accounts(id) on delete cascade
phone_e164      text not null         -- '+7XXXXXXXXXX' нормализованный
phone_display   text not null         -- '+7 (XXX) XXX-XX-XX' для UI
bank_label      text not null         -- 'Тинькофф', 'Сбер', 'Альфа'
is_default      boolean not null default false
created_at      timestamptz not null default now()
archived_at     timestamptz null
```

**Constraints**:
- `unique (teacher_account_id, phone_e164, bank_label) where archived_at is null`
- partial unique `(teacher_account_id) where is_default = true and archived_at is null`

**Re-add policy** (round-1 WARN): добавление пары (phone, bank), которая
уже архивирована → un-archive (SET archived_at = NULL).

### 2.2 `teacher_payment_method_assignments` (новая)

Override default-метода для конкретного ученика.

```
id              uuid pk
teacher_account_id uuid not null fk accounts(id) on delete cascade
learner_account_id uuid not null fk accounts(id) on delete cascade
payment_method_id uuid not null fk teacher_payment_methods(id) on delete cascade
created_at      timestamptz not null default now()
unique (teacher_account_id, learner_account_id)
```

### 2.3 `teacher_pricing_overrides` (новая) — round-2 ADD #2

Per-pair цена для конкретного ученика. Если строки нет — используется
учительский tariff по умолчанию.

```
id              uuid pk
teacher_account_id uuid not null fk accounts(id) on delete cascade
learner_account_id uuid not null fk accounts(id) on delete cascade
duration_minutes integer not null check (duration_minutes > 0)
amount_kopecks  integer not null check (
                  amount_kopecks >= 0 and amount_kopecks < 100000000
                )
                                  -- 0 разрешён: бесплатные занятия
                                  -- для конкретного ученика (round-2 BL-8).
                                  -- round-4 WN-29: верхний лимит 1 млн ₽.
created_at      timestamptz not null default now()
unique (teacher_account_id, learner_account_id, duration_minutes)
```

При бронировании слота, `lesson_slots.snapshot_amount_kopecks`
заполняется в порядке: pricing_override → tariff.

### 2.4 `accounts` — round-2 ADD #3

Новые столбцы под политику no-show / late-cancel:

```sql
alter table accounts add column if not exists
  teacher_charge_on_no_show boolean not null default false;
alter table accounts add column if not exists
  teacher_charge_on_late_cancel boolean not null default false;
```

(Default false = по дефолту не взимаем — консервативно для opt-in.)

Эти флаги читает функция деривации долга в §2.7.

### 2.5 `payment_claims` + `payment_claim_items` (новая)

#### `payment_claims` — шапка платежа

```
id              uuid pk
learner_account_id uuid null fk accounts(id) on delete set null
                                  -- nullable: при удалении аккаунта
                                  -- ученика журнал учителя остаётся.
learner_display_name_snapshot text not null
                                  -- round-2 BL-15: имя на момент создания.
teacher_account_id uuid null fk accounts(id) on delete set null
                                  -- round-3 BL-19: при удалении аккаунта
                                  -- учителя журнал ученика остаётся;
                                  -- знаем кому платил.
teacher_display_name_snapshot text not null
                                  -- round-3 BL-19: имя учителя на момент.
amount_kopecks  integer not null check (
                  amount_kopecks > 0 and amount_kopecks < 100000000
                )
                                  -- факт. перевод (то, что ученик заявил).
                                  -- round-4 WN-29: верхний лимит 1 млн ₽.
payment_method_id uuid null fk teacher_payment_methods(id) on delete set null
payment_method_phone_snapshot text null
                                  -- round-3 BL-18: phone_e164 на момент.
                                  -- Если изменили метод — claim помнит
                                  -- куда реально шли деньги.
                                  -- NULL когда payment_channel='other'.
payment_method_bank_snapshot text null
                                  -- round-3 BL-18: bank_label на момент.
payment_channel text not null check (payment_channel in (
                  'sbp',          -- через зарегистрированный СБП-метод
                  'other'         -- другим способом (нал, карта, перевод)
                ))
initiated_by    text not null check (initiated_by in ('learner', 'teacher'))
status          text not null check (status in (
                  'claimed',     -- ученик заявил, учитель не реагировал
                  'confirmed',   -- подтверждено
                  'declined',    -- учитель отклонил
                  'cancelled'    -- ученик передумал ДО реакции учителя
                ))
amount_mismatch_kopecks integer not null default 0
                                  -- round-2 BL-13: actual - sum(expected).
                                  -- > 0 переплата, < 0 недоплата, 0 точно.
note_learner    text null
note_teacher    text null
claimed_at      timestamptz not null default now()
paid_at         timestamptz null  -- round-2 BL-12 (backfill).
resolved_at     timestamptz null
replaces_claim_id uuid null fk payment_claims(id) on delete restrict
                                  -- refund-цепочка.
```

**Инварианты** (CHECK + server-side):

- `initiated_by='learner'` ⇒ status начинается с 'claimed', `payment_channel='sbp'`
  ⇒ payment_method_id NOT NULL.
- `initiated_by='learner'` AND `payment_channel='other'` ⇒ payment_method_id MAY be NULL,
  `note_learner` рекомендуется (UI просит, не обязательно).
- `initiated_by='teacher'` ⇒ status начинается с 'confirmed', `resolved_at = claimed_at`.
- learner-инициатива — `learner_account_id` всегда == session.account.id.
- teacher-инициатива — `learner_account_id` извлекается из (slot/package
  items), не из тела запроса.

CHECK constraints:

```sql
constraint payment_claims_learner_method check (
  initiated_by <> 'learner'
  or payment_channel <> 'sbp'
  or payment_method_id is not null
),
constraint payment_claims_teacher_status check (
  initiated_by <> 'teacher' or status in ('confirmed', 'declined')
)
```

#### `payment_claim_items` — за что именно

```
id              uuid primary key default gen_random_uuid()
                                  -- round-4 BL-23: surrogate PK.
                                  -- Раньше был composite PK с COALESCE
                                  -- — это невалидный Postgres-синтаксис
                                  -- (PRIMARY KEY принимает только имена
                                  -- столбцов, не выражения).
claim_id        uuid not null fk payment_claims(id) on delete cascade
slot_id         uuid null fk lesson_slots(id) on delete set null
package_purchase_id uuid null fk package_purchases(id) on delete set null
expected_amount_kopecks integer not null check (
                  expected_amount_kopecks >= 0
                  and expected_amount_kopecks < 100000000
                )
                                  -- round-4 WN-29: верхний лимит 1 млн ₽.
                                  -- Защита от typo. Round-2 BL-8: >= 0
                                  -- — 0 валиден для бесплатных.
item_label_snapshot text not null
                                  -- round-3 BL-21: «вт, 09 июн, 10:00 ·
                                  -- 60 мин» или «Пакет 8 уроков».
constraint payment_claim_item_xor check (
  (slot_id is not null and package_purchase_id is null)
  or (slot_id is null and package_purchase_id is not null)
)
```

**Unique constraint** (round-4 BL-23 fix continuation): дубликаты
одного и того же slot/package в одном claim запрещены через
NULLS NOT DISTINCT (Postgres 15+, у нас 16):

```sql
create unique index payment_claim_items_uniq
  on payment_claim_items (claim_id, slot_id, package_purchase_id)
  nulls not distinct;
```

**Sum invariant**: `sum(items.expected) = claim.amount` НЕ enforced
строго. Дельта живёт в `amount_mismatch_kopecks` (см. определение выше
в §2.5). Server вычисляет на INSERT: `actual - sum(expected)`.
> 0 переплата, < 0 недоплата, 0 точно. UI учителя подсвечивает в feed
mismatch ≥ 10% или ≥ 200 ₽ (round-2 OQ-3 — закрыт в round 3 значением).

**Concurrency** (round-1 BLOCKER #2): один slot в двух одновременно
активных claims защищается через advisory-lock + double-check в TX
(паттерн `lib/scheduling/slots/booking.ts`). Partial unique index
не работает из-за joined-status.

### 2.6 `payment_refunds` (новая) — round-2 ADD #10

Возврат денег от учителя ученику. Отдельная таблица для прозрачности
журнала (вместо negative-amount-claim).

```
id              uuid pk
claim_id        uuid not null fk payment_claims(id) on delete restrict
                                  -- какой именно claim возвращаем
                                  -- (учитель указывает — может быть
                                  -- частичный).
amount_kopecks  integer not null check (
                  amount_kopecks > 0 and amount_kopecks < 100000000
                )
                                  -- сумма возврата (≤ claim.amount).
                                  -- round-4 WN-29: верхний лимит 1 млн ₽.
reason          text not null check (reason in (
                  'slot_cancelled', -- слот отменили после оплаты
                  'overpaid',       -- переплата
                  'goodwill',       -- учитель решил вернуть
                  'duplicate',      -- дубль перевода
                  'other'
                ))
note            text null
refunded_at     timestamptz not null default now()
created_by      text not null check (created_by in ('teacher', 'system'))
                                  -- teacher = mark-as-refunded вручную
                                  -- system = автотриггер (slot cancelled)
```

**Расчёт «оплачено» с учётом refund**: для slot/package сумма
эффективной оплаты = `sum(confirmed claims) - sum(refunds)`.

**Round-2 #9 — auto-refund-flag**: при cancellation слота с confirmed
claim — НЕ создаём refund автоматически, но в UI учителя подсвечиваем
«требуется возврат» (visual hint, action: «Создать возврат»).

### 2.7 Деривация «должен ли ученик за слот»

Хранится не в БД — функция в `lib/payments/sbp-debt-derivation.ts`.

```
slot_is_paid(slot) =
  EXISTS payment_claim_items
   WHERE slot_id = slot.id
     AND claim.status = 'confirmed'
  MINUS
  EXISTS payment_refunds via claim — фильтр «refunded_amount < paid»

slot_is_pending(slot) =
  EXISTS payment_claim_items
   WHERE slot_id = slot.id AND claim.status = 'claimed'

slot_in_debt(slot, teacher_settings) =
  NOT slot_is_paid AND NOT slot_is_pending
  AND slot.snapshot_amount_kopecks > 0       -- round-2 #1 (free skip)
  AND payment_channel(slot) IN ('sbp', 'none') -- round-1 BL3 (legacy CP skip)
  AND CASE slot.status
        WHEN 'completed' THEN true
        WHEN 'booked' THEN slot.start_at <= now()  -- ещё не прошло — не долг
        WHEN 'no_show_learner' THEN teacher_settings.charge_on_no_show
        WHEN 'cancelled' THEN
          teacher_settings.charge_on_late_cancel
          AND cancelled_within_window(slot)
        ELSE false
      END
```

`payment_channel(slot)` (helper):
- `legacy_cp` — есть `payment_orders.paid_at IS NOT NULL` для этого слота.
- `sbp` — есть `payment_claims` confirmed на slot ИЛИ teacher имеет
  active payment_method на момент slot.created_at.
- `none` — иначе.

---

## 3. Backend API

### 3.1 Payment methods (teacher-only)

| Method | Path | Тело | Эффект |
|---|---|---|---|
| `GET` | `/api/teacher/payment-methods` | — | список активных + флаг default |
| `POST` | `/api/teacher/payment-methods` | `{phone, bank_label, is_default?}` | + re-add policy un-archive |
| `PATCH` | `/api/teacher/payment-methods/[id]` | `{phone?, bank_label?, is_default?}` | проверка ownership |
| `DELETE` | `/api/teacher/payment-methods/[id]` | — | soft delete + cascade default |

`POST` если у учителя 0 активных методов — `is_default` forced true.
`DELETE` если архивируемый был default — назначаем default следующему
активному (по created_at asc) или ни одному (opt-out re-deactivation).

### 3.2 Per-learner assignment + pricing override (teacher-only)

| Method | Path | Эффект |
|---|---|---|
| `PUT` | `/api/teacher/learners/[id]/payment-method` | upsert assignment |
| `DELETE` | `/api/teacher/learners/[id]/payment-method` | снять override |
| `PUT` | `/api/teacher/learners/[id]/pricing` | `{duration_minutes, amount_kopecks}[]` |
| `DELETE` | `/api/teacher/learners/[id]/pricing/[durationMinutes]` | снять цену |

### 3.3 Teacher policy (teacher-only)

| Method | Path | Тело |
|---|---|---|
| `PATCH` | `/api/teacher/payment-policy` | `{charge_on_no_show?, charge_on_late_cancel?}` |

### 3.4 Learner pay flow

| Method | Path | Тело |
|---|---|---|
| `GET` | `/api/learner/payment-method/[teacherId]` | — (возвращает default или override) |
| `POST` | `/api/learner/payment-claims` | `{items, amount_kopecks, payment_channel, payment_method_id?, note?}` |
| `POST` | `/api/learner/payment-claims/[id]/cancel` | до подтверждения учителем |

Anti-spoof: items.slot_id/package_purchase_id должны принадлежать
паре (teacher, session-learner). payment_method_id (если указан)
должен принадлежать тому же teacher.

### 3.4-bis Package offer flow (round-5 BL-28)

Под SBP пакеты создаются учителем как «offer» (без оплаты), потом
ученик платит и flow закрывается trigger'ом:

- `POST /api/teacher/packages/offer` — `{ learner_account_id, title_snapshot, duration_minutes, count_initial, amount_kopecks, expires_at? }`
  - Создаёт `package_purchases` строку с `paid_at = NULL`,
    `status = 'offered'` (round-5 IN-21: добавить enum если нет).
  - Не активируется до оплаты.
- `DELETE /api/teacher/packages/offer/[id]` — archive offer (учитель
  передумал).
- Ученик в `/cabinet/packages` видит `status='offered'` строки от
  каждого своего учителя — список «Доступные пакеты».
- Ученик нажимает «Купить» → `PayLessonModal`-like UI с СБП-деталями
  + amount → POST claim ссылающийся на `package_purchase_id`.
- Учитель confirm claim → **server-side trigger в TX**:
  ```sql
  update package_purchases
    set paid_at = now(), status = 'active'
    where id = claim_item.package_purchase_id
      and paid_at is null;
  ```
  Если другой источник уже отметил `paid_at` (concurrent confirm от
  второго claim — невозможно по design т.к. one claim → one package),
  trigger no-op.
- Учитель `mark-paid` с item.package_purchase_id — тот же flip
  в одной TX.

### 3.5 Teacher claim resolution + mark-as-paid

| Method | Path | Тело |
|---|---|---|
| `GET` | `/api/teacher/payment-claims?status=&limit=&from=&to=` | feed/история с фильтрами |
| `POST` | `/api/teacher/payment-claims/[id]/confirm` | — |
| `POST` | `/api/teacher/payment-claims/[id]/decline` | `{note?}` |
| `POST` | `/api/teacher/payment-claims/mark-paid` | `{items, amount_kopecks, payment_channel, paid_at?, note?}` |

### 3.6 Refunds

| Method | Path | Тело |
|---|---|---|
| `POST` | `/api/teacher/payment-refunds` | `{claim_id, amount_kopecks, reason, note?}` |
| `GET` | `/api/teacher/payment-refunds?from=&to=` | список |

### 3.7 Backfill (teacher-only) — round-2 #5

`POST /api/teacher/payment-claims/backfill` — массовая вставка прошлых
оплат. Body:

```
{
  claims: [
    {
      learner_account_id,
      items: [{ slot_id | package_purchase_id, expected_amount_kopecks }],
      amount_kopecks,
      payment_channel: 'sbp'|'other',
      paid_at: '<ISO date>',
      note?: string
    },
    ...
  ]
}
```

Все вставленные строки — `initiated_by='teacher'`, `status='confirmed'`.
Лимит: 50 claims за вызов (защита от случайного DoS).

### 3.8 CSV-export — round-2 #11

`GET /api/teacher/payment-claims/export.csv?from=&to=` — выгрузка
confirmed claims (один claim = одна строка): `paid_at, learner_name,
amount, payment_channel, items_summary, note_teacher`.

UTF-8 + BOM (Excel-friendly), `,` separator.

---

## 4. UI

### 4.1 Учитель — новые поверхности

#### `/teacher/settings/payment-methods` (новая, Sub-PR A)

- Список активных методов: `phone_display, bank_label, [DEFAULT], [edit], [archive]`
- Кнопка «Добавить метод» → форма (phone + bank, autocomplete по
  списку из 5-7 популярных банков + free-text).
- Explainer-баннер 4.3.b dismissible.

#### `/teacher/settings` (доработка, Sub-PR A)

Добавить тайл «Приём оплат через СБП»:
- Когда `count(active payment_methods) = 0`: pill warning «Не настроено».
- Когда `> 0`: pill success с числом методов.
- Иконка: тот же `SubscriptionCardIcon` (платёжная карта).

#### `/teacher/learners/[id]` (доработка, Sub-PR B)

Новый блок «Способ оплаты и цена для этого ученика»:
- Dropdown «Платёжный метод»: default / любой из активных.
- Поле/таблица «Цена за занятие»: по длительностям (45 мин: 1500₽,
  60 мин: 1800₽). Кнопка «Сбросить к стандартному тарифу».

#### `/teacher/settings/payment-policy` (новая, Sub-PR D)

Простая страничка с двумя свитчами:
- «Взимать оплату за no-show» (по умолчанию OFF).
- «Взимать оплату за поздние отмены (<24ч)» (по умолчанию OFF).
- Объяснение каждого.

Доступ — из тайла в `/teacher/settings`.

#### `/teacher/payments` (новая, Sub-PR D)

Контент:

1. **Сводка** (4 числа):
   - Ждут подтверждения (count + ₽)
   - Подтверждено за месяц (count + ₽)
   - Активный долг (count + ₽), кликабельно → раскрывается per-ученик
   - Заканчиваются абонементы (count) — пакеты с countRemaining ≤ 2
     ИЛИ expires_at в ближайшие 14 дней
2. **Feed заявок** — карточки pending claims, кнопки «Подтвердить» /
   «Не пришло». Sort по `claimed_at desc` с age-coloring (>7d жёлтый).
3. **Долг по ученикам** — таблица: ученик, # неоплаченных, ₽,
   `last_unpaid_slot_at`, кнопка «Напомнить» (Sub-PR F)
4. **Заканчивающиеся пакеты** — таблица: ученик, пакет, осталось,
   до экспирации, «Допродать» / «Напомнить» (Sub-PR F).
5. **История** — пагинация confirmed claims + refunds. Фильтр:
   ученик × период (этот месяц/прошлый/квартал/год/custom).
   В шапке таблицы — кнопка «Экспорт CSV» (Sub-PR F).
6. **«Внести задним числом»** (Sub-PR E) — отдельный модал-визард.

Mobile: вместо таблиц — card-stack (round-1 WARN).

#### `/teacher/payments/refund` (модал, Sub-PR E)

Откуда: из истории по строке `confirmed` claim. Контент:
- Сумма ≤ claim.amount.
- Reason dropdown.
- Note textarea.
- Кнопка «Создать возврат».

### 4.2 Ученик — новые поверхности

#### Кнопка «Оплатить» на booked-слотах (Sub-PR C)

Условие появления:
```
slot_is_pending = false
AND slot_is_paid = false
AND slot.snapshot_amount_kopecks > 0
AND teacher has active payment_method
```

Клик → `PayLessonModal`.

#### `PayLessonModal` (Sub-PR C)

- Заголовок: «Оплата учителю {teacher_name}» (round-1 #18: явно
  именуем учителя при multi-teacher).
- Сумма (с учётом per-pair pricing override).
- СБП-блок:
  - phone_display (+ кнопка «Копировать»),
  - bank_label,
  - сумма (+ кнопка «Копировать»),
  - подсказка «Минимальная сумма СБП в большинстве банков — 100₽»
    (round-1 #21).
- Поле note (опц.).
- Primary: «Я оплатил(а)» (создаёт claim с `payment_channel='sbp'`).
- Secondary: «Оплатил другим способом» — раскрывает форму:
  - Свободный текст (наличные / карта / другое).
  - «Зафиксировать» → claim с `payment_channel='other'`,
    `payment_method_id=null`, `note_learner = <текст>`.
- Тautoexplainer 4.3.c (первый раз).

#### `/cabinet/payments` (новая, Sub-PR C)

История: chronological list. Каждая строка:
- Дата (claim.claimed_at или paid_at)
- Учитель (если multi)
- Сумма
- Статус-pill: ожидает подтверждения / подтверждено / отклонено / возвращено / отменено
- Если declined: `note_teacher`.
- Если refund: явная строка «Возврат -1600₽».
- Кнопка «Отменить заявку» — если статус='claimed'.

Без агрегатов. Explainer 4.3.d.

### 4.3 Explainer / онбординг

Все 4 баннера через существующую `onboarding_state.dismissedHints`:

| Ключ dismiss | Когда показывается | Что говорит |
|---|---|---|
| `teacher_payments_explainer` | первый вход в `/teacher/payments` | модель «деньги мимо платформы», что делать в feed |
| `teacher_payment_methods_explainer` | первый вход в `/teacher/settings/payment-methods` | как ввести СБП, что увидит ученик |
| `learner_payment_explainer` | первый клик «Оплатить» (внутри модала) | модель прямой оплаты, инструкция |
| `learner_payment_history_explainer` | первый вход в `/cabinet/payments` | что это за журнал, что значит каждый статус |

Тексты — в плане ранее, копирую неизменно.

### 4.4 Opt-out UX

Учителю без методов: на `/teacher/settings` тайл с pill warning
«Не настроено». На главной /teacher и в `/teacher/learners/[id]`
никаких payment-related блоков. Учеников этого учителя в `/cabinet`
кнопки «Оплатить» нет. Ссылка `/cabinet/payments` всегда в футере
ученика — открывает пустую страницу с пояснением «Ваш учитель пока
не настроил приём оплат через платформу» (если ни один из его
учителей не настроил).

---

## 5. Декомпозиция на Sub-PR

| Sub-PR | Скоуп | Размер | Зависимости |
|---|---|---|---|
| **A. Schema + методы CRUD + settings UI** | 4 миграции (методы, assignments, pricing overrides, accounts policy columns), API methods CRUD, `/teacher/settings/payment-methods` + тайл, explainer 4.3.b | M | — |
| **B. Per-pair pricing + assignment UI** | API assignments + pricing overrides, UI блок в `/teacher/learners/[id]`, апдейт booking-snapshot path | S | A |
| **C. Learner pay flow + history** | API `/api/learner/payment-*`, `PayLessonModal` (SBP + other-channel), `/cabinet/payments`, explainer 4.3.c + 4.3.d | M | A, B |
| **D. Teacher feed + dashboard + policy** | Миграция claim+items+refunds, API claims feed + confirm/decline + mark-paid, `/teacher/payments` + сводка + история + feed, `/teacher/settings/payment-policy`, explainer 4.3.a | L | A, C |
| **E. Refunds + cancelled-after-paid + backfill** | `payment_refunds` migration, API refunds + backfill, refund-модал, backfill-визард, cancelled-after-paid hint | M | D |
| **F. Notifications + expiring packages + CSV export** | Telegram/email reminder integration (учителю — новый claim; ученику — напоминание о долге), expiring-packages dashboard, CSV-export, «Напомнить»-кнопки | M | D |

Каждый Sub-PR ходит под Claude self-review (внутри уже-распланированного
эпика). Epic-end paranoia wave — после merge всех 6 sub-PR.

---

## 6. Открытые вопросы

- **OQ-3**: при mismatch (ученик заплатил больше / меньше) — фиксируем
  `amount_mismatch_kopecks` и НЕ заставляем учителя обязательно его
  закрыть. Но если mismatch > 10% или > N₽ — flag в UI как warning?
  Defer до Sub-PR D.
- **OQ-4**: refund-причина 'slot_cancelled' — должен ли система сама
  предлагать оформить возврат, когда slot cancelled после confirmed
  claim? UI-подсказка (round-2 #9), но не auto-create. Подтвердить
  при имплементации Sub-PR E.
- **OQ-5**: backfill-лимит 50 claims — достаточно или нужен chunked
  пинг? Sub-PR E.
- **OQ-6**: notification на новый claim учителю — каналы (email,
  Telegram, push). Sub-PR F.

---

## 7. Rollout / flags

- **Master switch**: нет. Per-teacher активация через добавление
  первого метода.
- **`LESSON_PAYMENT_UI_ENABLED`** в `lessons-section.tsx` — удаляется
  в Sub-PR C, заменяется на SSR-derived проп
  `teacherSbpActiveForLearner: boolean`.
- **CloudPayments-path** — остаётся выключенным в UI; код-путь не
  трогаем. Будет отдельный эпик.

---

## 8. Тесты

### 8.1 Migrations

- Forward + repeat (idempotent CREATE IF NOT EXISTS, ALTER ADD COLUMN
  IF NOT EXISTS).
- Backfill `learner_display_name_snapshot` для существующих claim не
  нужен — таблица пустая на момент мерджа.

### 8.2 Unit

- `lib/util/phone.ts`: normalize + display, invalid input rejection.
- `lib/payments/sbp-debt-derivation.ts`: matrix booked / completed /
  cancelled / no_show × charge_on_no_show × charge_on_late_cancel ×
  payment_channel.
- amount-mismatch calc.
- pricing override resolution priority.

### 8.3 Integration (per Sub-PR)

- **A**: anti-spoof (чужой teacher делает PATCH/DELETE на чужой method),
  default-уникальность, re-add un-archive, soft-delete cascade default.
- **B**: pricing override применяется при бронировании (snapshot),
  assignment per-learner показывается в `GET payment-method/[teacherId]`.
- **C**: full happy path (book → claim → confirm), anti-spoof (chuжой
  ученик чужой slot), cancel-claim до подтверждения, multi-item claim
  (4 slots one transfer), payment_channel='other' creates claim
  без method.
- **D**: confirm flips status, decline flips status, mark-paid creates
  confirmed claim, race на двух claim'ах одного slot защищена.
- **E**: refund減щает effective paid, sum(refunds) > claim.amount
  отклоняется, slot.cancellation после confirmed claim показывает
  refund hint.
- **F**: expiring-packages query производительна на 10000 пакетов,
  reminder notification dedupe (один и тот же ученик не
  бомбардируется дважды в день).

### 8.4 Privacy

- Удаление аккаунта ученика: payment_claims.learner_account_id → NULL,
  `learner_display_name_snapshot` сохраняется, учитель видит «Маша
  (удалён)» в журнале.

---

## 9. Что отложено за эпик

- PDF-квитанции / receipts для ученика.
- Wallet / pre-paid credit (вне пакетов).
- Anti-fraud heuristics.
- ML-прогноз ARPU.
- Возврат CloudPayments-канала.
- Семейные / детские sub-аккаунты.
- Auto-confirm pending claims через N дней.
- 1-click reminder через любой канал — изначально только email; push
  и Telegram — в Sub-PR F или отдельным эпиком.

---

## 10. Self-review round 2 (2026-06-07)

Round 2 разворачивает round 1 и применяет owner-feedback (16 edge-cases).
Codex paranoia — пропущена (квота). In-house adversarial pass.

### 10.1 Закрытые BLOCKER (зафиксированы в спецификации выше)

| # | Issue | Fix-section |
|---|---|---|
| BL-1 | XOR slot/package в одной row ломал «один перевод за 4 урока» | §2.5 claim/items split |
| BL-2 | Race: один slot в двух активных claims | §2.5 advisory-lock + double-check |
| BL-3 | Legacy CloudPayments слоты попадали в «долг» | §2.7 payment_channel filter |
| BL-4 | Anti-spoof slot ↔ payment_method (разные учителя) | §3.4 server-side validation |
| BL-5 | Cascade conflict accounts → methods → claims | §2.5 payment_method on delete set null |
| BL-6 | Учитель не мог сам отметить оплату | §2.5 initiated_by + §3.5 mark-paid |
| BL-7 | Пользователь не понимает модель «деньги мимо платформы» | §4.3 4 explainer'а |
| **BL-8** | **Free trial / 0₽ слоты попадали в долг** | §2.7 фильтр snapshot > 0 |
| **BL-9** | **Per-pair custom цена** | §2.3 teacher_pricing_overrides + §3.2 API |
| **BL-10** | **No-show / late-cancel policy не была учтена** | §2.4 charge_on_* columns + §2.7 derivation matrix |
| **BL-11** | **Ученик не мог зафиксировать оплату другим способом** | §4.2 PayLessonModal secondary action, payment_channel='other' |
| **BL-12** | **Backfill (внесение задним числом)** | §3.7 backfill API + Sub-PR E |
| **BL-13** | **Amount mismatch — отвергать враждебно** | §2.5 amount_mismatch_kopecks + accept |
| **BL-14** | **Refund flow + slot cancelled after paid** | §2.6 payment_refunds table + Sub-PR E |
| **BL-15** | **Privacy при удалении аккаунта ученика** | §2.5 learner_account_id on delete set null + snapshot |
| **BL-16** | **Налоговая CSV-выгрузка** | §3.8 + Sub-PR F |

### 10.2 WARN — в скоупе Sub-PR'ов

- **WN-1** Phone normalization: `lib/util/phone.ts` (Sub-PR A).
- **WN-2** Integration-тесты anti-spoof / default / multi-item — все
  Sub-PR'ы покрывают свою часть (§8.3).
- **WN-3** Миграции: 0110 methods, 0111 assignments, 0112 pricing,
  0113 accounts policy cols, 0114 claims+items, 0115 refunds.
  Раздельно — granular review.
- **WN-4** Re-add archived phone+bank: un-archive policy (§2.1).
- **WN-5** Mobile layout `/teacher/payments`: card-stack ≤767px (§4.1).
- **WN-6** Package grant after confirmed claim: учитель ручкой создаёт
  package_purchase из своего кабинета. Подтвердить, что есть
  `/api/teacher/packages/grant` (если нет — Sub-PR D).
- **WN-7** Slot cancel после claim: UI учителя «требуется возврат»
  (§2.6 round-2 #9).
- **WN-8** Decline-уведомление ученику: pill + note в `/cabinet/payments`
  (§4.2). Channel-уведомление (email/push) — Sub-PR F.
- **WN-9** TZ для квартального фильтра: teacher.timezone (§4.1 + §3.5).
- **WN-10** Min СБП: подсказка в модале (§4.2 round-1 #21).
- **WN-11** Age-coloring зависших claims в feed (round-2 #6 + §4.1).
- **WN-12** Multi-teacher learner: явный label учителя в title модала
  и в группировке истории (§4.2 round-1 #18 + round-2 #15).
- **WN-13** Snapshot имя на момент claim: server populates
  `learner_display_name_snapshot` (§2.5 + §8.4).
- **WN-14** Refund нельзя превысить (sum refunds ≤ claim.amount) —
  server-side check (§2.6 + §8.3 Sub-PR E).
- **WN-15** Mismatch threshold UI hint (OQ-3, §10.4): Sub-PR D
  визуально подсветить mismatch > 10%.
- **WN-16** Backfill batch limit 50: документировать (§3.7).

### 10.3 INFO — записать, не блокирует

- **IN-1** CloudPayments в UI закрыт, код жив. Эпик «payments cleanup»
  отдельный.
- **IN-2** Refund — отдельная таблица, не negative-amount-row на
  payment_claims. Чище SQL-агрегации.
- **IN-3** Phone — PII, HTTPS + RBAC, без шифрования at-rest.
- **IN-4** Реестр банков для autocomplete — небольшой hard-coded
  список из 7-10 топовых + free-text option.
- **IN-5** `lib/payments/sbp-debt-derivation.ts` — единый source of
  truth для расчёта «должен ли». Все UI-callsites ходят через него.
- **IN-6** Status semantics: `claimed → confirmed/declined/cancelled`
  — единичный переход, в БД CHECK не enforced (server-side guard).
  Append-only в смысле «не обновляем claimed_at и amount»; status
  переход — single edit.

### 10.4 Открытые questions (после round 2)

- **OQ-3**: mismatch threshold UI (§10.2 WN-15) — > 10% или > 200₽?
- **OQ-4**: refund 'slot_cancelled' — auto-suggest или silent hint?
- **OQ-5**: backfill batch limit — 50 / 100 / 200?
- **OQ-6**: notification channels priority — email-first, Telegram
  опционально, push для прогрессивных. Sub-PR F.
- **OQ-7**: что показывать в expense rows если учитель архивировал
  payment_method, по которому был платёж? «Удалённый метод» с last
  4 цифр телефона? Или дать historic snapshot?
- **OQ-8**: backfill — нужна ли возможность учителю задним числом
  пометить slot completed (если он забыл нажать `completed`)? Или
  это отдельная операция? Скорее всего отдельная — `/admin/lessons`
  pattern.
- **OQ-9**: pricing override для duration_minutes — что если slot
  имеет нестандартную duration (45 ≠ 60)? Bookning сейчас знает
  duration через `slot.duration_minutes`. Резолвим override по
  exact match; нет match → fallback tariff.

### 10.5 Что не учитано даже в round 2 (потенциальные round 3)

- **Multi-currency / валютные курсы** (non-goal, но при росте
  иностранных учеников всплывёт).
- **Налоговые ставки** (НПД 4% / 6%) — простой post-processing на
  CSV. Можно учить в Sub-PR F sub-task.
- **Расхождение по часовому поясу при backfill** (ученик в UTC+3,
  учитель в UTC+5 — какой день оплаты?).
- **Прочие методы кроме СБП** (карта, USDT — не сейчас).
- **Reminders cooldown** — учитель не должен нажимать «Напомнить» 10
  раз подряд (rate-limit на уровне notification queue).

---

## 11. Self-review round 3 (2026-06-07)

Холодный проход после round 2. Цель — найти что упустили в schema, API
boundary, edge-cases теперь со сосредоточением на (a) cross-validation
items, (b) snapshot-данные на момент claim, (c) lifecycle при удалении
account-родителей, (d) UX-провалы в "счастливых" путях.

### 11.1 Новые BLOCKER (зафиксированы в спецификации выше)

| # | Issue | Fix-section |
|---|---|---|
| **BL-17** | mark-paid: items может содержать slot'ы разных учеников — claim шапка с одним learner_account_id развалится | §3.5 server-side validation: ВСЕ items.slot/package должны быть одной паре (teacher, learner). 400 при mismatch. |
| **BL-18** | Учитель меняет phone/bank у метода — история claim теперь врёт (показывает новый телефон вместо того, на который реально шли деньги) | §2.5 `payment_method_phone_snapshot` + `payment_method_bank_snapshot` populated на INSERT, никогда не меняются. |
| **BL-19** | teacher_account_id on delete cascade — при удалении аккаунта учителя ученик теряет историю переводов ему. Симметрично BL-15 | §2.5 `teacher_account_id on delete set null` + `teacher_display_name_snapshot`. |
| **BL-20** | Archive payment_method не cleanup assignments — ученик через assignment продолжает видеть архивированный метод как `current` | §3.4 GET `/api/learner/payment-method/[teacherId]` фильтрует assigned method WHERE archived_at IS NULL; если фильтр срезал — fallback default; если default нет — null (opt-out для этой пары). |
| **BL-21** | Slot/package удалены → item остаётся с null FK, теряется смысл строки | §2.5 `item_label_snapshot` populated на INSERT. |
| **BL-22** | Backfill попадает на slot с активным claim (gостейный clash с уже сделанной заявкой ученика) | §3.7 server-side: пропускает slot если EXISTS active claim_item (status in claimed/confirmed). Возвращает skipped[] в ответе. |

### 11.2 Новые WARN

- **WN-17** Refund explainer copy: ЯВНО сказать «возврат происходит у вас в банке вручную; платформа только фиксирует факт». Иначе учитель может подумать, что система сама сделает SBP-перевод обратно. (Sub-PR E refund-модал copy.)
- **WN-18** PayLessonModal optimistic UI rollback: если POST claim упал по сети, локальный pill «pending» должен откатиться + показать «не удалось — попробуйте ещё раз». (Sub-PR C.)
- **WN-19** PayLessonModal a11y: ESC закрывает, focus-trap, copy-кнопки tab-навigable, copy-confirmation announce через aria-live. (Sub-PR C.)
- **WN-20** Feed pagination: cursor-based (claimed_at + id) или offset+limit. Для MVP — offset+limit с дефолтом 50; cursor если history >1k. (Sub-PR D.)
- **WN-21** Bank-autocomplete список: 8 банков hard-coded (Тинькофф, Сбер, Альфа, ВТБ, Райффайзен, Газпромбанк, Открытие, Совкомбанк) + free-text fallback. (Sub-PR A.)
- **WN-22** Phone validation: server-side REGEX `^\+7\d{10}$` после normalize. (Sub-PR A.)
- **WN-23** Subtle "напомнение оплатить" hint в `/cabinet`: если у ученика есть completed slots без оплаты — подсветка в «Мои занятия» (не громкий баннер). (Sub-PR C.)
- **WN-24** CSV export — refunds включаем как отдельные строки с отрицательным amount + filter «без refunds» опционально. (Sub-PR F.)
- **WN-25** UI учителя при `learner_cancel` (ученик отменил свой claim до реакции учителя): запись исчезает из live feed, появляется в истории. Sub-PR D race-handling.
- **WN-26** Snapshot column `lesson_slots.snapshot_amount_kopecks` уже существует (mig 0036+ зацепили memory). **Action**: verify before Sub-PR B; если name отличается — адаптировать.

### 11.3 Новые INFO

- **IN-7** Archive метода НЕ cleanup assignments автоматически. Поведение задаётся на read-side (см. BL-20). Решение принято: проще + сохраняет интент «этому ученику этот метод» при un-archive.
- **IN-8** Postgres CHECK constraint с цепочкой OR — валидный синтаксис, проверка корректна.
- **IN-9** `phone_e164` только `+7XXXXXXXXXX` — СБП ограничен Россией.
- **IN-10** `amount_mismatch_kopecks` threshold для UI-подсветки: ≥ 10% от expected ИЛИ ≥ 200₽ (whichever first) → жёлтый warning. < — silent. Закрывает OQ-3.
- **IN-11** `audit log`: для confirm/decline отдельный audit не нужен — `teacher_account_id` на claim уже идентифицирует actor. Для refunds `created_by` уже зафиксирован.

### 11.4 Закрытые из round-2 open questions

- **OQ-3** (mismatch threshold): закрыто — IN-10 (10% или 200₽).
- **OQ-4** (auto-refund on slot cancel): silent hint, не auto-create — закрыто в WN-17.

### 11.5 Открытые после round 3

- **OQ-11** Bank autocomplete: 8 hard-coded — достаточно ли? Возможно, нужен публичный список (СБП ЦБ РФ). Решение MVP: hard-coded + free-text; если оператор просит расширить — добавить ENV-driven список.
- **OQ-12** Что показывать ученику когда у учителя 0 active методов И активная assignment ссылается на архивированный (учитель ушёл из платформы платежей)? UI «учитель не настроил оплаты», как в opt-out — закрыто, но fragmented edge.
- **OQ-13** Pricing override / backfill / refund — все три могут попасть в один claim items list. Server-side normalize: каждый item имеет expected_amount, mismatch считается на claim уровне. Должен ли быть per-item mismatch? Решение: НЕТ — для MVP достаточно одного на claim. Усложнение защёлкнуть в OQ-13 на будущее.
- **OQ-14** Privacy: после snapshot имени ученика учитель закрыл claim. Пройдёт год, snapshot останется. GDPR-вопрос: snapshot — это PII? Российский 152-ФЗ позволяет хранить для «бухгалтерских целей» бессрочно. OK для MVP.

### 11.6 Что НЕ учитано даже в round 3 (потенциальные round 4)

- **Receipt PDF / квитанции** — non-goal MVP, но для multi-teacher learner и для самозанятого учителя желательно. Отдельный эпик.
- **Auto-suggest следующего получателя** — учитель в feed нажимает confirm, mute на 1 час, чтобы случайно не подтвердить дубль.
- **Notifications cooldown / rate-limit** — учитель кликает «Напомнить» 10 раз подряд → ученик получает 10 писем. Server-side cooldown 1ч / 24ч.
- **Учительская подпись** при confirm — простой «подтверждаю получение» текст, для audit trail.
- **Audit retention** — после 7 лет по самозанятым нужно архивировать. Не наш scope.

### 11.7 Sub-PR-level scope updates

В таблицу §5 добавляется:

| Sub-PR | + к скоупу round 3 |
|---|---|
| A | bank autocomplete (WN-21), phone validation regex (WN-22) |
| B | verify `lesson_slots.snapshot_amount_kopecks` exists (WN-26), archived-method filter at read (BL-20) |
| C | optimistic rollback (WN-18), a11y (WN-19), subtle pay-hint (WN-23), snapshot phone/bank на claim INSERT (BL-18) |
| D | mark-paid same-learner validation (BL-17), feed pagination (WN-20), learner-cancelled race (WN-25), mismatch ≥ 10% UI hint (IN-10) |
| E | refund explainer copy (WN-17), backfill skip-active (BL-22) |
| F | CSV refunds inclusion (WN-24), reminder rate-limit (round-3 round-4 reference) |

---

## 12. Self-review round 4 (2026-06-07)

Холодный проход после round 3. Фокус: (a) SQL-корректность, (b)
авторизационные векторы, (c) idempotency / state-machine integrity,
(d) money math edge-cases, (e) deploy / migration safety, (f) интеграция
с legacy-системами, (g) UX-провалы при concurrent multi-tab.

### 12.1 Новые BLOCKER

| # | Issue | Fix-section |
|---|---|---|
| **BL-23** | `PRIMARY KEY (claim_id, COALESCE(...))` — невалидный Postgres-синтаксис. PRIMARY KEY принимает только имена столбцов, не выражения | §2.5 `payment_claim_items`: surrogate `id uuid pk` + UNIQUE INDEX через `NULLS NOT DISTINCT` (Postgres 15+, у нас 16). |
| **BL-24** | `PATCH /api/teacher/payment-methods/[id]` не поддерживал un-archive из UI — только re-add того же phone+bank через POST | §3.1 явно описать: PATCH принимает `archived_at: null` для restore из UI «Восстановить». |
| **BL-25** | `confirm/decline/cancel` НЕ idempotent — повторный вызов на terminal-claim ведёт к UB. Multi-tab пользователь нажимает дважды, второй тык даёт 500 | §3.5 server использует optimistic-concurrency: `UPDATE WHERE status='claimed'`; rows_affected=0 → 409 `{status: 'already_resolved', current_status}`. UI обрабатывает 409 как "ок, обновим feed". |
| **BL-26** | «Оплата» и «занятие» — независимые сущности. Если slot `completed → uncompleted` (учитель ошибся), claim status НЕ должен авто-меняться, но debt-derivation внезапно покажет slot снова в долге, который уже оплачен | §2.7 явно: `slot_is_paid` derived из payment_claims, НЕ зависит от slot.status. Slot back-to-booked → но если claim confirmed остаётся, slot НЕ в долге. |
| **BL-27** | `lesson_slots.snapshot_amount_kopecks` — это предположение, не verified. Если column-имя другое (`tariff_amount_kopecks` / etc) — все Sub-PR B/C/D ломаются | Sub-PR A ZERO: добавить шаг verification (grep + read schema) ПЕРЕД написанием миграций. Если name ≠ snapshot_amount_kopecks — обновить план. |

### 12.2 Новые WARN

- **WN-27** **Idempotent semantics**: повторный `cancel` на уже-cancelled → 409 (consistent with BL-25). Single-table state-machine: status переход разрешён только из 'claimed'.
- **WN-28** **Refund sum check**: `sum(payment_refunds.amount where claim_id=X) + amount_new ≤ payment_claims.amount`. Server-side в TX перед INSERT. Иначе учитель может вернуть больше чем получил.
- **WN-29** **Amount upper bound** на всех 3 money-полях: `< 100_000_000` копеек (1 млн ₽). Защита от typo (0 случайно лишний). Применено в §2.3, §2.5, §2.6.
- **WN-30** **Optimistic concurrency** на всех state-flip endpoints (`confirm/decline/cancel/mark-paid`). Single-stmt UPDATE … WHERE precondition, проверка rows_affected.
- **WN-31** **ALTER TABLE accounts** в mig 0113 (добавление 2 boolean колонок). На текущей шкале (десятки rows) — мгновенно. В migration-комментарии явно: "safe для production-scale текущей таблицы; при росте >10к строк — review lock-behaviour".
- **WN-32** **Legacy CloudPayments endpoints**: POST `/checkout/[tariffSlug]` всё ещё работает (UI скрыт, backend жив). Технически ученик может найти URL и оплатить через CP. Не блокер для MVP (debt-deriv `payment_channel='legacy_cp'` корректно учтёт), но при rollout — добавить feature-flag `CP_CHECKOUT_DISABLED=true` ENV для полной отключки.
- **WN-33** **Streaming CSV**: ответ не loadить в память, write to `ReadableStream`. Headers `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename=payments-{YYYY-MM-DD}.csv`. UTF-8 BOM первым байтом.
- **WN-34** **Min СБП hint**: PayLessonModal если `amount < 10000 коп` (100 ₽) — non-blocking warning «Большинство банков не пропускают переводы менее 100 ₽».
- **WN-35** **QA fixtures**: `scripts/seed-qa-fixtures.mjs` должен создавать `teacher_payment_methods` для `qa-fixture-teacher` (один default метод). Иначе ручное тестирование требует пройти весь add-method flow каждый раз после reseed.
- **WN-36** **Rate-limit + audit log** для новых endpoints. Reuse существующего middleware (Sub-PR A ZERO: grep existing pattern).
- **WN-37** **Drop `payment_refunds.created_by='system'`**: round-2 не описал ни одного use-case, где system автоматически создаёт refund. Только teacher-инициатива → enum упростить до `check (created_by = 'teacher')` или дроп колонки полностью. (Решение: keep колонку, drop 'system' из enum, для будущей extension.)
- **WN-38** **Per-row index для debt-derivation**: `payment_claim_items (slot_id) where slot_id is not null` + composite `lesson_slots (teacher_account_id, status)`. Verify в Sub-PR D что query plan ≤ 50ms на 10k slots.
- **WN-39** **PayLessonModal showing minimum amount**: если `amount < 100 ₽` СБП может отвергнуть. Warning в UI. (Сливается с WN-34.)

### 12.3 Новые INFO

- **IN-12** **Оплата ≠ занятие**. Claim status не привязан к slot.status. Slot uncomplete → claim остаётся confirmed. Это feature: payment is independent ledger.
- **IN-13** **Verify в Sub-PR A ZERO**:
  - `lesson_slots.snapshot_amount_kopecks` существует и semantically correct?
  - Существующий `rate-limit` middleware path для `/api/teacher/*`?
  - Существующий audit-log pattern (если есть таблица или ENV-toggle)?
  - `gen_random_uuid()` extension включён (`pgcrypto`)?
- **IN-14** **Postgres 15+ `NULLS NOT DISTINCT`**: используется в `payment_claim_items_uniq`. Verify `select version()` >= 15 (memory: prod Postgres 16.13 ✓).
- **IN-15** **`teacher_pricing_overrides.amount_kopecks = 0`** = бесплатное занятие для этого ученика. Snapshot 0 → slot не в долге (debt-deriv §2.7).
- **IN-16** **Schema PII inventory**: `phone_e164`, `phone_display`, `learner_display_name_snapshot`, `teacher_display_name_snapshot`. Не шифруем at-rest, защищены HTTPS + RBAC.

### 12.4 Закрыты round-3 OQ

- **OQ-13** (per-item mismatch): закрыто — claim-level хватит.

### 12.5 Открытые после round 4

- **OQ-15** Backfill: формат входа — JSON body / multipart CSV upload / inline form? MVP: JSON body batched по 50.
- **OQ-16** Что если учитель вызывает `mark-paid` с item.slot_id, но slot уже cancelled? Принимать (учитель сам решает) или отказывать? Решение: принимать с warning (учитель знает контекст).
- **OQ-17** Notification channels (Sub-PR F): email-only MVP или email+Telegram сразу? Память говорит, что Telegram-binding уже есть у части учеников — можно использовать.

### 12.6 Что НЕ учитано даже в round 4 (потенциальные round 5)

- **Время обработки СБП** (5-30 сек, иногда минуты): если ученик нажимает «Я оплатил» сразу, а деньги ещё не пришли — учитель пишет «не пришло». Stress-pattern. Возможный fix: явное напоминание ученику «нажимайте только после смс от банка».
- **Учитель банкротится / эскалация в legal**: payment_refunds с reason='goodwill' может стать массовым. Не наш scope.
- **Ученик закрыл аккаунт прямо после создания claim**: `learner_account_id` set null + snapshot держит имя. Учитель видит «Маша (удалён)» — corner case, не блокер.
- **Time-window для cancel claim**: сейчас можно cancel'ить только если status='claimed'. А если учитель быстро confirmed, ученик не успевает отменить? UX-проблема, но fundamentally correct (claimed → confirmed = атомарный переход).
- **Сравнение payment_method_phone_snapshot с СБП-реальностью**: учитель может ввести phone, а ученик переведёт на другой. Платформа не знает. Доверие.

### 12.7 Sub-PR-level scope updates (round 4 add)

| Sub-PR | + к round-4 scope |
|---|---|
| **A** (Sub-PR ZERO step) | **verification step** (IN-13): grep `snapshot_amount_kopecks`, существующего rate-limit, audit-log pattern, pgcrypto, Postgres version |
| A | WN-21 bank-autocomplete, WN-22 phone regex, WN-31 ALTER comment, WN-35 fixtures, WN-36 rate-limit |
| C | BL-25 + WN-30 idempotent confirm/cancel handling, WN-34 min СБП hint |
| D | BL-26 «оплата ≠ занятие» — debt-deriv test matrix включает slot uncomplete flip, WN-30 optimistic concurrency, WN-38 query plan verification |
| E | BL-24 PATCH `archived_at: null` un-archive, WN-28 refund sum check, BL-25 idempotent endpoints |
| F | WN-33 streaming CSV, WN-32 legacy CP disable flag (опц.) |

---

## 13. Self-review round 5 (2026-06-07)

Холодный проход после round 4. Focus: (a) полнота flow для пакетов
(round-4 раскрыл schema, но не сам путь), (b) интеграция с
existing-системами (admin UI, audit log, cache), (c) UX состояния
(empty / loading / error), (d) PII в server-side обзвоне.

### 13.1 Новые BLOCKER

| # | Issue | Fix-section |
|---|---|---|
| **BL-28** | Package-purchase flow под SBP не описан. `payment_claim_items.package_purchase_id` ссылается на строку, но кто/когда её создаёт? Если она создаётся только webhook'ом CloudPayments (legacy), то ученик не может pay-and-claim для нового пакета. | §3.4-bis (новый параграф ниже): добавляем `POST /api/teacher/packages/offer` — учитель из своего кабинета создаёт «предложенный» package_purchase со `paid_at=null`, `status='offered'`. Ученик в `/cabinet/packages` видит его, нажимает «Купить», получает SBP-реквизиты, после перевода создаёт claim ссылающийся на этот package_purchase_id. Учитель confirm → автотриггер в TX flip'ает `package_purchase.paid_at = now()` → доступ ученика активируется. Также `mark-paid` от учителя — same triggered flip. |
| **BL-29** | Race: учитель меняет pricing_override на 2000 ₽, в этот же момент booking создаёт slot и пишет snapshot из старой цены (1500 ₽). Slot перманентно зафиксирован за старую цену | §2.3 + §2.7: snapshot price reads override в transaction с `SELECT ... FOR UPDATE` на pricing_overrides row для этой пары (teacher, learner, duration). Race acceptable если override меняется реже, чем booking, но edge case → лучше пресечь. |

### 13.2 Новые WARN

- **WN-40** **Free-slot workflow**: учитель хочет провести бесплатный пробный без trash'а tariff'а / pricing override. Решение: при `mark-paid` с `amount_kopecks=0` создаётся confirmed claim, item.expected=0. Slot не в долге, в журнале — строка «Пробное занятие — бесплатно». Documentation в Sub-PR E.
- **WN-41** **PII в server logs**: phone_e164, learner/teacher snapshot names НЕ должны попадать в server logs и Sentry breadcrumbs. Защита: `lib/logger.ts` (если есть) добавить scrub-pattern, или sanity-проверить error.message не содержит phone. Sub-PR A ZERO step.
- **WN-42** **Admin /admin/teachers/[id] обновить**: существующая drill-down показывает `teacher_earnings` ledger (mig 0081). Добавить блоки: «SBP payment methods» (count), «Active payment_claims pending» (count), «Last 10 claims». Sub-PR D или отдельный mini-PR.
- **WN-43** **Filter/sort/persist в feed UI**: фильтры по статусу × ученику × периоду + URL persist. Default sort: `claimed_at desc`. Опционально `amount desc`. Sub-PR D.
- **WN-44** **Search by snapshot name**: `GET /api/teacher/payment-claims?search=маша` — case-insensitive substring. Index: `lower(learner_display_name_snapshot) text_pattern_ops`. Sub-PR D.
- **WN-45** **Telegram notification template**: Sub-PR F переиспользует BCS-DEF-4-TG infra (учеников Telegram-binding уже сделан). Template: «Учитель {name} ждёт оплату {amount}₽ за {date} занятие. Не забудьте перевести через СБП». Email — отдельный template.
- **WN-46** **Cache revalidation**: Next.js `dynamic = 'force-dynamic'` уже стоит на cabinet pages. После confirm/decline/mark-paid — server router.refresh() в UI. Sub-PR C/D.
- **WN-47** **Empty / loading / error states**: каждая UI surface (feed, history, settings hub tile) должна иметь явные пустые состояния. Sub-PR-by-Sub-PR copy review: «Здесь будут заявки ваших учеников» / «Загружаем заявки…» / «Не удалось загрузить — попробуйте ещё раз».
- **WN-48** **Schema linking** между `payment_claim_items.package_purchase_id` и `package_purchases.id` — verify что existing `package_purchases` table принимает строки с `paid_at IS NULL` без crash в существующих query path. Sub-PR A ZERO step (новый verification).

### 13.3 Новые INFO

- **IN-17** **Audit log**: reuse existing pattern. Если в проекте нет глобального audit table — Sentry breadcrumbs purpose-build для critical state-flip (confirm/decline/mark-paid). Sub-PR A ZERO: check audit infra.
- **IN-18** **Sentry policy**:
  - INSERT валидация (mismatch / wrong learner) → 400, **НЕ** в Sentry.
  - confirm/decline/optimistic lock fail → 409, **НЕ** в Sentry.
  - 500 от DB / network → **YES** Sentry warning.
- **IN-19** **Pricing override applies ONLY к будущим booking-ам**: уже забронированные slots сохраняют snapshot. Это feature (price freezing at booking time).
- **IN-20** **Package_purchase creation paths**:
  - Legacy CloudPayments webhook → `paid_at=now()` at creation.
  - **NEW** SBP-flow: teacher `POST /offer` → `paid_at=NULL` → learner claim → teacher confirm → `paid_at=now()`.
  - **NEW** Teacher mark-paid: ditto, но в одной TX без learner claim flow.
- **IN-21** **package_purchases.status** — нужна или вычисляется из `paid_at IS NULL/NOT NULL`? Если в существующей таблице `status` есть — спросить semantics. Если нет — добавить (`offered | active | exhausted | expired`). Sub-PR A ZERO step.

### 13.4 Закрыты round-4 OQ

- **OQ-15** Backfill format: JSON body batched. Не делаем CSV-upload в MVP.
- **OQ-16** Mark-paid на cancelled slot: разрешаем, учитель сам знает. UI warning «Slot отменён — точно зафиксировать оплату?».

### 13.5 Открытые после round 5

- **OQ-18** Package offer expiry: если учитель `POST /offer` создал, но ученик не купил за 30 дней — offer должен auto-expire или висеть вечно? MVP: висит, учитель может вручную archive.
- **OQ-19** Что показывать ученику в `/cabinet/packages`, когда у учителя 0 active payment_methods? offers видим, но кнопка «Купить» в opt-out — disabled с пояснением.
- **OQ-20** Если slot перебронирован (старый отменён, новый создан с тем же payment_claim_item ссылкой) — claim становится «оплачен за несуществующий slot». Обработать?

### 13.6 Что НЕ учитано даже в round 5

- **Уведомление учителю в realtime** когда ученик создаёт claim. MVP опция: polling каждые 30с в feed UI. WebSocket / SSE — отдельный эпик.
- **Бот-учитель**: автоматическая sub-PR на confirm от Telegram bot. Чисто UX-niceto-have.
- **Гросс-нетто** — какая сумма доход учителя (грос) и сколько за вычетом налогов (нетто). Не наш scope (учитель сам знает свою налоговую ставку).
- **Многоразовая backfill UX**: загрузить CSV с 1000 строк прошлых оплат. Defer (`OQ-15` MVP — JSON inline).
- **PCI compliance**: не применимо, мы не храним номера карт.

### 13.7 Sub-PR scope updates (round 5)

| Sub-PR | + round-5 |
|---|---|
| **A ZERO step** | + verify `package_purchases.status` существует / semantics (IN-21, WN-48), + PII scrub в logger (WN-41), + audit log infra (IN-17) |
| A | (без новых tasks) |
| B | + pricing_override `FOR UPDATE` race-fix (BL-29) |
| C | + Telegram template (WN-45), + free-slot workflow notes (WN-40) |
| D | + admin drill-down update (WN-42), + search/filter/sort (WN-43, WN-44), + cache revalidation (WN-46), + empty/loading/error states (WN-47) |
| E | + free-slot via mark-paid amount=0 (WN-40), + package_purchase create-on-confirm trigger (BL-28) |
| F | + Telegram template (WN-45), + email template |

---

## 14. Self-review round 6 (2026-06-07)

Холодный проход после round 5. Фокус: (a) sub-PR ordering и migration
dependencies, (b) интеграция с existing UI/nav, (c) edge-cases на
boundary с deletion-grace / unverified email, (d) backfill / rate-limit
hardening.

### 14.1 Новые BLOCKER

| # | Issue | Fix-section |
|---|---|---|
| **BL-30** | **Sub-PR ordering broken**. Round-2 §5 размещает migration 0114 (claims+items) в Sub-PR D. Но Sub-PR C (learner pay flow) INSERT'ит в claims/items — D ещё не merged → C не сможет компилироваться. | §5 пересмотр: **0114 + 0115 переезжают в Sub-PR A**, чтобы schema полностью готова к моменту Sub-PR B+. Sub-PR D становится UI/API only — feed, dashboard, mark-paid, confirm/decline. Risk: A разрастается, но это меньшее зло чем dependency-breakage. |

### 14.2 Новые WARN

- **WN-49** **`/cabinet/payments` maxWidth**: AuthShell default 440px — узко для истории. Mirror /cabinet/profile pattern: `<div style={{ maxWidth: 640 }}>`.
- **WN-50** **TeacherCabinetNav active-tab**: /teacher/payments → highlight «Настройки» tab (closest parent). Sub-PR D.
- **WN-51** **/teacher main surface**: если pending claims > 0 — добавить tile «Ждут подтверждения N» под DigestPreviewTile. Иначе учитель не узнает без дрилла в settings. Sub-PR D.
- **WN-52** **Bottom-nav badge** на «Настройки» когда есть pending claims (паттерн existing `calendarConnected` dot). Sub-PR D, server-derived SSR-проп `pendingPaymentClaimsCount` в `TeacherCabinetNav`.
- **WN-53** **Sub-PR B риск**: модификация booking-path для чтения pricing_overrides — касание existing `lib/scheduling/slots/booking.ts` (или где живёт snapshot calc). Это core path, защищённый advisory-lock + TX. Sub-PR B test plan расширить: explicit booking happy-path тест без override + с override + race в `SELECT FOR UPDATE` (BL-29).
- **WN-54** **Refund applicable only to confirmed**: `POST /api/teacher/payment-refunds` отвергает 400 если `claim.status ≠ 'confirmed'`. Sub-PR E.
- **WN-55** **PayLessonModal emailVerified gate**: модал не открывается если `!emailVerified`. Mirror existing pattern для «Открыть календарь». Sub-PR C.
- **WN-56** **Deletion-grace state**: учитель в 30-day grace — НЕ принимаем новые claims на него, новые payment_methods не редактируются. Server-side check `accounts.deletion_requested_at IS NULL`. Sub-PR A.
- **WN-57** **Backfill paid_at validation**: `check (paid_at IS NULL OR paid_at <= now())` — нельзя зафиксировать оплату из будущего. Sub-PR E.
- **WN-58** **Rate-limit POST /api/learner/payment-claims**: 10/час per `(learner_account_id, teacher_account_id)`. Защита от случайного спама / атаки. Reuse existing middleware. Sub-PR C.
- **WN-59** **Bulk-actions** в `/teacher/payments` feed: «Подтвердить все», «Отклонить все» — checkbox + batch endpoint. Nice-to-have в Sub-PR D, можно defer.
- **WN-60** **Structured logging** на confirm/decline/mark-paid: `{ action, teacher_id, claim_id, item_count, amount, mismatch }` — для support tickets и performance metrics. Reuse existing logger.
- **WN-61** **Free slot — НЕ через claim**: round-5 WN-40 предлагал `mark-paid amount=0`. Это **conflict** с `check (amount_kopecks > 0)` на claim. Корректный путь: free slot живёт через `snapshot_amount_kopecks=0` + debt-deriv exclusion (§2.7). НИКАКОГО claim не создаётся — это чисто конфигурационный atrribute slot'а. (Замещает WN-40.)

### 14.3 Новые INFO

- **IN-22** **claim.amount_kopecks > 0 строго**: free slots живут вне claim-системы. Исправление round-5 WN-40 → round-6 WN-61.
- **IN-23** **Prepay = valid use-case**: ученик оплачивает slot, который ещё не состоялся. UI учителя «вперёд оплачен». Не блокер, feature.
- **IN-24** **Timestamps UTC + display tz**: claimed_at/paid_at/resolved_at в БД UTC; UI учителя — в `account.timezone`; CSV — в `account.timezone`.
- **IN-25** **Sub-PR A scope расширен**: после BL-30 в Sub-PR A добавлены mig 0114 + 0115 (структура — без UI). Это делает A большим Sub-PR, но semantically чище: всё schema в A.
- **IN-26** **«Освобождение» bottom-nav real-estate**: badge на «Настройки» — на existing tab без новой вкладки. Соответствует round-1 решению не вводить 5-ю.

### 14.4 Закрытые round-5 OQ

- **OQ-19** (что показывать ученику в opt-out учителя): закрыто WN-49 + opt-out UX §4.4 — пустая страница с пояснением.

### 14.5 Открытые после round 6

- **OQ-23** Bulk-actions (WN-59) — Sub-PR D MVP или defer? Решение: defer, не критично для shipping.
- **OQ-24** Bot-учитель ответ на pending claim из Telegram — отдельный эпик.
- **OQ-25** При cascading-delete учителя через GDPR DangerZone — что с pending claims ученика на этого учителя? cascade удалит payment_methods → claims set null teacher → snapshot имени учителя сохранён. Ученик видит «Учитель (удалён)». Acceptable.

### 14.6 Что НЕ учли даже в round 6

- **Анти-фрод**: ученик создаёт массовые claims на small суммы для теста — pattern detection. Out of MVP scope.
- **Чёрный список**: учитель добавляет ученика в «не принимать оплаты от этого». Outside scope.
- **Сам-учитель платит self**: edge — учитель=ученик. UI не должен показать pay-flow на свои же slots.
- **Учитель экспортирует свои данные перед увольнением**: GDPR right-to-portability. CSV export уже даёт это, но включить prompt при DangerZone deletion.
- **Multi-currency для приграничных учеников**: SBP только +7. Иностранный ученик не сможет платить. Документация требует.

### 14.7 Sub-PR scope updates (round 6)

| Sub-PR | + round-6 |
|---|---|
| **A** | **+ mig 0114 (claims+items)**, **+ mig 0115 (refunds)** — schema целиком в A (BL-30); + deletion-grace check (WN-56) |
| **B** | + WN-53 risk-acknowledgement test plan |
| **C** | + emailVerified gate (WN-55), + rate-limit per pair (WN-58) |
| **D** | + active-tab nav logic (WN-50), + main page tile (WN-51), + bottom-nav badge (WN-52), + structured logging (WN-60), + bulk-actions defer note (WN-59 / OQ-23) |
| **E** | + refund-only-confirmed (WN-54), + backfill paid_at past check (WN-57) |
| **F** | (без новых) |

### 14.8 Замечание по Sub-PR A росту

После BL-30 Sub-PR A содержит:
- ZERO step (verifications)
- 6 migrations (0110-0115)
- `lib/util/phone.ts`
- API `/api/teacher/payment-methods/**`
- UI `/teacher/settings/payment-methods` + тайл
- Explainer 4.3.b
- Integration-тесты §8.3-A

Это **L-размер**, не M. Если попахивает мега-PR — рассмотрим split на A1 (migrations only, без UI/API) и A2 (UI/API на готовой schema). Решение примем при старте Sub-PR A.

---

## 15. Self-review round 7 (2026-06-07)

Холодный проход после round 6. Diminishing returns начали — BLOCKER не
найдено. Focus: (a) concrete TX semantics, (b) reuse existing primitives
+ infrastructure, (c) экспансия test scenarios, (d) операционные
мелочи.

### 15.1 BLOCKER

**Нет.** После 6 rounds большие архитектурные проблемы закрыты.
Дальнейшие проходы дадут только WARN/INFO.

### 15.2 Новые WARN

- **WN-62** **Advisory-lock namespace**: использовать prefix `'pay-claim:' || slot_id` для `pg_advisory_xact_lock(hashtext(...))`. Не пересекается с существующим `'pkg-stack:'` (memory: PKG-ADMIN-GRANT BLOCKER #1 unified buy + admin-grant + webhook на `pkg-stack:`). Sub-PR C/D/E TX-блоки.
- **WN-63** **Concrete TX sequences**: задокументировать в плане precise BEGIN/COMMIT для:
  - `POST /api/learner/payment-claims`: BEGIN → advisory_xact_lock per item.slot_id → validate ownership/teacher-pair → SELECT existing active claim_item.slot_id (any in claimed/confirmed) → 409 if found → INSERT claim → INSERT items → COMMIT.
  - `POST .../[id]/confirm`: BEGIN → UPDATE claim SET status='confirmed' WHERE id=X AND status='claimed' AND teacher=session RETURNING — if rows=0 → SELECT current status → 409 → ELSE если items имеют package_purchase_id, UPDATE package_purchases SET paid_at=now() — COMMIT.
  - `POST /payment-refunds`: BEGIN → SELECT claim FOR UPDATE → validate status='confirmed' → SUM existing refunds → check (new + existing) ≤ claim.amount → INSERT refund → COMMIT.
  - `POST /mark-paid`: BEGIN → advisory_xact_lock per item → validate same teacher+learner — same as learner-claim PLUS INSERT claim status='confirmed' напрямую → INSERT items + package_purchases flip → COMMIT.
- **WN-64** **CSRF token**: проверить, что existing middleware (`lib/security/csrf`?) применяется к новым endpoints. Sub-PR A ZERO step: grep CSRF infrastructure.
- **WN-65** **Modal focus-trap**: native `<dialog>` element автогрузит focus-trap, но мы используем `<div role="dialog">`. Manual implementation: useEffect `document.addEventListener('keydown')` для Tab, циклирует focus внутри modal. PayLessonModal / CancelLessonModal / refund-modal. Sub-PR C/E.
- **WN-66** **Pill tone mapping для claim statuses**:
  - `claimed` → tone='warning' (жёлтый, «ждёт»)
  - `confirmed` → tone='success' (зелёный, «оплачено»)
  - `declined` → tone='danger' (красный, «не пришло»)
  - `cancelled` → tone='default' (серый, «отменено учеником»)
  - Refund → отдельная pill tone='default' с надписью «Возврат N₽»
- **WN-67** **Reuse existing primitives**:
  - Banner для всех 4 explainers (поддерживает `tone`, `action` dismiss-кнопка).
  - EmptyState для empty feed/history.
  - Pill для status badges (см. WN-66).
  - Button primitive для всех CTA — не inline `<button>`.
  Sub-PR C/D/E checklist.
- **WN-68** **Sanity-limit на active payment_methods per teacher**: max 10. Защита от абуза. POST returns 409 if at limit. Sub-PR A.
- **WN-69** **Pricing override UI warn**: учитель ставит override для `duration_minutes=45`, но в его tariffs только 60. UI warning «У вас нет тарифа на 45 мин — этот override применится только если ученик забронирует 45-минутный slot». Sub-PR B.
- **WN-70** **PayLessonModal visual layout**: сумма — primary number (24-28pt), phone+bank — secondary. Layout matters для quick comprehension в банковском приложении. Sub-PR C.
- **WN-71** **SBP QR / deep-link** (defer): СБП поддерживает deep-link `https://qr.nspk.ru/...` для прямого открытия в банке. UX improvement — generate per-claim QR. **Defer**: nice-to-have, не блокер MVP. Документация после shipping.
- **WN-72** **Sub-PR A test list expansion**: явный enumeration concrete tests (см. §15.5).
- **WN-73** **Money/date formatting helpers**: `Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' })` для сумм, `Intl.DateTimeFormat('ru-RU', ...)` для дат. Reuse existing `lib/util/format.ts` (если есть) или inline.
- **WN-74** **Sentry breadcrumbs verbosity**: every state-flip → category='payment-claim' breadcrumb (no PII). Только 5xx → error. Решение: log всё, filter on Sentry side.

### 15.3 Новые INFO

- **IN-27** **TX patterns documented** в WN-63 как reference для implementation.
- **IN-28** **Reuse plan** (WN-67) фиксирован — не «изобретаем» modal/banner с нуля.
- **IN-29** **Money/date helpers** (WN-73) — единый стиль форматирования.
- **IN-30** **Migration rollback policy**: новые таблицы — DROP TABLE rollback (data-free at deploy). Acceptable.
- **IN-31** **`pg_advisory_xact_lock` namespace**: округлённый pattern `hashtext('pay-claim:' || slot_id::text)`. Documentation in code comments.

### 15.4 Закрытые round-6 OQ

- **OQ-22** Bulk-actions defer — закрыто (OQ-23 → defer).

### 15.5 Concrete test scenarios (WN-72 expansion)

Sub-PR A integration-тесты должны покрывать:

1. **Anti-spoof A → B**: учитель А GET `/payment-methods` видит только свои (not B's).
2. **Snapshot stability**: учитель change phone у method → существующий claim ссылается на старый phone через snapshot.
3. **Default-уникальность**: попытка вставить второй active default → 409.
4. **Re-add un-archive**: POST same (phone, bank_label) после archive → row un-archive'нут, не дубль.
5. **Sanity limit**: POST 11й method → 409 max_methods_reached.
6. **Archive → default auto-promote**: archive default, next active method becomes default.
7. **Archive last method → opt-out**: archive single active → 0 active methods, learner GET payment-method returns null.
8. **PATCH archive un-archive**: PATCH archived_at=null → row activated.
9. **CSRF token**: POST без token → 403.
10. **Deletion-grace**: учитель в grace → POST 403.
11. **Rate-limit ZERO**: убедиться что rate-limit middleware применяется (verify infra).
12. **Migration idempotent**: forward run twice → no error.

Sub-PR C тесты:
- Full happy path (book → claim → confirm).
- Anti-spoof: ученик А создаёт claim для slot ученика Б → 403.
- Anti-spoof: payment_method_id принадлежит teacher C, slot teacher D → 400.
- Cancel claim before confirm → status='cancelled'.
- Multi-item claim (4 slots one transfer) → all items linked, sum mismatch=0.
- payment_channel='other' без method → claim создаётся, no method.
- Race: 2 concurrent INSERT claim same slot → 2nd получает 409.
- Rate-limit: 11 claim's в час per pair → 429.
- emailVerified=false → modal не открывается (или 403 на API).

Sub-PR D тесты:
- Confirm idempotent: 2nd call → 409.
- Mark-paid same-learner validation: items mixed learners → 400.
- Mark-paid happy: создаёт confirmed claim атомарно.
- Decline → claim status='declined', ученик можно создать новый.
- Race: 2 concurrent confirm same claim → 2nd получает 409.
- Search by snapshot name (case-insensitive).
- Pagination cursor/offset stable.

Sub-PR E тесты:
- Refund happy: claim confirmed → refund created → effective paid -= amount.
- Refund > claim.amount → 400.
- Refund на declined → 400.
- Backfill batch 50 happy → all confirmed.
- Backfill batch 51 → 400 (over limit).
- Backfill skip-active: slot has active claim → skipped[] в ответе.
- Backfill paid_at > now() → 400.

### 15.6 Открытые после round 7

- **OQ-26** Sentry breadcrumb для confirm/decline — every event или sample? MVP: every (low traffic).
- **OQ-27** Bulk-mark-paid endpoint (batch confirm от учителя с shared SBP-method context) — Sub-PR D nice-to-have, defer.
- **OQ-28** SBP QR deep-link generation — отдельный эпик после MVP shipping.

### 15.7 Что НЕ учли в round 7 (round 8 candidate)

- **i18n** для banks list — для русскоязычной UI ОК.
- **Service worker** перезапуск при confirm — PWA cache invalidation.
- **Bot-учитель reply через TG** — отдельный эпик.
- **Учительская подпись / receipt** — отдельный эпик.

### 15.8 Sub-PR scope updates (round 7)

| Sub-PR | + round-7 |
|---|---|
| **A** | + WN-63 TX patterns documentation, + WN-64 CSRF verify, + WN-68 sanity limit, + WN-72 expanded tests |
| **B** | + WN-69 override-no-tariff warn |
| **C** | + WN-65 focus-trap impl, + WN-66 pill mapping, + WN-67 primitive reuse, + WN-70 modal layout, + WN-73 format helpers |
| **D** | + WN-66 pill mapping, + WN-67 EmptyState reuse, + WN-74 Sentry breadcrumbs |
| **E** | + WN-65 focus-trap для refund modal, + WN-67 EmptyState |
| **F** | (без новых) |

### 15.9 Рекомендация после round 7

**Diminishing returns достигнут**. Из round 7 нет ни одного BLOCKER —
все находки это implementation polish + test enumeration. Round 8 даст
ещё меньше.

**Рекомендую**: переходить к Sub-PR A ZERO step. Дальнейшие проверки —
во время implementation (грэп existing code → adjust plan если что
расходится).

---

## 16. Next step

`/codex-paranoia plan` отложена. Стартую Sub-PR A немедленно:

1. `lib/util/phone.ts`
2. Migrations 0110, 0111, 0112, 0113 (раздельно)
3. API `/api/teacher/payment-methods/**`
4. UI `/teacher/settings/payment-methods` + тайл в settings hub
5. Explainer 4.3.b
6. Integration-тесты §8.3-A

---

*Round 2 self-review by Claude (Opus 4.7), 2026-06-07. Round 1 +
owner-feedback (16 edge-cases) интегрированы. Codex paranoia deferred —
re-run на epic-end wave, если квота вернётся.*
