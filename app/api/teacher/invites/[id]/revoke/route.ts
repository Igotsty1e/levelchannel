import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { recordAuthAuditEvent } from '@/lib/audit/auth-events'
import { requireTeacherWithCurrentSaasOfferConsent } from '@/lib/auth/guards'
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

  const auth = await requireTeacherWithCurrentSaasOfferConsent(request)
  if (!auth.ok) return auth.response

  const rl = await enforceAccountRateLimit(
    auth.account.id,
    'invite-revoke',
    30,
    60 * 60_000,
  )
  if (rl) return rl

  const { id } = await context.params
  const ok = await revokeInvite(id, auth.account.id)
  if (!ok) {
    return NextResponse.json(
      { error: 'not_found', message: 'Приглашение не найдено.' },
      { status: 404, headers: NO_STORE },
    )
  }
  await recordAuthAuditEvent({
    eventType: 'auth.invite.revoked',
    accountId: auth.account.id,
    email: auth.account.email,
    clientIp: getClientIp(request),
    userAgent: request.headers.get('user-agent'),
    payload: { inviteId: id },
  })
  return NextResponse.json({ ok: true }, { status: 200, headers: NO_STORE })
}
