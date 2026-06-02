# Free-tier (Стартовый) — unlock 1 package + 1 tariff for «feel the features»

Status: SIGN-OFF — codex-paranoia round 10/3 (cap extended; package cap `is_active=true AND deleted_at IS NULL` unified; tariff cap `deleted_at IS NULL`; UI SSR data contract specified; teacher copy plain-RU without admin-only terms)
Owner: Иван
Driver: Claude (this session, 2026-06-02)
Branch: `feat/free-tier-1pkg-1tariff`

## Owner ask (verbatim)

> Нужно добавить возможность на базовом тарифе создавать 1 пакет и 1 тариф на занятия.
> чтобы юзер мог на бесплатном плане почувствовать все нужные фичи. Нужно будет везде
> это обновить — везде где мы описываем наши тарифы.

Decoded: на **Стартовом** (DB slug=`free`, public RU title «Стартовый», learner_limit=1)
учитель сейчас не может создать ни одного пакета и ни одного тарифа (HTTP 422
`plan_4_required`). Owner хочет дать **по 1 штуке каждого** чтобы учитель «почувствовал
все нужные фичи». «Базовый» / «Расширенный» учителя пока тоже под тем же `plan_4_required`
гейтом, но owner ask ограничен Стартовым; Базовый/Расширенный — out of scope (см. §"What is NOT in scope").

Note по терминологии: owner написал «на базовом тарифе» и «на бесплатном плане». В этом
контексте они **синонимичны** = «Стартовый» (free) — это бесплатный entry-уровень
после Sub-PR A #490. **Не путать с «Базовым»** (mid, 300 ₽/мес). Если по результатам
паранойи окажется что owner имел в виду «Базовый», переименовать тут и пере-prompt'нуть
codex с уточнением.

## §1. Existing surface inventory

Survey verbs: **«где enforced лимит на создание package / tariff teacher'ом»** +
**«где free / Стартовый описан пользователю»**.

```
rg "plan_4_required|isOperatorManagedTeacher|operator-managed" --type ts --type tsx --type sql
rg "Стартов|free.*tier|learner_limit|\\bfree\\b.*plan" --type ts --type tsx --type md --type sql
rg "maxPackages|maxTariffs|packageLimit|tariffLimit"  # (no hits — no per-tier write-cap exists today)
rg "/teacher/packages|/teacher/tariffs" --type ts --type tsx --type md
```

### A. Backend write-gate (current behaviour)

| # | File:Line | Carries | Disposition |
|---|---|---|---|
| 1 | `app/api/teacher/packages/route.ts:87-97` | Gates POST on `isOperatorManagedTeacher()` → 422 `plan_4_required` for everyone except operator-managed. | **refactor** — replace gate with tier-aware limit check (free → 1, mid/pro → still 0, operator-managed → unlimited). |
| 2 | `app/api/teacher/tariffs/route.ts:78-88` | Same `plan_4_required` gate. | **refactor** — same shape as #1. |
| 3 | `lib/payments/teacher-derivation.ts:106-121` | `isOperatorManagedTeacher` helper — checks `plan_slug === 'operator-managed' AND state === 'active'`. | **refactor** — keep this helper unchanged (still used by buyer-side gates in `/api/checkout/package/[slug]`, `/api/payments/sbp/create-qr`, `/api/payments/charge-token`). Add a **new** helper for write-cap derivation. |

### B. Backend limit helpers (none today)

`countPackagesByTeacher` / `countTariffsForTeacher` — **DO NOT EXIST** (verified by
`rg "count.*ByTeacher" lib/`). Today we use `listPackagesByTeacher(id).length` or
`listTariffsForTeacher(id).length` at most. Implementation will either add a `count*`
helper or call `list*` and `.length` (cheap: each teacher's catalog is bounded; tiny rows).

### C. UI — teacher cabinet packages/tariffs editors

| # | File:Line | Carries | Disposition |
|---|---|---|---|
| 4 | `app/teacher/packages/page.tsx:60-72` | «Каталог пакетов уроков, которые вы выпускаете». | **refactor** — add per-tier capacity hint («Стартовый — 1 пакет на вашем тарифе»). NO «Operator-managed» mention in teacher UX — that's admin-only language (R7-BLOCKER#1; see `docs/plans/saas-offer-and-landing-redesign.md:865` deferral + `docs/content-style.md:53`). |
| 5 | `app/teacher/packages/client.tsx:30-100` | `TeacherPackagesEditor` — full create form. On POST 422 surfaces `body.message` in `setError`. | **refactor** — hide Create-form when teacher already at cap; show friendly hint instead. Preserve the form for cap=0 → cap=1 transition during the same session (refresh after create). |
| 6 | `app/teacher/tariffs/page.tsx` + `tariff-editor.tsx` | Same shape as packages. | **refactor** — same as #4-5. |

### D. UI — subscription tier cards + landing

| # | File:Line | Carries | Disposition |
|---|---|---|---|
| 7 | `lib/billing/teacher-subscription.ts:290-321` | `SAAS_SUBSCRIPTION_TARIFFS` — features bullets for mid + pro. NO entry for free. | **refactor** — feature bullets for «Базовый» add a "+1 пакет, +1 тариф" line **only if** owner wants the explicit comparison. Stay minimal — see Decision §3. |
| 8 | `components/home/teacher-landing-client.tsx:644-706` | Pricing-section tier cards. «Стартовый» bullets: `['Расписание и слоты', 'Карточка ученика', 'История уроков', 'Оплата вне платформы']`. | **refactor** — add `'1 пакет уроков и 1 тариф на занятия (демо)'` bullet to Стартовый. |
| 9 | `app/saas/page.tsx:13-30` | Meta description + og:description. | **leave as-is** — no specific limit count mentioned (only «навсегда; когда учеников становится больше»). |
| 10 | `app/teacher/subscription/client.tsx:266-336` | Pick-a-tier surface shows **only Базовый + Расширенный** (Стартовый is default after register, not purchasable here). | **leave as-is** — Стартовый is intentionally NOT shown here. Sub-PR B #494 design decision documented in plan. |

### E. Tests

| # | File:Line | Carries | Disposition |
|---|---|---|---|
| 11 | `tests/integration/saas-pivot/security-high-closures.test.ts:418-487` | `describe('HIGH-2 — POST /api/teacher/packages plan-4 gate')` — pins «free → 422 / operator-managed → 201» contract. | **refactor** — flip the `free` test to expect 201 for the FIRST create + 422 for the SECOND. |
| 12 | `tests/integration/saas-pivot/security-high-closures.test.ts:370-416` | Same for tariffs (HIGH-2 tariffs gate). | **refactor** — same shape. |
| 13 | `tests/integration/saas-pivot/teacher-packages.test.ts` | (exists per Grep hit; will check shape) — covers happy-path create for plan-4. | **verify, refactor if needed** — should also pin free=1cap. |
| 14 | `tests/integration/saas-pivot/teacher-tariffs.test.ts` | (exists) — same. | **verify, refactor if needed**. |
| 15 | NEW: `tests/integration/saas-pivot/free-tier-write-cap.test.ts` | Integration test: free creates 1 pkg → 201; 2nd pkg → 422 `tier_write_cap_reached`. Same for tariffs. Operator-managed can still create N. | **add**. |
| 16 | `tests/saas-pivot/landing.test.tsx:81-83` | Pins `getByText('Стартовый' / 'Базовый' / 'Расширенный')`. | **refactor** if we add the new bullet text and the test asserts bullet list. |

### F. Buyer-side gates — UNCHANGED

The `plan_4_required` 422 on the buyer side (lines in `app/api/checkout/package/[slug]/route.ts`,
`/api/payments/sbp/create-qr`, `/api/payments/charge-token`) **stays**. No payment_orders
will be created for a free-tier teacher's package/tariff — these `feel` items cannot be sold
through the platform. Free teachers use them via `teacher_grant` (non-money issue) or
out-of-band billing. **This is the architectural escape valve** that makes the unlock safe.

### G. Negative checks

- `rg "1 пакет|один пакет"` — no production code matches today (negative-check baseline for new copy).
- `rg "tier_write_cap"` — no matches (new error code namespace, no collision).

## §2. Current limits per tier (verified vs codebase)

| DB slug | RU title | learner_limit (mig 0073 + 0103) | Can CREATE package? | Can CREATE tariff? | Can SELL on platform? | Source |
|---|---|---|---|---|---|---|
| `free` | Стартовый | 1 | **❌ HTTP 422 plan_4_required** | **❌ HTTP 422 plan_4_required** | ❌ (buyer-side 422) | `packages/route.ts:87`, `tariffs/route.ts:78` |
| `mid` | Базовый | 5 | ❌ 422 plan_4_required | ❌ 422 plan_4_required | ❌ | same |
| `pro` | Расширенный | 30 | ❌ 422 plan_4_required | ❌ 422 plan_4_required | ❌ | same |
| `operator-managed` | Operator-managed | unlimited | ✅ 201 | ✅ 201 | ✅ (money via platform) | same |

Why the gate exists (SAAS-PIVOT security-audit HIGH-2 closure, 2026-05-23):
non-plan-4 teachers don't have a platform disbursement path. If a learner pays for
their package, `payment_orders.teacher_account_id` points at a teacher the platform
can't pay out → orphaned funds. The gate prevents this at the WRITE moment — no
package/tariff = no buyable surface for that teacher.

## §3. Proposed change

### Decision rule

**Стартовый (free) gets a write-cap of 1 package + 1 tariff.** Базовый/Расширенный
unchanged (still `plan_4_required` until owner explicitly opens them up — out of
scope here). Operator-managed unchanged (unlimited).

### How free-tier «sell» risk is closed without unwinding HIGH-2

The buyer-side 422 stays. A free-tier teacher who creates a package/tariff cannot
have a learner pay through the platform — `/api/checkout/package/[slug]` and the
SBP/charge-token surfaces still return 422 `plan_4_required` for them (line 325-344
in `security-high-closures.test.ts` already pins this for **buyer**-side calls). The
package/tariff is purely a **structural template** the free teacher can:

- **Issue** via `/api/teacher/packages/[id]/issue` (non-money `teacher_grant` — already
  works regardless of plan, by design).
- **Show** to their learner as a price list and settle out-of-band (cash, bank transfer,
  whatever). The UI surfaces this via a hint copy on the package/tariff cards.

This matches the existing comment in `packages/route.ts:91-97`:
> Free/Mid/Pro teacher creating a paid package whose buy commits a payment_orders row
> pointing at THEIR teacher_account_id would orphan the funds — the platform has no
> disbursement path to non-plan-4 teachers. They must use the non-money `teacher_grant`
> issue path (/teacher/packages/[id]/issue) OR settle out-of-band.

The unlock just **lets** them create 1 of each (instead of 0) so they can taste the
surface. The «больше пакетов — свяжитесь с оператором LevelChannel» upsell naturally
follows.

### Tier write-cap matrix (new contract)

| DB slug | maxPackages | maxTariffs | maxLearners (existing, unchanged) |
|---|---|---|---|
| `free` | **1** | **1** | 1 |
| `mid` | 0 (unchanged — out of scope) | 0 | 5 |
| `pro` | 0 (unchanged — out of scope) | 0 | 30 |
| `operator-managed` | unlimited | unlimited | unlimited |

`maxPackages` / `maxTariffs` semantics: **active catalog size** (R4-BLOCKER#1 unified):
- packages: `count(*) from lesson_packages where teacher_id = $1 and is_active = true and deleted_at is null`
- tariffs:  `count(*) from pricing_tariffs where teacher_id = $1 and deleted_at is null`

Both use each surface's existing escape valve so «archive→create-new» works
(package UI toggles `isActive=false`; tariff UI writes `deleted_at`).

**R1-BLOCKER#1+#3 + R3-BLOCKER#1 closure (verified vs code 2026-06-03):**

- `pricing_tariffs` has `deleted_at` (`lib/pricing/tariffs.ts:239`). Tariff UI has explicit «архивировать» soft-delete write path. **Tariff cap counts `deleted_at IS NULL`.**
- `lesson_packages` has `deleted_at` column too (`catalog.ts:24`), BUT the teacher
  package UI does NOT write `deleted_at` — it only toggles `is_active`
  (`app/teacher/packages/[id]/route.ts:91` accepts `isActive` + metadata, not
  `deleted_at`). To keep scope tight and avoid adding a package soft-delete write
  path here, **Package cap counts `is_active = true AND deleted_at IS NULL`**.
  Toggling `is_active=false` (the existing UI «Архивировать» button) is the
  escape valve. The package row stays in DB but stops counting.
- Both cap predicates respect the UX intent: «archive→create new» works in both
  surfaces, using each surface's existing soft-delete/deactivate write path.

### Helper shape

New helpers in `lib/billing/teacher-subscription.ts` (single SoT for tier limits):

```ts
export type TierWriteCaps = {
  maxPackages: number      // 0 = no creates; Infinity = unlimited
  maxTariffs: number
}

const TIER_WRITE_CAPS: Record<string, TierWriteCaps> = {
  free: { maxPackages: 1, maxTariffs: 1 },
  mid: { maxPackages: 0, maxTariffs: 0 },
  pro: { maxPackages: 0, maxTariffs: 0 },
  'operator-managed': { maxPackages: Infinity, maxTariffs: Infinity },
}

export async function resolveTeacherWriteCaps(teacherAccountId: string): Promise<TierWriteCaps>
// Reads teacher_subscriptions JOIN teacher_subscription_plans;
// Falls back to { maxPackages: 0, maxTariffs: 0 } if:
//   - no row, OR
//   - state !== 'active' (R1-BLOCKER#4 closure — suspended/cancelled rows
//     must NOT grant write caps; mirrors isOperatorManagedTeacher contract
//     in lib/payments/teacher-derivation.ts:106).
// Returns the slug's caps from TIER_WRITE_CAPS only when state='active'.
```

Route-layer gate (replaces the existing `isOperatorManagedTeacher` 422):

```ts
// Open TX + advisory lock + count-with-deleted_at-filter + create on same client
const client = await pool.connect()
try {
  await client.query('begin')
  await client.query(`select pg_advisory_xact_lock(hashtext('tier-cap:' || $1))`, [teacherId])
  const caps = await resolveTeacherWriteCaps(teacherId)
  if (caps.maxPackages === 0) {
    await client.query('rollback')
    return 422 plan_upgrade_required
  }
  const existing = await countActivePackagesByTeacherTx(client, teacherId)
  // ^ R3-BLOCKER#1 closure (packages): count(*) WHERE teacher_id=$1 AND is_active=true AND deleted_at IS NULL.
  // For tariffs: count(*) WHERE teacher_id=$1 AND deleted_at IS NULL (tariff UI has its own deleted_at write path).
  if (existing >= caps.maxPackages) {
    await client.query('rollback')
    return 422 tier_write_cap_reached
  }
  const pkg = await createPackageTx(client, ...)
  await client.query('commit')
} finally { client.release() }
```

**Race condition + R1-BLOCKER#2 closure**: two concurrent POSTs could both pass
cap check. Mitigation: **advisory lock per teacher-id** around the count + insert.

**Implementation requires TX-aware variants** (current writers go through
`getDbPool().query(...)` without `PoolClient`):
- New helper `countActivePackagesByTeacherTx(client, teacherId)` + `createPackageTx(client, ...)` in `lib/billing/packages/catalog.ts` — same shape as PKG-LEARNER-BUY's
  TX-aware writers. Route handler opens TX, takes advisory lock, calls count+create
  on the same client.
- Same for tariffs in `lib/pricing/tariffs.ts`: `countActiveTariffsForTeacherTx(client, teacherId)`
  + `createTariffTx(client, ...)`.
- Existing non-TX `createPackage` / `createTariff` keep working for callers that
  don't need the cap gate (admin grant, seed scripts).

Lock key prefix: `tier-cap:` + teacher UUID (deterministic 64-bit hash via
`hashtext()`). Lock released at TX end. Mirrors PKG-LEARNER-BUY (see memory note
`advisory_lock_prefix_unification.md`).

Alternative (simpler): rely on a UNIQUE constraint. But `lesson_packages` has no
"teacher's primary package" concept — there's no natural UNIQUE that maps to "1 per
teacher". Advisory lock is the right shape.

### New error codes

- `tier_write_cap_reached` — 422 — body: `{ error, message, cap: 1, current: 1, tier: 'free' }`.
- `plan_upgrade_required` — 422 — replaces `plan_4_required` for the **non-free** non-operator
  tiers that still have cap=0. Keep `plan_4_required` as an alias for backward-compat?
  Decision: **rename to `plan_upgrade_required`** — message is friendlier («Перейдите на тариф
  с пакетами»), and downstream callers don't currently switch on the literal string in
  client code (verified by `rg "plan_4_required" components/ app/teacher/` — no client-side
  switch). **Test contract updated in §1.E.**

  Actually re-checking: `rg "plan_4_required"` shows `app/teacher/packages/client.tsx`
  and `app/teacher/tariffs/tariff-editor.tsx` may surface `body.message` to the user
  via `setError(body.message || body.error)`. The user sees the message, not the code
  → safe to rename. **Will verify in implementation.**

### Buyer-side gate stays

NO CHANGE to:
- `app/api/checkout/package/[slug]/route.ts`
- `app/api/payments/sbp/create-qr/route.ts`
- `app/api/payments/charge-token/route.ts`

These still 422 if the target teacher is non-operator-managed. The `feel-the-feature`
package/tariff for a free teacher is **structurally creatable** but **not platform-payable**.

## §4. Surfaces to update

### Backend

- `lib/billing/teacher-subscription.ts`: add `TIER_WRITE_CAPS` map + `resolveTeacherWriteCaps(teacherId)` helper.
- `app/api/teacher/packages/route.ts:POST`: replace `isOperatorManagedTeacher` gate with cap-check. Wrap count+create in advisory-lock.
- `app/api/teacher/tariffs/route.ts:POST`: same.
- `lib/billing/packages/catalog.ts` — add `countActivePackagesByTeacherTx(client, teacherId)` (R3+R4-BLOCKER closure: TX-aware count with `is_active = true AND deleted_at IS NULL`; `listPackagesByTeacher().length` is wrong because it includes archived/inactive rows).
- `lib/pricing/tariffs.ts` — add `countActiveTariffsForTeacherTx(client, teacherId)` with `deleted_at IS NULL` (no `is_active` column on tariffs).

### UI — teacher cabinet

**R7-BLOCKER#2 closure — data contract**: the page MUST thread the cap data
server-side. Add to `app/teacher/packages/page.tsx` (SSR):
```ts
const caps = await resolveTeacherWriteCaps(guard.account.id)
const activeCount = await countActivePackagesByTeacher(guard.account.id)
return <TeacherPackagesEditor initialPackages={...} writeCap={caps.maxPackages} currentCount={activeCount} />
```
The client component receives `writeCap` (number, 0/1/Infinity) + `currentCount`
(number) as props. After create/archive, the page re-fetches via existing
`refresh()` pattern (server-rendered SSR; client patches list locally + triggers
`router.refresh()` to re-pull caps). Same shape for `app/teacher/tariffs/page.tsx`.

- `app/teacher/packages/page.tsx`: tier-aware capacity hint above editor («Стартовый — 1 пакет на вашем тарифе. Чтобы создать больше — свяжитесь с оператором LevelChannel.»). R7-BLOCKER#1 — NO «Operator-managed» in teacher copy (admin-only term).
- `app/teacher/packages/client.tsx`: hide Create-form when at cap; show «Лимит пакетов на тарифе исчерпан» message instead. Refresh after first create (existing pattern).
- `app/teacher/tariffs/page.tsx` + `tariff-editor.tsx`: same.

### UI — landing

- `components/home/teacher-landing-client.tsx`: Pricing «Стартовый» bullets — add `'1 пакет уроков и 1 тариф на занятия (демо)'`. Replace existing «Оплата вне платформы» wording with «1 пакет + 1 тариф (демо) · оплата вне платформы» so the bullet count stays 4 (visual rhythm of the card grid is bullet-count sensitive).

### Tests

- `tests/integration/saas-pivot/security-high-closures.test.ts`: flip HIGH-2 contract for `free` plan: first create → 201, second create → 422 `tier_write_cap_reached`. Test names stay HIGH-2 but the description updates.
- `tests/integration/saas-pivot/teacher-packages.test.ts` + `teacher-tariffs.test.ts`: skim, may need `planSlug='operator-managed'` annotation to stay green.
- NEW: `tests/integration/saas-pivot/free-tier-write-cap.test.ts`:
  - free teacher creates package #1 → 201; package #2 → 422.
  - free teacher creates tariff #1 → 201; tariff #2 → 422.
  - mid teacher creates package #1 → 422 `plan_upgrade_required` (no change in behaviour, just renamed code).
  - operator-managed creates 5 packages → all 201.
  - Concurrent: two POST /api/teacher/packages from the same free teacher in parallel → exactly one 201, one 422 (advisory-lock check).
- `tests/saas-pivot/landing.test.tsx`: add assertion for the new bullet text in «Стартовый» card.

### Out of scope for change-touch

- `app/teacher/subscription/client.tsx` — Стартовый is not displayed here (Sub-PR B #494 design); no change.
- `lib/legal/**`, `docs/legal/**`, `migrations/0099_*` (live offer) — offer delegates concrete limits to /saas/pricing per §4.0 of mig 0099. No legal-pipeline trailer needed.
- Database migration — no schema change needed. Limits live in code (`lib/billing/teacher-subscription.ts`). Owner can adjust without a migration round-trip.

## §5. What is NOT in scope

- **Pricing/payment changes** — no amount_kopecks edits, no new CloudPayments intents.
- **Tier-upgrade UX** — no «Перейдите на Базовый» button added; existing /teacher/subscription handles that.
- **Mid/Pro write-cap unlock** — owner said «на базовом тарифе» (Стартовый); Базовый/Расширенный stay cap=0. Future epic can flip those values in `TIER_WRITE_CAPS` if owner asks.
- **Buyer-side platform payment for free-tier teachers** — `plan_4_required` 422 on `/checkout/package` etc. stays. (This is the architectural escape valve — see §3.)
- ~~**Soft-delete `lesson_packages.deleted_at` column**~~ — R2+R3+R4-BLOCKER closure: column ALREADY exists (`catalog.ts:24`). Cap-counter respects it per the unified rule in §3+§4 (packages: `is_active = true AND deleted_at IS NULL`; tariffs: `deleted_at IS NULL`).
- **Legal offer rewrite** — see §4 out-of-scope.

## §6. Risks + mitigations

| # | Risk | Mitigation |
|---|---|---|
| R1 | Race condition: 2 concurrent POSTs from same teacher both pass count<cap check, both insert. | Advisory lock per teacher-id (prefix `tier-cap:`, hash teacher UUID into 64-bit key). Test pins this. |
| R2 | Free teacher creates 1 package, wants to try another — R3-BLOCKER#1 closure: cap counts `is_active=true AND deleted_at IS NULL`. Toggle «Архивировать» (`isActive=false`) via the existing UI frees the cap; teacher can create a new package. For tariffs: use existing tariff soft-delete (`deleted_at`). | Editor copy + error message: «Лимит пакетов исчерпан. Архивируйте старый пакет, чтобы создать новый.» |
| R3 | Free teacher creates 1 package, publishes it, a learner tries to buy it via `/api/checkout/package/[slug]` → gets 422. Confusing if the teacher thought it was sellable. | Editor hint above the form: «Пакеты на Стартовом — для демонстрации возможностей. Чтобы принимать оплату через платформу — свяжитесь с оператором LevelChannel. Можно "выдать" пакет ученику вручную через кнопку "Выдать"». R8-BLOCKER#1 closure: NO «Operator-managed» term in teacher UX. |
| R4 | Renaming `plan_4_required` → `plan_upgrade_required` breaks client-side string match. | `rg "plan_4_required" components/ app/` shows no client-side switches on the string. Body `message` is what the user sees. Tests updated. **Will re-verify during implementation**. |
| R5 | `tests/integration/saas-pivot/security-high-closures.test.ts` HIGH-2 «free → 422» pin breaks — the test name says HIGH-2 but the behaviour now allows 1 create. | Rename the test description from «rejects a free-plan teacher with 422» to «accepts a free-plan teacher's FIRST create with 201; rejects the SECOND with 422 tier_write_cap_reached». Update inline comment with link to this plan. |
| R6 | Cap counter uses NEW `countActivePackagesByTeacherTx` (filters `is_active=true AND deleted_at IS NULL`); `listPackagesByTeacher` is no longer the cap-counter. | Doc in code comment + R2 copy. |
| R7 | Operator-managed teacher in some seed/test fixture might rely on the old «free returns 422» contract for negative-path coverage. | `rg "plan_4_required" tests/` lists hits; review each, update or add `planSlug='operator-managed'` to make the test target the new gate (cap=0 for non-free/non-operator-managed). |
| R8 | Owner meant «Базовый» not «Стартовый» — see top-of-doc terminology note. | Plan-doc flags this in the verbatim. Paranoia plan checkpoint should surface it; if Codex says «owner ambiguity» — surface to user before implementation. |
| R9 | The new `resolveTeacherWriteCaps()` falls back to `{ maxPackages: 0, maxTariffs: 0 }` if the teacher has no `teacher_subscriptions` row. Today some test fixtures create a teacher without seeding the row. | Verify against `tests/integration/saas-pivot/security-high-closures.test.ts:442-463` which already tests «no subscription → 422 plan_4_required». Behaviour identical: no row → cap=0 → 422. Test continues to pass (just rename of error code). |

## §7. Definition of done

- [ ] `lib/billing/teacher-subscription.ts` — `TIER_WRITE_CAPS` constant + `resolveTeacherWriteCaps()` helper.
- [ ] `app/api/teacher/packages/route.ts` — gate flipped, advisory-lock around count+create.
- [ ] `app/api/teacher/tariffs/route.ts` — same.
- [ ] Optional: `count*ByTeacher` helpers added.
- [ ] `app/teacher/packages/{page,client}.tsx` — capacity hint + at-cap UX.
- [ ] `app/teacher/tariffs/{page,tariff-editor}.tsx` — same.
- [ ] `components/home/teacher-landing-client.tsx` — Стартовый bullet updated.
- [ ] `tests/integration/saas-pivot/security-high-closures.test.ts` — HIGH-2 free contract flipped + renamed.
- [ ] NEW: `tests/integration/saas-pivot/free-tier-write-cap.test.ts` — full free-tier cap matrix.
- [ ] `tests/saas-pivot/landing.test.tsx` — Стартовый bullet pinned.
- [ ] `npm run build` green; `npm run test:run` green; `npm run test:integration` (relevant files) green.
- [ ] Plan-doc paranoia SIGN-OFF (this file's §"Codex-Paranoia plan loop").
- [ ] Wave paranoia SIGN-OFF on aggregate diff.
- [ ] PR merged with trailers: `Codex-Paranoia: SIGN-OFF round N/3`, `Skill-Used: free-tier 1pkg+1tariff unlock`.
- [ ] No `Legal-Pipeline-Verified:` trailer needed (offer untouched).

## §8. Codex-Paranoia plan loop

- Plan checkpoint round 0: this doc.
- Plan checkpoint round 1+: run `/Applications/Codex.app/Contents/Resources/codex exec --skip-git-repo-check "<prompt with this file>"`. If Codex returns quota-exhausted error → WAIT for reset (~23:48 Asia/Saigon ≈ 16:48 UTC per owner authorization) and retry. **DO NOT** fall back to self-review on this task.
- Hard cap 3 rounds. Extend to 5 if convergence is tractable (precedent: cabinet-stale-future-labels reached SIGN-OFF on round 10).

## §9. Implementation order

1. Add `TIER_WRITE_CAPS` + `resolveTeacherWriteCaps` helper (catalog).
2. Add `countPackagesByTeacher` / `countTariffsForTeacher` helpers (cheap SQL).
3. Wrap `packages/route.ts:POST` and `tariffs/route.ts:POST` in advisory-lock + cap check.
4. Update test fixture `security-high-closures.test.ts` HIGH-2 to new contract.
5. Add `free-tier-write-cap.test.ts`.
6. Touch cabinet UI (capacity hint + at-cap surface).
7. Touch landing bullet.
8. Run `npm run build` + `npm run test:run` + `npm run test:integration -- saas-pivot`.
9. Wave paranoia (3 rounds hard cap, Codex-only, same wait rule as plan).
10. PR with trailers.

## §10. Changelog of this plan-doc

- Round 0 (initial): inventory + decision + caps matrix + risks + DoD.
- _(future entries appended after each paranoia round)_
