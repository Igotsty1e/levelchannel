import { listAccountRoles } from '@/lib/auth/accounts'
import { getCurrentSession } from '@/lib/auth/sessions'

// RECEIPT-3DS-TOKEN (2026-05-16) — shared consumer-side anti-spoof
// for `evaluateReceiptGate({ sessionAccountId })`.
//
// The receipt-token gate is dumb: it only compares
// `sessionAccountId` against `order.metadata.accountId`. The
// consumer (route handler) decides which sessions to trust. We
// MUST NOT trust admin or teacher sessions — they have a separate
// surface (`/admin/payments/[invoiceId]`) with a separate audit
// trail; threading their session into the learner-side gate would
// silently grant them access to every order.
//
// The check is intentionally LIGHTER than `isLearnerArchetypeCandidate`
// (which also requires verified email + non-deletion-grace state).
// Reason: the saved-card 3DS path doesn't require verified email
// today (charge-token/route.ts:58-85 has no verify gate); using
// the heavier predicate would leave unverified saved-card buyers
// on the broken /thank-you path even after this fix. Reading your
// own payment status is strictly less-privileged than initiating
// a new payment, so the lighter check is the right scope.
export async function resolveSessionAccountIdForReceiptGate(
  request: Request,
): Promise<string | null> {
  const session = await getCurrentSession(request)
  if (!session) return null
  const roles = await listAccountRoles(session.account.id)
  if (roles.includes('admin') || roles.includes('teacher')) {
    return null
  }
  return session.account.id
}
