// PKG-RECON RECON.2 — operator action: re-run grant for a
// paid_not_granted order.
//
// Workflow (inside per-invoice advisory lock):
//   1. Acquire pg_advisory_xact_lock by invoice_id hash.
//   2. Re-verify paid_not_granted (operator may be acting on a
//      stale list).
//   3. Call processPackageGrant with actor='admin:retry-grant'.
//   4. On granted: insert package_grant_resolutions row.
//   5. On semantic_failure / package_unknown_or_inactive: surface
//      the reason in the response so the operator can pick a
//      different action.
//
// Idempotency: shared helper reads the Idempotency-Key HEADER per
// `lib/security/idempotency.ts:withIdempotency` contract.

import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { recordPaymentAuditEvent } from '@/lib/audit/payment-events'
import { requireAdminRole } from '@/lib/auth/guards'
import {
  processPackageGrant,
} from '@/lib/billing/package-grant'
import { getDbPool } from '@/lib/db/pool'
import { withIdempotency } from '@/lib/security/idempotency'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ invoiceId: string }> }

export async function POST(request: Request, { params }: RouteParams) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(
    request,
    'admin:reconciliation:retry-grant:ip',
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

  // Body is parsed for the request hash that withIdempotency uses to
  // dedupe; we also expect a non-empty `reason` for audit (server
  // generates a default if absent).
  let rawBody: string
  let body: { reason?: string } = {}
  try {
    rawBody = await request.text()
    body = rawBody.length > 0 ? JSON.parse(rawBody) : {}
  } catch {
    return NextResponse.json(
      { error: 'invalid_body' },
      { status: 400, headers: NO_STORE },
    )
  }
  const operatorReason =
    typeof body.reason === 'string' && body.reason.trim().length > 0
      ? body.reason.trim().slice(0, 1024)
      : null

  return withIdempotency(
    request,
    'admin:pkg-recon:retry-grant',
    rawBody,
    async () => {
      const pool = getDbPool()
      const client = await pool.connect()
      try {
        await client.query('begin')

        // Per-invoice advisory lock (plan §4.3).
        await client.query(
          `select pg_advisory_xact_lock(hashtextextended($1, 0))`,
          [`pkg-recon:${invoiceId}`],
        )

        // Re-verify paid_not_granted: operator may be racing the
        // webhook or a sibling action; re-check inside the lock.
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
                'This invoice is no longer in paid_not_granted state. ' +
                'Either it was already resolved or the underlying order changed.',
            },
          }
        }
        await client.query('commit')

        // processPackageGrant manages its own connection/TX; not in
        // our advisory lock TX. But the lock above held only as long
        // as the TX; we want the lock for the WHOLE action including
        // the grant call. Re-issue inside a NEW TX that wraps the
        // grant call too.
      } catch (e) {
        await client.query('rollback').catch(() => {})
        client.release()
        throw e
      } finally {
        client.release()
      }

      // Re-lock for the actual grant action.
      //
      // Wave-mode round 1 BLOCKER #1 closure: phase 1 above
      // committed and RELEASED the advisory lock (it's xact-bound).
      // Between phase-1-commit and phase-2-relock, another admin
      // could have inserted a package_grant_resolutions row (e.g.
      // mark-resolved). Re-verify paid_not_granted INSIDE the new
      // lock TX before calling processPackageGrant, else we'd
      // double-grant a terminal invoice.
      const lockClient = await pool.connect()
      try {
        await lockClient.query('begin')
        await lockClient.query(
          `select pg_advisory_xact_lock(hashtextextended($1, 0))`,
          [`pkg-recon:${invoiceId}`],
        )
        // Phase-2 race re-check (round 1 BLOCKER #1 closure).
        //
        // Between phase-1 COMMIT and phase-2 lock re-acquisition the
        // xact-bound advisory lock was released; a sibling
        // mark-resolved could have written a terminal resolution row.
        // Re-checking only the `package_grant_resolutions` table is
        // SUFFICIENT for the race we need to close:
        //   - status=paid is monotonic (orders don't unflip to pending).
        //   - package_purchases collision is handled inside
        //     processPackageGrant via UNIQUE(payment_order_id) →
        //     `already_granted` kind.
        //   - Only a terminal package_grant_resolutions row inserted
        //     by a sibling action races us here.
        //
        // Why we don't re-read `payment_orders` here: that would take
        // ACCESS SHARE on payment_orders and deadlock with
        // `ensureSchema()` inside processPackageGrant on its first
        // call in a fresh worker (CREATE TABLE IF NOT EXISTS needs
        // ACCESS EXCLUSIVE). Limiting the re-verify to a single small
        // table that ensureSchema never touches keeps the lockClient
        // TX cheap and unblocking.
        const resolved = await lockClient.query(
          `select 1 from package_grant_resolutions
            where invoice_id = $1 limit 1`,
          [invoiceId],
        )
        if (resolved.rows.length > 0) {
          await lockClient.query('commit')
          return {
            status: 409,
            body: {
              error: 'not_paid_not_granted',
              message:
                'This invoice was resolved by another action between phase 1 and phase 2 of this request.',
            },
          }
        }
        const grantResult = await processPackageGrant(invoiceId, {
          actor: 'admin:retry-grant',
        })
        if (grantResult.kind === 'granted' || grantResult.kind === 'already_granted') {
          const packagePurchaseId =
            grantResult.kind === 'granted'
              ? grantResult.packagePurchaseId
              : null
          const defaultReason = `Re-run grant by admin ${auth.account.email} at ${new Date().toISOString()}`
          await lockClient.query(
            `insert into package_grant_resolutions
               (invoice_id, resolved_by_account_id, resolution, reason, payload)
             values ($1, $2, 'granted', $3, $4::jsonb)
             on conflict (invoice_id) do nothing`,
            [
              invoiceId,
              auth.account.id,
              operatorReason ?? defaultReason,
              JSON.stringify({
                packagePurchaseId,
                replay: grantResult.kind === 'already_granted',
              }),
            ],
          )
          await lockClient.query('commit')
          // Best-effort audit row outside the lock TX.
          try {
            await recordPaymentAuditEvent({
              eventType: 'payment.grant.retried-by-admin',
              invoiceId,
              customerEmail: null,
              amountKopecks: 0,
              toStatus: 'paid',
              actor: 'admin:retry-grant',
              payload: {
                operatorAccountId: auth.account.id,
                operatorEmail: auth.account.email,
                outcome: grantResult.kind,
                packagePurchaseId,
                reason: operatorReason,
              },
            })
          } catch {
            // Audit is best-effort; the load-bearing record is the
            // package_grant_resolutions row above.
          }
          return {
            status: 200,
            body: {
              ok: true,
              outcome: grantResult.kind,
              packagePurchaseId,
            },
          }
        }
        // Semantic-failure / package_unknown_or_inactive: NO
        // resolution row, return the reason to the operator.
        await lockClient.query('commit')
        if (grantResult.kind === 'semantic_failure') {
          return {
            status: 200,
            body: {
              ok: false,
              outcome: 'semantic_failure',
              reason: grantResult.reason,
            },
          }
        }
        return {
          status: 200,
          body: {
            ok: false,
            outcome: 'package_unknown_or_inactive',
            slug: grantResult.slug,
          },
        }
      } catch (e) {
        await lockClient.query('rollback').catch(() => {})
        throw e
      } finally {
        lockClient.release()
      }
    },
  )
}

