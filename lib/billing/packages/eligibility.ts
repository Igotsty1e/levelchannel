import { getDbPool } from '@/lib/db/pool'

// PKG-LEARNER-BUY LBL.0 — learner-buy eligibility predicates.
//
// `learnerHasActivePackageOfDuration` is the "already-owns-active-
// package" gate for /api/checkout/package/[slug]/route.ts. The
// predicate MUST stay logically identical to the WHERE-fragment
// inside `lib/billing/packages/purchases.ts:listAccountActivePackages`
// — that's the SoT for "is a package active for this account?".
//
// Excluded conditions (purchase fails predicate when ANY holds):
//   - voided_at IS NOT NULL  (refunded; cabinet hides it)
//   - expires_at <= now()    (6-month expiry exhausted)
//   - count_remaining <= 0   (every unit consumed)
//
// Drift test in `tests/integration/billing/learner-buy-eligibility.test.ts`
// pins this predicate against `listAccountActivePackages` so a divergence
// (e.g. someone adds a new exclusion to listAccountActivePackages and
// forgets to mirror here) is caught at CI time.

export type ActiveOwnedPackage = {
  purchaseId: string
  packageId: string
  titleSnapshot: string
  durationMinutes: number
  countRemaining: number
  expiresAt: string
}

export async function learnerHasActivePackageOfDuration(
  accountId: string,
  durationMinutes: number,
): Promise<ActiveOwnedPackage | null> {
  // Epic-end paranoia round 1 BLOCKER #1 closure: the count_remaining
  // > 0 filter MUST be in SQL, not in JS. The earlier shape
  //   `order by expires_at asc limit 1` + JS-side `count_remaining <= 0`
  // was wrong: if a learner has an EARLIER exhausted purchase + a
  // LATER active one of the same duration, LIMIT 1 picks the earlier
  // exhausted row, JS drops it, helper returns null — and the anti-
  // stacking gate falsely admits a third buy. Fix: filter
  // `count_remaining > 0` in SQL via a duplicated correlated subquery,
  // then LIMIT 1.
  const pool = getDbPool()
  const result = await pool.query(
    `select pp.id,
            pp.package_id,
            pp.title_snapshot,
            pp.duration_minutes,
            pp.expires_at,
            pp.count_initial - (
              select count(*) from package_consumptions pc
               where pc.package_purchase_id = pp.id
                 and pc.restored_at is null
            ) as count_remaining
       from package_purchases pp
      where pp.account_id = $1::uuid
        and pp.duration_minutes = $2::int
        and pp.voided_at is null
        and pp.expires_at > now()
        and pp.count_initial - (
          select count(*) from package_consumptions pc
           where pc.package_purchase_id = pp.id
             and pc.restored_at is null
        ) > 0
      order by pp.expires_at asc
      limit 1`,
    [accountId, durationMinutes],
  )
  if (result.rows.length === 0) return null
  const row = result.rows[0] as Record<string, unknown>
  return {
    purchaseId: String(row.id),
    packageId: String(row.package_id),
    titleSnapshot: String(row.title_snapshot),
    durationMinutes: Number(row.duration_minutes),
    countRemaining: Number(row.count_remaining),
    expiresAt: new Date(String(row.expires_at)).toISOString(),
  }
}
