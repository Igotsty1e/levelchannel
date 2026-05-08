import { getDbPool } from '@/lib/db/pool'

// Codex 2026-05-08 (HIGH) — gate the slotId on POST /api/payments.
//
// Pre-fix: the route accepted any UUID as `slotId`, stuffed it into
// `order.metadata.slotId`, and the webhook on `pay` wrote a
// `payment_allocations` row binding the paid invoice to that slot
// — without verifying ownership, tariff match, or amount match. So
// a learner could:
//
//   1. Find any slot's UUID (e.g. via /api/slots/available which is
//      anonymous-readable).
//   2. POST /api/payments with that slotId + an arbitrary amount
//      (1₽ if accepted by the amount validator).
//   3. After CloudPayments confirms, the webhook quietly writes
//      `payment_allocations(payment_order_id=their, target_id=victim_slot)`.
//   4. Operator UIs that join allocations show the attacker as the
//      payer of someone else's slot.
//
// This module is the request-time gate: when a session-bearing
// learner attaches a slotId to a payment, the slot must (a) exist,
// (b) belong to that learner, and (c) carry a tariff whose amount
// matches the payment within rounding. The webhook later does an
// independent verification (defence-in-depth — separate file).
//
// Anonymous (no session) callers cannot supply a slotId at all; the
// route rejects upstream before this module is consulted.

export type SlotBindingVerdict =
  | { ok: true; tariffAmountKopecks: number | null }
  | {
      ok: false
      reason:
        | 'not_found'
        | 'not_owner'
        | 'not_in_payable_state'
        | 'tariff_mismatch'
      detail?: string
    }

const PAYABLE_STATUSES = new Set<string>(['booked'])
const KOPECKS_TOLERANCE = 1

export async function validatePaymentSlotBinding(args: {
  slotId: string
  learnerAccountId: string
  amountRub: number
}): Promise<SlotBindingVerdict> {
  const pool = getDbPool()
  const result = await pool.query(
    `select s.learner_account_id,
            s.status,
            s.tariff_id,
            t.amount_kopecks as tariff_amount_kopecks
       from lesson_slots s
       left join pricing_tariffs t on t.id = s.tariff_id
      where s.id = $1
      limit 1`,
    [args.slotId],
  )
  const row = result.rows[0]
  if (!row) return { ok: false, reason: 'not_found' }

  const slotLearner = row.learner_account_id ? String(row.learner_account_id) : null
  if (slotLearner !== args.learnerAccountId) {
    return { ok: false, reason: 'not_owner' }
  }

  const status = String(row.status)
  if (!PAYABLE_STATUSES.has(status)) {
    // The only state where paying-for-a-slot makes sense is 'booked'.
    // 'open' (not yet booked by anyone) means the learner hasn't
    // committed; 'cancelled' / 'completed' / 'no_show_*' are terminal
    // and a payment would have nowhere to bind cleanly.
    return {
      ok: false,
      reason: 'not_in_payable_state',
      detail: `slot status is "${status}"`,
    }
  }

  // Tariff match. Slots without a bound tariff can be paid in any
  // amount (legacy / ad-hoc) — operator decided that at slot-create
  // time. Slots WITH a tariff must match the requested amount within
  // a 1-kopeck rounding tolerance.
  const tariffAmountKopecks =
    row.tariff_amount_kopecks !== null && row.tariff_amount_kopecks !== undefined
      ? Number(row.tariff_amount_kopecks)
      : null

  if (tariffAmountKopecks !== null) {
    const requestedKopecks = Math.round(args.amountRub * 100)
    const drift = Math.abs(requestedKopecks - tariffAmountKopecks)
    if (drift > KOPECKS_TOLERANCE) {
      return {
        ok: false,
        reason: 'tariff_mismatch',
        detail: `expected ${tariffAmountKopecks / 100} ₽, got ${args.amountRub} ₽`,
      }
    }
  }

  return { ok: true, tariffAmountKopecks }
}
