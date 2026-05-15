import { describe, expect, it } from 'vitest'

import {
  checkAccountInFlightPackageGrant,
} from '@/lib/billing/deletion-guard'
import {
  findPaidNotGrantedForAccount,
  listPaidNotGrantedOrders,
} from '@/lib/billing/paid-not-granted'
import {
  createAccount,
  markAccountVerified,
  normalizeAccountEmail,
} from '@/lib/auth/accounts'
import { hashPassword } from '@/lib/auth/password'
import { getDbPool } from '@/lib/db/pool'

import '../setup'
import { freshInvoiceId } from '../helpers'

// PKG-RECON RECON.0 — drift detector for paid_not_granted predicate.
// Pins three consumers of the predicate to the same row set:
//   1. listPaidNotGrantedOrders (operator-wide list view).
//   2. findPaidNotGrantedForAccount (per-account helper).
//   3. checkAccountInFlightPackageGrant Branch B (deletion-guard).
//
// Round 1 WARN #11 + round 2 BLOCKER #8 closure.

async function makeLearner(email: string): Promise<string> {
  const account = await createAccount({
    email: normalizeAccountEmail(email),
    passwordHash: await hashPassword('StrongPassword123'),
  })
  await markAccountVerified(account.id)
  return account.id
}

async function insertPaidPackageOrderWithoutPurchase(opts: {
  accountId: string
  email: string
}): Promise<string> {
  const pool = getDbPool()
  const invoiceId = freshInvoiceId('lc_pnt')
  // Insert a paid package order with NO matching package_purchases.
  await pool.query(
    `insert into payment_orders
       (invoice_id, amount_rub, currency, status, provider, description,
        customer_email, receipt, receipt_email, metadata, paid_at,
        created_at, updated_at)
     values
       ($1, 3500, 'RUB', 'paid', 'mock', 'package test',
        $2, '{}'::jsonb, $2, $3::jsonb, now(),
        now(), now())`,
    [
      invoiceId,
      opts.email,
      JSON.stringify({
        accountId: opts.accountId,
        packageSlug: 'lessons-10',
      }),
    ],
  )
  return invoiceId
}

describe('paid_not_granted predicate drift (three consumers agree)', () => {
  it('paid package order without package_purchases: ALL THREE consumers see it', async () => {
    const id = await makeLearner('pnt-1@example.com')
    const invoiceId = await insertPaidPackageOrderWithoutPurchase({
      accountId: id,
      email: 'pnt-1@example.com',
    })

    // (1) list view
    const list = await listPaidNotGrantedOrders({ limit: 200 })
    expect(list.rows.some((r) => r.invoiceId === invoiceId)).toBe(true)

    // (2) per-account helper
    const perAccount = await findPaidNotGrantedForAccount(getDbPool(), id)
    expect(perAccount).toBe(invoiceId)

    // (3) deletion-guard branch B
    const guard = await checkAccountInFlightPackageGrant(getDbPool(), id)
    expect(guard.inFlight).toBe(true)
    expect(guard.reason).toBe('paid_not_granted')
    expect(guard.sampleInvoiceId).toBe(invoiceId)
  })

  it('package_grant_resolutions row hides the order from ALL THREE consumers (unblocks deletion)', async () => {
    const id = await makeLearner('pnt-resolved@example.com')
    const invoiceId = await insertPaidPackageOrderWithoutPurchase({
      accountId: id,
      email: 'pnt-resolved@example.com',
    })
    // Sanity: appears before resolution.
    const before = await listPaidNotGrantedOrders({ limit: 200 })
    expect(before.rows.some((r) => r.invoiceId === invoiceId)).toBe(true)

    // Operator marks it resolved.
    const operator = await makeLearner('pnt-resolved-op@example.com')
    await getDbPool().query(
      `insert into package_grant_resolutions
         (invoice_id, resolved_by_account_id, resolution, reason)
       values ($1, $2, 'marked_resolved_manually', 'Refunded out-of-band via CP dashboard, tx 12345')`,
      [invoiceId, operator],
    )

    // All three consumers now skip the row.
    const list = await listPaidNotGrantedOrders({ limit: 200 })
    expect(list.rows.some((r) => r.invoiceId === invoiceId)).toBe(false)

    const perAccount = await findPaidNotGrantedForAccount(getDbPool(), id)
    expect(perAccount).toBe(null)

    const guard = await checkAccountInFlightPackageGrant(getDbPool(), id)
    expect(guard.reason).not.toBe('paid_not_granted')
  })

  it('non-UUID metadata.accountId does NOT crash the list (no ::uuid cast)', async () => {
    // Insert a paid package order with a junk accountId in metadata.
    // Pre-fix: ::uuid cast would crash the SELECT.
    const pool = getDbPool()
    const invoiceId = freshInvoiceId('lc_pnt_junk')
    await pool.query(
      `insert into payment_orders
         (invoice_id, amount_rub, currency, status, provider, description,
          customer_email, receipt, receipt_email, metadata, paid_at,
          created_at, updated_at)
       values
         ($1, 3500, 'RUB', 'paid', 'mock', 'package test junk',
          'junkemail@example.com', '{}'::jsonb, 'junkemail@example.com',
          $2::jsonb, now(), now(), now())`,
      [
        invoiceId,
        JSON.stringify({
          accountId: 'this-is-not-a-uuid',
          packageSlug: 'lessons-10',
        }),
      ],
    )
    // List must succeed and include this row.
    const list = await listPaidNotGrantedOrders({ limit: 200 })
    expect(list.rows.some((r) => r.invoiceId === invoiceId)).toBe(true)
  })
})
