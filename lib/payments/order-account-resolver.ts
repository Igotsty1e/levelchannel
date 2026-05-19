import { listAccountRoles } from '@/lib/auth/accounts'
import { getCurrentSession } from '@/lib/auth/sessions'

// SBP-PAY (2026-05-19, §0a BLOCKER#4 + §0b WARN#2 closures) — resolve
// the account-id we attach to a freshly-created order's metadata so
// the receipt-token gate's session-fallback path can validate
// deep-link returns from the bank app to `/thank-you?invoiceId=X`
// (no token in URL on a fresh-browser-tab deep-link).
//
// Trust boundary differential vs `resolveSessionAccountIdForReceiptGate`
// in `lib/payments/receipt-gate-session.ts`:
//
//   - That gate (the READER) rejects BOTH admin AND teacher roles —
//     the threat model is "logged-in admin/teacher should NOT be able
//     to read an arbitrary learner's order via session-fallback".
//
//   - This resolver (the WRITER) rejects ONLY admin. Writing your own
//     account.id into your own order's metadata is strictly less-
//     privileged than reading any order via the session-fallback.
//     Teacher-archetype sessions ARE allowed — a teacher paying for
//     a personal course should not lose access to deep-link-back.
//
//   - Learner-with-teacher hybrid sessions: this resolver attaches
//     accountId (so the order is "owned" by the right account). The
//     deep-link return path's anti-spoof still blocks teacher
//     sessions from session-fallback bypass, so a learner-teacher
//     hybrid returning from the bank app on a fresh tab WON'T benefit
//     from the fallback — they need same-tab token. This is the
//     acceptable asymmetry documented in §1.4 + §R3 WARN#2 closure.
//
// Returns null on:
//   - guest (no session)
//   - admin session
//   - account-roles lookup error (defence-in-depth — fail closed)
export async function resolveOrderAccountIdForCreate(
  request: Request,
): Promise<string | null> {
  const session = await getCurrentSession(request)
  if (!session) return null

  try {
    const roles = await listAccountRoles(session.account.id)
    if (roles.includes('admin')) {
      return null
    }
    return session.account.id
  } catch {
    // Auth store hiccup → fail closed (don't attach an accountId we
    // can't validate the role of). Order is still created as guest;
    // user keeps the token in browser state for same-tab return.
    return null
  }
}
