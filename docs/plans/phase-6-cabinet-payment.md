# Phase 6 — Cabinet Payment + payment_allocations

Status: **approved (proposed defaults) 2026-05-04**.

## Why this wave exists

Phase 3 shipped a `pricing_tariffs` catalog but `/pay` stayed
free-amount (D3 in `phase-3-profiles-admin-pricing.md`). Phase 4
shipped booking but payment-free. Phase 5 closed lifecycle but still
no money path through the cabinet.

Phase 6 closes the loop: a learner books a slot, gets a clear price
tag from the catalog, pays. Operator sees what's been paid and what's
outstanding. **Crucially, this ships on a separate URL** so the
existing `/pay` free-amount flow stays bit-for-bit identical and we
can soak the new flow in production without touching the old one.

## Hard constraint — DO NOT break `/pay`

The existing `/pay` (free-amount, opens through CloudPayments widget)
stays untouched in this wave. Migration is additive, no existing
column is renamed, no existing route is modified.

The new flow lives at:

- `/checkout/[tariffSlug]` — public tariff checkout, anonymous-OK
- `/checkout/[tariffSlug]?slot=<uuid>` — same page, additionally
  binds the resulting payment to a specific lesson_slot via
  payment_allocations on webhook paid

If the new flow has problems in prod, we just don't link to it from
the cabinet. The catalog stays operator-CRUD-only at `/admin/pricing`,
the booking flow stays payment-free, and the existing `/pay` keeps
running.

## What ships

1. **Migration 0022** — additive only:
   - new column `lesson_slots.tariff_id` (uuid, nullable, FK to
     `pricing_tariffs(id)` ON DELETE SET NULL)
   - new table `payment_allocations`:
     ```
     payment_order_id  text  references payment_orders(invoice_id)
     kind              text  check (kind in ('lesson_slot'))
     target_id         text
     amount_kopecks    integer not null
     created_at        timestamptz default now()
     primary key (payment_order_id, kind, target_id)
     ```
2. **`lib/payments/allocations.ts`** — store ops:
   - `recordAllocation` — best-effort insert on webhook paid
   - `listAllocationsForOrder`
   - `listSlotPaidStatus(slotIds[])` — bulk check returning a map
     `slotId → { paid: boolean; orderInvoiceId?: string }`. Cabinet UI
     uses this to render «оплачено» / «оплатить» beside each booked
     slot.
3. **`/checkout/[tariffSlug]`** — public page. Reads tariff from
   `pricing_tariffs` (404 if slug unknown or `is_active = false`).
   Layout mirrors `/pay`'s pricing-section: amount fixed (display
   only — no input), email + consent fields, "Перейти к оплате"
   button. The amount is the tariff's `amount_kopecks` (rendered in
   ₽). When `?slot=<uuid>` is present, the page additionally validates
   the slot exists, has `learner_account_id` matching the cabinet
   session (auth required in that case), and is `booked`. Returns 404
   otherwise. Submit hits `POST /api/payments` (existing) with the
   tariff's amount + customer email + a `metadata.slotId` field that
   the webhook handler will read.
4. **Webhook integration:** on `webhook.pay.processed`, if the order's
   metadata contains `slotId`, also call `recordAllocation`. Best-
   effort wrap (try/catch); a failed allocation insert does NOT block
   webhook ack to CloudPayments.
5. **Cabinet payment hint:** in `/cabinet`'s «Мои уроки» section,
   each booked future slot whose `tariff_id` is non-null AND has no
   paid allocation gets an «Оплатить» link to `/checkout/<slug>?slot=<id>`.
   Already-paid bookings get a green «Оплачено» pill. Bookings with
   no `tariff_id` (operator chose not to attach a tariff) get nothing —
   payment is operator-side / DM-driven for those.
6. **Admin slot UI extension:** the create + bulk forms get an
   optional «Тариф» dropdown. The slots table shows the tariff slug.
7. **Public landing:** **NOT touched.** The `/pay` free-amount form
   stays as is. No "выберите тариф" link, no "оплатить пакет" CTA.
   Operator can manually share `/checkout/<slug>` URLs while the
   flow soaks.

## What is NOT in scope (parked)

- Refund / credit on cancellation. If a learner with a paid booking
  cancels (>24h), Phase 6 just stamps the slot cancelled and leaves
  the payment_orders + payment_allocations rows alone. Operator-side
  refund stays manual via CloudPayments dashboard for now. A clean
  refund flow ships in Phase 7 if/when refund volume justifies it.
- Package purchases (one payment → N slots). The
  `payment_allocations` table is forward-compatible (kind enum), but
  Phase 6 only ships `kind='lesson_slot'`. Adding `kind='package'`
  later is a one-row CHECK constraint update.
- Sunsetting `/pay`. Both flows run side-by-side in this wave. After
  the new flow has a few weeks in production with no incidents, we
  can decide whether to make `/pay` redirect to a tariff picker or
  keep it as a one-off.
- 1-click charge from a saved card on a tariff-bound payment. Saved
  cards stay scoped to free-amount `/pay` for now.
- Per-account custom prices. Catalog tariffs apply to everyone.

## Open decisions — settled

| ID | Settled |
|---|---|
| D1 | New URL `/checkout/[tariffSlug]`, parallel to `/pay`. Existing `/pay` untouched |
| D2 | Slot ↔ tariff = optional FK `lesson_slots.tariff_id`. Null = no auto-bound price |
| D3 | Booking stays payment-free at the protocol layer. Slot status='booked' on click; payment is a separate concern tracked through `payment_allocations` |
| D4 | "Paid" status on a slot = derived (JOIN payment_allocations + payment_orders.status='paid'). No new column on `lesson_slots` |
| D5 | Refund / credit out of scope this wave. Manual via CloudPayments dashboard for now |
| D6 | Cabinet only links to `/checkout/...` from booked-future slots that have a non-null `tariff_id`. Other slots stay as-is |

## Surface area

**Migration**: 0022 (additive).

**New library code:**
- `lib/payments/allocations.ts`

**New routes:**
- `app/checkout/[tariffSlug]/page.tsx` (server-rendered shell)
- `app/checkout/[tariffSlug]/checkout-client.tsx` (client island)
- The page reuses existing `/api/payments` POST (with `metadata.slotId`
  added if a `?slot=` query param is present).

**Modified routes:**
- `app/api/payments/route.ts` — accept and persist `metadata.slotId`
  on create (validates the field shape; does NOT bind anything yet —
  binding happens in the webhook).
- `app/api/payments/webhooks/cloudpayments/pay/route.ts` — on success
  + slot in metadata, call `recordAllocation`.

**Modified UI:**
- `app/cabinet/lessons-section.tsx` — render «Оплатить» link / «Оплачено»
  pill on booked future slots that have a `tariff_id`.
- `app/admin/slots/slots-manager.tsx` — tariff dropdown in single +
  bulk create forms; tariff column in the list.
- `lib/scheduling/slots.ts` — extend select / row-mapping to include
  `tariff_id` and `tariffSlug`/`tariffAmountKopecks` joined from
  `pricing_tariffs`.

**Tests:**
- unit: allocation validation (non-negative kopecks, valid kind)
- integration: webhook paid + slot metadata writes allocation;
  public `/checkout/[slug]` 404 on unknown slug, 200 on valid; cabinet
  query for slot-paid status returns correct map; create slot with
  `tariff_id` round-trips.

**Activation:** migrate:up on autodeploy applies 0022. No new systemd
timer this wave.

## Test plan in production

After deploy, before linking the new URL from the cabinet:

1. Operator picks an active tariff slug, opens `/checkout/<slug>` in
   incognito. Verify: page renders, amount matches catalog,
   "Перейти к оплате" opens the CloudPayments widget with the right
   amount.
2. Test purchase end-to-end (operator pays themselves), confirm the
   widget closes on success and CloudPayments webhook lands. Verify
   the new payment_orders row + (if slot was attached) the
   payment_allocations row.
3. Then link from cabinet by deploying the cabinet-side hint. If
   anything goes wrong, the cabinet link reverts via a single revert
   PR; the public `/checkout/...` URL keeps running independently.
