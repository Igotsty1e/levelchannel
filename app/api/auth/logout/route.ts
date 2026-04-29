import { NextResponse } from 'next/server'

import {
  buildSessionClearCookie,
  getCurrentSession,
  revokeSession,
} from '@/lib/auth/sessions'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
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
  const rl = enforceRateLimit(request, 'auth:logout:ip', 60, 60_000)
  if (rl) return rl

  const origin = enforceTrustedBrowserOrigin(request)
  if (origin) return origin

  const current = await getCurrentSession(request)
  if (current) {
    await revokeSession(current.session.id)
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
