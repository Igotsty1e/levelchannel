import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import {
  type AccountRole,
  grantAccountRole,
  revokeAccountRole,
} from '@/lib/auth/accounts'
import { requireAdminRole } from '@/lib/auth/guards'
import { withIdempotency } from '@/lib/security/idempotency'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'


const ALLOWED_ROLES = new Set<AccountRole>(['admin', 'teacher', 'student'])

type RouteParams = { params: Promise<{ id: string }> }

// POST /api/admin/accounts/[id]/role
//   { role: 'admin' | 'teacher' | 'student', op: 'grant' | 'revoke' }
//
// Self-protection: an admin can revoke `admin` from another account
// but not from themselves — prevents an accidental "revoke last admin"
// foot-gun. (CLI script can recover, but that's an extra step.)
//
// AUDIT-CODE-1 (2026-05-17): wrapped in withIdempotency for
// SEQUENTIAL same-key replay dedup. CONCURRENT same-key fire MAY
// still execute the executor twice — see contract on
// lib/security/idempotency.ts. grantAccountRole and
// revokeAccountRole are idempotent in effect (ON CONFLICT on grant,
// DELETE on revoke). The current path emits no audit row and no
// notification email, so duplicate executor invocation produces
// only redundant DB statements, no externally-visible noise.

export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params

  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(request, 'admin:role:ip', 30, 60_000)
  if (rl) return rl

  const guard = await requireAdminRole(request)
  if (!guard.ok) return guard.response

  let rawBody: string
  let raw: { role?: unknown; op?: unknown } = {}
  try {
    rawBody = await request.text()
    raw = rawBody.length > 0 ? JSON.parse(rawBody) : {}
  } catch {
    return NextResponse.json(
      { error: 'invalid_body', message: 'Body must be valid JSON.' },
      { status: 400, headers: NO_STORE },
    )
  }

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

  return withIdempotency(
    request,
    `admin:accounts:role:${id}:${role}:${op}:${guard.account.id}`,
    rawBody,
    async () => {
      try {
        if (op === 'grant') {
          await grantAccountRole(id, role as AccountRole, guard.account.id)
          // free-tier-saas-card-and-subscription-row plan §0b-1 closure:
          // when admin grants the 'teacher' role, insert the implicit
          // Стартовый subscription row so the new teacher gets
          // TIER_WRITE_CAPS.free (1 пакет + 1 тариф). Without this,
          // admin-promoted teachers would hit EMPTY_CAPS (same bug as
          // self-register). ON CONFLICT keeps it idempotent. Failure is
          // FATAL — falls through to the existing catch + 500 branch.
          if (role === 'teacher') {
            const { getDbPool } = await import('@/lib/db/pool')
            await getDbPool().query(
              `insert into teacher_subscriptions (account_id, plan_slug, state)
               values ($1::uuid, 'free', 'active')
               on conflict (account_id) do nothing`,
              [id],
            )
          }
        } else {
          await revokeAccountRole(id, role as AccountRole)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown'
        if (msg === 'role/admin_exclusive') {
          return {
            status: 400,
            body: {
              error:
                'Аккаунт с ролью admin не может быть одновременно teacher или student. Сначала отзовите admin.',
            },
          }
        }
        console.warn('[admin.accounts.role] unexpected error', {
          accountId: id,
          role,
          op,
          error: msg,
        })
        return {
          status: 500,
          body: { error: 'internal_error' },
        }
      }
      return { status: 200, body: { ok: true } }
    },
  )
}
