// PKG-RECON RECON.4 — operator action: mark a paid_not_granted
// order as resolved without granting a package.
//
// Use cases:
//   - Operator refunded the order out-of-band via the CloudPayments
//     dashboard (category='refunded_offline').
//   - Operator manually granted the learner an equivalent value via
//     a tariff outside the system (category='manual_grant_via_tariff').
//   - Operator decided to comp the learner (category='comped').
//   - Catch-all (category='other').
//
// Resolution semantics: writes a durable row to
// `package_grant_resolutions` with resolution='marked_resolved_manually'.
// `deletion-guard.ts` Branch B now reads this table, so account
// deletion UNBLOCKS once a resolution row exists. Trade-off accepted:
// the `package_purchases` table still has no row; the learner gets no
// system-side entitlement; this resolution shape is for "operator
// handled it out-of-band, no entitlement needed."

import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { recordPaymentAuditEvent } from '@/lib/audit/payment-events'
import { requireAdminRole } from '@/lib/auth/guards'
import { getDbPool } from '@/lib/db/pool'
import { withIdempotency } from '@/lib/security/idempotency'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ invoiceId: string }> }

const VALID_CATEGORIES = new Set([
  'manual_grant_via_tariff',
  'refunded_offline',
  'comped',
  'other',
])

export async function POST(request: Request, { params }: RouteParams) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(
    request,
    'admin:reconciliation:mark-resolved:ip',
    30,
    60_000,
  )
  if (rl) return rl

  const auth = await requireAdminRole(request)
  if (!auth.ok) return auth.response

  const { invoiceId } = await params
  if (typeof invoiceId !== 'string' || invoiceId.length === 0) {
    return NextResponse.json(
      { error: 'invalid_invoice_id' },
      { status: 400, headers: NO_STORE },
    )
  }

  let rawBody: string
  let body: {
    category?: string
    reason?: string
    cpRefundTransactionId?: string
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

  const category = typeof body.category === 'string' ? body.category : ''
  if (!VALID_CATEGORIES.has(category)) {
    return NextResponse.json(
      {
        error: 'invalid_category',
        message:
          'category must be one of: manual_grant_via_tariff, refunded_offline, comped, other',
      },
      { status: 400, headers: NO_STORE },
    )
  }
  const reason =
    typeof body.reason === 'string' ? body.reason.trim() : ''
  if (reason.length === 0 || reason.length > 1024) {
    return NextResponse.json(
      {
        error: 'invalid_reason',
        message: 'reason must be non-empty and ≤ 1024 chars',
      },
      { status: 400, headers: NO_STORE },
    )
  }
  const cpRefundTransactionId =
    typeof body.cpRefundTransactionId === 'string'
      && body.cpRefundTransactionId.trim().length > 0
      ? body.cpRefundTransactionId.trim().slice(0, 256)
      : null

  // Round 3 WARN #3: if category='refunded_offline' but no
  // cpRefundTransactionId provided, emit a warning log. Don't refuse;
  // the operator may have refunded by other means.
  if (category === 'refunded_offline' && !cpRefundTransactionId) {
    console.warn(
      JSON.stringify({
        probe: 'admin.pkg-recon.mark-resolved',
        level: 'warn',
        invoiceId,
        operator: auth.account.email,
        message:
          'mark-resolved with category=refunded_offline but no cpRefundTransactionId; ' +
          'audit reconciliation against CP dashboard relies on free-text reason',
      }),
    )
  }

  return withIdempotency(
    request,
    'admin:pkg-recon:mark-resolved',
    rawBody,
    async () => {
      const pool = getDbPool()
      const client = await pool.connect()
      try {
        await client.query('begin')
        await client.query(
          `select pg_advisory_xact_lock(hashtextextended($1, 0))`,
          [`pkg-recon:${invoiceId}`],
        )
        // Re-verify paid_not_granted inside the lock.
        const stillPnG = await client.query(
          `select 1
             from payment_orders po
            where po.invoice_id = $1
              and po.status = 'paid'
              and po.metadata->>'packageSlug' is not null
              and not exists (
                select 1 from package_purchases pp
                 where pp.payment_order_id = po.invoice_id
              )
              and not exists (
                select 1 from package_grant_resolutions r
                 where r.invoice_id = po.invoice_id
              )
            limit 1`,
          [invoiceId],
        )
        if (stillPnG.rows.length === 0) {
          await client.query('commit')
          return {
            status: 409,
            body: {
              error: 'not_paid_not_granted',
              message:
                'This invoice is no longer in paid_not_granted state.',
            },
          }
        }

        // Insert resolution row. Terminal: ON CONFLICT DO NOTHING.
        const payload: Record<string, unknown> = {}
        if (cpRefundTransactionId) {
          payload.cpRefundTransactionId = cpRefundTransactionId
        }
        await client.query(
          `insert into package_grant_resolutions
             (invoice_id, resolved_by_account_id, resolution, category, reason, payload)
           values ($1, $2, 'marked_resolved_manually', $3, $4, $5::jsonb)
           on conflict (invoice_id) do nothing`,
          [
            invoiceId,
            auth.account.id,
            category,
            reason,
            JSON.stringify(payload),
          ],
        )
        await client.query('commit')

        // Best-effort audit.
        try {
          await recordPaymentAuditEvent({
            eventType: 'payment.grant.resolved-manually-by-admin',
            invoiceId,
            customerEmail: null,
            amountKopecks: 0,
            toStatus: 'paid',
            actor: 'admin:resolved',
            payload: {
              operatorAccountId: auth.account.id,
              operatorEmail: auth.account.email,
              category,
              reason,
              cpRefundTransactionId,
            },
          })
        } catch {
          // Best-effort.
        }
        return {
          status: 200,
          body: {
            ok: true,
            outcome: 'marked_resolved_manually',
            category,
            cpRefundTransactionId,
          },
        }
      } catch (e) {
        await client.query('rollback').catch(() => {})
        throw e
      } finally {
        client.release()
      }
    },
  )
}
