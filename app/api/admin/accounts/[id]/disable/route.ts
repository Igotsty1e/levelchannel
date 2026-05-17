import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { disableAccount, reenableAccount } from '@/lib/auth/accounts'
import { requireAdminRole } from '@/lib/auth/guards'
import { revokeAllSessionsForAccount } from '@/lib/auth/sessions'
import { withIdempotency } from '@/lib/security/idempotency'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'


type RouteParams = { params: Promise<{ id: string }> }

// POST /api/admin/accounts/[id]/disable  { disabled: boolean }
//
// disabled=true: stamp disabled_at, revoke sessions.
// disabled=false: clear disabled_at AND scheduled_purge_at (mirror of
// the deletion-cancel flow); only valid if the row hasn't been purged.
//
// Self-protection: cannot disable yourself.
//
// AUDIT-CODE-1 (2026-05-17): wrapped in withIdempotency so a
// SEQUENTIAL same-key replay (UI retries, browser back+forward,
// network-flap auto-retry where the client reuses the
// Idempotency-Key) skips re-running disableAccount +
// revokeAllSessionsForAccount on retry. Scope keyed on (id,
// operator) — two different operators can still issue independent
// disables.
//
// CONCURRENT same-key fire (two parallel POSTs within the
// executor's runtime window) MAY still execute both side effects —
// see the contract note on lib/security/idempotency.ts. In
// practice this requires an explicitly racing client; the admin UI
// uses one form-submit per click, so concurrent same-key is
// operator-initiated only. The underlying mutations are idempotent
// in effect (`disabled_at = coalesce(disabled_at, now())`,
// `revokeAllSessionsForAccount` is `UPDATE ... WHERE revoked_at IS
// NULL`) — there's no audit-row emission or operator email on this
// path, so a duplicate executor invocation produces no extra side
// effects beyond the two redundant SQL statements.

export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params

  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(request, 'admin:disable:ip', 30, 60_000)
  if (rl) return rl

  const guard = await requireAdminRole(request)
  if (!guard.ok) return guard.response

  let rawBody: string
  let body: { disabled?: unknown } = {}
  try {
    rawBody = await request.text()
    body = rawBody.length > 0 ? JSON.parse(rawBody) : {}
  } catch {
    return NextResponse.json(
      { error: 'invalid_body', message: 'Body must be valid JSON.' },
      { status: 400, headers: NO_STORE },
    )
  }
  if (typeof body.disabled !== 'boolean') {
    return NextResponse.json(
      {
        error: 'invalid_body',
        message: 'Body must be { disabled: boolean }.',
      },
      { status: 400, headers: NO_STORE },
    )
  }
  const disabled = body.disabled
  if (disabled && id === guard.account.id) {
    return NextResponse.json(
      {
        error: 'cannot_disable_self',
        message: 'Cannot disable yourself.',
      },
      { status: 400, headers: NO_STORE },
    )
  }

  return withIdempotency(
    request,
    `admin:accounts:disable:${id}:${guard.account.id}`,
    rawBody,
    async () => {
      if (disabled) {
        await disableAccount(id)
        await revokeAllSessionsForAccount(id)
      } else {
        await reenableAccount(id)
      }
      return { status: 200, body: { ok: true } }
    },
  )
}
