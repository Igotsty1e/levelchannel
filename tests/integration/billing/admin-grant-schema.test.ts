import { describe, expect, it } from 'vitest'

import { getAccountByEmail, markAccountVerified } from '@/lib/auth/accounts'
import { POST as registerHandler } from '@/app/api/auth/register/route'
import { getDbPool } from '@/lib/db/pool'

import '../setup'
import { buildRequest, freshInvoiceId } from '../helpers'

// PKG-ADMIN-GRANT LBL.0 — schema invariants (migration 0051).
//
// The triple-CHECK constraint enforces that an admin-grant row is
// always identifiable by ALL three signals (provider, status,
// granted_by_operator_id). This test pins the CHECK from both
// directions:
//   - admin_grant + granted + non-null operator → OK
//   - admin_grant + paid + non-null operator → reject
//   - cloudpayments + paid + non-null operator → reject
//   - admin_grant + granted + null operator → reject
//   - cloudpayments + granted + null operator → reject (status='granted'
//     is admin-grant-only)

async function makeOperator(emailPrefix: string): Promise<string> {
  const email = `${emailPrefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
  await registerHandler(
    buildRequest('/api/auth/register', {
      body: { email, password: 'StrongPassword123', personalDataConsentAccepted: true },
    }),
  )
  const acc = await getAccountByEmail(email)
  await markAccountVerified(acc!.id)
  return acc!.id
}

async function insertOrder(opts: {
  provider: string
  status: string
  grantedByOperatorId: string | null
  customerEmail?: string
  // SAAS-PIVOT Epic 3 Day 4 (mig 0090) — quadruple-CHECK requires
  // payment_method symmetry. Callers that don't set it explicitly fall
  // back to the bucket-default: 'admin_grant' for admin-grant rows,
  // null otherwise (money path allows null).
  paymentMethod?: string | null
}): Promise<string> {
  const invoiceId = freshInvoiceId('lc_admgrant')
  const paymentMethod =
    opts.paymentMethod !== undefined
      ? opts.paymentMethod
      : opts.provider === 'admin_grant'
        ? 'admin_grant'
        : null
  await getDbPool().query(
    `insert into payment_orders (
       invoice_id, amount_rub, currency, description, provider, status,
       created_at, updated_at, customer_email, receipt_email, receipt,
       granted_by_operator_id, payment_method
     ) values (
       $1, 100, 'RUB', 'schema test', $2, $3,
       now(), now(), $4, $4, '{}'::jsonb, $5::uuid, $6
     )`,
    [
      invoiceId,
      opts.provider,
      opts.status,
      opts.customerEmail ?? 'schema-test@example.com',
      opts.grantedByOperatorId,
      paymentMethod,
    ],
  )
  return invoiceId
}

describe('payment_orders admin_grant triple-CHECK (migration 0051)', () => {
  it('accepts admin_grant + granted + non-null operator', async () => {
    const operatorId = await makeOperator('admgrant-ok')
    const invoiceId = await insertOrder({
      provider: 'admin_grant',
      status: 'granted',
      grantedByOperatorId: operatorId,
    })
    const row = await getDbPool().query(
      `select provider, status, granted_by_operator_id from payment_orders where invoice_id = $1`,
      [invoiceId],
    )
    expect(row.rows[0].provider).toBe('admin_grant')
    expect(row.rows[0].status).toBe('granted')
    expect(row.rows[0].granted_by_operator_id).toBe(operatorId)
  })

  it('rejects admin_grant + paid + operator (status must be granted)', async () => {
    const operatorId = await makeOperator('admgrant-bad-status')
    await expect(
      insertOrder({
        provider: 'admin_grant',
        status: 'paid',
        grantedByOperatorId: operatorId,
      }),
    ).rejects.toThrow(/payment_orders_grant_consistency/)
  })

  it('rejects cloudpayments + paid + non-null operator (operator only on admin grants)', async () => {
    const operatorId = await makeOperator('admgrant-bad-provider')
    await expect(
      insertOrder({
        provider: 'cloudpayments',
        status: 'paid',
        grantedByOperatorId: operatorId,
      }),
    ).rejects.toThrow(/payment_orders_grant_consistency/)
  })

  it('rejects admin_grant + granted + null operator (operator required on admin grants)', async () => {
    await expect(
      insertOrder({
        provider: 'admin_grant',
        status: 'granted',
        grantedByOperatorId: null,
      }),
    ).rejects.toThrow(/payment_orders_grant_consistency/)
  })

  it('rejects cloudpayments + granted (status granted is admin-grant-only)', async () => {
    await expect(
      insertOrder({
        provider: 'cloudpayments',
        status: 'granted',
        grantedByOperatorId: null,
      }),
    ).rejects.toThrow(/payment_orders_grant_consistency/)
  })

  it('rejects unknown provider (taxonomy CHECK)', async () => {
    await expect(
      insertOrder({
        provider: 'wechat_pay',
        status: 'paid',
        grantedByOperatorId: null,
      }),
    ).rejects.toThrow(/payment_orders_provider_check/)
  })

  it('rejects unknown status (taxonomy CHECK)', async () => {
    await expect(
      insertOrder({
        provider: 'cloudpayments',
        status: 'refunded',
        grantedByOperatorId: null,
      }),
    ).rejects.toThrow(/payment_orders_status_check/)
  })

  it('paid_not_granted query does NOT include admin grants', async () => {
    const operatorId = await makeOperator('admgrant-pnotgranted')
    await insertOrder({
      provider: 'admin_grant',
      status: 'granted',
      grantedByOperatorId: operatorId,
      customerEmail: `pnotgranted-target-${Date.now()}@example.com`,
    })
    // The paid_not_granted predicate filters on status='paid', so
    // admin grants (status='granted') are invisible by construction.
    // This test asserts the new schema didn't accidentally surface
    // them.
    const { listPaidNotGrantedOrders } = await import(
      '@/lib/billing/paid-not-granted'
    )
    const result = await listPaidNotGrantedOrders({ limit: 100 })
    expect(
      result.rows.find((r) =>
        r.customerEmail?.startsWith('pnotgranted-target-'),
      ),
    ).toBeUndefined()
  })
})
