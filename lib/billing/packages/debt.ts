// Wave 42 — postpaid debt view (slots completed/no-show without
// package consumption and without paid allocation). Read-only.

import { getDbPool } from '@/lib/db/pool'

export type PostpaidDebtSlot = {
  slotId: string
  startAt: string
  durationMinutes: number
  status: string
  tariffId: string | null
  expectedAmountKopecks: number | null
  legacyGrandfathered: boolean
}

// Read-only: list this account's POSTPAID DEBT slots — slots that
// are completed/no_show_learner, not consumed from a package, and
// not yet paid via /checkout/?slot=. Used by /api/account/postpaid-debt
// and the cabinet "К оплате" section.
export async function listAccountPostpaidDebt(
  accountId: string,
): Promise<PostpaidDebtSlot[]> {
  const pool = getDbPool()
  const result = await pool.query(
    `select s.id, s.start_at, s.duration_minutes, s.status, s.tariff_id,
            t.amount_kopecks as expected_amount_kopecks,
            s.legacy_grandfathered
       from lesson_slots s
       left join pricing_tariffs t on t.id = s.tariff_id
      where s.learner_account_id = $1
        and s.status in ('completed', 'no_show_learner')
        and not exists (
          select 1 from package_consumptions pc
           where pc.slot_id = s.id and pc.restored_at is null
        )
        and not exists (
          select 1 from payment_allocations pa
           join payment_orders po on po.invoice_id = pa.payment_order_id
          where pa.kind = 'lesson_slot'
            and pa.target_id = s.id::text
            and po.status = 'paid'
        )
      order by s.start_at desc`,
    [accountId],
  )
  return result.rows.map((r) => ({
    slotId: String(r.id),
    startAt: new Date(String(r.start_at)).toISOString(),
    durationMinutes: Number(r.duration_minutes),
    status: String(r.status),
    tariffId: r.tariff_id ? String(r.tariff_id) : null,
    expectedAmountKopecks:
      r.expected_amount_kopecks !== null && r.expected_amount_kopecks !== undefined
        ? Number(r.expected_amount_kopecks)
        : null,
    legacyGrandfathered: Boolean(r.legacy_grandfathered),
  }))
}
