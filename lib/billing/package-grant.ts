// Billing wave PR 2 — package-grant flow.
//
// The CloudPayments `pay.processed` webhook AND the mock-auto-confirm
// path both call this helper. It implements the dual-source ownership
// corroboration contract from design v9 (Codex round 5):
//
//   Path A: metadata.accountId → accounts.id lookup
//   Path B: customer_email → accounts.email_normalized lookup
//   BOTH paths must resolve to the same account; mismatch = fail-closed.
//
// Permanent semantic failures (seven enumerated reasons) → audit
// `payment.grant.failed/<reason>` event + return without throwing.
// The HTTP layer caller maps "no-throw" to 200 (no retry).
//
// Operational failures (DB outage, lock timeout, tx abort) throw →
// HTTP layer caller maps to 5xx → CloudPayments retries. This split
// is the load-bearing invariant from Codex round 5 MEDIUM.

import { recordPaymentAuditEvent, rublesToKopecks } from '@/lib/audit/payment-events'
import { createPackagePurchase, getPackageBySlug } from '@/lib/billing/packages'
import { getDbPool } from '@/lib/db/pool'
import { getOrder } from '@/lib/payments/store'

export type GrantSemanticFailure =
  | 'no_metadata_accountid'
  | 'metadata_accountid_unknown'
  | 'no_ciphertext'
  | 'decrypt_failed'
  | 'no_account_match'
  | 'multi_account_match'
  | 'metadata_email_mismatch'

export type GrantResult =
  | { kind: 'granted'; packagePurchaseId: string }
  | { kind: 'already_granted' }
  | { kind: 'semantic_failure'; reason: GrantSemanticFailure }
  | { kind: 'package_unknown_or_inactive'; slug: string }

export async function processPackageGrant(
  invoiceId: string,
): Promise<GrantResult> {
  const pool = getDbPool()
  const fullOrder = await getOrder(invoiceId)
  if (!fullOrder) {
    // Order vanished between webhook fire and grant attempt — should
    // never happen for an idempotent path, but treat as semantic fail
    // (no_metadata_accountid is the closest enum; "we can't read the
    // order" is permanent for this invoice).
    await audit(invoiceId, null, 'no_metadata_accountid', { hint: 'order_missing' })
    return { kind: 'semantic_failure', reason: 'no_metadata_accountid' }
  }

  const metaAccountId = fullOrder.metadata?.accountId
  const metaPackageSlug = fullOrder.metadata?.packageSlug

  if (typeof metaAccountId !== 'string' || metaAccountId.length === 0) {
    await audit(invoiceId, fullOrder, 'no_metadata_accountid')
    return { kind: 'semantic_failure', reason: 'no_metadata_accountid' }
  }

  // Path A: metadata.accountId → accounts.id.
  const metaRow = await pool.query(
    `select id, email from accounts where id = $1`,
    [metaAccountId],
  )
  if (metaRow.rows.length === 0) {
    await audit(invoiceId, fullOrder, 'metadata_accountid_unknown', {
      metaAccountId,
    })
    return { kind: 'semantic_failure', reason: 'metadata_accountid_unknown' }
  }
  const metaResolvedId = String(metaRow.rows[0].id)

  // Path B: customer_email → accounts.email_normalized.
  const customerEmail = fullOrder.customerEmail
  if (typeof customerEmail !== 'string' || customerEmail.trim().length === 0) {
    await audit(invoiceId, fullOrder, 'no_ciphertext')
    return { kind: 'semantic_failure', reason: 'no_ciphertext' }
  }
  const normalized = customerEmail.trim().toLowerCase()
  const emailRow = await pool.query(
    `select id from accounts where email = $1`,
    [normalized],
  )
  if (emailRow.rows.length === 0) {
    await audit(invoiceId, fullOrder, 'no_account_match', {
      normalizedEmail: normalized,
    })
    return { kind: 'semantic_failure', reason: 'no_account_match' }
  }
  if (emailRow.rows.length > 1) {
    await audit(invoiceId, fullOrder, 'multi_account_match', {
      normalizedEmail: normalized,
    })
    return { kind: 'semantic_failure', reason: 'multi_account_match' }
  }
  const emailResolvedId = String(emailRow.rows[0].id)

  // Corroborate.
  if (metaResolvedId !== emailResolvedId) {
    await audit(invoiceId, fullOrder, 'metadata_email_mismatch', {
      metaAccountId: metaResolvedId,
      emailAccountId: emailResolvedId,
    })
    return { kind: 'semantic_failure', reason: 'metadata_email_mismatch' }
  }
  const accountId = metaResolvedId

  if (typeof metaPackageSlug !== 'string') {
    // Should be filtered by caller (only call this fn on package
    // orders), but defensive.
    await audit(invoiceId, fullOrder, 'no_metadata_accountid', {
      hint: 'missing_package_slug',
    })
    return { kind: 'semantic_failure', reason: 'no_metadata_accountid' }
  }
  const pkg = await getPackageBySlug(metaPackageSlug)
  if (!pkg || !pkg.isActive) {
    return { kind: 'package_unknown_or_inactive', slug: metaPackageSlug }
  }

  // expires_at = paid_at + 6 months. Read paid_at from the order
  // row directly (it was set by markOrderPaid inside the webhook,
  // OR by the mock-auto-confirm path's INSERT).
  const paidAtRow = await pool.query(
    `select paid_at from payment_orders where invoice_id = $1`,
    [invoiceId],
  )
  const paidAt = paidAtRow.rows[0]?.paid_at
    ? new Date(String(paidAtRow.rows[0].paid_at))
    : new Date()
  const expiresAt = new Date(paidAt.getTime() + 180 * 24 * 60 * 60_000)

  const client = await pool.connect()
  try {
    await client.query('begin')
    const purchase = await createPackagePurchase(client, {
      accountId,
      packageId: pkg.id,
      paymentOrderId: invoiceId,
      amountKopecks: pkg.amountKopecks,
      titleSnapshot: pkg.titleRu,
      durationMinutes: pkg.durationMinutes,
      countInitial: pkg.count,
      expiresAt,
    })
    if (!purchase) {
      // UNIQUE on payment_order_id rejected — already granted, no-op.
      await client.query('commit')
      return { kind: 'already_granted' }
    }
    await client.query(
      `insert into payment_allocations
         (payment_order_id, kind, target_id, amount_kopecks)
       values ($1, 'package', $2, $3)
       on conflict (payment_order_id, kind, target_id) do nothing`,
      [invoiceId, purchase.id, pkg.amountKopecks],
    )
    await client.query('commit')
    return { kind: 'granted', packagePurchaseId: purchase.id }
  } catch (e) {
    await client.query('rollback').catch(() => {})
    throw e // operational failure → HTTP layer maps to 5xx → CP retries
  } finally {
    client.release()
  }
}

// Wrapper for the mock-auto-confirm path. Same flow as the webhook,
// but called inline at order-init time so test integration can
// observe the grant in one round-trip. Logs but does not rethrow on
// any failure (mock path is best-effort and tests assert via DB
// state).
export async function processPackageGrantInline(
  invoiceId: string,
): Promise<void> {
  try {
    await processPackageGrant(invoiceId)
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[package.grant.inline] failed:', {
      invoiceId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

async function audit(
  invoiceId: string,
  fullOrder: Awaited<ReturnType<typeof getOrder>> | null,
  reason: GrantSemanticFailure,
  extra?: Record<string, unknown>,
): Promise<void> {
  await recordPaymentAuditEvent({
    eventType: 'package.grant.failed',
    invoiceId,
    customerEmail: fullOrder?.customerEmail ?? null,
    amountKopecks: fullOrder?.amountRub ? rublesToKopecks(fullOrder.amountRub) : 0,
    toStatus: 'paid',
    actor: 'webhook:cloudpayments:pay',
    payload: { reason, ...(extra ?? {}) },
  })
}
