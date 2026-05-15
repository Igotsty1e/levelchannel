// PKG-RECON wave RECON.0 — shared `paid_not_granted` detection.
//
// Single source of truth for "find paid orders that the package-grant
// flow couldn't complete." Previously this predicate was duplicated
// in `lib/billing/deletion-guard.ts` (per-account Branch B) — round 1
// WARN #11 + round 2 BLOCKER #8 closure.
//
// Definition: a `payment_orders` row is "paid_not_granted" iff
//   1. status = 'paid'
//   2. metadata.packageSlug IS NOT NULL (i.e. it's a package order)
//   3. NO `package_purchases` row references the invoice
//   4. NO `package_grant_resolutions` row references the invoice
//      (operator-resolved orders DROP OUT of the list — round 2
//      BLOCKER #2 closure).
//
// IMPORTANT: comparisons use `metadata->>'accountId'` as TEXT — NO
// `::uuid` cast (round 1 BLOCKER #8 closure). One poisoned non-UUID
// row would otherwise crash the entire operator list.

import type { Pool, PoolClient } from 'pg'

import { getDbPool } from '@/lib/db/pool'

// SQL WHERE-clause fragment for use anywhere this predicate is needed.
// Caller aliases the payment_orders table as `po`. NO trailing AND.
//
// Drift test at tests/integration/billing/paid-not-granted.test.ts
// pins this fragment + the per-account branch in deletion-guard.ts +
// the listing helper below to identical row sets.
export const PAID_NOT_GRANTED_WHERE_SQL = `
  po.status = 'paid'
  and po.metadata->>'packageSlug' is not null
  and not exists (
    select 1 from package_purchases pp
     where pp.payment_order_id = po.invoice_id
  )
  and not exists (
    select 1 from package_grant_resolutions r
     where r.invoice_id = po.invoice_id
  )
`

export type PaidNotGrantedRow = {
  invoiceId: string
  customerEmail: string | null
  amountRub: number
  paidAt: string
  metaAccountId: string | null
  metaAccountEmail: string | null
  emailAccountId: string | null
  metaPackageSlug: string | null
  lastFailureReason: string | null
}

// Operator-wide list. Used by the new GET
// /api/admin/reconciliation/package-grants endpoint.
export async function listPaidNotGrantedOrders(opts: {
  limit?: number
  offset?: number
}): Promise<{ rows: PaidNotGrantedRow[]; total: number }> {
  const pool = getDbPool()
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200)
  const offset = Math.max(opts.offset ?? 0, 0)

  const rowsResult = await pool.query(
    `select po.invoice_id,
            po.customer_email,
            po.amount_rub,
            po.paid_at,
            po.metadata->>'accountId' as meta_account_id,
            po.metadata->>'packageSlug' as meta_package_slug,
            (
              select a.email::text
                from accounts a
               where a.id::text = po.metadata->>'accountId'
               limit 1
            ) as meta_account_email,
            (
              select a.id::text
                from accounts a
               where a.email = lower(trim(po.customer_email))
               limit 1
            ) as email_account_id,
            (
              select ae.payload->>'reason'
                from payment_audit_events ae
               where ae.invoice_id = po.invoice_id
                 and ae.event_type = 'package.grant.failed'
               order by ae.created_at desc
               limit 1
            ) as last_failure_reason
       from payment_orders po
      where ${PAID_NOT_GRANTED_WHERE_SQL}
      order by po.paid_at desc
      limit $1 offset $2`,
    [limit, offset],
  )
  const countResult = await pool.query(
    `select count(*)::int as n
       from payment_orders po
      where ${PAID_NOT_GRANTED_WHERE_SQL}`,
  )
  return {
    rows: rowsResult.rows.map((r) => ({
      invoiceId: String(r.invoice_id),
      customerEmail: r.customer_email ? String(r.customer_email) : null,
      amountRub: Number(r.amount_rub),
      paidAt: new Date(String(r.paid_at)).toISOString(),
      metaAccountId: r.meta_account_id ? String(r.meta_account_id) : null,
      metaAccountEmail: r.meta_account_email ? String(r.meta_account_email) : null,
      emailAccountId: r.email_account_id ? String(r.email_account_id) : null,
      metaPackageSlug: r.meta_package_slug ? String(r.meta_package_slug) : null,
      lastFailureReason: r.last_failure_reason ? String(r.last_failure_reason) : null,
    })),
    total: Number(countResult.rows[0]?.n ?? 0),
  }
}

// Per-account branch B helper. Replaces the inline SQL in
// `lib/billing/deletion-guard.ts:checkAccountInFlightPackageGrant`
// Branch B subquery. Returns sample invoice_id if a paid_not_granted
// order exists for the given account (matched via meta accountId
// OR email), else null.
export async function findPaidNotGrantedForAccount(
  conn: Pool | PoolClient,
  accountId: string,
): Promise<string | null> {
  const result = await conn.query(
    `select po.invoice_id
       from payment_orders po
      where (
        po.metadata->>'accountId' = $1
        or po.customer_email = (
          select a.email from accounts a where a.id = $1::uuid limit 1
        )
      )
        and ${PAID_NOT_GRANTED_WHERE_SQL}
      order by po.created_at asc
      limit 1`,
    [accountId],
  )
  return result.rows.length > 0 ? String(result.rows[0].invoice_id) : null
}
