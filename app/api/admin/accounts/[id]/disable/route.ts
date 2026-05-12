import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { readJsonObjectOr400 } from '@/lib/api/json-body'
import { disableAccount, reenableAccount } from '@/lib/auth/accounts'
import { requireAdminRole } from '@/lib/auth/guards'
import { revokeAllSessionsForAccount } from '@/lib/auth/sessions'
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

export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params

  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(request, 'admin:disable:ip', 30, 60_000)
  if (rl) return rl

  const guard = await requireAdminRole(request)
  if (!guard.ok) return guard.response

  const parsed = await readJsonObjectOr400(request)
  if (!parsed.ok) return parsed.response
  if (typeof parsed.body.disabled !== 'boolean') {
    return NextResponse.json(
      {
        error: 'invalid_body',
        message: 'Body must be { disabled: boolean }.',
      },
      { status: 400, headers: NO_STORE },
    )
  }
  const disabled = parsed.body.disabled
  if (disabled && id === guard.account.id) {
    return NextResponse.json(
      {
        error: 'cannot_disable_self',
        message: 'Cannot disable yourself.',
      },
      { status: 400, headers: NO_STORE },
    )
  }

  if (disabled) {
    await disableAccount(id)
    await revokeAllSessionsForAccount(id)
  } else {
    await reenableAccount(id)
  }

  return NextResponse.json({ ok: true }, { status: 200, headers: NO_STORE })
}
