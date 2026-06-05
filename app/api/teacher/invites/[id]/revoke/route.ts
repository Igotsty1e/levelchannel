import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { recordAuthAuditEvent } from '@/lib/audit/auth-events'
import {
  MutationGateAbort,
  requireTeacherAndVerified,
  runInSaasOfferMutationGate,
} from '@/lib/auth/guards'
import { revokeInvite } from '@/lib/auth/teacher-invites'
import { enforceAccountRateLimit } from '@/lib/security/account-rate-limit'
import {
  enforceTrustedBrowserOrigin,
  getClientIp,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// SAAS-3+4 TINV.4 (2026-05-18) — revoke an unused invite.
//
// 2026-06-04 — saas-offer-mutation-wrapper-poc: migrated from the
// single-step `requireTeacherWithCurrentSaasOfferConsent` guard to the
// race-safe 2-step pattern (`requireTeacherAndVerified` →
// `enforceAccountRateLimit` → `runInSaasOfferMutationGate`). Plan:
// docs/plans/saas-offer-mutation-wrapper-rollout-poc.md (SIGN-OFF
// round 5/3, 2026-06-05). Drift-pinned by
// tests/security/saas-offer-mutation-gate-perimeter.test.ts.
//
// Perimeter ordering (per-route, NOT uniform across PoC routes):
//   origin → auth → account-RL → gate.
// Account-RL goes AFTER auth because the bucket key is the
// authenticated account id.
//
// Ownership is encoded in the WHERE clause inside `revokeInvite`:
// teacher B cannot revoke teacher A's invite. A miss (wrong-id OR
// wrong-owner OR already-used OR already-revoked) collapses to 404
// to avoid id-existence enumeration. See plan §3.6 + §6.7-revoke.

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const origin = enforceTrustedBrowserOrigin(request)
  if (origin) return origin

  const auth = await requireTeacherAndVerified(request)
  if (!auth.ok) return auth.response

  const rl = await enforceAccountRateLimit(
    auth.account.id,
    'invite-revoke',
    30,
    60 * 60_000,
  )
  if (rl) return rl

  const { id } = await context.params

  const result = await runInSaasOfferMutationGate(auth.account.id, async (client) => {
    const ok = await revokeInvite(id, auth.account.id, { client })
    if (!ok) {
      throw MutationGateAbort.fromJson(
        { error: 'not_found', message: 'Приглашение не найдено.' },
        { status: 404, headers: NO_STORE },
      )
    }
    return { ok: true }
  })
  if (result instanceof NextResponse) return result

  // Audit event AFTER commit. Plan §0b-2 + §0c-3: audit uses a separate
  // pool (lib/audit/auth-events.ts) and is best-effort; NOT part of the
  // atomic mutation TX. Check the boolean return value so silent drops
  // are observable.
  const auditOk = await recordAuthAuditEvent({
    eventType: 'auth.invite.revoked',
    accountId: auth.account.id,
    email: auth.account.email,
    clientIp: getClientIp(request),
    userAgent: request.headers.get('user-agent'),
    payload: { inviteId: id },
  })
  if (!auditOk) {
    console.warn('[teacher.invites.revoke] audit-event recorder returned false', {
      accountId: auth.account.id,
      inviteId: id,
    })
  }
  return NextResponse.json({ ok: true }, { status: 200, headers: NO_STORE })
}
