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
import { learnerHasActivePackageOfDuration } from '@/lib/billing/packages/eligibility'
import { getDbPool } from '@/lib/db/pool'
import { sendOperatorPackageGrantFailureNotification } from '@/lib/email/dispatch'
import { normalizeEmail } from '@/lib/email/normalize'
import { getOrder } from '@/lib/payments/store'

// Wave 46 — taxonomy cleanup (Codex Wave 12 sweep HIGH 2).
//
// `decrypt_failed` and `no_ciphertext` were declared in v9 design but
// the implementation has always read plaintext `customer_email` from
// the order row — never decrypts. Removing the dead values; keeping
// the seven reasons that the code actually emits.
//
// `package_unknown_or_inactive` is also surfaced as a result kind for
// route-layer differentiation, but it now ALSO produces an audit row
// + operator notification via the same fail-closed path.
export type GrantSemanticFailure =
  | 'no_metadata_accountid'
  | 'metadata_accountid_unknown'
  | 'no_customer_email'
  | 'no_account_match'
  | 'multi_account_match'
  | 'metadata_email_mismatch'
  | 'package_unknown_or_inactive'
  // PKG-ADMIN-GRANT epic-end paranoia BLOCKER #1 (2026-05-16).
  // The webhook grant path runs LONG after the learner-buy lock was
  // released, so a concurrent admin grant for the same
  // (account, duration) can sneak in between. Hitting this means
  // "learner paid but a duplicate active package already exists" —
  // operator must refund the duplicate buyer manually. Treated as a
  // semantic failure (not operational): 200 to CP, no retry, audit row
  // + operator email so the paid-but-not-granted incident is visible.
  | 'already_owns_active_package'

export type GrantResult =
  | { kind: 'granted'; packagePurchaseId: string }
  | { kind: 'already_granted' }
  | { kind: 'semantic_failure'; reason: GrantSemanticFailure }
  | { kind: 'package_unknown_or_inactive'; slug: string }

// Wave 46 review LOW. Actor lives on every audit row this flow
// produces. The default 'webhook:cloudpayments:pay' covers the real
// webhook path; the mock-auto-confirm inline path passes
// 'mock:auto_confirm' so audit reads don't misattribute test/mock
// grants to the webhook surface.
export type PackageGrantActor =
  | 'webhook:cloudpayments:pay'
  | 'mock:auto_confirm'
  // PKG-RECON RECON.0 — operator-driven entry paths for
  // /admin/reconciliation/package-grants. Each path emits a
  // dedicated `payment.grant.*-by-admin` audit row IN ADDITION to
  // the standard `package.grant.succeeded/failed` row from this
  // module, so the audit reader can distinguish "webhook
  // succeeded on its own" vs "admin recovered the grant".
  | 'admin:retry-grant'
  | 'admin:attach-account'

export async function processPackageGrant(
  invoiceId: string,
  options: { actor?: PackageGrantActor } = {},
): Promise<GrantResult> {
  const actor: PackageGrantActor = options.actor ?? 'webhook:cloudpayments:pay'
  const pool = getDbPool()
  const fullOrder = await getOrder(invoiceId)
  if (!fullOrder) {
    // Order vanished between webhook fire and grant attempt — should
    // never happen for an idempotent path, but treat as semantic fail
    // (no_metadata_accountid is the closest enum; "we can't read the
    // order" is permanent for this invoice).
    await audit(invoiceId, null, 'no_metadata_accountid', actor, { hint: 'order_missing' })
    return { kind: 'semantic_failure', reason: 'no_metadata_accountid' }
  }

  const metaAccountId = fullOrder.metadata?.accountId
  const metaPackageSlug = fullOrder.metadata?.packageSlug

  if (typeof metaAccountId !== 'string' || metaAccountId.length === 0) {
    await audit(invoiceId, fullOrder, 'no_metadata_accountid', actor)
    return { kind: 'semantic_failure', reason: 'no_metadata_accountid' }
  }

  // Path A: metadata.accountId → accounts.id.
  const metaRow = await pool.query(
    `select id, email from accounts where id = $1`,
    [metaAccountId],
  )
  if (metaRow.rows.length === 0) {
    await audit(invoiceId, fullOrder, 'metadata_accountid_unknown', actor, {
      metaAccountId,
    })
    return { kind: 'semantic_failure', reason: 'metadata_accountid_unknown' }
  }
  const metaResolvedId = String(metaRow.rows[0].id)

  // Path B: customer_email → accounts.email_normalized.
  const customerEmail = fullOrder.customerEmail
  if (typeof customerEmail !== 'string' || customerEmail.trim().length === 0) {
    await audit(invoiceId, fullOrder, 'no_customer_email', actor)
    return { kind: 'semantic_failure', reason: 'no_customer_email' }
  }
  const normalized = normalizeEmail(customerEmail)
  const emailRow = await pool.query(
    `select id from accounts where email = $1`,
    [normalized],
  )
  if (emailRow.rows.length === 0) {
    await audit(invoiceId, fullOrder, 'no_account_match', actor, {
      normalizedEmail: normalized,
    })
    return { kind: 'semantic_failure', reason: 'no_account_match' }
  }
  if (emailRow.rows.length > 1) {
    await audit(invoiceId, fullOrder, 'multi_account_match', actor, {
      normalizedEmail: normalized,
    })
    return { kind: 'semantic_failure', reason: 'multi_account_match' }
  }
  const emailResolvedId = String(emailRow.rows[0].id)

  // Corroborate.
  if (metaResolvedId !== emailResolvedId) {
    await audit(invoiceId, fullOrder, 'metadata_email_mismatch', actor, {
      metaAccountId: metaResolvedId,
      emailAccountId: emailResolvedId,
    })
    return { kind: 'semantic_failure', reason: 'metadata_email_mismatch' }
  }
  const accountId = metaResolvedId

  if (typeof metaPackageSlug !== 'string') {
    // Should be filtered by caller (only call this fn on package
    // orders), but defensive.
    await audit(invoiceId, fullOrder, 'no_metadata_accountid', actor, {
      hint: 'missing_package_slug',
    })
    return { kind: 'semantic_failure', reason: 'no_metadata_accountid' }
  }
  const pkg = await getPackageBySlug(metaPackageSlug)
  if (!pkg || !pkg.isActive) {
    // Wave 46 — was a silent 200-path failure (no audit, no email).
    // The operator now sees both an audit row AND a Resend dispatch
    // so they can react to a paid-but-not-granted incident.
    await audit(invoiceId, fullOrder, 'package_unknown_or_inactive', actor, {
      slug: metaPackageSlug,
      reason: !pkg ? 'not_found' : 'inactive',
    })
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

    // PKG-ADMIN-GRANT epic-end paranoia BLOCKER #1 (2026-05-16).
    // Acquire the shared `pkg-stack:` advisory lock so the webhook
    // grant path serialises against concurrent admin grants AND
    // learner-buy POSTs on the same (account, duration). Without this
    // lock the webhook can race an admin grant that committed between
    // the learner's buy POST (which released its own short lock at
    // commit time) and now — both would call createPackagePurchase,
    // both would succeed (different invoice_ids → no UNIQUE conflict),
    // and the learner ends up with two active packages of the same
    // duration in violation of the anti-stacking invariant.
    await client.query(
      `select pg_advisory_xact_lock(hashtextextended('pkg-stack:' || $1 || ':' || $2, 0))`,
      [accountId, pkg.durationMinutes],
    )

    // Replay check first: did we already create a purchase for THIS
    // exact invoice_id? Webhook retries / mock-auto-confirm re-runs
    // are routine and MUST be idempotent. Without this branch, the
    // ownedActive check below would fire on the package we just
    // created on the previous attempt and mis-classify the replay as
    // `already_owns_active_package`. Ordering is load-bearing.
    const replayRow = await client.query(
      `select id from package_purchases where payment_order_id = $1`,
      [invoiceId],
    )
    if (replayRow.rows.length > 0) {
      await client.query('commit')
      // Wave 46 — audit the replay. Operator breadcrumb so
      // "package granted twice" investigations can spot the second
      // hit and confirm it's an idempotent no-op, not a real grant.
      await auditSucceeded(invoiceId, fullOrder, actor, String(replayRow.rows[0].id), {
        replay: true,
      })
      return { kind: 'already_granted' }
    }

    const ownedActive = await learnerHasActivePackageOfDuration(
      accountId,
      pkg.durationMinutes,
    )
    if (ownedActive) {
      // Commit so the audit row written below is not blocked behind
      // the still-open lock TX. The grant itself is suppressed.
      await client.query('commit')
      await audit(invoiceId, fullOrder, 'already_owns_active_package', actor, {
        existingPurchaseId: ownedActive.purchaseId,
        existingTitleSnapshot: ownedActive.titleSnapshot,
        durationMinutes: pkg.durationMinutes,
      })
      return { kind: 'semantic_failure', reason: 'already_owns_active_package' }
    }

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
      // UNIQUE on payment_order_id rejected — should be unreachable
      // given the replayRow check above + the held lock, but if it
      // ever fires, treat it as a replay (the row landed during the
      // microsecond between our SELECT and our INSERT).
      await client.query('commit')
      await auditSucceeded(invoiceId, fullOrder, actor, null, { replay: true })
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
    // Wave 46 — emit the success event. The enum (migration 0034 +
    // lib/audit/payment-events.ts) reserved 'package.grant.succeeded'
    // but no callsite emitted it. Now the operator gets a positive
    // audit signal mirroring 'package.grant.failed' on every grant.
    await auditSucceeded(invoiceId, fullOrder, actor, purchase.id, { replay: false })
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
    // mock-auto-confirm path. Actor labels distinguish inline test/
    // mock grants from real webhook deliveries in audit reads.
    await processPackageGrant(invoiceId, { actor: 'mock:auto_confirm' })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[package.grant.inline] failed:', {
      invoiceId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

// Wave 46 — emits the 'package.grant.succeeded' audit row reserved in
// migration 0034 + lib/audit/payment-events.ts but never written until
// now. Called on both the fresh-grant and idempotent-replay branches
// so the operator gets matching breadcrumbs for every webhook fire.
async function auditSucceeded(
  invoiceId: string,
  fullOrder: Awaited<ReturnType<typeof getOrder>> | null,
  actor: PackageGrantActor,
  packagePurchaseId: string | null,
  extra?: Record<string, unknown>,
): Promise<void> {
  try {
    await recordPaymentAuditEvent({
      eventType: 'package.grant.succeeded',
      invoiceId,
      customerEmail: fullOrder?.customerEmail ?? null,
      amountKopecks: fullOrder?.amountRub ? rublesToKopecks(fullOrder.amountRub) : 0,
      toStatus: 'paid',
      actor,
      payload: { packagePurchaseId, ...(extra ?? {}) },
    })
  } catch (err) {
    // Audit is best-effort. A failure here MUST NOT roll back a
    // successful grant — the operator can recover from a missing
    // audit row, but a rolled-back grant means the learner paid and
    // got nothing.
    // eslint-disable-next-line no-console
    console.warn('[package.grant.audit.success] failed:', {
      invoiceId,
      packagePurchaseId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

async function audit(
  invoiceId: string,
  fullOrder: Awaited<ReturnType<typeof getOrder>> | null,
  reason: GrantSemanticFailure,
  actor: PackageGrantActor,
  extra?: Record<string, unknown>,
): Promise<void> {
  await recordPaymentAuditEvent({
    eventType: 'package.grant.failed',
    invoiceId,
    customerEmail: fullOrder?.customerEmail ?? null,
    amountKopecks: fullOrder?.amountRub ? rublesToKopecks(fullOrder.amountRub) : 0,
    toStatus: 'paid',
    actor,
    payload: { reason, ...(extra ?? {}) },
  })

  // Wave 15 — operator email on every semantic-failure path.
  // Best-effort: a Resend outage (or missing OPERATOR_NOTIFY_EMAIL)
  // must not turn a 200-no-retry semantic into a 5xx-retry. The audit
  // row above is the load-bearing record; this email is the human
  // signal on top.
  try {
    await sendOperatorPackageGrantFailureNotification({
      invoiceId,
      packageSlug:
        typeof fullOrder?.metadata?.packageSlug === 'string'
          ? fullOrder.metadata.packageSlug
          : null,
      customerEmail: fullOrder?.customerEmail ?? null,
      amountRub: fullOrder?.amountRub ?? null,
      reason,
      reasonHint:
        extra && Object.keys(extra).length > 0
          ? JSON.stringify(extra)
          : undefined,
    })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[package.grant.email] dispatch failed:', {
      invoiceId,
      reason,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
