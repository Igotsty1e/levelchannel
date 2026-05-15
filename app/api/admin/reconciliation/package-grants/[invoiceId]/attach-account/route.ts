// PKG-RECON RECON.3 — operator action: attach a paid_not_granted
// order to a DIFFERENT account, then re-run grant.
//
// Use case: webhook fired metadata_email_mismatch or
// no_account_match because the customer typed a slightly-different
// email on the CloudPayments widget than the one on their
// LevelChannel account. Operator picks the correct learner; route
// rewrites `payment_orders.metadata.accountId` + `customer_email`
// and calls processPackageGrant again.
//
// Server-authoritative: operator picks ONLY targetAccountId +
// optional operator reason. Amount / duration / count / title /
// expiry are pulled from the catalog server-side, same as the
// original webhook path.
//
// Target-account policy: uses the canonical
// `isLearnerArchetypeCandidate` predicate (lib/auth/learner-archetype.ts)
// — refuses admin/teacher accounts and any account that fails the
// learner-side allowlist (unverified / disabled / scheduled_purge_at
// set / purged_at set). Round 1 BLOCKERs #6+#7 / round 2 WARN #6
// closure.

import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { recordPaymentAuditEvent } from '@/lib/audit/payment-events'
import { isLearnerArchetypeCandidate } from '@/lib/auth/learner-archetype'
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

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: Request, { params }: RouteParams) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(
    request,
    'admin:reconciliation:attach-account:ip',
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
  let body: { targetAccountId?: string; reason?: string } = {}
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
  const operatorReason =
    typeof body.reason === 'string' && body.reason.trim().length > 0
      ? body.reason.trim().slice(0, 1024)
      : null

  return withIdempotency(
    request,
    'admin:pkg-recon:attach-account',
    rawBody,
    async () => {
      // Pre-lock target-state policy check (round 1 BLOCKERs #6+#7
      // closure). Don't even take the lock if the operator picked a
      // disqualified target.
      const candidate = await isLearnerArchetypeCandidate(targetAccountId)
      if (!candidate) {
        return {
          status: 422,
          body: {
            error: 'target_account_unavailable',
            message:
              'Target account is not a valid learner target ' +
              '(unverified, disabled, scheduled-for-purge, purged, ' +
              'or holds admin/teacher role).',
          },
        }
      }

      const pool = getDbPool()
      const client = await pool.connect()
      try {
        await client.query('begin')

        // Per-invoice advisory lock.
        await client.query(
          `select pg_advisory_xact_lock(hashtextextended($1, 0))`,
          [`pkg-recon:${invoiceId}`],
        )

        // Re-verify paid_not_granted inside the lock.
        const stillPnG = await client.query(
          `select po.metadata->>'accountId' as previous_account_id,
                  po.customer_email as previous_customer_email
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
        const previousAccountId = stillPnG.rows[0].previous_account_id
          ? String(stillPnG.rows[0].previous_account_id)
          : null
        const previousCustomerEmail = stillPnG.rows[0].previous_customer_email
          ? String(stillPnG.rows[0].previous_customer_email)
          : null

        // Fetch target account email for the metadata + customer_email
        // overwrite. This is the email LevelChannel knows; it overrides
        // whatever the customer typed on the CloudPayments widget.
        const targetRow = await client.query(
          `select email from accounts where id = $1`,
          [targetAccountId],
        )
        if (targetRow.rows.length === 0) {
          await client.query('commit')
          return {
            status: 422,
            body: { error: 'target_account_missing' },
          }
        }
        const newCustomerEmail = String(targetRow.rows[0].email)

        // Rewrite metadata + customer_email in the SAME TX as the
        // advisory lock so a concurrent retry-grant sees consistent
        // state.
        await client.query(
          `update payment_orders
              set metadata = jsonb_set(metadata, '{accountId}', to_jsonb($1::text), true),
                  customer_email = $2,
                  updated_at = now()
            where invoice_id = $3`,
          [targetAccountId, newCustomerEmail, invoiceId],
        )
        await client.query('commit')

        // Call processPackageGrant in a NEW TX (it manages its own
        // connection). Re-acquire the per-invoice lock for the grant
        // call so we serialise against retry-grant + other actions.
        //
        // Wave-mode round 1 BLOCKER #1 closure: phase-1 commit above
        // released the xact-bound advisory lock. Between phases, a
        // sibling mark-resolved can write a terminal resolution row.
        // Re-verify paid_not_granted INSIDE the new lock TX before
        // calling processPackageGrant; otherwise we'd double-grant
        // an invoice that was already terminally resolved.
        const lockClient = await pool.connect()
        try {
          await lockClient.query('begin')
          await lockClient.query(
            `select pg_advisory_xact_lock(hashtextextended($1, 0))`,
            [`pkg-recon:${invoiceId}`],
          )
          const stillPnG2 = await lockClient.query(
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
          if (stillPnG2.rows.length === 0) {
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
            actor: 'admin:attach-account',
          })
          if (
            grantResult.kind === 'granted'
            || grantResult.kind === 'already_granted'
          ) {
            const packagePurchaseId =
              grantResult.kind === 'granted'
                ? grantResult.packagePurchaseId
                : null
            const defaultReason = `Attached to account ${newCustomerEmail} by admin ${auth.account.email} at ${new Date().toISOString()}`
            await lockClient.query(
              `insert into package_grant_resolutions
                 (invoice_id, resolved_by_account_id, resolution, reason, payload)
               values ($1, $2, 'attached_and_granted', $3, $4::jsonb)
               on conflict (invoice_id) do nothing`,
              [
                invoiceId,
                auth.account.id,
                operatorReason ?? defaultReason,
                JSON.stringify({
                  previousAccountId,
                  previousCustomerEmail,
                  newAccountId: targetAccountId,
                  newCustomerEmail,
                  packagePurchaseId,
                  replay: grantResult.kind === 'already_granted',
                }),
              ],
            )
            await lockClient.query('commit')
            // Best-effort audit.
            try {
              await recordPaymentAuditEvent({
                eventType: 'payment.grant.account-attached-by-admin',
                invoiceId,
                customerEmail: newCustomerEmail,
                amountKopecks: 0,
                toStatus: 'paid',
                actor: 'admin:attach-account',
                payload: {
                  operatorAccountId: auth.account.id,
                  operatorEmail: auth.account.email,
                  previousAccountId,
                  previousCustomerEmail,
                  newAccountId: targetAccountId,
                  newCustomerEmail,
                  outcome: grantResult.kind,
                  packagePurchaseId,
                  reason: operatorReason,
                },
              })
            } catch {
              // Best-effort.
            }
            return {
              status: 200,
              body: {
                ok: true,
                outcome: grantResult.kind,
                packagePurchaseId,
                previousAccountId,
                previousCustomerEmail,
                newAccountId: targetAccountId,
                newCustomerEmail,
              },
            }
          }
          // Grant still failed despite the attach — return the
          // reason. NO resolution row. Operator can pick mark-resolved
          // if the underlying issue can't be fixed.
          await lockClient.query('commit')
          if (grantResult.kind === 'semantic_failure') {
            return {
              status: 200,
              body: {
                ok: false,
                outcome: 'semantic_failure',
                reason: grantResult.reason,
                newAccountId: targetAccountId,
                newCustomerEmail,
              },
            }
          }
          return {
            status: 200,
            body: {
              ok: false,
              outcome: 'package_unknown_or_inactive',
              slug: grantResult.slug,
              newAccountId: targetAccountId,
              newCustomerEmail,
            },
          }
        } catch (e) {
          await lockClient.query('rollback').catch(() => {})
          throw e
        } finally {
          lockClient.release()
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
