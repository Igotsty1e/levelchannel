---
title: Bug #3 — booking screens show hardcoded «Занятие по английскому» + «50 мин»
status: SHIPPED — plan SIGN-OFF round 2/3 (Codex R1 BLOCK→fixed; R2 §7 fallback). Wave SIGN-OFF round 1/2 (§7 fallback — doc/UI-only tier-1, no DB/auth/payment surface).
date: 2026-06-02
owner: claude-orchestrator
---

# Bug #3 — booking screens show hardcoded «Занятие по английскому» + «50 мин»

## Owner report

> При бронировании слотов мы показываем странное название слота и почему то пишем про 50 минут. Не понимаю откуда мы это берем.

Screenshot of `/cabinet/book` shows:
- Title: «Занятие по английскому»
- Duration: «🕐 50 мин»
- Footnote: «🎥 Ссылку на встречу пришлёт учитель — обычно за день до занятия.»

Owner is correct to be confused. Neither the title nor «50 мин» reflect any teacher/tariff configuration — both are dead literals committed in the original Calendly-style booking wave.

## Reproduction

1. Login as a verified learner with an assigned teacher.
2. Open `/cabinet/book`.
3. Screen 1 (`app/cabinet/book/page.tsx`) renders:
   - h1 «Занятие по английскому» (line 133)
   - «🕒 50 мин» (line 144)
4. Pick any day → screen 2 (`app/cabinet/book/[ymd]/page.tsx`) renders:
   - «Длительность: 50 мин» (line 159) under «Выберите время».
5. Pick any time → screen 3 (`app/cabinet/book/[ymd]/[slotId]/page.tsx`) already shows the real `slot.durationMinutes` (line 144). Screen 3 is NOT buggy.

## Existing surface inventory (COMPANY.md §151)

**Grep #1** — every hit for the literal subtitle:

```
grep -rn "Занятие по английскому" app/ lib/ components/ scripts/
```

Hits:
- `app/cabinet/book/page.tsx:133` — h1 on `/cabinet/book`. → **fix**.

Zero other hits in app/lib/components. This is the only render site.

**Grep #2** — every hit for the hardcoded duration string:

```
grep -rn "50 мин" app/ lib/ components/ scripts/
```

Hits:
- `app/cabinet/book/page.tsx:144` — screen 1 subheader. → **fix**.
- `app/cabinet/book/[ymd]/page.tsx:159` — screen 2 «Длительность» line. → **fix**.
- `app/offer/page.tsx` — public offer, unrelated commercial copy. → **unrelated**.
- `scripts/legal-v1-templates/offer.md` — offer template, unrelated. → **unrelated**.
- `docs/plans/onboarding-flows-2026-05-31.md` — historical plan-doc, unrelated. → **unrelated**.

**Grep #3** — surface area we will reuse:

```
grep -rn "PublicSlot\|tariffTitleRu\|toPublicSlot" lib/scheduling/slots/ app/api/slots/
```

Hits:
- `lib/scheduling/slots/types.ts:153-175` — `PublicSlot` type already carries `tariffTitleRu`, `tariffSlug`, `tariffAmountKopecks`, `durationMinutes`. → **reuse** verbatim, no schema/DTO change.
- `lib/scheduling/slots/booking-queries.ts:184-232` — `listOpenBookingTimes` SQL already joins `pricing_tariffs t` and projects `t.title_ru as tariff_title_ru`. → **reuse**, no SQL change.
- `app/api/slots/booking-times/route.ts:117` — already returns `slots.map(toPublicSlot)`. → **reuse**, no API change.
- `lib/scheduling/slots/internal.ts:43-111` — `rowToSlot()` already maps `duration_minutes` from `lesson_slots` (slot snapshot) and `tariff_title_ru` from the join. → **reuse**.

**Conclusion** — all data the UI needs is already on the wire. The bug is purely in two server components. No API, DTO, query, or migration change required.

**Grep #4** — places that currently consume the booking-times API to make sure we don't break a sibling reader:

```
grep -rn "/api/slots/booking-times" app/ lib/ components/ scripts/
```

Hits:
- `app/cabinet/book/[ymd]/time-list.tsx:51` — client island, fetches and renders slot times. → **fix** (extend `PublicSlot` shape consumed locally + render title + duration per slot).
- No other consumers.

## Root cause (per string)

### «Занятие по английскому» — hardcoded literal

`app/cabinet/book/page.tsx:133`. Plain JSX string. Committed in the original BCS-B.frontend Calendly screen as a placeholder. **Not** sourced from any tariff/teacher field. The DB has `pricing_tariffs.title_ru` per-tariff (e.g. «Индивидуальный урок 60 мин», «Trial 30 мин») but the booking page never reads it.

### «50 мин» — hardcoded literal × 2

`app/cabinet/book/page.tsx:144` and `app/cabinet/book/[ymd]/page.tsx:159`. Both are plain JSX strings. **Not** sourced from any tariff. Real per-slot duration is `lesson_slots.duration_minutes` (a snapshot copied from `pricing_tariffs.duration_minutes` at slot creation, enforced immutable by `pricing_tariffs_duration_immutable` trigger from mig 0046). The default tariff (`migrations/0102`, T3 epic) sets duration to 60 min, NOT 50. So «50 мин» is a literal that no operator ever set — it was just a placeholder from the original BCS-B.frontend wave.

**The owner's instinct is correct**: this is a phantom number. No tariff, slot, or config row currently in production carries the value 50.

## Fix

### Constraint reminder
- No DB schema changes.
- No tariff CRUD changes.
- No new API endpoints.
- The booking-times API already returns the data we need; we just consume it.

### Screen 1 — `/cabinet/book` (`app/cabinet/book/page.tsx`)

This screen renders BEFORE the learner picks a day or time. At this level we don't know which specific slot/tariff the learner will hit (different tariffs may coexist for one teacher). Two options:

- **Option A (chosen)** — drop the hardcoded title + duration line entirely. Replace with neutral, factually correct copy:
  - h1 stays a generic Calendly-style label: «Запись на занятие».
  - Subline drops the fake duration; keeps only the meeting-link hint.
- **Option B (rejected)** — try to pick a "representative" tariff (e.g. teacher's only active tariff). Rejected because: (1) multi-tariff teachers exist after T3; (2) requires a new server read just to render a single label; (3) the per-slot title is shown on screen 2 anyway, which is one click away. Option A is simpler and not wrong.

### Screen 2 — `/cabinet/book/[ymd]` (`app/cabinet/book/[ymd]/page.tsx` + `time-list.tsx`)

This screen lists slots for a chosen day. Each slot carries its own title + duration.

- Drop the static «Длительность: 50 мин» subheader at line 159.
- Extend the client `TimeList` to consume the existing `tariffTitleRu` + `durationMinutes` fields from `PublicSlot` and render them per row.
- Row format (compact): `HH:MM · 60 мин · Индивидуальный урок`.

**R1-WARN#3 closure** — single, canonical null-fallback contract (drift-prevention):

- When `tariffTitleRu === null` (legacy pre-tariff-binding slots from before mig 0022, OR slots created without a tariff ref), render the row as `HH:MM · NN мин` with NO title suffix. No literal fallback text like «Занятие» or «Урок» — that would just reintroduce the placeholder bug under a different name.
- When `tariffTitleRu` is a non-empty string, render `HH:MM · NN мин · {title}`.
- This is the ONLY null-handling rule for the title; the §"Not in scope" section reflects it verbatim.

### Screen 3 — `/cabinet/book/[ymd]/[slotId]` (confirm)

**R1-BLOCKER#1 closure (2026-06-02):** R1 caught that `getSlotById()` at `lib/scheduling/slots/queries.ts:289-300` does NOT join `pricing_tariffs` — it selects only `lesson_slots` columns. So `slot.tariffTitleRu` is null on the confirm screen even when the underlying slot has a tariff. Surfacing tariff title here would require either (a) extending `getSlotById()`'s SELECT to join `pricing_tariffs` + auditing all 3 call-sites (`app/checkout/[tariffSlug]/page.tsx:106`, `app/admin/(gated)/payments/[invoiceId]/page.tsx:31`, `app/api/teacher/slots/[id]/conflicts/route.ts:33`) or (b) adding a parallel `getSlotByIdWithTariff()` helper.

Both options exceed Bug #3 scope. **Decision: drop confirm-screen tariff-title surfacing from this bug.** Screen 3 already shows real `slot.durationMinutes` correctly (that's the snapshot column from `lesson_slots`, available without a join). The cosmetic gap (no tariff title on confirm) is captured as a follow-up below.

### Files touched (final list, R1 BLOCKER-closed scope)

- `app/cabinet/book/page.tsx` — drop hardcoded title + duration line.
- `app/cabinet/book/[ymd]/page.tsx` — drop hardcoded «Длительность: 50 мин» line.
- `app/cabinet/book/[ymd]/time-list.tsx` — extend `PublicSlot` local type with optional `tariffTitleRu` field; render `HH:MM · NN мин · {title}` per slot.
- `tests/integration/scheduling/booking-endpoints.test.ts` — extend the booking-times pin test to assert `durationMinutes` and `tariffTitleRu` are present + correct (not 50, not hardcoded title).

Confirm screen (`app/cabinet/book/[ymd]/[slotId]/page.tsx`) NOT touched in this bug.

## Tests

R1-WARN#4 closure — the original "just assert the API" plan would silent-green even if the hardcoded literals stayed in the components. Real coverage needs both data-pinning AND a guarantee the booked literals are gone. Two pieces:

1. **Booking-times API pins real slot duration + tariff title** (new asserts in `tests/integration/scheduling/booking-endpoints.test.ts`, in the existing «returns open slots for the requested day in assigned teacher tz» case):
   - The current setup creates a slot via `/api/admin/slots` with `durationMinutes: 60`. Admin slot creation does NOT bind a tariff by default — so to pin tariff fields we either (a) seed a tariff via `lib/pricing/tariffs.ts:createTariffForTeacher()` first + create the slot with `tariffId` in the body, or (b) add a NEW dedicated test case that does (a) and leave the existing case alone.
   - Choose (b) to keep blast-radius small: a new test case «booking-times surfaces real tariff title + duration (anti-hardcode pin)» that:
     - Seeds a tariff with `durationMinutes: 60`, `titleRu: 'Индивидуальный урок'`.
     - Creates a slot via `/api/admin/slots` with `tariffId` set.
     - Fetches `/api/slots/booking-times`.
     - Asserts `slots[0].durationMinutes === 60` AND `slots[0].durationMinutes !== 50` (explicit anti-hardcode pin).
     - Asserts `slots[0].tariffTitleRu === 'Индивидуальный урок'` AND `slots[0].tariffTitleRu !== 'Занятие по английскому'`.

2. **Static source pin against placeholder literals**: a `tests/integration/scheduling/no-hardcoded-booking-copy.test.ts` (or co-located with booking-endpoints) that fs-reads the three booking page components and asserts NONE of them contain:
   - the literal `'50 мин'`
   - the literal `'Занятие по английскому'`
   - This is fast, deterministic, and prevents regression if someone re-introduces a placeholder later. Files watched: `app/cabinet/book/page.tsx`, `app/cabinet/book/[ymd]/page.tsx`, `app/cabinet/book/[ymd]/time-list.tsx`.

3. **Manual smoke (post-merge)** — load `/cabinet/book` on prod, verify:
   - No «50 мин» anywhere on screen 1.
   - No «Занятие по английскому» on screen 1.
   - Screen 2 shows real per-slot duration + title.

## What is NOT in scope

- Admin/teacher tariff editor UX (Bug #3 is purely about display drift, not configuration).
- Slot-level title overrides (no schema field exists; lesson title === tariff title by design).
- Multi-teacher picker UI improvements (covered by SAAS-PIVOT Epic 7).
- Restoring the hardcoded label as a fallback for null-tariff legacy slots — those will simply render without a title (the format becomes `HH:MM · NN мин` when `tariffTitleRu` is null, which is fine). This matches the §Screen 2 canonical null-fallback contract exactly; no other fallback path exists.
- Surfacing tariff title on the confirm screen (`app/cabinet/book/[ymd]/[slotId]/page.tsx`). R1-BLOCKER#1 caught that `getSlotById()` does not join `pricing_tariffs`. Fixing this requires either extending `getSlotById()` SELECT + auditing 3 call-sites, or adding a parallel helper — both exceed bug-fix scope. Tracked as follow-up bug if owner wants it.
- Aligning booking-flow tariff visibility with `/api/slots/available` (R1-WARN#2). `lib/scheduling/slots/booking-queries.ts` does NOT filter on `pricing_tariffs.is_active` / `deleted_at`, while `/api/slots/available` does. Result: an archived tariff's open slot stays bookable via /cabinet/book until the slot itself is removed. This is the existing behaviour and is out of scope for a display bug — track separately if it's a real correctness concern.
- Changing the meeting-link copy on confirm screen.
- Any change to `pricing_tariffs` schema or CRUD.
