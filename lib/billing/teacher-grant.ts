// SAAS-PIVOT Epic 3 Day 4 (2026-05-22) — teacher-driven package grant +
// revoke flow.
//
// Plan: docs/plans/saas-pivot-master.md §3 Epic 3 (teacher-owned
// packages) + §2.1 row 0087 (teacher_grant provider).
//
// Sibling of `lib/billing/package-grant.ts` (webhook) and the
// `/admin/packages/[id]/grant` route. Teacher-driven grants:
//   - NON-money: never touches CloudPayments; never books a
//     payment_allocation_reversals row on revoke.
//   - Single TX writes payment_orders + package_purchases +
//     payment_allocations (kind='package'). Rollback on any error.
//   - Status pair: 'teacher_granted' (live) / 'teacher_revoked'
//     (voided). Quadruple-CHECK in mig 0087 enforces the consistency
//     between provider/status/payment_method/granted_by_teacher_id.
//   - Anti-spoof: every write re-checks teacher_id ownership
//     server-side; the route layer is the first gate but the helper
//     re-verifies.
//   - Anti-stacking: shared 'pkg-stack:' advisory-lock prefix with
//     learner-buy + admin-grant + webhook (round-29 BLOCKER closure).

import { randomBytes } from 'crypto'

import {
  recordPaymentAuditEvent,
  rublesToKopecks,
} from '@/lib/audit/payment-events'
import {
  createPackagePurchase,
  getPackageById,
  learnerHasActivePackageOfDuration,
} from '@/lib/billing/packages'
import { restoreAllConsumptionsForPurchase } from '@/lib/billing/consumption'
import { getDbPool } from '@/lib/db/pool'

export const PACKAGE_EXPIRY_DAYS = 180

export type TeacherGrantResult =
  | {
      kind: 'granted'
      invoiceId: string
      purchaseId: string
      expiresAt: string
      titleSnapshot: string
      count: number
    }
  | { kind: 'package_not_found' }
  | { kind: 'package_inactive' }
  | { kind: 'package_not_owned' }
  | { kind: 'learner_not_linked' }
  | { kind: 'learner_account_missing' }
  | { kind: 'already_owns_active_package'; existingPurchaseId: string; titleSnapshot: string }

export type TeacherRevokeResult =
  | { kind: 'revoked'; restoredConsumptions: number }
  | { kind: 'order_not_found' }
  | { kind: 'order_not_teacher_grant' }
  | { kind: 'order_not_owned_by_teacher' }
  | { kind: 'already_revoked' }
  | { kind: 'has_completed_consumptions' }
  | { kind: 'purchase_not_found' }

/**
 * Issue a NON-money package grant from `teacherAccountId` to
 * `learnerAccountId`. The caller is responsible for:
 *   - authenticating the teacher,
 *   - verifying the learner is in the teacher's link set,
 *   - rate-limiting at the route layer.
 * This helper re-asserts package ownership (`pkg.teacherId ===
 * teacherAccountId`) and the link-set membership (`linkExists()` SQL
 * fragment) defensively before any write.
 *
 * `allowStacking` mirrors the admin-grant route's contract: by
 * default the helper refuses if the learner already owns an active
 * package of the same duration; passing true lets the teacher
 * stack (e.g. comp / make-good after a refund).
 */
export async function issueTeacherPackageGrant(args: {
  teacherAccountId: string
  learnerAccountId: string
  packageId: string
  reason?: string | null
  allowStacking?: boolean
}): Promise<TeacherGrantResult> {
  const pool = getDbPool()
  const pkg = await getPackageById(args.packageId)
  if (!pkg) return { kind: 'package_not_found' }
  if (!pkg.isActive) return { kind: 'package_inactive' }
  if (pkg.teacherId !== args.teacherAccountId) {
    // Anti-spoof: caller authenticated as teacher A but the package
    // belongs to teacher B. Treat as not-found from the caller's
    // perspective so we don't leak whose catalog the id belongs to.
    return { kind: 'package_not_owned' }
  }

  // Verify link membership. Active link only — soft-unlinked rows
  // mean the teacher no longer manages the learner.
  const linkRow = await pool.query(
    `select 1
       from learner_teacher_links
      where teacher_account_id = $1::uuid
        and learner_account_id = $2::uuid
        and unlinked_at is null
      limit 1`,
    [args.teacherAccountId, args.learnerAccountId],
  )
  if (linkRow.rows.length === 0) {
    return { kind: 'learner_not_linked' }
  }

  // Resolve learner email for payment_orders.customer_email
  // (NOT NULL).
  const learnerRow = await pool.query<{ email: string }>(
    `select email from accounts where id = $1`,
    [args.learnerAccountId],
  )
  if (learnerRow.rows.length === 0) {
    return { kind: 'learner_account_missing' }
  }
  const learnerEmail = String(learnerRow.rows[0].email)

  const reason =
    typeof args.reason === 'string' && args.reason.trim().length > 0
      ? args.reason.trim().slice(0, 1024)
      : null

  const invoiceId = `lc_tg_${randomBytes(8).toString('hex')}`
  const expiresAt = new Date(Date.now() + PACKAGE_EXPIRY_DAYS * 24 * 60 * 60_000)
  const expiresAtIso = expiresAt.toISOString()
  const amountRub = pkg.amountKopecks / 100
  const description = reason
    ? `Teacher grant: ${reason}`
    : `Teacher grant of «${pkg.titleRu}»`

  // Single-TX atomic flow.
  const lockClient = await pool.connect()
  let purchaseId: string | null = null
  try {
    await lockClient.query('begin')

    // Shared 'pkg-stack:' advisory lock — serialises against learner-
    // buy, admin-grant, webhook grant flows for the same (account,
    // duration). round-29 BLOCKER closure: prevent double-grant via
    // teacher AND admin simultaneously.
    await lockClient.query(
      `select pg_advisory_xact_lock(hashtextextended('pkg-stack:' || $1 || ':' || $2, 0))`,
      [args.learnerAccountId, pkg.durationMinutes],
    )

    if (!args.allowStacking) {
      const ownedActive = await learnerHasActivePackageOfDuration(
        args.learnerAccountId,
        pkg.durationMinutes,
      )
      if (ownedActive) {
        await lockClient.query('commit')
        return {
          kind: 'already_owns_active_package',
          existingPurchaseId: ownedActive.purchaseId,
          titleSnapshot: ownedActive.titleSnapshot,
        }
      }
    }

    const receipt = {
      items: [],
      email: learnerEmail,
      isBso: false,
      amounts: {
        electronic: 0,
        advancePayment: 0,
        credit: 0,
        provision: 0,
      },
    }
    const metadata = {
      accountId: args.learnerAccountId,
      packageId: pkg.id,
      packageSlug: pkg.slug,
      packageDurationMinutes: pkg.durationMinutes,
      teacherGrantReason: reason,
    }

    // INSERT synthetic payment_orders row. paid_at stays NULL — a
    // teacher grant is NOT a payment event (mirrors the admin grant
    // route's wave-paranoia WARN #2 closure). teacher_account_id is
    // ALSO populated so the Day-6 NOT NULL flip pre-condition is met
    // (round-30 closure).
    await lockClient.query(
      `insert into payment_orders (
         invoice_id, amount_rub, currency, description,
         provider, status,
         created_at, updated_at, paid_at,
         customer_email, receipt_email,
         receipt, metadata,
         granted_by_teacher_id,
         payment_method,
         teacher_account_id
       ) values (
         $1, $2, 'RUB', $3,
         'teacher_grant', 'teacher_granted',
         now(), now(), null,
         $4, $4,
         $5::jsonb, $6::jsonb,
         $7::uuid,
         'teacher_grant',
         $7::uuid
       )`,
      [
        invoiceId,
        amountRub,
        description,
        learnerEmail,
        JSON.stringify(receipt),
        JSON.stringify(metadata),
        args.teacherAccountId,
      ],
    )

    const purchase = await createPackagePurchase(lockClient, {
      accountId: args.learnerAccountId,
      packageId: pkg.id,
      paymentOrderId: invoiceId,
      amountKopecks: pkg.amountKopecks,
      titleSnapshot: pkg.titleRu,
      durationMinutes: pkg.durationMinutes,
      countInitial: pkg.count,
      expiresAt,
      teacherId: args.teacherAccountId,
    })
    if (!purchase) {
      // ON CONFLICT(payment_order_id) DO NOTHING returned null —
      // shouldn't happen with a fresh invoice_id, but defensive.
      await lockClient.query('rollback')
      return { kind: 'package_not_found' }
    }
    purchaseId = purchase.id

    await lockClient.query(
      `insert into payment_allocations
         (payment_order_id, kind, target_id, amount_kopecks)
       values ($1, 'package', $2, $3)
       on conflict (payment_order_id, kind, target_id) do nothing`,
      [invoiceId, purchase.id, pkg.amountKopecks],
    )

    await lockClient.query('commit')
  } catch (e) {
    await lockClient.query('rollback').catch(() => {})
    throw e
  } finally {
    lockClient.release()
  }

  // Post-commit best-effort audit.
  try {
    await recordPaymentAuditEvent({
      eventType: 'package.grant.teacher-granted',
      invoiceId,
      customerEmail: learnerEmail,
      amountKopecks: rublesToKopecks(amountRub),
      toStatus: 'teacher_granted',
      actor: 'teacher:grant',
      payload: {
        teacherAccountId: args.teacherAccountId,
        learnerAccountId: args.learnerAccountId,
        packageId: pkg.id,
        packageSlug: pkg.slug,
        reason,
        purchaseId,
      },
    })
  } catch {
    // Best-effort.
  }

  return {
    kind: 'granted',
    invoiceId,
    purchaseId: purchaseId!,
    expiresAt: expiresAtIso,
    titleSnapshot: pkg.titleRu,
    count: pkg.count,
  }
}

/**
 * Revoke a teacher_grant payment_orders row. Voids the matching
 * package_purchases row + restores all active consumptions; bumps
 * the order status to 'teacher_revoked'. NO payment_allocation_
 * reversals row — non-money. Idempotent: a second revoke against
 * an already-revoked order returns `already_revoked` without
 * mutating anything.
 *
 * Gate: refuses if any consumption on the purchase has been
 * `completed` (the consumption rows have `consumed_by_actor` but
 * the slot lifecycle uses `lesson_completions` for completion
 * tracking; we conservatively read `package_consumptions` with
 * `restored_at IS NULL` as a proxy for "in use"). A consumption
 * that's been restored is fair game — the purchase row had a
 * booking that was later cancelled.
 *
 * `bypassTeacherOwnership` is set to true for the admin override
 * route (`/admin/teacher-grant/[id]/revoke`); the teacher cabinet
 * route passes it as false (the default) so the ownership check
 * fires.
 */
export async function revokeTeacherPackageGrant(args: {
  invoiceId: string
  // For the teacher cabinet route: who's calling. The helper checks
  // payment_orders.granted_by_teacher_id matches.
  // For the admin override: pass null + bypassTeacherOwnership=true.
  teacherAccountId: string | null
  bypassTeacherOwnership?: boolean
}): Promise<TeacherRevokeResult> {
  const pool = getDbPool()
  const lockClient = await pool.connect()
  try {
    await lockClient.query('begin')

    // Lock the order row + read the relevant fields.
    const orderRow = await lockClient.query(
      `select provider, status, granted_by_teacher_id
         from payment_orders
        where invoice_id = $1
        for update`,
      [args.invoiceId],
    )
    if (orderRow.rows.length === 0) {
      await lockClient.query('rollback')
      return { kind: 'order_not_found' }
    }
    const provider = String(orderRow.rows[0].provider)
    const status = String(orderRow.rows[0].status)
    const grantedByTeacherId = orderRow.rows[0].granted_by_teacher_id
      ? String(orderRow.rows[0].granted_by_teacher_id)
      : null

    if (provider !== 'teacher_grant') {
      await lockClient.query('rollback')
      return { kind: 'order_not_teacher_grant' }
    }

    if (!args.bypassTeacherOwnership) {
      if (
        !args.teacherAccountId
        || grantedByTeacherId !== args.teacherAccountId
      ) {
        await lockClient.query('rollback')
        return { kind: 'order_not_owned_by_teacher' }
      }
    }

    if (status === 'teacher_revoked') {
      await lockClient.query('rollback')
      return { kind: 'already_revoked' }
    }

    // Lookup the matching purchase. UNIQUE(payment_order_id) on
    // package_purchases means at most one row.
    const purchaseRow = await lockClient.query<{
      id: string
    }>(
      `select id
         from package_purchases
        where payment_order_id = $1
        for update`,
      [args.invoiceId],
    )
    if (purchaseRow.rows.length === 0) {
      await lockClient.query('rollback')
      return { kind: 'purchase_not_found' }
    }
    const purchaseId = String(purchaseRow.rows[0].id)

    // Completion gate. If any active consumption on this purchase
    // has a lesson_completions row (post-Day-5A), the revoke must
    // refuse — completed lessons can't be retroactively reversed.
    // Day 5A hasn't shipped yet, so today we conservatively read
    // package_consumptions and refuse if ANY active (non-restored)
    // consumption exists. Once Day 5A lands, the predicate flips
    // to "any consumption with a lesson_completions row".
    const activeConsumptions = await lockClient.query<{ count: string }>(
      `select count(*)::text as count
         from package_consumptions
        where package_purchase_id = $1
          and restored_at is null`,
      [purchaseId],
    )
    const activeCount = Number(activeConsumptions.rows[0]?.count ?? 0)
    if (activeCount > 0) {
      await lockClient.query('rollback')
      return { kind: 'has_completed_consumptions' }
    }

    // Void purchase + restore (mass) any (now zero) consumptions —
    // restore is a no-op here since the gate above already required
    // zero active consumptions; the call ensures the purchase row's
    // voided_at column is stamped. Mirrors the admin refund flow's
    // `restoreAllConsumptionsForPurchase` call shape.
    await restoreAllConsumptionsForPurchase(lockClient, {
      packagePurchaseId: purchaseId,
      actor: 'teacher',
      reason: args.bypassTeacherOwnership
        ? 'admin_revoke_teacher_grant'
        : 'teacher_revoke',
    })

    // Bump order status.
    await lockClient.query(
      `update payment_orders
          set status = 'teacher_revoked',
              updated_at = now()
        where invoice_id = $1`,
      [args.invoiceId],
    )

    await lockClient.query('commit')
  } catch (e) {
    await lockClient.query('rollback').catch(() => {})
    throw e
  } finally {
    lockClient.release()
  }

  // Post-commit audit.
  try {
    await recordPaymentAuditEvent({
      eventType: 'package.grant.teacher-revoked',
      invoiceId: args.invoiceId,
      customerEmail: null,
      amountKopecks: 0,
      toStatus: 'teacher_revoked',
      actor: args.bypassTeacherOwnership ? 'admin:revoke' : 'teacher:revoke',
      payload: {
        teacherAccountId: args.teacherAccountId,
        bypass: args.bypassTeacherOwnership === true,
      },
    })
  } catch {
    // Best-effort.
  }

  return { kind: 'revoked', restoredConsumptions: 0 }
}
