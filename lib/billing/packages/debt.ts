// Wave 42 — postpaid debt view (slots completed/no-show without
// package consumption and without paid allocation). Read-only.
//
// Wave 58 — admin debt aggregator. The per-account query
// (`listAccountPostpaidDebt`) is the cabinet surface. The same predicate
// rolled up by `learner_account_id` powers the admin debt summary
// (`listAccountsWithPostpaidDebtAggregate`), which the operator hits
// to see who owes how much across the whole learner base.

import { getDbPool } from '@/lib/db/pool'

export type PostpaidDebtSlot = {
  slotId: string
  startAt: string
  durationMinutes: number
  status: string
  tariffId: string | null
  // Wave 45 — also surface the slug so the cabinet "Оплатить" link can
  // hit /checkout/[tariffSlug] which resolves by slug, not UUID.
  tariffSlug: string | null
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
  // Wave 45 post-review MEDIUM. Filter the tariff join on
  // is_active=true so an archived tariff doesn't surface as a paid
  // CTA in the cabinet. /checkout/[tariffSlug] refuses inactive
  // slugs (it 404s), so showing an "Оплатить" button against an
  // archived tariff would dead-end the user. With this filter, the
  // archived case falls through to "обратитесь к оператору" via the
  // null-slug branch in the UI.
  const result = await pool.query(
    `select s.id, s.start_at, s.duration_minutes, s.status, s.tariff_id,
            t.slug as tariff_slug,
            t.amount_kopecks as expected_amount_kopecks,
            s.legacy_grandfathered
       from lesson_slots s
       left join pricing_tariffs t
              on t.id = s.tariff_id and t.is_active = true
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
            -- Refund Phase 7 + Wave 54 partial reversals. Slot stays
            -- OUT of the debt list while at least one allocation has
            -- SUM(refunded) < amount (still partly paid). A series of
            -- partials that sum to >= amount, or a single full
            -- reversal, flips the slot back to the debt bucket.
            and (
              select coalesce(sum(par.refunded_kopecks), 0)::bigint
                from payment_allocation_reversals par
               where par.payment_order_id = pa.payment_order_id
                 and par.kind = pa.kind
                 and par.target_id = pa.target_id
            ) < pa.amount_kopecks
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
    tariffSlug: r.tariff_slug ? String(r.tariff_slug) : null,
    expectedAmountKopecks:
      r.expected_amount_kopecks !== null && r.expected_amount_kopecks !== undefined
        ? Number(r.expected_amount_kopecks)
        : null,
    legacyGrandfathered: Boolean(r.legacy_grandfathered),
  }))
}

export type AccountPostpaidDebtSummary = {
  accountId: string
  email: string
  displayName: string | null
  // Total of `expected_amount_kopecks` for the account's debt slots
  // — slots with a null tariff (legacy / operator-priced) contribute 0
  // and are surfaced via `slotsWithoutTariff` so the operator can
  // chase them down manually.
  totalDebtKopecks: number
  slotCount: number
  slotsWithoutTariff: number
  // Earliest completed/no-show slot in the debt set — useful for
  // sorting "oldest debt first" when chasing late payers.
  oldestDebtSlotAt: string
}

// Aggregate debt across all learners. Mirrors the predicate in
// `listAccountPostpaidDebt` but groups by `learner_account_id` and
// joins `accounts` for the human-readable label. The CTE pattern
// keeps the predicate-vs-aggregation split readable; the cabinet
// query stays the single point of truth for which slots count as
// debt.
//
// `minKopecks` filters out small/zero balances (e.g. the legacy
// "all slots have null tariff" case where totalDebtKopecks == 0).
// Default 0 surfaces everything; the operator UI passes a threshold
// via the route.
export async function listAccountsWithPostpaidDebtAggregate(opts?: {
  minKopecks?: number
}): Promise<AccountPostpaidDebtSummary[]> {
  const pool = getDbPool()
  const minKopecks = opts?.minKopecks ?? 0
  const result = await pool.query(
    `with debt_slots as (
       select s.learner_account_id,
              s.id as slot_id,
              s.start_at,
              t.amount_kopecks as expected_amount_kopecks
         from lesson_slots s
         left join pricing_tariffs t
                on t.id = s.tariff_id and t.is_active = true
        where s.learner_account_id is not null
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
              and (
                select coalesce(sum(par.refunded_kopecks), 0)::bigint
                  from payment_allocation_reversals par
                 where par.payment_order_id = pa.payment_order_id
                   and par.kind = pa.kind
                   and par.target_id = pa.target_id
              ) < pa.amount_kopecks
          )
     )
     select a.id as account_id,
            a.email,
            ap.display_name,
            coalesce(sum(ds.expected_amount_kopecks), 0)::bigint as total_debt_kopecks,
            count(*)::int as slot_count,
            count(*) filter (where ds.expected_amount_kopecks is null)::int as slots_without_tariff,
            min(ds.start_at) as oldest_debt_slot_at
       from debt_slots ds
       join accounts a on a.id = ds.learner_account_id
       left join account_profiles ap on ap.account_id = a.id
      group by a.id, a.email, ap.display_name
     having coalesce(sum(ds.expected_amount_kopecks), 0) >= $1
      order by total_debt_kopecks desc, oldest_debt_slot_at asc`,
    [minKopecks],
  )
  return result.rows.map((r) => ({
    accountId: String(r.account_id),
    email: String(r.email),
    displayName: r.display_name ? String(r.display_name) : null,
    totalDebtKopecks: Number(r.total_debt_kopecks),
    slotCount: Number(r.slot_count),
    slotsWithoutTariff: Number(r.slots_without_tariff),
    oldestDebtSlotAt: new Date(String(r.oldest_debt_slot_at)).toISOString(),
  }))
}
