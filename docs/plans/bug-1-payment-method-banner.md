---
title: Bug #1 — Banner «учитель не выбрал способ оплаты» на главной кабинета ученика
status: IMPLEMENTED — plan paranoia SIGN-OFF round 1/3 (4 BLOCKER + 4 WARN + 1 INFO closed) + Claude self-review fallback round 2/2 (SKILL.md §7 — bounded scope: 1 banner + 1 route case + 3 cabinet client/server file edits + tests). Wave paranoia round 1: Codex quota exhausted at start → 2-round Claude self-review fallback round 2/2 (same §7 clause). Pending: PR + merge.
date: 2026-06-02
owner: claude-orchestrator
---

# Bug #1 — Banner «учитель не выбрал способ оплаты» на главной кабинета ученика

## Кратко

После регистрации ученик может выбрать слоты учителя, которые доступны.
Но при попытке забронировать слот учителя, у которого НЕ выбрана модель
оплаты в `learner_billing_preferences` (или row отсутствует), бронирование
падает с `payment_method_not_set` глубоко внутри Calendly-flow
(`/cabinet/book/<ymd>/<slotId>/confirm-form.tsx`). Route handler сейчас
**не маппит** этот reason → fallback в generic «Это время только что
забронировал кто-то другой» (HTTP 409, см. round-1 R1-BLOCKER#2).

Владелец хочет показать понятный баннер **на главной кабинета ученика, ДО
входа в календарь**:

> Вы пока не можете забронировать занятие. Учитель должен выбрать
> модель оплаты за занятия.

## Existing surface inventory (per COMPANY.md §151 — survey-before-plan)

### Grep #1 — server-side reads/writes `learner_billing_preferences`

```
grep -rln "learner_billing_preferences" lib/ app/ tests/ migrations/ docs/
```

Hits (disposition each):

- `migrations/0101_learner_billing_preferences.sql` — table source. **unrelated** (DDL).
- `lib/billing/learner-payment-method.ts:32-187` — `getPaymentMethodForPair(teacherId, learnerId)` async helper returns `'postpaid'|'prepaid_packages'|'none'` (default `'none'` on missing row). **REUSE** — this is the single SoT for the predicate. No new SQL allowed (would drift).
- `lib/scheduling/slots/booking.ts:171-252` — booking-side reads `getPaymentMethodForPairTx(client, teacher, learner)` inside the txn and short-circuits to `{ ok:false, reason:'payment_method_not_set' }` on `'none'`. **DO NOT TOUCH** (per task constraint: defense-in-depth).
- `lib/scheduling/teacher-learners.ts` — teacher-side learners list reads the same row to project the payment method into the teacher dashboard. **unrelated** (teacher surface; not learner cabinet).
- `app/teacher/learners/[id]/page.tsx` — teacher edits the per-pair payment method. **unrelated** (teacher cabinet).
- `tests/integration/billing/booking.test.ts:78-92` — `setPairPaymentMethod()` test helper UPSERTs the row. **REUSE** (integration test pattern).
- `tests/integration/billing/admin-grant-schema.test.ts`, `tests/integration/billing/checkout-package.test.ts`, etc. — same UPSERT pattern in setup blocks. **unrelated** (different scope).
- `docs/plans/per-learner-payment-method.md` — original epic plan. **REFERENCE**.
- `docs/plans/tariffs-packages-learner-scope.md` — T3 cross-reference. **unrelated**.

### Grep #2 — entry-points into the booking calendar from cabinet home

```
grep -rln "/cabinet/book" app/ components/
```

Hits (per disposition):

- `app/cabinet/lessons-section.tsx:439-540` — `BookingCta` component (single-link learner path). Renders «Записаться на занятие» card with `<Link href="/cabinet/book">Открыть календарь</Link>`. **TARGET A** — banner must render here above the CTA (single-link learner).
- `app/cabinet/teacher-blocks-list.tsx:262-275` — per-teacher block with `<Link href="/cabinet/book?teacher=<id>">Записаться к этому учителю</Link>`. **TARGET B** — multi-link learner; banner must render per-block (per-teacher) since payment method is per-pair.
- `app/cabinet/page.tsx:239-307` — main cabinet renderer; branches single-link → `LessonsSection`, multi-link → `TeacherBlocksList` + `UnifiedTimeline`. **EDIT** — derive `paymentMethodByTeacher: Map<teacherId, PaymentMethod>` server-side, pass down.
- `app/cabinet/book/page.tsx`, `app/cabinet/book/[ymd]/page.tsx`, etc. — Calendly screens 1/2/3. **DO NOT TOUCH** (per scope: banner is on cabinet home BEFORE the calendar; the calendar-side gate stays for defense-in-depth, the user already lands in the calendar before they realise nothing is bookable — that's the bug).
- `app/cabinet/book/[ymd]/[slotId]/confirm-form.tsx:56-69` — submits POST, prints raw `data.message || data.error || HTTP ${res.status}`. Plus the route-handler issue below: deep-link path currently lands on the WRONG generic message.

### Grep #3 — existing `'use client'` cabinet components for banner placement style

```
grep -n "Учитель пока не назначен\|verify.*email\|role=\"status\"\|role=\"alert\"" app/cabinet/*.tsx
```

Hits:

- `app/cabinet/lessons-section.tsx:500-504` — existing «учитель пока не назначен» short-circuit inside `BookingCta`. **PATTERN MATCH** — same idiom.
- `app/cabinet/lessons-section.tsx:505-508` — existing «подтвердите e-mail» short-circuit. **PATTERN MATCH**.

### Grep #4 — call-sites of `getPaymentMethodForPair`

```
grep -rln "getPaymentMethodForPair\|learner-payment-method" app/ lib/ tests/
```

Hits:

- `lib/billing/learner-payment-method.ts` — definition.
- `lib/scheduling/slots/booking.ts` — Tx variant in booking.
- `tests/billing/learner-payment-method.test.ts` — type-shape unit test.
- **No other call-sites** — the new banner will be the first non-booking caller. `getPaymentMethodForPair` (pool-based) is the right entry-point — no new SQL needed.

### Grep #5 (R1-BLOCKER#2) — route handler reason mapping

```
grep -n "payment_method_not_set\|result.reason ===" app/api/slots/[id]/book/route.ts
```

Hits:

- `app/api/slots/[id]/book/route.ts:144-207` — reasons `not_found`, `in_past`, `self_booking_blocked`, `package_required`, `tariff_required`, `pending_package_grant`, `external_conflict`. `payment_method_not_set` is **NOT** mapped — currently falls through to the final `return NextResponse.json({ error: 'Это время только что забронировал кто-то другой. Обновите список.' }, { status: 409, headers: NO_STORE })` block. This is a real bug for any deep-link / stale-tab learner. **EDIT** — add a `payment_method_not_set` case that returns `422` with the verbatim banner copy. (Defense-in-depth ≠ no mapping — the server-side gate stays in `booking.ts`, but the route MUST translate the reason for the API contract to be honest.)

### Grep #6 (R1-WARN#7) — billing-sections contradiction

```
grep -n "Купить пакет\|приобретите пакет" app/cabinet/billing-sections.tsx
```

Hits:

- `app/cabinet/billing-sections.tsx:140-158` — «Купить пакет →» CTA in «Мои пакеты» card (gated on server-side `canBuyPackages` SoT).
- `app/cabinet/billing-sections.tsx:165-169` — empty-state copy «У вас нет активных пакетов. Каждое занятие нужно оплачивать отдельно, или приобретите пакет, чтобы записываться без повторной оплаты.»

**Decision (R1-WARN#7 closure):** when `method === 'none'` для всех assigned teachers (т.е. ученик вообще не может ничего забронировать ни у одного учителя), а ученик ещё `canBuyPackages`, эти суджесшены формально не врут — пакет можно купить заранее, а потом учитель выберет `prepaid_packages` и пакет автоматически потребляется. Но в моменте копия НЕ говорит «учитель ещё не определил способ оплаты» — ученик может купить пакет, который сразу не консумится (метод 'none' → booking всё ещё блокирован).

В этой волне **НЕ скрываем** «Купить пакет» CTA — это отдельный продуктовый разговор (нужно ли блокировать покупку до выбора метода). НО **добавляем** в баннер тонкую подсказку «Не нужно ничего покупать заранее — сначала дождитесь, пока учитель выберет способ оплаты. Если он выберет «оплата по пакетам», тогда ссылка «Купить пакет» в разделе ниже даст всё нужное.»

**Scope contract:** copy решает противоречие на уровне UX; ни одна логика покупки/гейта в этой волне не меняется. Это явно в §"What is NOT in scope".

### Conclusion of inventory

- The banner needs **server-side data on `app/cabinet/page.tsx`** — one
  `getPaymentMethodForPair(teacherId, learnerId)` call per assigned teacher.
- Single-link: scalar `paymentMethodNotSet: boolean` fed into `LessonsSection`/`BookingCta`.
- Multi-link: enrich `TeacherBlock` server-side (R1-WARN#5) with a new field `paymentMethod: 'postpaid'|'prepaid_packages'|'none'` inside `loadTeacherBlocks()` — single SoT.
- No new helper; no new SQL.
- Booking-side gate (`booking.ts`) stays untouched — defense-in-depth per task.
- Route handler GAINS one new case (R1-BLOCKER#2) — surfaces the reason instead of leaking it as generic 409.

## Reproduction

1. Register a fresh learner account, verify e-mail.
2. As admin, link the learner to a fresh teacher (`setAssignedTeacher`).
3. **Do NOT** insert a row into `learner_billing_preferences` for this (teacher, learner) pair.
4. Log in as the learner; navigate to `/cabinet`.
5. Click «Открыть календарь» → land on `/cabinet/book` → pick a day → pick a time → confirm.
6. POST `/api/slots/<id>/book` falls through to the generic 409 «Это время только что забронировал кто-то другой» (R1-BLOCKER#2: `payment_method_not_set` is unmapped).
7. The cabinet shows this misleading message. The learner has invested 3-4 clicks before discovering the block, and even then the message lies about the cause.

Expected after fix:
- At step 4, the learner sees the banner («Вы пока не можете забронировать занятие. Учитель должен выбрать модель оплаты за занятия.»). The «Открыть календарь» / «Записаться к этому учителю» CTAs are hidden.
- At step 6 (defense-in-depth, e.g. stale tab), the API responds with `422 { error: 'payment_method_not_set', message: 'Вы пока не можете забронировать занятие. Учитель должен выбрать модель оплаты за занятия.' }`, and confirm-form prints this real message instead of the misleading 409.

## Root cause

- Booking rejects in `lib/scheduling/slots/booking.ts:249-252`:
  ```ts
  if (method === 'none') {
    await client.query('rollback')
    return { ok: false, reason: 'payment_method_not_set' }
  }
  ```
- `getPaymentMethodForPairTx` returns `'none'` when no `learner_billing_preferences` row exists OR when the existing row's `payment_method = 'none'`.
- The cabinet home page (`app/cabinet/page.tsx`) does NOT currently surface this state.
- The route handler (`app/api/slots/[id]/book/route.ts:144-207`) does NOT have a case for `payment_method_not_set` — it falls through to the final generic 409 (R1-BLOCKER#2 finding).

## Fix

### A. Server-side derivation (`app/cabinet/page.tsx`)

- Add a server-side query to derive a `paymentMethodByTeacher: Map<string, 'postpaid'|'prepaid_packages'|'none'>` for the learner's assigned teacher set.
- Implementation: call `getPaymentMethodForPair(teacherId, account.id)` per `teacherIds`. Run in `Promise.all` alongside the existing `Promise.all` block.
- For single-link learner: derive `paymentMethodNotSet: boolean = method === 'none'` and pass to `LessonsSection`.
- For multi-link learner: **R1-WARN#5 closure** — enrich `loadTeacherBlocks` output. Add a new field `paymentMethod` to the `TeacherBlock` type in `lib/cabinet/teacher-blocks.ts`. Fetch via a 5th batched query OR per-teacher call inside the existing batch. Single SoT prevents map/blocks drift.

### B. Banner component

- New file `components/cabinet/missing-payment-method-banner.tsx`.
- **R1-BLOCKER#1 closure:** Both consumers (`lessons-section.tsx`, `teacher-blocks-list.tsx`) are `'use client'`. To safely import the banner from client trees, the banner is marked `'use client'`. Pure render (no hooks, no state); the directive is just for module-boundary compatibility.
- **R1-WARN#6 closure:** No `teacherName` prop. Final copy doesn't use it. Two-mode prop is `variant?: 'single' | 'per-teacher'` (default `'single'`).
- Copy (final, fixed):

  Single-link (`variant='single'`):
  > Вы пока не можете забронировать занятие. Учитель должен выбрать
  > модель оплаты за занятия.

  Multi-link per-block (`variant='per-teacher'`):
  > Вы пока не можете забронировать занятие у этого учителя. Учитель
  > должен выбрать модель оплаты за занятия.

  Optional second paragraph (renders only when `canBuyPackages === true`, **R1-WARN#7 closure**):
  > Не нужно ничего покупать заранее — сначала дождитесь, пока учитель
  > выберет способ оплаты.

  Both copies use «занятие», NOT «слот» (per `docs/content-style.md:116`).

- Visual style: yellow-bordered card (`role="status"`, matches the «подтвердите e-mail» idiom). `data-testid="missing-payment-method-banner"` for the render test.

### C. Wiring (single-link path)

- `app/cabinet/page.tsx`:
  - When `isLearner && linkCount === 1 && primaryTeacherId`:
    - Compute `paymentMethodNotSet = (await getPaymentMethodForPair(primaryTeacherId, account.id)) === 'none'`.
    - Pass `paymentMethodNotSet` AND `canBuyPackages` to `<LessonsSection>` as new props.
- `app/cabinet/lessons-section.tsx`:
  - Add `paymentMethodNotSet: boolean` + `canBuyPackages: boolean` to the `Props` type.
  - In `BookingCta`: if `paymentMethodNotSet === true`, render `<MissingPaymentMethodBanner variant="single" canBuyPackages={canBuyPackages} />` INSTEAD of the «Открыть календарь» CTA.
  - Order of short-circuits (top-to-bottom): `!hasAssignedTeacher` → `!emailVerified` → `paymentMethodNotSet` → CTA.

### D. Wiring (multi-link path)

- `lib/cabinet/teacher-blocks.ts`:
  - Extend `TeacherBlock` type with `paymentMethod: PaymentMethod` (import `PaymentMethod` from `@/lib/billing/learner-payment-method` to avoid drift if the enum gains a value).
  - Add a 5th batched DB query on `dbPool` (NOT `authPool` — `learner_billing_preferences` lives in the main DB, see `migrations/0101_learner_billing_preferences.sql`):
    ```sql
    select teacher_account_id, payment_method
      from learner_billing_preferences
     where learner_account_id = $1::uuid and teacher_account_id = any($2::uuid[])
    ```
    Build a `Map<teacherId, PaymentMethod>`; default any teacher_id not in the result to `'none'`.
- `app/cabinet/page.tsx`: pass `canBuyPackages` to `<TeacherBlocksList>` as a new prop.
- `app/cabinet/teacher-blocks-list.tsx`:
  - Add `canBuyPackages: boolean` to props.
  - Inside each block (`blocks.map((b) => ...)`): if `b.paymentMethod === 'none'`, render `<MissingPaymentMethodBanner variant="per-teacher" canBuyPackages={canBuyPackages} />` INSTEAD of «Записаться к этому учителю» CTA. The rest of the block (upcoming slots, debt, packages) stays visible.

### E. Route handler — R1-BLOCKER#2 closure

- `app/api/slots/[id]/book/route.ts`: insert a new `if (result.reason === 'payment_method_not_set')` case between `tariff_required` and `pending_package_grant`:
  ```ts
  if (result.reason === 'payment_method_not_set') {
    return NextResponse.json(
      {
        error: 'payment_method_not_set',
        message:
          'Вы пока не можете забронировать занятие. Учитель должен выбрать модель оплаты за занятия.',
      },
      { status: 422, headers: NO_STORE },
    )
  }
  ```
- 422 chosen because the request is well-formed but the precondition (teacher payment method) is not met. Matches the existing `package_required` / `tariff_required` semantic pattern in the same file (402 for payment-required, 422 for precondition-style; we are precondition).

### F. Defense-in-depth — booking server-side gate stays

- `lib/scheduling/slots/booking.ts:249-252` UNCHANGED. The banner is a UX improvement on the entry path; the booking SQL gate is untouched.

### G. Doc sweep — R1-WARN#8 closure

- `ARCHITECTURE.md` lines 45 (`/cabinet/page.tsx`) + 262 (`lib/scheduling/slots/booking.ts` description) — add brief mention of the new banner + the new 422 reason in the booking gate description. Plain prose; no new section.

## Tests

### Test 1 — `tests/cabinet/missing-payment-method-banner.test.tsx` (NEW, render unit; R1-INFO#9 — real DOM)

- Vitest + React Testing Library + jsdom — same pattern as `tests/cabinet/calendar-settings-state-matrix.test.tsx`.
- Assertions:
  - Variant `single`: text equals «Вы пока не можете забронировать занятие. Учитель должен выбрать модель оплаты за занятия.» exact match.
  - Variant `per-teacher`: text contains «у этого учителя» substring.
  - `canBuyPackages={true}` renders the additional «Не нужно ничего покупать заранее…» paragraph; `canBuyPackages={false}` does NOT.
  - `role="status"` and `data-testid="missing-payment-method-banner"` present.
  - **Negative: no «слот» substring** (style-guide pin; `docs/content-style.md:116`).

### Test 2 — `tests/cabinet/cabinet-page-banner.test.tsx` (NEW, page-level SSR; R1-BLOCKER#3 closure)

- Vitest + RTL + jsdom — mock the auth/teacher/billing helpers (same pattern as `calendar-settings-state-matrix.test.tsx`).
- Scenarios:
  - **Single-link, method='none'**: render `/cabinet`, expect `missing-payment-method-banner` testid present, expect NO «Открыть календарь» link.
  - **Single-link, method='postpaid'**: NO banner, «Открыть календарь» link visible.
  - **Multi-link (2 teachers), one method='none' + one method='prepaid_packages'**: 1 banner inside the 'none' block, 1 «Записаться к этому учителю» link inside the 'prepaid_packages' block.
- Mocked: `lookupSession`, `listAccountRoles`, `getAccountProfile`, `listSlotsForLearner`, `listOpenFutureSlots`, `listAccountActivePackages`, `getDbPool` (postpaid row read), `getPaymentMethodForPair`, `loadTeacherBlocks`, `isLearnerArchetypeCandidate`, plus the `next/headers` / `next/navigation` / `next/link` stubs (already in `calendar-settings-state-matrix.test.tsx`).

### Test 3 — `tests/integration/billing/cabinet-payment-method-banner.test.ts` (NEW, integration; R1-BLOCKER#3 + R1-BLOCKER#4 — predicate + route)

- Boots Postgres via the integration harness.
- Three scenarios (predicate side):
  - **Scenario A — no preference row**: register learner + teacher, link them, do NOT UPSERT. Assert `getPaymentMethodForPair(teacherId, learnerId) === 'none'`.
  - **Scenario B — preference row with `payment_method='none'`**: insert with `'none'`. Same assertion.
  - **Scenario C — `'postpaid'` set**: insert with `'postpaid'`. Assert `=== 'postpaid'`.
- One scenario (route side, R1-BLOCKER#4 — confirms the round-trip):
  - **Scenario D — Book endpoint surfaces 422 + verbatim message** when the pair is `'none'` and the slot is otherwise bookable. `BILLING_WAVE_ACTIVE=true` per pattern. Assert response body has `error: 'payment_method_not_set'` AND `message` includes «Учитель должен выбрать модель оплаты за занятия.»
- Why integration (not unit): the SoT predicate AND the route mapping are server-side; mocking would silently drift.

### Tests 4 — sanity: existing tests stay green

- `npm run test:run` (vitest unit suite incl. tests/cabinet/, tests/billing/) — full green.
- `bash scripts/test-integration.sh tests/integration/billing/booking.test.ts tests/integration/billing/cabinet-payment-method-banner.test.ts` — full green.
- `npm run build` — clean.

## What is NOT in scope

- **Calendar entry for past lessons** — keeping the «Прошедшие» list view-only is unchanged. The banner only suppresses the FUTURE-booking CTA. Past-lesson cards in `lessons-section.tsx` remain visible.
- **Banner inside Calendly screens** (`/cabinet/book`, `/cabinet/book/<ymd>`, etc.) — the user asked for the surface on cabinet home BEFORE the calendar. Deep-link users get the new 422 (R1-BLOCKER#2 closure) at submit-time, surfaced by the existing `confirm-form.tsx` error renderer (which prints `data.message`).
- **Auto-prompting the teacher to set the method** — out of scope; existing teacher-side surface in `/teacher/learners/<id>` is sufficient.
- **Hiding the «Купить пакет» CTA on cabinet home when method='none'** — explicitly OUT (R1-WARN#7 closure); copy in the banner explains. Product-level call to gate package purchase on method-set is a separate discussion.
- **Change to billing logic in `booking.ts`** — explicitly excluded by task constraints (defense-in-depth).
- **SaaS-offer gate / security guards** — excluded by task constraints.
- **Tariff models** — excluded by task constraints.

## Implementation order

1. New banner component `components/cabinet/missing-payment-method-banner.tsx` with `'use client'`.
2. Extend `TeacherBlock` in `lib/cabinet/teacher-blocks.ts` with `paymentMethod` field (5th batched query).
3. Plumb `paymentMethodNotSet` (single) + `canBuyPackages` through `app/cabinet/page.tsx` → `LessonsSection`. Plumb `canBuyPackages` → `TeacherBlocksList` (the per-block `paymentMethod` is now on the block itself).
4. Render banner in both call-sites, short-circuiting the CTA.
5. Add `payment_method_not_set` → 422 mapping in `app/api/slots/[id]/book/route.ts`.
6. Doc sweep on `ARCHITECTURE.md`.
7. Add render unit test + page-level test + integration derivation+route test.
8. Run `npm run build`, `npm run test:run`, `bash scripts/test-integration.sh tests/integration/billing/cabinet-payment-method-banner.test.ts tests/integration/billing/booking.test.ts`.
9. Wave paranoia 3-round (hard cap).
10. PR `bug/1-payment-method-banner` → main, squash merge.
