import { NextResponse } from 'next/server'

import { recordAuthAuditEvent } from '@/lib/audit/auth-events'
import {
  buildSessionClearCookie,
  getCurrentSession,
  revokeSession,
} from '@/lib/auth/sessions'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
  getClientIp,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/auth/logout
//
// Revoke current session, clear cookie. Replay-safe: missing or already-
// revoked session is a no-op. Always returns 200 so the client can blindly
// "log out" without distinguishing "had session" from "didn't".

const noStore = { 'Cache-Control': 'no-store, max-age=0' }
const isProd = process.env.NODE_ENV === 'production'

export async function POST(request: Request) {
  const rl = await enforceRateLimit(request, 'auth:logout:ip', 60, 60_000)
  if (rl) return rl

  const origin = enforceTrustedBrowserOrigin(request)
  if (origin) return origin

  const current = await getCurrentSession(request)
  if (current) {
    await revokeSession(current.session.id)
    // Wave 5 — explicit session-revocation audit. Distinct from the
    // janitor's bulk revoke (`scripts/db-retention-cleanup.mjs`) so the
    // alert query can tell user-driven logout from background cleanup.
    await recordAuthAuditEvent({
      eventType: 'auth.session.revoked',
      accountId: current.account.id,
      email: current.account.email,
      clientIp: getClientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
  }

  return NextResponse.json(
    { ok: true },
    {
      status: 200,
      headers: {
        ...noStore,
        'Set-Cookie': buildSessionClearCookie(isProd),
      },
    },
  )
}
