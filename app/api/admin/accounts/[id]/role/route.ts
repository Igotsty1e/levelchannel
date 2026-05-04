import { NextResponse } from 'next/server'

import {
  type AccountRole,
  grantAccountRole,
  revokeAccountRole,
} from '@/lib/auth/accounts'
import { requireAdminRole } from '@/lib/auth/guards'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const noStore = { 'Cache-Control': 'no-store, max-age=0' }

const ALLOWED_ROLES = new Set<AccountRole>(['admin', 'teacher', 'student'])

type RouteParams = { params: Promise<{ id: string }> }

// POST /api/admin/accounts/[id]/role
//   { role: 'admin' | 'teacher' | 'student', op: 'grant' | 'revoke' }
//
// Self-protection: an admin can revoke `admin` from another account
// but not from themselves — prevents an accidental "revoke last admin"
// foot-gun. (CLI script can recover, but that's an extra step.)

export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params

  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(request, 'admin:role:ip', 30, 60_000)
  if (rl) return rl

  const guard = await requireAdminRole(request)
  if (!guard.ok) return guard.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body.' },
      { status: 400, headers: noStore },
    )
  }
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json(
      { error: 'Body must be a JSON object.' },
      { status: 400, headers: noStore },
    )
  }
  const raw = body as Record<string, unknown>
  const role = typeof raw.role === 'string' ? raw.role : ''
  const op = typeof raw.op === 'string' ? raw.op : ''
  if (!ALLOWED_ROLES.has(role as AccountRole)) {
    return NextResponse.json(
      { error: 'role must be one of: admin, teacher, student.' },
      { status: 400, headers: noStore },
    )
  }
  if (op !== 'grant' && op !== 'revoke') {
    return NextResponse.json(
      { error: 'op must be "grant" or "revoke".' },
      { status: 400, headers: noStore },
    )
  }

  if (op === 'revoke' && role === 'admin' && id === guard.account.id) {
    return NextResponse.json(
      { error: 'Cannot revoke admin from yourself.' },
      { status: 400, headers: noStore },
    )
  }

  if (op === 'grant') {
    await grantAccountRole(id, role as AccountRole, guard.account.id)
  } else {
    await revokeAccountRole(id, role as AccountRole)
  }

  return NextResponse.json({ ok: true }, { status: 200, headers: noStore })
}
