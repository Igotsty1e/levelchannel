import { NextResponse } from 'next/server'

import { listAccountRoles } from '@/lib/auth/accounts'
import {
  buildSessionClearCookie,
  getCurrentSession,
} from '@/lib/auth/sessions'
import { enforceRateLimit } from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/auth/me
//
// Bootstrap endpoint for the cabinet UI: same-origin read, no origin
// gate (cabinet client JS calls this on mount). Returns the resolved
// account + session, or 401 with cookie cleared.

const noStore = { 'Cache-Control': 'no-store, max-age=0' }
const isProd = process.env.NODE_ENV === 'production'

export async function GET(request: Request) {
  const rl = enforceRateLimit(request, 'auth:me:ip', 60, 60_000)
  if (rl) return rl

  const current = await getCurrentSession(request)

  if (!current) {
    return NextResponse.json(
      { error: 'Not authenticated.' },
      {
        status: 401,
        headers: {
          ...noStore,
          'Set-Cookie': buildSessionClearCookie(isProd),
        },
      },
    )
  }

  const roles = await listAccountRoles(current.account.id)

  return NextResponse.json(
    {
      account: {
        id: current.account.id,
        email: current.account.email,
        emailVerifiedAt: current.account.emailVerifiedAt,
        disabledAt: current.account.disabledAt,
        roles,
      },
      session: {
        id: current.session.id,
        expiresAt: current.session.expiresAt,
      },
    },
    { status: 200, headers: noStore },
  )
}
