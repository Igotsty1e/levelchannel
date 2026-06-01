---
title: Tariffs + packages → learner-scoped binding
status: SHIPPED 2026-06-02 — all sub-PRs (#470–#475) + epic-end fix-PR (#476) merged to main. Plan-mode SIGN-OFF round 10/N + epic-end wave-mode SIGN-OFF round 1/3 (3 BLOCKER + 1 WARN closed inline). One follow-up tracked: archive contract for lesson_packages.deleted_at writer + bulk-revoke (deferred per fix-PR #476 R1-WARN#2 closure note).
date: 2026-06-01
owner: claude-orchestrator (after T1 «per-learner payment method» wave)
---

## Reading order (post round-3)

The doc grew through 3 paranoia rounds; reading top-to-bottom hits superseded text. Authoritative state lives in these sections; treat anything earlier as historical context. Anchor labels match the `## `/`### ` headings exactly:

1. **`## Migration`** — current canonical mig 0102: visibility columns on BOTH tables, `lesson_packages.deleted_at`, junction tables, `lesson_slots.snapshot_amount_kopecks` column + backfill (status-predicated). Slug-flip DDL is intentionally absent (R2/R3-BLOCKER#3 closure).
2. **`### Round-1 BLOCKER fixes — applied`** — current invariants: ownership/link trigger (with revoke-only exemption), unified `pkg-stack:tariff-access:…` + `pkg-stack:package-access:…` advisory locks, `FOR KEY SHARE` on `learner_teacher_links`.
3. **`#### B1 — Price snapshot invariant (UC4 enforceable)`** — current price-snapshot spec: backfill + forward trigger + app-side write across both `BILLING_WAVE_ACTIVE` branches.
4. **`### WARN fixes — applied`** — current visibility filter (`deleted_at IS NULL AND is_active = true`) and package-visibility discriminator (`lpa.package_id IS NULL` after LEFT JOIN).
5. **`### Updated Sub-PR phasing`** (at the bottom, post round-1) — authoritative sub-PR order with PKG-TEACHER-SCOPE companion first.

# Tariffs + packages → learner-scoped binding

## Кратко

Сейчас `pricing_tariffs` и `lesson_packages` хранятся per-teacher (1:N, `teacher_id` колонка), но **никак не привязаны к ученику**. Один тариф «60 мин английский, 1500₽» виден всем ученикам этого учителя; пакет «10 уроков по 60 мин» можно купить любому.

Это значит: учитель **не может** сказать «у Алины индивидуальная цена 1200₽, у Пети стандартная 1500₽», или «этот пакет доступен только новым ученикам».

**Вопрос:** добавлять ли привязку tariff/package → конкретный ученик?

**Recommendation (draft):** **Option B — отдельная таблица `learner_tariff_access` + `learner_package_access` (junction).** Tariffs/packages остаются «каталогом» учителя, junction добавляет ACL и опционально per-pair price override.

## Текущее состояние

### `pricing_tariffs` (mig 0018 + mig 0088)

```sql
pricing_tariffs (
  id uuid PK,
  slug text NOT NULL UNIQUE,
  title_ru text,
  amount_kopecks int,
  currency text,
  duration_minutes int,
  teacher_id uuid REFERENCES accounts(id) NOT NULL,  -- mig 0088
  is_active bool,
  display_order int
)
```

**Кто пишет:** учитель через `/teacher/tariffs` (CRUD UI).
**Кто читает:**
- `lib/scheduling/slots/booking.ts` — slot.tariffId → `amount_kopecks` для postpaid path
- admin slots create flow — для прикрепления tariff к slot'у
- `lib/cabinet/teacher-blocks.ts` — для отображения цены ученику

**Per-teacher, не per-learner.** Любой booking с этим teacher_id видит этот тариф.

### `lesson_packages` (mig 0033 + mig 0076a + mig 0089)

```sql
lesson_packages (
  id uuid PK,
  slug text NOT NULL UNIQUE,
  title_ru text,
  duration_minutes int,
  count int,
  amount_kopecks int,
  teacher_id uuid REFERENCES accounts(id) NOT NULL,  -- mig 0076a
  is_active bool,
  display_order int
)
```

**Кто пишет:** учитель через `/teacher/packages`.
**Кто читает:**
- `app/api/checkout/package/[slug]/route.ts` — purchase flow
- `lib/billing/packages/catalog.ts` — list active
- `lib/billing/packages/consumption.ts` — match by duration на booking

**Per-teacher, не per-learner.** Любой ученик этого учителя может купить любой пакет.

## Проблема — vacuum-floating

После SaaS-pivot:
1. Учитель ведёт расчёты с учениками вне платформы (T1 → payment_method per pair).
2. Реальная цена занятия — **дело учителя и ученика**, не платформы.
3. Один и тот же учитель часто имеет **разные цены для разных учеников** (старые клиенты — скидка, новые — стандарт).
4. Пакеты могут быть **личными офферами** («Алина, тебе предлагаю 10×60min за 12000»), не общими.

Текущая модель не даёт это выразить — каталог одинаков для всех. Если учитель сделает «дешёвый» тариф для Алины — Петя его тоже увидит и сможет забронировать слот по этой цене.

## Use cases

**UC1** — индивидуальная цена занятия:
> Алина — старый ученик с привилегированной ценой 1200₽ за 60 мин. Петя — новый, стандарт 1500₽.

**UC2** — приватный пакет:
> Учитель предлагает Алине «10×60min пакет за 11000₽» (скидка). Петя этот пакет НЕ должен видеть.

**UC3** — публичный каталог + приватные офферы:
> Базовый тариф «60 мин — 1500₽» видят все. Плюс отдельный приватный тариф «60 мин для Алины — 1200₽», который только Алина видит.

**UC4** — изменение в течение жизни связи:
> Алина платила 1500₽, потом учитель снизил до 1200₽. Старые завершённые занятия не пересчитываются, новые бронирования идут по 1200₽.

## Design options

### Option A — nullable `learner_account_id` колонка на сами `pricing_tariffs` / `lesson_packages`

```sql
ALTER TABLE pricing_tariffs ADD COLUMN learner_account_id uuid NULL
  REFERENCES accounts(id) ON DELETE CASCADE;
-- NULL = applies to all learners of this teacher (caталог)
-- SET = scoped to specific learner only
```

**Pros:**
- Меньше таблиц.
- Простой SQL: `WHERE teacher_id = $1 AND (learner_account_id IS NULL OR learner_account_id = $2)`.
- Sluд per-teacher unique → per-(teacher, learner) unique.

**Cons:**
- Смешивает «каталог» (учительский шаблон) и «individual offer» в одну сущность.
- Если хочется когда-нибудь иметь общий тариф + per-learner price override — это два разных rows с почти одинаковым контентом (дубль метаданных типа title_ru).
- Trigger immutability (`lesson_packages_economic_fields_immutable`) не различает: «приватный пакет для Алины» нельзя изменить пока куплен — а это может быть нужно (учитель хочет поднять цену для новой покупки, оставив старую).
- Booking flow query становится сложнее: ORDER BY ... затем `coalesce(learner-scoped, catalog-default)`.

### Option B — junction tables `learner_tariff_access` + `learner_package_access` (РЕКОМЕНДУЮ)

```sql
CREATE TABLE learner_tariff_access (
  teacher_id uuid NOT NULL,
  learner_account_id uuid NOT NULL,
  tariff_id uuid REFERENCES pricing_tariffs(id) ON DELETE CASCADE NOT NULL,
  override_amount_kopecks int NULL,  -- NULL = use catalog price, SET = override
  granted_at timestamptz DEFAULT now(),
  granted_by_account_id uuid REFERENCES accounts(id),
  revoked_at timestamptz NULL,
  PRIMARY KEY (teacher_id, learner_account_id, tariff_id)
);

CREATE TABLE learner_package_access (
  teacher_id uuid NOT NULL,
  learner_account_id uuid NOT NULL,
  package_id uuid REFERENCES lesson_packages(id) ON DELETE CASCADE NOT NULL,
  override_amount_kopecks int NULL,
  granted_at timestamptz DEFAULT now(),
  granted_by_account_id uuid REFERENCES accounts(id),
  revoked_at timestamptz NULL,
  PRIMARY KEY (teacher_id, learner_account_id, package_id)
);
```

**Semantics:**
- `pricing_tariffs` / `lesson_packages` остаются **каталогом учителя** (как сейчас).
- Junction row = «учитель сделал этот тариф/пакет доступным этому ученику + опционально override цены».
- Учитель решает: **explicit allowlist** (только junction-scoped) ИЛИ **default-open** (все каталоговые видны, junction = override).

**Default policy (рекомендую):**
- **Default-open** для каталога: все ученики этого учителя видят активные tariffs/packages.
- Junction row нужен ТОЛЬКО для price override OR ACL-deny (через `revoked_at`).
- Простой UX: учитель создал «60min — 1500₽» — всем доступно. Хочет Алине 1200 — добавил junction row с override.

**Pros:**
- Разделяет «каталог» (учитель creates) и «assignment + override» (учитель decides per learner).
- Trigger immutability на `lesson_packages` не ломается — economic fields реально immutable для всего каталога; override живёт на junction.
- ACL расширяемость — можно потом добавить `expires_at`, `max_purchases`, etc.
- Аналогично уже принятому паттерну в T1 (`learner_billing_preferences` = per-pair config).

**Cons:**
- Лишний JOIN в booking flow.
- Больше таблиц — но schema-cost мал по сравнению с архитектурной чистотой.
- Migration ловит UC3 (общий + per-learner override) — но **UC2 (приватный пакет, не видимый другим)** требует ACL semantics.

**ACL вариант:** ввести колонку `lesson_packages.visibility` (`'catalog' | 'private'`):
- `'catalog'` — видят все ученики этого учителя (default-open).
- `'private'` — видят ТОЛЬКО ученики с junction row.

Это закрывает UC2 без перерасхода.

### Option C — `teacher_personal_offers` table (отдельная сущность)

Тариф/пакет, который **не часть каталога**, а private offer:

```sql
CREATE TABLE teacher_personal_offers (
  id uuid PK,
  teacher_id uuid NOT NULL,
  learner_account_id uuid NOT NULL,
  kind text CHECK (kind IN ('tariff', 'package')),
  title_ru text,
  amount_kopecks int,
  duration_minutes int,
  count int NULL,  -- only for kind='package'
  is_active bool,
  created_at, updated_at
);
```

**Pros:**
- Чистое разделение «каталог = public» vs «personal = private».
- Independent immutability semantics.

**Cons:**
- Полное дублирование fields с `pricing_tariffs`/`lesson_packages`.
- Booking flow: UNION ALL по двум таблицам — сложно.
- Catalog edits не отражаются автоматом на personal offers.

**Не рекомендую** — кросс-таблица overhead больше, чем junction-based pattern Option B.

### Option D — JSONB column на `learner_billing_preferences` (extending T1)

Бросить overrides в JSONB:
```sql
ALTER TABLE learner_billing_preferences ADD COLUMN
  tariff_overrides jsonb DEFAULT '{}'::jsonb,
  package_overrides jsonb DEFAULT '{}'::jsonb;
```

**Pros:** одна таблица для всего pair-specific config.

**Cons:**
- Невалидируемые ключи (потеря FK на tariff_id).
- Сложно делать query типа «какие ученики купили этот пакет» — нужен JSONB GIN index.
- Mixing concerns: payment_method и price overrides — разные lifecycle.

**Не рекомендую.**

## Recommendation

**Option B + visibility column.**

Concrete schema:
```sql
-- (a) ACL semantics на каталог: добавляем visibility.
ALTER TABLE pricing_tariffs ADD COLUMN visibility text
  NOT NULL DEFAULT 'catalog'
  CHECK (visibility IN ('catalog', 'private'));

ALTER TABLE lesson_packages ADD COLUMN visibility text
  NOT NULL DEFAULT 'catalog'
  CHECK (visibility IN ('catalog', 'private'));

-- (b) Junction tables.
CREATE TABLE learner_tariff_access (...) as above;
CREATE TABLE learner_package_access (...) as above;
```

Semantics resolution:

```sql
-- Tariffs visible to (teacher, learner):
SELECT t.*, COALESCE(lta.override_amount_kopecks, t.amount_kopecks) AS effective_amount
FROM pricing_tariffs t
LEFT JOIN learner_tariff_access lta
  ON lta.tariff_id = t.id
 AND lta.learner_account_id = $learner_id
 AND lta.revoked_at IS NULL
WHERE t.teacher_id = $teacher_id
  AND t.is_active = true
  AND (
    t.visibility = 'catalog'
    OR (t.visibility = 'private' AND lta.tariff_id IS NOT NULL)
  );
```

## Booking flow impact

`lib/scheduling/slots/booking.ts:281-301` (postpaid path) reads `pricing_tariffs.amount_kopecks` by `slot.tariffId`.

**Change:** read effective_amount through junction:

```sql
SELECT COALESCE(lta.override_amount_kopecks, t.amount_kopecks) AS amount_kopecks,
       t.currency
FROM pricing_tariffs t
LEFT JOIN learner_tariff_access lta
  ON lta.tariff_id = t.id
 AND lta.learner_account_id = $learner_account_id
 AND lta.revoked_at IS NULL
WHERE t.id = $slot_tariff_id;
```

Visibility check для blocking «slot has private tariff but learner has no access» → reject `tariff_not_visible_to_learner` (новый reason в `BookSlotResult`).

## UI impact

**Teacher's view (новый функционал):**

1. На `/teacher/tariffs` каждая карточка получает кнопку `Кому доступен →` → панель со списком учеников, чекбоксами доступа + опциональной override-ценой.
2. На `/teacher/learners/[id]` (детальная страница ученика) — секция «Цены и пакеты» со списком всех каталог-tariffs учителя и переключателями: `[доступен/не доступен]` + поле `override цена ___₽`.

Symmetric для packages.

**Learner's view:**

`/cabinet` уже отображает available packages через `lib/billing/packages/catalog.ts`. Изменение: catalog запрос проходит через junction → возвращает только видимые для этого learner'а пакеты с effective price.

## Migration

```sql
-- 0102_tariffs_packages_learner_scope.sql

-- (a) Visibility column on BOTH tables.
ALTER TABLE pricing_tariffs
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'catalog'
    CHECK (visibility IN ('catalog', 'private'));

ALTER TABLE lesson_packages
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'catalog'
    CHECK (visibility IN ('catalog', 'private'));

-- (a.2) R3-WARN#6 closure: `lesson_packages.deleted_at` for soft-delete
-- symmetry with `pricing_tariffs`. Without this column the visibility
-- filter on the package side would have only `is_active=true` while
-- the tariff side has both predicates — asymmetric attack surface.
ALTER TABLE lesson_packages
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;

-- (a.3) R6-BLOCKER#1 closure: `package_purchases.priority_snapshot`
-- frozen at purchase time. Without this, consume order reads live
-- junction priority, and a teacher revoking the junction row after
-- purchase silently demotes the purchase's consume priority — exactly
-- the "revoke does NOT affect paid consumption" invariant the plan
-- promises (see §5 below). Defaults to 0 so existing rows snapshot
-- to catalog priority retroactively (best we can do for legacy).
ALTER TABLE package_purchases
  ADD COLUMN IF NOT EXISTS priority_snapshot int NOT NULL DEFAULT 0;

-- Backfill: existing rows are by definition not soft-deleted.
-- No data change required; column defaults to NULL.

-- R4-WARN#2 closure: package archive write-side hook. Current package
-- routes (`/api/teacher/packages/[id]`, `/api/admin/packages/[id]`)
-- only flip `is_active=false`. Sub-PR A adds a DELETE handler (or
-- `PATCH … archive`) that sets `deleted_at = now()` AND bulk-revokes
-- junction rows in one transaction, mirroring the tariff side:
--
--   UPDATE lesson_packages SET deleted_at = now() WHERE id = $1;
--   UPDATE learner_package_access
--      SET revoked_at = now() WHERE package_id = $1 AND revoked_at IS NULL;
--
-- Until this hook ships, the new `deleted_at` column stays NULL on all
-- prod rows and the two-predicate filter degrades safely to
-- `is_active = true` semantics (no behavior change). The column is
-- there waiting for the archive handler to start using it.

-- (b) Slug UNIQUE: NOT TOUCHED in mig 0102.
-- `lesson_packages.slug` already moved to composite UNIQUE in mig 0089.
-- `pricing_tariffs.slug` stays globally UNIQUE in this epic; the move to
-- composite is deferred to a separate follow-up wave "TARIFF-SLUG-TEACHER-
-- SCOPE" because it requires rewriting every `slug`-based lookup
-- (`/checkout/[tariffSlug]`, `lib/billing/packages/debt.ts`, etc.) and
-- would balloon T3 scope. See R2-BLOCKER#3 closure note: the earlier
-- draft of this section also dropped + recreated slug indexes here, which
-- contradicted the §B4 deferral below and would have shipped hot-table
-- DDL changes that no caller actually needed in v1.

-- (c) Junction tables.
CREATE TABLE IF NOT EXISTS learner_tariff_access (
  teacher_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  learner_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  tariff_id uuid NOT NULL REFERENCES pricing_tariffs(id) ON DELETE CASCADE,
  override_amount_kopecks int NULL CHECK (override_amount_kopecks IS NULL OR override_amount_kopecks BETWEEN 100 AND 100000000),
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by_account_id uuid REFERENCES accounts(id),
  revoked_at timestamptz NULL,
  PRIMARY KEY (teacher_id, learner_account_id, tariff_id)
);
CREATE INDEX learner_tariff_access_lookup_idx
  ON learner_tariff_access (teacher_id, learner_account_id)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS learner_package_access (
  teacher_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  learner_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  package_id uuid NOT NULL REFERENCES lesson_packages(id) ON DELETE CASCADE,
  override_amount_kopecks int NULL CHECK (override_amount_kopecks IS NULL OR override_amount_kopecks BETWEEN 100 AND 100000000),
  -- Round-1 BLOCKER #8/Q9 — explicit priority для consumption order.
  -- Higher value consumed first. Default 0 = caталог-priority.
  priority int NOT NULL DEFAULT 0,
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by_account_id uuid REFERENCES accounts(id),
  revoked_at timestamptz NULL,
  PRIMARY KEY (teacher_id, learner_account_id, package_id)
);
CREATE INDEX learner_package_access_lookup_idx
  ON learner_package_access (teacher_id, learner_account_id)
  WHERE revoked_at IS NULL;

-- (d) auth_audit_events — четыре новых event_type для junction CRUD (Q8).
-- R5-BLOCKER#1 closure: full enum enumerated (not placeholder), copied
-- from mig 0101 + 4 new T3 entries. Drop-then-add invalidates earlier
-- constraint with the same name; no orphan event types are possible
-- because the existing rows already match the previous enum (subset).
ALTER TABLE auth_audit_events
  DROP CONSTRAINT IF EXISTS auth_audit_events_event_type_check;
ALTER TABLE auth_audit_events
  ADD CONSTRAINT auth_audit_events_event_type_check
  CHECK (event_type IN (
    'auth.login.success',
    'auth.login.failed',
    'auth.register.created',
    'auth.reset.requested',
    'auth.reset.confirmed',
    'auth.verify.success',
    'auth.session.revoked',
    'auth.teacher.self_registered',
    'auth.invite.created',
    'auth.invite.revoked',
    'auth.invite.redeemed',
    'auth.teacher.saas_offer_accepted',
    'auth.teacher.saas_offer_backfilled',
    'auth.onboarding.reset',
    'auth.billing.method_changed',
    -- T3 (mig 0102) additions:
    'auth.tariff_access.granted',
    'auth.tariff_access.revoked',
    'auth.package_access.granted',
    'auth.package_access.revoked'
  ));
```

**Backfill:** не нужен — default `catalog` visibility сохраняет текущее поведение (все ученики видят все).

### Round-1 BLOCKER fixes — applied

1. **Slug uniqueness collision** (#10/#14) — DEFERRED to separate follow-up wave «TARIFF-SLUG-TEACHER-SCOPE» (R2-BLOCKER#3 + R3-BLOCKER#3 closure). `lesson_packages` already moved to composite in mig 0089; `pricing_tariffs` stays globally UNIQUE in this epic. The earlier draft said "inline в mig 0102 above" — that line is now removed because §Migration explicitly does NOT touch slug. T3 first iteration uses tariff IDs (UUIDs) for the private-tariff identifier, not slugs. UX side: when a teacher creates a private tariff, slug stays globally unique (existing constraint) but the system may auto-generate a unique-suffix slug if needed.

2. **Unlinked-teacher invariant** (#4 BLOCKER) — в booking flow выше до junction lookup добавляется:
   ```sql
   -- Hard gate: link active? FOR KEY SHARE (not FOR SHARE) so concurrent
   -- non-key UPDATEs on learner_teacher_links don't deadlock with unlink.
   SELECT 1 FROM learner_teacher_links
    WHERE teacher_account_id = $teacher_id
      AND learner_account_id = $learner_id
      AND unlinked_at IS NULL
   FOR KEY SHARE;
   -- если 0 rows → reject `learner_unlinked_from_teacher`
   ```
   Junction rows на unlinked паре остаются (audit trail), но booking блокируется до relink.

3. **ON ARCHIVE семантика** (#9 BLOCKER; R6-WARN#2 closure: single authoritative contract — **endpoint-layer, one TX**, no trigger):
   - При `is_active=false` на каталоговом тарифе junction-row остаётся, но visibility SELECT всё равно `WHERE t.is_active = true` → Алина не видит. **Не теряет** access — при `is_active=true` снова видна.
   - При archive private тарифа: archive endpoint (`PATCH /api/teacher/tariffs/[id]/archive` или `DELETE /api/teacher/tariffs/[id]`) делает `UPDATE pricing_tariffs SET deleted_at = now()` + bulk `UPDATE learner_tariff_access SET revoked_at = now() WHERE tariff_id = $archived_tariff_id` в одной транзакции. NO trigger — trigger took ACCESS EXCLUSIVE and would have broken concurrent reads (R2-self#3 conclusion preserved). Symmetric for packages.

4. **Consumption priority** (#8/Q9 BLOCKER; R6-BLOCKER#1 closure) — `learner_package_access.priority int DEFAULT 0` AT GRANT TIME, but consume order MUST read a **snapshot** taken at the purchase moment, not the live junction, otherwise a teacher revoking the junction row after purchase silently demotes the purchase's consume priority (existing repo pattern: economic fields snapshot at purchase per `migrations/0033_billing_packages_and_postpaid.sql`).

   Mig 0102 addition:
   ```sql
   ALTER TABLE package_purchases
     ADD COLUMN IF NOT EXISTS priority_snapshot int NOT NULL DEFAULT 0;
   COMMENT ON COLUMN package_purchases.priority_snapshot IS
     'Junction priority frozen at purchase time. NEVER read live lpa.priority for consume — R6-BLOCKER#1.';
   ```

   **Where the snapshot is captured** (R8-BLOCKER#1 closure: the previous draft said "at purchase time" but `/api/checkout/package/[slug]` does not insert `package_purchases` — it only inserts `payment_orders` with a metadata blob. The actual `package_purchases` row is created later by `createPackagePurchase()` in `lib/billing/package-grant.ts` after the gateway-success webhook or mock-path fires):

   1. **At checkout-init** (`/api/checkout/package/[slug]/route.ts`): under both duration-lock AND access-lock, read the priority and bake it into `payment_orders.metadata.priority_snapshot`:

      ```ts
      // Inside the lock block, after slug/teacher disambiguation:
      const { rows: priorityRows } = await client.query(
        `SELECT COALESCE(
           (SELECT priority FROM learner_package_access
             WHERE package_id = $1 AND learner_account_id = $2
               AND revoked_at IS NULL),
           0
         ) AS priority_snapshot`,
        [packageId, accountId],
      )
      const prioritySnapshot = priorityRows[0].priority_snapshot
      // ... insert payment_orders with metadata:
      //   { ..., priority_snapshot: prioritySnapshot }
      ```

   2. **In the grant path** (`lib/billing/package-grant.ts` webhook/mock branch): read `payment_orders.metadata.priority_snapshot` and pass to `createPackagePurchase({ ..., prioritySnapshot })` (extend the helper signature). Sub-PR A extends `lib/billing/packages/purchases.ts` to accept and persist `priority_snapshot`.

   3. **Admin / teacher direct-grant flows** (`app/api/admin/packages/[id]/grant/route.ts`, `lib/billing/teacher-grant.ts`): same snapshot read on grant-time AS the checkout-init read in step 1 — `createPackagePurchase` is called with the captured snapshot. The lock context here matches step 1 because admin/teacher-grant already takes the duration-lock; this wave ALSO takes the access-lock at those call-sites to make the snapshot capture serialized against concurrent revoke (R7-BLOCKER#1 composition extended to admin-grant per R8-WARN#2 closure).

   4. **Attach-account reconciliation** (R9-BLOCKER#1 closure — `app/api/admin/reconciliation/package-grants/[invoiceId]/attach-account/route.ts`): the existing operator flow REWRITES `payment_orders.metadata.accountId` and re-runs grant. This breaks the snapshot bridge: the frozen priority would belong to the wrong learner. The attach-account route MUST also DISCARD any existing `metadata.priority_snapshot` and re-read it for the new `accountId` under the same lock pair (duration-lock + access-lock). Recompute logic:

   ```ts
   // Inside attach-account TX after metadata.accountId is rewritten:
   //   1. Acquire pkg-stack:{newAccountId}:{duration} lock
   //   2. Acquire pkg-stack:package-access:{packageId}:{newAccountId} lock
   //   3. Read priority for the NEW accountId (revoked_at IS NULL)
   //   4. Overwrite metadata.priority_snapshot with the new value
   //   5. Re-run grant
   ```

   Without this, learner B inherits learner A's frozen-at-original-checkout priority — exactly the cross-learner drift the snapshot is supposed to prevent.

   A revoked junction row at the moment of snapshot is NOT eligible to grant priority (R7-WARN#3 closure: `revoked_at IS NULL` predicate above).

   `lib/billing/consumption.ts` consume SQL becomes:
   ```sql
   SELECT pp.id, ...
     FROM package_purchases pp
    WHERE pp.account_id = $1
      AND pp.duration_minutes = $2
      AND <active>
    ORDER BY pp.priority_snapshot DESC, pp.expires_at ASC
   ```

   The LEFT JOIN to `learner_package_access` is gone from consume: subsequent revokes do NOT mutate `pp.priority_snapshot` and do NOT change consume order for already-paid purchases.

5. **Revoke vs consumption invariant** (#8/Q3 BLOCKER; R6-BLOCKER#1 reinforcement) — явно фиксируется:
   - `learner_*_access.revoked_at SET` блокирует **новые** purchases (`/api/checkout/package/[slug]` reject) и новые bookings с `tariff_id` (booking flow reject `tariff_access_revoked`).
   - **НЕ затрагивает** уже-проведённые `package_purchases` consumption — учитель не может ретроактивно отозвать оплаченный пакет. The `priority_snapshot` column makes this invariant mechanically enforced, not just documented.

6. **Re-grant idempotency** (#13 WARN) — API helper:
   ```sql
   INSERT INTO learner_tariff_access (teacher_id, learner_account_id, tariff_id, override_amount_kopecks, granted_by_account_id)
   VALUES (...) 
   ON CONFLICT (teacher_id, learner_account_id, tariff_id)
   DO UPDATE SET
     revoked_at = NULL,
     override_amount_kopecks = EXCLUDED.override_amount_kopecks,
     granted_at = CASE WHEN learner_tariff_access.revoked_at IS NOT NULL THEN now() ELSE learner_tariff_access.granted_at END,
     granted_by_account_id = EXCLUDED.granted_by_account_id
   ```
   `granted_at` обновляется ТОЛЬКО при re-grant после revoke (preserve original grant date в простом re-edit case).

7. **Advisory lock в booking + checkout + access writer** (#2 WARN; R2-WARN#5+#6 + R3-WARN#5 closure) — unified `pkg-stack:` prefix (matches PKG-LEARNER-BUY epic per memory `advisory_lock_prefix_unification.md`). Two parallel namespaces — `pkg-stack:tariff-access:…` and `pkg-stack:package-access:…` — give symmetric coverage so a teacher's override edit truly serializes against an in-flight learner checkout on EITHER kind of product:

```sql
-- TARIFF side:
-- 1. /api/checkout/[tariffSlug]                       (reader/booker)
-- 2. lib/scheduling/slots/booking.ts step 6 postpaid  (reader/booker)
-- 3. PATCH /api/teacher/tariffs/[id]/access           (writer)
SELECT pg_advisory_xact_lock(
  hashtext('pkg-stack:tariff-access:' || $tariff_id::text || ':' || $learner_id::text)
);

-- PACKAGE side (R3-WARN#5 symmetry; R9-WARN#2 cleanup: removed
-- consumption.ts from this list — consume now reads pp.priority_snapshot
-- and does NOT touch the junction, so the access-lock is irrelevant there):
-- 1. /api/checkout/package/[slug]                                 (reader/buyer)
-- 2. lib/billing/teacher-grant.ts                                 (reader/grant)
-- 3. lib/billing/package-grant.ts (webhook/mock grant)            (reader/grant)
-- 4. app/api/admin/packages/[id]/grant/route.ts                   (reader/grant)
-- 5. app/api/admin/reconciliation/.../attach-account/route.ts     (reader/grant on rewrite)
-- 6. PATCH /api/teacher/packages/[id]/access                      (writer)
SELECT pg_advisory_xact_lock(
  hashtext('pkg-stack:package-access:' || $package_id::text || ':' || $learner_id::text)
);
```

**Lock COMPOSITION with existing duration-lock** (R7-BLOCKER#1 + R8-WARN#2 closure): the new access-lock is ADDED, not REPLACING the existing per-(account, duration) anti-stacking lock `pkg-stack:{accountId}:{duration}` already taken by:

- `app/api/checkout/package/[slug]/route.ts` (learner self-buy)
- `lib/billing/teacher-grant.ts` (teacher direct-grant)
- `lib/billing/package-grant.ts` (webhook/mock grant)
- `app/api/admin/packages/[id]/grant/route.ts` (admin grant — R8-WARN#2 closure: previously omitted from the inventory)

The duration-lock prevents two concurrent purchases of the same duration from racing through `pending_package_in_flight`; the access-lock prevents a teacher's override edit from racing with the purchase. Both invariants matter.

**Lock acquisition order** to prevent deadlock: always acquire `pkg-stack:{accountId}:{duration}` FIRST (existing-path semantics, learner-side), THEN `pkg-stack:package-access:{package_id}:{learner_id}` (new, access-side). A consistent order across all paths is required — if any path inverts it, two concurrent operations could deadlock. The PATCH `/access` writer takes only the access-lock (no duration-lock); the 5 buyer/grant/reconcile paths above (`/api/checkout/package/[slug]`, `lib/billing/teacher-grant.ts`, `lib/billing/package-grant.ts`, `/api/admin/packages/[id]/grant`, `/api/admin/reconciliation/.../attach-account`) take both locks in the documented order. R10-WARN#1 closure: previous draft said "four buyer/grant paths" which omitted `attach-account` — now explicitly enumerated.

Earlier draft used the `lpa:` prefix in some places and the right `pkg-stack:` prefix in others; the mixed-prefix version DID NOT serialize cross-path because PG advisory locks are keyed off the raw int64. The unified `pkg-stack:{tariff,package}-access:…` namespaces are authoritative.

**Lock ordering** (R4-WARN#3 + R5-WARN#4 closure): the lock MUST be acquired BEFORE any read of **mutable economic state** (visibility / override_amount_kopecks / junction membership / consumption-pending state) in the same transaction. Otherwise a reader can read stale state, the writer can flip the row, and the reader's subsequent write proceeds on the stale snapshot — exact TOCTOU window the lock is supposed to close. Authoritative ordering for all 6 paths:

```sql
BEGIN;
-- (1) Pre-lock SELECTs ARE permitted ONLY for IDENTITY/DISAMBIGUATION
--     gates that do not feed pricing decisions:
--       - session-cookie → account_id (auth/role check)
--       - UUID validation
--       - slug → id mapping ONLY where slug is immutably unique:
--           * pricing_tariffs.slug is globally UNIQUE in v1 → safe
--             (deferred follow-up wave changes this; revisit then)
--           * lesson_packages.slug is per-teacher UNIQUE (mig 0089) →
--             requires fail-closed disambiguation BEFORE the lock:
--             abort with 400 `package_slug_ambiguous` if multiple
--             rows match (user-remediable: caller passes ?packageId
--             or ?teacher to disambiguate — matches existing
--             /api/checkout/package/[slug] semantics, R7-WARN#4
--             closure: 400 for user-remediable, NOT 409). 409 stays
--             reserved for "impossible" duplicates after teacher
--             scoping (data-integrity bug — composite UNIQUE should
--             have prevented).
SELECT id FROM pricing_tariffs WHERE slug = $slug;  -- safe in v1 (global unique)
-- Package equivalent must be fail-closed:
SELECT id FROM lesson_packages
 WHERE slug = $slug AND teacher_id = $teacher_id_from_session_or_route_param;
-- If 0 rows: 404. If >1 rows AFTER teacher scope: 409 (data integrity
-- bug). If route received only bare slug (no teacher hint) and >1
-- rows match: 400 `package_slug_ambiguous` per existing route
-- semantics in app/api/checkout/package/[slug]/route.ts.

-- (2) Lock acquisition
SELECT pg_advisory_xact_lock(hashtext('pkg-stack:{tariff,package}-access:' || $id || ':' || $learner_id));

-- (3) Post-lock SELECTs — mutable economic state read under serialization:
--       - visibility, override_amount_kopecks, lta.revoked_at,
--       - lesson_packages.is_active / deleted_at, etc.
-- (4) Writes
COMMIT;  -- releases the advisory lock atomically with TX commit
```

The route handlers in `/api/checkout/[tariffSlug]`, `/api/checkout/package/[slug]`, `lib/scheduling/slots/booking.ts`, `lib/billing/teacher-grant.ts`, `lib/billing/package-grant.ts`, `/api/admin/packages/[id]/grant/route.ts`, `/api/admin/reconciliation/.../attach-account/route.ts`, `/api/teacher/tariffs/[id]/access`, `/api/teacher/packages/[id]/access` ALL share this skeleton. R9-WARN#2 cleanup: `lib/billing/consumption.ts` is NOT on this list — consume reads only `pp.priority_snapshot` (no junction access) since R7. Lock-then-read for mutable economic state is a hard invariant — read-then-lock leaves the window open and we get arbitrary price drift.

## API surface

1. `GET /api/teacher/tariffs?learner_id=$id` — returns effective list for this pair (existing endpoint extended with query param; without `learner_id` returns catalog as today).
2. `PATCH /api/teacher/tariffs/[tariff_id]/access` — body `{ learners: [{ learner_id, override_amount_kopecks? }] }` — bulk-update junction.
3. Symmetric для packages.

## Open questions для codex-paranoia

**Q1** — Backward compat: учителя, которые уже работают с public catalog — НЕ должны почувствовать никакой разницы. Default `visibility = 'catalog'` гарантирует это? Что с edge case «у Алины tariff override, но Алина unassigned»?

**Q2** — Trigger immutability `lesson_packages_economic_fields_immutable`: что происходит при override_amount_kopecks change на already-purchased package? Junction row не trigger'ит — это OK?

**Q3** — Refund/reversal: ученик купил пакет, потом учитель revoked junction row → existing purchase остаётся валидным (учетная FK), но новый покупки невозможны. Это правильный invariant?

**Q4** — Concurrent edits: учитель меняет override_amount пока ученик находится в `/checkout/package/[slug]` flow. Stale-read OK или нужен advisory lock?

**Q5** — Cascade на teacher-unlink: `learner_teacher_links.unlinked_at` set → нужно ли revoke junction rows автоматом? Default: НЕТ (preserve audit trail), но teacher не может больше использовать tariff с этим learner.

**Q6** — Slot creation flow: admin создаёт slot с `tariff_id` (например `private` тариф для Алины). Что если slot потом бронирует Петя (которому private tariff не виден)? Booking reject или slot должен иметь явный `intended_learner_id`?

**Q7** — UI на `/teacher/learners/[id]` — список ВСЕХ tariffs учителя с чекбоксами. Что если учитель имеет 50 tariffs? UI scaling?

**Q8** — Audit: нужен ли event_type `auth.access.granted` / `auth.access.revoked` в `auth_audit_events` для junction-row CRUD?

**Q9** — Package consumption (`lib/billing/consumption.ts`) — выбирает package по duration. Что если у learner есть несколько package_purchases — original (catalog) + private (junction) — какой consume first?

**Q10** — Mass-toggle vs per-learner: Q9 из T1 spec'а сказал нет mass-toggle. Здесь user может ожидать «применить override к всем активным ученикам разом». Default: НЕТ, скажем per-learner, обоснуем «scope-discipline».

## Sub-PR phasing

**Authoritative order — see «Updated Sub-PR phasing» at the bottom of the doc (post round-1 fixes).** The earlier 4-step decomposition that lived here without the PKG-TEACHER-SCOPE companion epic is SUPERSEDED and was removed (R2-WARN#7 closure: two conflicting phasings forced implementers to guess which is correct).

## Codex-paranoia loop

- **Round 1/3** — BLOCK, 3 BLOCKER + 4 WARN closed. Fix-list applied в §Migration above.
- **Round 2/3** — BLOCK, 4 BLOCKER + 3 WARN + 1 INFO closed (rewritten §Migration + R2 closures).
- **Round 3/3** — BLOCK, 4 BLOCKER + 2 WARN + 1 INFO closed (R3 surgical fixes).
- **Round 4/N** — BLOCK, 1 BLOCKER + 3 WARN closed (R4 surgical fixes after user-authorized cap extension).
- **Round 5/N** — BLOCK, 1 BLOCKER + 4 WARN closed (R5: audit-events enum enumerated, snapshot promise scoped, archive handler added to phasing, lock-then-read clarified).
- **Round 6/N** — BLOCK, 1 BLOCKER + 3 WARN closed (R6: priority_snapshot for retroactive-drift fix, single archive contract, TS audit-events mirror, slug pre-lock fail-closed).
- **Round 7/N** — BLOCK, 1 BLOCKER + 3 WARN closed (R7: access-lock compose with duration-lock not replace, TS mirror 6 events not 5, priority buy-side reads active row only, HTTP 400 for slug ambiguity not 409).
- **Round 8/N** — BLOCK, 1 BLOCKER + 2 WARN closed (R8: priority_snapshot stored in payment_orders.metadata at checkout-init, copied to package_purchases by grant path; admin-grant in duration-lock inventory; TS↔SQL enum drift test pin).
- **Round 9/N** — BLOCK, 1 BLOCKER + 2 WARN closed (R9: attach-account flow recomputes priority_snapshot for new accountId; consumption removed from access-lock holders; enum drift test is bidirectional set parity).
- **Round 10/N** — **SIGN-OFF**, 0 BLOCKER + 1 WARN closed inline ("5 buyer/grant paths" listed explicitly including attach-account). Plan is implementation-ready.

### Round 2/3 self-review notes — RETAINED for context only

The 11 items below remain in the doc as historical analysis. R2-self #4 (priority=10) and #14 (slug DO BLOCK) were SUPERSEDED by the canonical §Migration block and must NOT be implemented:

- ~~R2-self #4 — Priority default = 10~~ **SUPERSEDED**. Canonical mig 0102 keeps `priority DEFAULT 0`; junction rows tie with catalog by default and operator-set priority is the only way junction beats catalog. The "10 default" idea over-indexed on UI ergonomics at the cost of explicit operator intent.
- ~~R2-self #14 — Mig 0102 slug DO BLOCK~~ **SUPERSEDED**. Canonical §Migration does NOT touch slug uniqueness in T3 (R2-BLOCKER#3 + R3-BLOCKER#3 closure); the DO BLOCK collision check is moot because there's no slug-flip in this mig.

The remaining R2-self items (#1, #2, #3, #5, #6, #7, #10, #11, #12, #13, #15) are still informative and consistent with the canonical sections.

**R2-self #1 — Existing slug callers не grep'нуты.** `app/api/checkout/package/[slug]/route.ts` и `lib/billing/packages/catalog.ts` SELECT'ят `WHERE slug = $1` без teacher scope. After T3 ships, callers still use slug-or-id lookup; the deferred slug-flip wave will revisit.

**R2-self #2 — `FOR SHARE` vs `FOR KEY SHARE` на learner_teacher_links.** Resolved in canonical §"Round-1 BLOCKER fixes — applied" item #2 — `FOR KEY SHARE` everywhere.

**R2-self #3 — ON ARCHIVE: application-layer, не trigger.** Resolved: archive endpoint UPDATE tariff/package + bulk UPDATE junction in one TX. No trigger needed.

**R2-self #5 — Revoke check в /api/checkout/package/[slug].** Resolved with `LEFT JOIN learner_package_access lpa ON lpa.package_id = p.id …` + `lpa.package_id IS NULL` discriminator (R2-BLOCKER#4 closure).

**R2-self #6 — granted_at edge на pure override edit.** OK as documented (no change).

**R2-self #7 — Lock prefix унификация.** Resolved: `pkg-stack:tariff-access:` and `pkg-stack:package-access:` (R2-WARN#6 + R3-WARN#5 closures).

**R2-self #10 — Visibility filter миссит revoked_at check.** Resolved: visibility filter now `… AND lta.revoked_at IS NULL` everywhere.

**R2-self #11 — Cascade ON DELETE accounts(id).** Mig 0102 sets `granted_by_account_id` to `ON DELETE SET NULL`; junction `teacher_account_id` stays CASCADE.

**R2-self #12 — Audit constraint copy-paste риск.** Sub-PR A enumerates all existing event types explicitly (no `-- ... existing ...` placeholder ships).

**R2-self #13 — Bulk API fail-all.** PATCH `/access` validates all learner_ids first; ROLLBACK on any failure.

**R2-self #15 — Priority UI — backend-only в MVP.** No UI surface for priority in T3; operator-set via SQL only if ever needed.

---

## Round 1/3 — REAL codex-paranoia (2026-06-01)

`/codex-paranoia plan` запущена per skill protocol. Verdict: **BLOCK** — 5 BLOCKER + 3 WARN. Полный отчёт: `/tmp/codex-paranoia-20260601T082545Z/round-1.md`.

### BLOCKER fixes — applied

#### B1 — Price snapshot invariant (UC4 enforceable)

**Findings:** `pricing_tariffs.amount_kopecks` читается live в `lib/scheduling/slots/booking.ts:131,187,291`, `lib/teacher-ledger/mark-lesson-completed.ts:63`, `lib/billing/packages/debt.ts:47`, `lib/payments/slot-binding.ts:50`. Override меняет цену ретроактивно для уже-проведённых занятий.

**Fix:** snapshot цены при бронировании — three pieces (R2-BLOCKER#1 closure: app-side write alone leaves legacy rows drifting and skips the `BILLING_WAVE_ACTIVE!=='true'` legacy writer).

1. **Column + backfill (one mig, one TX):**

```sql
-- В mig 0102:
ALTER TABLE lesson_slots
  ADD COLUMN IF NOT EXISTS snapshot_amount_kopecks int NULL
    CHECK (snapshot_amount_kopecks IS NULL OR snapshot_amount_kopecks BETWEEN 100 AND 100000000);

-- Backfill: any booked/completed/cancelled row that has a tariff_id but no
-- snapshot yet gets the CURRENT tariff price frozen. R3-BLOCKER#1 closure:
-- exclude `open` slots — they have no booking yet, so freezing their
-- snapshot at migration time would lock them to whatever the catalog
-- price was at migration time, ignoring later edits before the booking
-- actually happens. Open slots get their snapshot at booking time via
-- the app-side write (step 3 below).
UPDATE lesson_slots s
   SET snapshot_amount_kopecks = t.amount_kopecks
  FROM pricing_tariffs t
 WHERE s.tariff_id = t.id
   AND s.snapshot_amount_kopecks IS NULL
   AND s.tariff_id IS NOT NULL
   AND s.status IN ('booked', 'completed', 'cancelled',
                    'no_show_learner', 'no_show_teacher');
```

Note: backfill freezes whatever price was current at migration time — not the historical booking-time price. We accept that imprecision for legacy rows (no way to recover history) but lock-in from this point forward.

2. **Forward trigger** — belt-and-suspenders against any writer path that forgets to set `snapshot_amount_kopecks`. R3-BLOCKER#2 closure: the trigger is BEFORE INSERT/UPDATE and runs AFTER the app's row-modification but BEFORE PG stores the row — so an app-side `UPDATE lesson_slots SET status='booked', snapshot_amount_kopecks=$1` makes `NEW.snapshot_amount_kopecks = $1` and the trigger's "fill if NULL" branch sees the app's value and short-circuits. Immutability check is also relaxed to allow the open→booked transition where OLD might be NULL or the placeholder zero.

```sql
CREATE OR REPLACE FUNCTION lesson_slots_snapshot_on_book()
RETURNS trigger AS $$
BEGIN
  -- Fill ONLY when app didn't supply a value AND we're transitioning into
  -- a terminal/booked state. App-side write always takes precedence
  -- because by the time the trigger fires, NEW already reflects the
  -- caller's column assignments (BEFORE trigger sees post-SET NEW.*).
  IF NEW.status IN ('booked', 'completed', 'no_show_learner', 'no_show_teacher')
     AND NEW.snapshot_amount_kopecks IS NULL
     AND NEW.tariff_id IS NOT NULL
  THEN
    SELECT amount_kopecks INTO NEW.snapshot_amount_kopecks
      FROM pricing_tariffs WHERE id = NEW.tariff_id;
  END IF;
  -- Immutability: once snapshot is set AND the row is already in a
  -- post-booking state, app may not change it. This permits the
  -- open→booked transition where OLD.snapshot was NULL and NEW.snapshot
  -- is being set for the first time.
  IF TG_OP = 'UPDATE'
     AND OLD.snapshot_amount_kopecks IS NOT NULL
     AND OLD.status IN ('booked', 'completed', 'cancelled',
                        'no_show_learner', 'no_show_teacher')
     AND NEW.snapshot_amount_kopecks IS DISTINCT FROM OLD.snapshot_amount_kopecks
  THEN
    RAISE EXCEPTION 'lesson_slots.snapshot_amount_kopecks is immutable once a booking exists';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER lesson_slots_snapshot_on_book_trg
  BEFORE INSERT OR UPDATE ON lesson_slots
  FOR EACH ROW EXECUTE FUNCTION lesson_slots_snapshot_on_book();
```

3. **App-side write** — both writer branches MUST set the snapshot in the **same UPDATE statement** that flips `status` away from `'open'`. R4-BLOCKER#1 closure: a follow-up second `UPDATE … SET snapshot_amount_kopecks = $1` would fail the immutability guard, because the first UPDATE (open→booked) already fired the trigger which filled `snapshot_amount_kopecks` from catalog. Single-statement form:

```ts
// lib/scheduling/slots/booking.ts — BILLING_WAVE_ACTIVE === 'true' path
// (and the legacy branch at the corresponding line):
await client.query(
  `UPDATE lesson_slots
      SET status = 'booked',
          learner_account_id = $1,
          booked_at = $2,
          snapshot_amount_kopecks = $3
    WHERE id = $4 AND status = 'open'`,
  [learnerId, bookedAt, effectiveAmount, slot.id],
)
```

NB: the existing booking UPDATE in both branches already sets `status`, `learner_account_id`, `booked_at` in one statement; this fix adds one column (`snapshot_amount_kopecks`) to the same SET clause. NO separate follow-up `UPDATE` is allowed.

Trigger fallback (catalog price) only fires for paths that forgot to set `snapshot_amount_kopecks` — e.g., a defensive cron, a backfill, or a path that accidentally skipped the new column. That fallback locks the catalog price into the snapshot — undesirable for override pairs but better than a NULL.

Downstream paths (completion / debt / payment): SELECT `s.snapshot_amount_kopecks` directly. The migration backfill + trigger together guarantee NOT NULL ONLY for rows that ever entered the `booked` state — namely `booked`, `completed`, `no_show_learner`, `no_show_teacher`, and `cancelled` that was previously `booked` (the cancelled-after-booking case the backfill covers via the status allowlist). R5-WARN#3 closure: a slot that's cancelled directly from `open` (admin/teacher housekeeping, learner never reserved it) was never booked and has no snapshot — that's fine because such a row has no economic event to settle. Read paths that care about settlement (completion / debt / payment) inspect rows where status ∈ {booked, completed, no_show_*}; cancelled rows reach those paths only if they were previously booked, in which case the backfill set the snapshot. `COALESCE` is unnecessary; a NULL snapshot on a settlement read indicates a genuine bug (unbooked row reached settlement) and should raise.

#### B2 — Multi-teacher package leak (already-prod bug, scope expansion)

**Findings:** `lib/billing/consumption.ts:51` consume matches by `(account_id, duration_minutes)`. Multi-teacher learner: купил пакет у A → потребит у B. `lib/billing/packages/eligibility.ts:30`, `lib/billing/teacher-grant.ts:141` все одного паттерна.

**Это не баг T3 — это уже-существующий prod bug.** Junction tables его не исправляют.

**Fix path:** T3 scope расширяется на companion mini-epic «PKG-TEACHER-SCOPE»:
- `package_purchases.teacher_id NOT NULL` (mig 0076c уже есть колонка — verify).
- `consume` SQL добавляет `AND pp.teacher_id = $expected_teacher_id`.
- `eligibility` same.
- `pending-package-grant` same.
- `teacher-grant` flow uses `teacher_id` of grantor.

**Sub-PR ordering:** PKG-TEACHER-SCOPE → T3 Sub-PR A. Если PKG-TEACHER-SCOPE откладывается, **T3 не может ship безопасно** — multi-teacher leak останется.

#### B3 — Private tariff/package leak через анонимные endpoints

**Findings:** `app/api/slots/available/route.ts:30` анонимно отдаёт `tariffSlug/title/amount`. `app/checkout/[tariffSlug]/page.tsx:57` анонимный slug-only surface. Приватная цена утечёт до auth gate.

**Fix:**
- `/api/slots/available` — фильтр на response level: для anonymous request возвращать только `visibility='catalog'` tariffs. Для authenticated learner: проверка через junction.
- `/checkout/[tariffSlug]` — частичная авторизация: anonymous может видеть только `visibility='catalog'`. Private tariff → 404 для anonymous, 403/redirect для not-junction-scoped.

Schema change на response shape:
```ts
type PublicSlot = {
  // ...
  tariff: { slug, title, amount } | null // null если visibility=private + viewer не authorized
}
```

#### B4 — Slug migration coordination

**Findings:** `lesson_packages` УЖЕ переведены на `UNIQUE(teacher_id, slug)` в mig 0089 — план не знал. `pricing_tariffs` — composite UNIQUE требует переписать `app/checkout/[tariffSlug]/page.tsx:57`, `lib/billing/packages/debt.ts:18`, `app/api/teacher/tariffs/route.ts:33`.

**Fix:**
- В mig 0102 убрать DROP+CREATE для `lesson_packages.slug` (уже сделано в 0089).
- Для `pricing_tariffs` — composite UNIQUE рассматривать как **отдельный эпик** «TARIFF-SLUG-TEACHER-SCOPE»:
  - mig: `DROP CONSTRAINT pricing_tariffs_slug_unique + CREATE UNIQUE INDEX pricing_tariffs_teacher_slug_unique`
  - rewrite `app/checkout/[tariffSlug]/page.tsx` для teacher hint (из session OR slug-includes-teacher-prefix)
  - rewrite `lib/billing/packages/debt.ts` lookups
  - rewrite `app/api/teacher/tariffs/route.ts` create flow
- **T3 первая итерация не трогает slug-uniqueness** для tariffs — приватные tariffs идентифицируются по `id`, не по slug. UX: при создании private tariff slug может быть пустой / system-generated.

#### B5 — DDL ownership invariant

**Findings:** Junction `teacher_id` не связан FK с owner'ом `tariff_id`. БД примет «teacher A grants tariff of teacher B». Нет проверки active `learner_teacher_links`.

**Fix:** Trigger на INSERT/UPDATE junction. R3-BLOCKER#4 closure: the link-active check is skipped for revoke-only UPDATE so archive/teacher-unlink/cleanup paths can revoke an existing junction row even after the underlying learner_teacher_links row went `unlinked_at IS NOT NULL`. The check still applies to NEW INSERTs and to UPDATEs that mutate any field other than `revoked_at`/`updated_at`.

```sql
CREATE OR REPLACE FUNCTION learner_tariff_access_invariants()
RETURNS trigger AS $$
DECLARE
  owner_teacher_id uuid;
  link_active boolean;
  is_revoke_only_update boolean;
BEGIN
  -- (1) tariff owned by claimed teacher. ALWAYS enforced.
  SELECT teacher_id INTO owner_teacher_id
    FROM pricing_tariffs WHERE id = NEW.tariff_id;
  IF owner_teacher_id IS NULL THEN
    RAISE EXCEPTION 'tariff % not found', NEW.tariff_id;
  END IF;
  IF owner_teacher_id <> NEW.teacher_id THEN
    RAISE EXCEPTION 'tariff % owned by % not %', NEW.tariff_id, owner_teacher_id, NEW.teacher_id;
  END IF;

  -- (2) learner-teacher link active. SKIPPED for revoke-only UPDATEs
  -- (R3-BLOCKER#4 closure): the operator/teacher may need to revoke
  -- a junction row AFTER the link itself went historical (unlink-then-
  -- archive sequence). Without this exception the archive trigger
  -- would fail and leave stale junction rows on dead links.
  is_revoke_only_update := (
    TG_OP = 'UPDATE'
    AND OLD.revoked_at IS NULL
    AND NEW.revoked_at IS NOT NULL
    AND NEW.teacher_id = OLD.teacher_id
    AND NEW.learner_account_id = OLD.learner_account_id
    AND NEW.tariff_id = OLD.tariff_id
    AND NEW.override_amount_kopecks IS NOT DISTINCT FROM OLD.override_amount_kopecks
  );

  IF NOT is_revoke_only_update THEN
    SELECT EXISTS (
      SELECT 1 FROM learner_teacher_links
       WHERE teacher_account_id = NEW.teacher_id
         AND learner_account_id = NEW.learner_account_id
         AND unlinked_at IS NULL
    ) INTO link_active;
    IF NOT link_active THEN
      RAISE EXCEPTION 'no active link teacher=% learner=%', NEW.teacher_id, NEW.learner_account_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER learner_tariff_access_invariants_trigger
  BEFORE INSERT OR UPDATE ON learner_tariff_access
  FOR EACH ROW EXECUTE FUNCTION learner_tariff_access_invariants();

-- Symmetric для learner_package_access (same revoke-only exemption).
```

### WARN fixes — applied

#### W6 — Soft-delete vs is_active

**Findings:** `lib/pricing/tariffs.ts:23,198,237,598`, `app/api/teacher/tariffs/[id]/route.ts:144` — два независимых флага: `is_active=false` (operator-toggled, hidden but recoverable) AND `deleted_at IS NULL` (soft-delete added mig 0080). Earlier "W6 fix" replaced one with the other, which would let *inactive-but-not-deleted* tariffs leak back into learner-visible surfaces.

**Fix (R2-BLOCKER#2 closure):** Visibility SQL must use BOTH predicates. Every learner-visible read path (cabinet, checkout, slot-available, teacher matrix) gates on:

```sql
WHERE t.deleted_at IS NULL
  AND t.is_active = true
  AND (
    t.visibility = 'catalog'
    OR (t.visibility = 'private'
        AND lta.tariff_id IS NOT NULL
        AND lta.revoked_at IS NULL)
  );
```

Writer paths (admin/teacher CRUD, archive endpoint) use `deleted_at IS NULL` alone — they need to see inactive rows to flip them back on.

Sweep targets (replace any single-predicate filter with the two-predicate form):
- `lib/pricing/tariffs.ts:198` (`listActiveTariffs`) — currently `is_active = true` only.
- `lib/billing/packages/catalog.ts` — same.
- Slot-binding read paths in `lib/payments/slot-binding.ts`.

ON ARCHIVE semantics → on DELETE endpoint (`app/api/teacher/tariffs/[id]/route.ts` DELETE handler): UPDATE `pricing_tariffs SET deleted_at = now()` + bulk UPDATE junction `revoked_at = now()` in a single transaction. The endpoint does NOT also flip `is_active=false` — `deleted_at` is the authoritative tombstone.

#### W7 — Historical-link UI write surface

**Findings:** `app/teacher/learners/[id]/page.tsx:66,84` доступна по historical-slot fallback. PaymentMethodToggle на этой странице создаст write-surface на mёртвой связи.

**Fix:** Tariff/Package access UI на detail page рендерится ТОЛЬКО если `guard.rows[0]?.in_link === true`. На historical-link state — read-only history (нет toggles, нет PATCH).

#### W8 — Test plan gaps

**Findings:** `tests/integration/billing/booking.test.ts:71,153`, `tests/integration/billing/checkout-package.test.ts:60`, `tests/integration/billing/package-buy-e2e.test.ts:87` — single-teacher паттерн.

**Fix:** Sub-PR A тесты должны cover'ить:
- Multi-teacher learner: купил у A, попытка consume у B → reject.
- Anonymous `/api/slots/available` для slot с private tariff → response без tariff details.
- Override edit после booking → snapshot НЕ меняется, новый booking использует новую цену.
- **TS↔SQL auth-event enum drift pin** (R8-WARN#3 + R9-WARN#3 closure): create `tests/integration/auth/event-types-drift.test.ts` that does **bidirectional set parity** between the SQL CHECK constraint and the TS union. R9-WARN#3: an insert-per-TS-value test only catches TS→SQL omissions; SQL→TS drift (SQL adds a value, TS forgets it — the exact bug this epic uncovered) requires reading the constraint's allowed set. Test logic:

  ```ts
  // 1. Query the SQL constraint's allowed values:
  const r = await pool.query(
    `SELECT pg_get_constraintdef(c.oid) AS def
       FROM pg_constraint c
      WHERE c.conname = 'auth_audit_events_event_type_check'`,
  )
  const sqlSet = parseCheckConstraintValues(r.rows[0].def)  // returns Set<string>
  // 2. The TS union:
  const tsSet = new Set(AUTH_EVENT_TYPES)
  // 3. Assert exact set equality:
  expect([...sqlSet].sort()).toEqual([...tsSet].sort())
  ```

  Any future drift on either side trips this test in CI before merge.

### Updated Sub-PR phasing

Из round 1 findings:

1. **Companion epic «PKG-TEACHER-SCOPE»** (B2) — отдельная mini-волна перед T3. Скоуп: расширение consume/eligibility/teacher-grant на `teacher_id`.
2. **T3 Sub-PR A foundation** — depends on PKG-TEACHER-SCOPE merged.
   - mig 0102: visibility column + `lesson_packages.deleted_at` + `package_purchases.priority_snapshot` + junction tables + ownership trigger (B5) + price snapshot column + forward trigger (B1) + auth_audit_events event-type enum extension.
   - `lib/billing/learner-tariff-access.ts` helper.
   - `learner-package-access.ts` helper.
   - **TS audit-event mirror** (R6-WARN#3 + R7-WARN#2 closure): `lib/audit/auth-events.ts` event-type union already stale relative to SQL — Sub-PR A extends it with the 4 new T3 events (`auth.tariff_access.granted/revoked`, `auth.package_access.granted/revoked`) AND closes the pre-existing drift by adding BOTH `auth.billing.method_changed` (mig 0101) AND `auth.onboarding.reset` (mig 0100) which are also live in SQL but missing from the TS union. Total: 6 missing events (2 pre-existing + 4 new). Without this, any T3 writer going through the typed helper would fail compile.
   - **Package archive handler** (R4-WARN#2 closure): extend `app/api/teacher/packages/[id]/route.ts` and `app/api/admin/packages/[id]/route.ts` DELETE/PATCH to set `lesson_packages.deleted_at = now()` and bulk-revoke `learner_package_access` rows in one TX. Without this, the new `deleted_at` column stays NULL on prod and the two-predicate filter degrades silently to `is_active = true` semantics.
3. **T3 Sub-PR B booking flow** — single-statement snapshot write on book (R4-BLOCKER#1 closure: status + snapshot in the SAME UPDATE) + downstream reads from `s.snapshot_amount_kopecks` directly.
4. **T3 Sub-PR C anonymous endpoint filter** (B3) — `/api/slots/available` + `/checkout/[tariffSlug]` auth check.
5. **T3 Sub-PR D teacher UI** — list + detail (только active-link), invite-flow default.
6. **T3 Sub-PR E learner-side** — `/cabinet/packages` filter по junction.
7. **Cleanup follow-up** — slug composite UNIQUE для `pricing_tariffs` (B4 deferred).

**Status (post round 5):** plan-doc has been through 5 codex-paranoia rounds (3-round hard cap extended by user). Round 5 closed 1 BLOCKER (audit-events enum placeholder) + 3 WARNs (archive handler in phasing, snapshot NOT NULL promise scoped, structural drift items). Round 6 launched immediately on this revision.
