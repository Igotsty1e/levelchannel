import { createHash, randomBytes, randomUUID } from 'crypto'

import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import {
  recordPaymentAuditEvent,
  rublesToKopecks,
} from '@/lib/audit/payment-events'
import { requireAdminRole } from '@/lib/auth/guards'
import { isLearnerArchetypeCandidate } from '@/lib/auth/learner-archetype'
import { getPackageById } from '@/lib/billing/packages'
import { createPackagePurchase } from '@/lib/billing/packages/purchases'
import { learnerHasActivePackageOfDuration } from '@/lib/billing/packages/eligibility'
import { getDbPool } from '@/lib/db/pool'
import { withIdempotency } from '@/lib/security/idempotency'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

// PKG-ADMIN-GRANT LBL.1 — operator-driven package grant route.
//
// Plan: docs/plans/pkg-admin-grant.md (Option D — synthetic
// payment_orders with provider='admin_grant', SKIP processPackageGrant
// entirely; write payment_orders + package_purchases + payment_allocations
// atomically in one TX).
//
// Auth: requireAdminRole. Operator picks targetAccountId + reason +
// optional allowStacking.
// Server-authoritative on amount/duration/count/title/expiry from the
// catalog. Body is ONLY { targetAccountId, reason, allowStacking? }.
//
// Idempotency: two layers.
//   1. Transport (withIdempotency at the route boundary).
//   2. Business: anti-stacking gate via learnerHasActivePackageOfDuration.
//      Unless allowStacking=true, second grant of same-duration package
//      to same learner gets 409.
//
// Lock: pg_advisory_xact_lock('pkg-admin-grant:' || accountId || ':' ||
// durationMinutes) — matches the anti-stacking domain so two parallel
// grants of DIFFERENT packages of the SAME duration to the SAME learner
// serialize.
//
// Single TX writes: payment_orders + package_purchases + payment_allocations.
// All-or-nothing atomic — failure rolls back the whole grant.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string }> }

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const PACKAGE_EXPIRY_DAYS = 180

function dayBucket(): string {
  // YYYYMMDD UTC.
  return new Date().toISOString().slice(0, 10).replace(/-/g, '')
}

function deterministicInvoiceId(
  packageId: string,
  targetAccountId: string,
  allowStacking: boolean,
): string {
  if (allowStacking) {
    // Random salt produces a fresh invoice_id every call. Transport
    // dedup is handled by withIdempotency at the outer layer.
    return `lc_adm_${randomBytes(8).toString('hex')}`
  }
  // Deterministic from (packageId, accountId, dayBucket). Same operator
  // clicking twice on the same day → same invoice_id → payment_orders
  // UNIQUE(invoice_id) rejects the second INSERT.
  const hash = createHash('sha256')
    .update(`pkg-admin-grant:${packageId}:${targetAccountId}:${dayBucket()}`)
    .digest('hex')
  return `lc_adm_${hash.slice(0, 16)}`
}

export async function POST(request: Request, { params }: RouteParams) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(
    request,
    'admin:packages:grant:ip',
    20,
    60_000,
  )
  if (rl) return rl

  const auth = await requireAdminRole(request)
  if (!auth.ok) return auth.response

  const { id: packageId } = await params
  if (!UUID_PATTERN.test(packageId)) {
    return NextResponse.json(
      { error: 'invalid_package_id' },
      { status: 400, headers: NO_STORE },
    )
  }

  let rawBody: string
  let body: {
    targetAccountId?: string
    reason?: string
    allowStacking?: boolean
  } = {}
  try {
    rawBody = await request.text()
    body = rawBody.length > 0 ? JSON.parse(rawBody) : {}
  } catch {
    return NextResponse.json(
      { error: 'invalid_body' },
      { status: 400, headers: NO_STORE },
    )
  }

  const targetAccountId =
    typeof body.targetAccountId === 'string' ? body.targetAccountId : null
  if (!targetAccountId || !UUID_PATTERN.test(targetAccountId)) {
    return NextResponse.json(
      { error: 'invalid_target_account_id' },
      { status: 400, headers: NO_STORE },
    )
  }

  const reason =
    typeof body.reason === 'string' && body.reason.trim().length > 0
      ? body.reason.trim().slice(0, 1024)
      : null
  if (!reason) {
    return NextResponse.json(
      {
        error: 'reason_required',
        message: 'Укажите причину выдачи пакета (≤1024 символа).',
      },
      { status: 400, headers: NO_STORE },
    )
  }

  const allowStacking = body.allowStacking === true

  return withIdempotency(
    request,
    `admin:packages:grant:${packageId}:${targetAccountId}`,
    rawBody,
    async () => {
      // Anti-spoof: target must be a valid learner-archetype candidate.
      // Excludes admin / teacher / unverified / deletion-grace / purged.
      const candidate = await isLearnerArchetypeCandidate(targetAccountId)
      if (!candidate) {
        return {
          status: 422,
          body: {
            error: 'target_account_unavailable',
            message:
              'Target account is not a valid learner target (admin/teacher/unverified/deletion-grace/purged).',
          },
        }
      }

      // Package must exist + be active.
      const pkg = await getPackageById(packageId)
      if (!pkg) {
        return {
          status: 404,
          body: { error: 'package_not_found' },
        }
      }
      if (!pkg.isActive) {
        return {
          status: 422,
          body: {
            error: 'package_inactive',
            message: 'Cannot grant an inactive package.',
          },
        }
      }

      const pool = getDbPool()

      // Pre-resolve target email + verify account exists (anti-spoof
      // double-check). Required for payment_orders.customer_email
      // NOT NULL.
      const targetRow = await pool.query(
        `select email from accounts where id = $1`,
        [targetAccountId],
      )
      if (targetRow.rows.length === 0) {
        return {
          status: 422,
          body: { error: 'target_account_missing' },
        }
      }
      const targetEmail = String(targetRow.rows[0].email)

      // Single-TX atomic flow on a dedicated lockClient.
      const lockClient = await pool.connect()
      let invoiceId: string | null = null
      let purchaseId: string | null = null
      let expiresAtIso: string | null = null
      try {
        await lockClient.query('begin')

        // Lock by (accountId, durationMinutes). Uses the shared
        // 'pkg-stack:' prefix so the admin-grant flow serializes
        // against the learner-buy flow (which uses the same prefix
        // since the epic-end paranoia BLOCKER #1 fix). Prior version
        // used a separate 'pkg-admin-grant:' prefix that let admin
        // grants race concurrent learner buys for the same (account,
        // duration) and produced two package_purchases rows.
        await lockClient.query(
          `select pg_advisory_xact_lock(hashtextextended('pkg-stack:' || $1 || ':' || $2, 0))`,
          [targetAccountId, pkg.durationMinutes],
        )

        // Anti-stacking gate (default REJECT, override via allowStacking).
        if (!allowStacking) {
          const ownedActive = await learnerHasActivePackageOfDuration(
            targetAccountId,
            pkg.durationMinutes,
          )
          if (ownedActive) {
            await lockClient.query('commit')
            return {
              status: 409,
              body: {
                error: 'already_owns_active_package',
                existingPurchaseId: ownedActive.purchaseId,
                message: `Учитель уже имеет активный пакет такой же длительности (${ownedActive.titleSnapshot}). Передай allowStacking: true чтобы разрешить стэк.`,
              },
            }
          }
        }

        invoiceId = deterministicInvoiceId(packageId, targetAccountId, allowStacking)
        const amountRub = pkg.amountKopecks / 100
        const description = `Admin grant: ${reason}`
        const expiresAt = new Date(Date.now() + PACKAGE_EXPIRY_DAYS * 24 * 60 * 60_000)
        expiresAtIso = expiresAt.toISOString()
        const receipt = {
          items: [],
          email: targetEmail,
          isBso: false,
          amounts: {
            electronic: 0,
            advancePayment: 0,
            credit: 0,
            provision: 0,
          },
        }
        const metadata = {
          accountId: targetAccountId,
          packageSlug: pkg.slug,
          packageDurationMinutes: pkg.durationMinutes,
          packageId: pkg.id,
        }

        // INSERT synthetic payment_orders row. paid_at stays NULL — an
        // admin grant is NOT a payment event, and the admin payments
        // detail page renders "Оплачен" off paid_at; setting it to
        // now() would misclassify the grant as paid. Wave-mode
        // paranoia WARN #2 (2026-05-16). status='granted' alone is the
        // signal; the detail page uses status to render "Выдан".
        await lockClient.query(
          `insert into payment_orders (
             invoice_id, amount_rub, currency, description,
             provider, status,
             created_at, updated_at, paid_at,
             customer_email, receipt_email,
             receipt, metadata,
             granted_by_operator_id
           ) values (
             $1, $2, 'RUB', $3,
             'admin_grant', 'granted',
             now(), now(), null,
             $4, $4,
             $5::jsonb, $6::jsonb,
             $7::uuid
           )`,
          [
            invoiceId,
            amountRub,
            description,
            targetEmail,
            JSON.stringify(receipt),
            JSON.stringify(metadata),
            auth.account.id,
          ],
        )

        // INSERT package_purchases directly via shared helper.
        const purchase = await createPackagePurchase(lockClient, {
          accountId: targetAccountId,
          packageId: pkg.id,
          paymentOrderId: invoiceId,
          amountKopecks: pkg.amountKopecks,
          titleSnapshot: pkg.titleRu,
          durationMinutes: pkg.durationMinutes,
          countInitial: pkg.count,
          expiresAt,
        })
        if (!purchase) {
          // ON CONFLICT(payment_order_id) DO NOTHING returned null.
          // Shouldn't happen under our deterministic+allowStacking
          // contract (invoice_id is fresh per real-stack click). If we
          // do hit it, rollback and 500 — that's data inconsistency.
          await lockClient.query('rollback')
          return {
            status: 500,
            body: { error: 'purchase_insert_returned_null' },
          }
        }
        purchaseId = purchase.id

        // INSERT payment_allocations row (kind='package').
        await lockClient.query(
          `insert into payment_allocations
             (payment_order_id, kind, target_id, amount_kopecks)
           values ($1, 'package', $2, $3)
           on conflict (payment_order_id, kind, target_id) do nothing`,
          [invoiceId, purchase.id, pkg.amountKopecks],
        )

        await lockClient.query('commit')
      } catch (e: unknown) {
        await lockClient.query('rollback').catch(() => {})
        // 23505 = unique violation — same-day deterministic invoice_id
        // collision when NOT stacking. Map to a clear 409.
        const code =
          e instanceof Error && 'code' in e
            ? (e as Error & { code?: string }).code
            : undefined
        if (code === '23505' && !allowStacking) {
          return {
            status: 409,
            body: {
              error: 'duplicate_grant_today',
              message:
                'Этому ученику уже был выдан этот пакет сегодня. Передай allowStacking: true или жди следующего дня.',
            },
          }
        }
        throw e
      } finally {
        lockClient.release()
      }

      // Post-commit best-effort audit. Load-bearing record is
      // package_purchases row + payment_orders.description (NOT NULL).
      try {
        await recordPaymentAuditEvent({
          eventType: 'package.grant.operator-granted',
          invoiceId,
          customerEmail: targetEmail,
          amountKopecks: rublesToKopecks(pkg.amountKopecks / 100),
          toStatus: 'granted',
          actor: 'admin:grant',
          payload: {
            operatorAccountId: auth.account.id,
            operatorEmail: auth.account.email,
            targetAccountId,
            targetEmail,
            packageId: pkg.id,
            packageSlug: pkg.slug,
            reason,
            allowStacking,
            purchaseId,
          },
        })
      } catch {
        // Best-effort.
      }

      return {
        status: 200,
        body: {
          ok: true,
          invoiceId,
          purchaseId,
          expiresAt: expiresAtIso,
          titleSnapshot: pkg.titleRu,
          count: pkg.count,
        },
      }
    },
  )
}
