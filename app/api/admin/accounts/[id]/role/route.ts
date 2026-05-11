import { NextResponse } from 'next/server'

import { readJsonObjectOr400 } from '@/lib/api/json-body'
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

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' }

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

  const parsed = await readJsonObjectOr400(request)
  if (!parsed.ok) return parsed.response
  const raw = parsed.body
  const role = typeof raw.role === 'string' ? raw.role : ''
  const op = typeof raw.op === 'string' ? raw.op : ''
  if (!ALLOWED_ROLES.has(role as AccountRole)) {
    return NextResponse.json(
      {
        error: 'invalid_role',
        message: 'role must be one of: admin, teacher, student.',
      },
      { status: 400, headers: NO_STORE },
    )
  }
  if (op !== 'grant' && op !== 'revoke') {
    return NextResponse.json(
      {
        error: 'invalid_op',
        message: 'op must be "grant" or "revoke".',
      },
      { status: 400, headers: NO_STORE },
    )
  }

  if (op === 'revoke' && role === 'admin' && id === guard.account.id) {
    return NextResponse.json(
      {
        error: 'cannot_revoke_admin_self',
        message: 'Cannot revoke admin from yourself.',
      },
      { status: 400, headers: NO_STORE },
    )
  }

  try {
    if (op === 'grant') {
      await grantAccountRole(id, role as AccountRole, guard.account.id)
    } else {
      await revokeAccountRole(id, role as AccountRole)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    if (msg === 'role/admin_exclusive') {
      return NextResponse.json(
        {
          error:
            'Аккаунт с ролью admin не может быть одновременно teacher или student. Сначала отзовите admin.',
        },
        { status: 400, headers: NO_STORE },
      )
    }
    console.warn('[admin.accounts.role] unexpected error', {
      accountId: id,
      role,
      op,
      error: msg,
    })
    return NextResponse.json(
      { error: 'internal_error' },
      { status: 500, headers: NO_STORE },
    )
  }

  return NextResponse.json({ ok: true }, { status: 200, headers: NO_STORE })
}
