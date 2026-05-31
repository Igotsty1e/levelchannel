import { recordPaymentAuditEvent, rublesToKopecks } from '@/lib/audit/payment-events'
import { getAccountByEmail } from '@/lib/auth/accounts'
import { processPackageGrant } from '@/lib/billing/package-grant'
import {
  createOrRenewTeacherSubscription,
  findSubscriptionByPaymentOrderId,
  getSubscriptionTariff,
} from '@/lib/billing/teacher-subscription'
import { sendOperatorPaymentNotification } from '@/lib/email/dispatch'
import { recordAllocation } from '@/lib/payments/allocations'
import { handleCloudPaymentsWebhook } from '@/lib/payments/cloudpayments-route'
import {
  detectPaymentMethod,
  getCloudPaymentsInvoiceId,
} from '@/lib/payments/cloudpayments-webhook'
import { validatePaymentSlotBinding } from '@/lib/payments/slot-binding'
import { getOrder } from '@/lib/payments/store'
import { markOrderPaid } from '@/lib/payments/provider'
import { maybePersistTokenFromWebhook } from '@/lib/payments/tokens'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  return handleCloudPaymentsWebhook(request, { kind: 'pay', handler: async (payload) => {
    // SBP-PAY (2026-05-19) — detect payment_method from positive
    // signals BEFORE markOrderPaid so the lifecycle can fill in a
    // legacy NULL column without overwriting the canonical value an
    // SBP create-qr already wrote. See detectPaymentMethod() contract
    // + lifecycle.markOrderPaid `detectedPaymentMethod` option.
    const detectedMethod = detectPaymentMethod(payload)
    const order = await markOrderPaid(
      getCloudPaymentsInvoiceId(payload),
      {
        transactionId: payload.TransactionId,
        paymentMethod: payload.PaymentMethod,
        status: payload.Status,
      },
      { detectedPaymentMethod: detectedMethod },
    )

    if (order?.customerEmail) {
      // Сохраняем токен только если пользователь явно согласился на чекбоксе
      // и terminal вернул Token. Согласие читаем из metadata ордера (наш
      // source of truth) с fallback на Data/JsonData в payload.
      // SBP-PAY (2026-05-19) — maybePersistTokenFromWebhook has a
      // defensive early-exit on order.paymentMethod==='sbp'; this call
      // remains safe to fire unconditionally.
      await maybePersistTokenFromWebhook(payload, order.customerEmail, order)
    }

    if (order) {
      await recordPaymentAuditEvent({
        eventType: 'webhook.pay.processed',
        invoiceId: order.invoiceId,
        customerEmail: order.customerEmail,
        amountKopecks: rublesToKopecks(order.amountRub),
        toStatus: order.status,
        actor: 'webhook:cloudpayments:pay',
        payload: {
          transactionId: payload.TransactionId,
          paymentMethod: payload.PaymentMethod,
          providerStatus: payload.Status,
          // SBP-PAY — keep the raw provider string in audit forensics
          // alongside our detector's classification, so an 'unknown'
          // classification surfaces the actual provider value for
          // operator-side whitelist extension.
          detectedPaymentMethod: detectedMethod,
          rawPaymentMethod: payload.PaymentMethod ?? null,
        },
      })

      // Operator notification — best-effort. A Resend outage must NOT
      // break the webhook ACK to CloudPayments (which would make CP
      // re-fire the Pay webhook, double-marking the order). All errors
      // get swallowed + warn'd here; the order is already paid in DB
      // and audit captured the transition, so the operator can still
      // see the event by other means even if email never arrives.
      try {
        const result = await sendOperatorPaymentNotification({
          invoiceId: order.invoiceId,
          amountRub: order.amountRub,
          customerEmail: order.customerEmail,
          transactionId: payload.TransactionId ?? null,
          paymentMethod: payload.PaymentMethod ?? null,
          customerComment: order.customerComment ?? null,
        })
        if (!result.ok && result.reason === 'no_recipient') {
          // No-op path — OPERATOR_NOTIFY_EMAIL not configured. Don't
          // log to keep webhook journal noise low.
        } else if (!result.ok) {
          console.warn('[notify] operator payment email failed:', result)
        }
      } catch (err) {
        console.warn('[notify] operator payment email threw:', {
          invoiceId: order.invoiceId,
          error: err instanceof Error ? err.message : String(err),
        })
      }

      // Phase 6: if the order's metadata names a slotId, write a
      // payment_allocations row binding this paid invoice to that
      // slot. Best-effort: a failed allocation insert MUST NOT block
      // the webhook ack — the order is already paid in DB and audit
      // captured the transition, so the operator can stitch the slot
      // ↔ payment link manually if needed.
      //
      // Codex 2026-05-08 (HIGH defence-in-depth) — re-verify ownership
      // and tariff-match here even though /api/payments already
      // gated. Webhooks land at a different trust boundary (HMAC, no
      // session); a future regression that reintroduces an unguarded
      // path to set order.metadata.slotId must not produce a poisoned
      // allocation. We look up the customer's account by email and
      // run the same `validatePaymentSlotBinding` predicate. On
      // mismatch we skip the insert and audit-log it.
      try {
        const fullOrder = await getOrder(order.invoiceId)
        const metaSlotId = fullOrder?.metadata?.slotId
        if (typeof metaSlotId === 'string' && metaSlotId) {
          const customerAccount = await getAccountByEmail(order.customerEmail)
          if (!customerAccount) {
            console.warn('[allocations] webhook skipping allocation — no account for customerEmail', {
              invoiceId: order.invoiceId,
              slotId: metaSlotId,
            })
          } else {
            const verdict = await validatePaymentSlotBinding({
              slotId: metaSlotId,
              learnerAccountId: customerAccount.id,
              amountRub: order.amountRub,
            })
            if (!verdict.ok) {
              console.warn(
                '[allocations] webhook REFUSED allocation — slot binding mismatch (defence-in-depth)',
                {
                  invoiceId: order.invoiceId,
                  slotId: metaSlotId,
                  reason: verdict.reason,
                  detail: verdict.detail ?? null,
                },
              )
            } else {
              await recordAllocation({
                paymentOrderId: order.invoiceId,
                kind: 'lesson_slot',
                targetId: metaSlotId,
                amountKopecks: rublesToKopecks(order.amountRub),
              })
            }
          }
        }
      } catch (err) {
        console.warn('[allocations] webhook recordAllocation threw:', {
          invoiceId: order.invoiceId,
          error: err instanceof Error ? err.message : String(err),
        })
      }

      // Billing wave PR 2 — package grant branch.
      //
      // If the order's metadata names a packageId (post-PR-382) OR
      // packageSlug (legacy in-flight orders), dispatch to the shared
      // grant flow (lib/billing/package-grant.ts) which implements
      // dual-source ownership corroboration with eight semantic-failure
      // reasons (last one: already_owns_active_package — cross-flow
      // anti-stacking, PKG-ADMIN-GRANT 2026-05-16). The grant flow
      // itself resolves the package via id-first / slug-fallback
      // (round-28 BLOCKER #1 closure, SAAS-PIVOT Epic 3 Day 4).
      // Operational failures rethrow → CloudPayments retries naturally.
      try {
        const fullOrderForPkg = await getOrder(order.invoiceId)
        const metaPackageId = fullOrderForPkg?.metadata?.packageId
        const metaPackageSlug = fullOrderForPkg?.metadata?.packageSlug
        const hasPackageIdent =
          (typeof metaPackageId === 'string' && metaPackageId)
          || (typeof metaPackageSlug === 'string' && metaPackageSlug)
        if (hasPackageIdent) {
          await processPackageGrant(order.invoiceId)
        }
      } catch (err) {
        console.warn('[package.grant] webhook handler threw, will retry:', {
          invoiceId: order.invoiceId,
          error: err instanceof Error ? err.message : String(err),
        })
        throw err
      }

      // A2 — saas teacher-subscription branch.
      //
      // If the order's metadata names a saas_subscription_{mid,pro}
      // productKind, activate or renew the teacher's subscription row.
      // Idempotency: check by payment_order_id first; if the order was
      // already applied (e.g. CloudPayments re-fired the webhook), the
      // second call is a no-op.
      //
      // teacher_account_id on the order is the canonical owning teacher
      // (set at create-time from session.account.id). It is preferred
      // over metadata.accountId. Both should agree by construction.
      try {
        const fullOrderForSub = await getOrder(order.invoiceId)
        const productKind = fullOrderForSub?.metadata?.productKind
        const isSaasSub =
          typeof productKind === 'string' &&
          productKind.startsWith('saas_subscription_')
        if (isSaasSub) {
          const tier = productKind.replace('saas_subscription_', '')
          const tariff = getSubscriptionTariff(tier)
          const teacherAccountId =
            (typeof fullOrderForSub?.teacherAccountId === 'string'
              ? fullOrderForSub.teacherAccountId
              : null) ??
            (typeof fullOrderForSub?.metadata?.accountId === 'string'
              ? (fullOrderForSub.metadata.accountId as string)
              : null)
          if (!tariff || !teacherAccountId) {
            console.warn('[teacher.subscription] webhook missing tier or accountId', {
              invoiceId: order.invoiceId,
              productKind,
              teacherAccountId,
            })
          } else {
            const existing = await findSubscriptionByPaymentOrderId(order.invoiceId)
            if (!existing) {
              await createOrRenewTeacherSubscription({
                accountId: teacherAccountId,
                tier: tariff.tier,
                amountKopecks: tariff.amountKopecks,
                paymentOrderId: order.invoiceId,
                cpToken:
                  typeof payload.Token === 'string' && payload.Token.length > 0
                    ? payload.Token
                    : null,
              })
              await recordPaymentAuditEvent({
                eventType: 'webhook.pay.processed',
                invoiceId: order.invoiceId,
                customerEmail: order.customerEmail,
                amountKopecks: tariff.amountKopecks,
                toStatus: order.status,
                actor: 'webhook:cloudpayments:pay',
                payload: { tier: tariff.tier, productKind },
              })
            }
          }
        }
      } catch (err) {
        console.warn(
          '[teacher.subscription] webhook handler threw, will retry:',
          {
            invoiceId: order.invoiceId,
            error: err instanceof Error ? err.message : String(err),
          },
        )
        throw err
      }
    }
  } })
}

