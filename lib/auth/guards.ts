import { NextResponse } from 'next/server'

import { type Account, listAccountRoles } from '@/lib/auth/accounts'
import { type Session, getCurrentSession } from '@/lib/auth/sessions'

export type GuardResult =
  | { ok: true; account: Account; session: Session }
  | { ok: false; response: NextResponse }

// One-stop session guard for cabinet API routes. Returns the resolved
// account + session, or a NextResponse the caller should immediately
// `return` (401 with no-store headers, no cookie clear — the cabinet's
// /api/auth/me does the clear; chained 401 from a different surface
// should not double-stamp the cookie).
export async function requireAuthenticated(
  request: Request,
): Promise<GuardResult> {
  const current = await getCurrentSession(request)
  if (!current) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Not authenticated.' },
        { status: 401, headers: { 'Cache-Control': 'no-store, max-age=0' } },
      ),
    }
  }
  return { ok: true, account: current.account, session: current.session }
}

// Admin-only gate for /api/admin/* and the /admin SSR pages. Reuses
// requireAuthenticated, then checks the role list. 401 is returned to
// anonymous; 403 is returned to a logged-in non-admin so the UI can
// distinguish "your session is gone" from "you can't be here".
export async function requireAdminRole(request: Request): Promise<GuardResult> {
  const auth = await requireAuthenticated(request)
  if (!auth.ok) return auth
  const roles = await listAccountRoles(auth.account.id)
  if (!roles.includes('admin')) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Forbidden.' },
        { status: 403, headers: { 'Cache-Control': 'no-store, max-age=0' } },
      ),
    }
  }
  return { ok: true, account: auth.account, session: auth.session }
}
