import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { readJsonObjectOr400 } from '@/lib/api/json-body'
import { requireAdminRole } from '@/lib/auth/guards'
import { getDbPool } from '@/lib/db/pool'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type RouteParams = { params: Promise<{ id: string }> }

// Billing wave PR 4 — toggle accounts.postpaid_allowed. Operator-only.
// Postpaid is opt-in per design v9 (admin-flag, default false). New
// clients get prepaid-only; loyal long-term clients get the toggle
// flipped after a track record of paid orders.

export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params

  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(request, 'admin:postpaid:ip', 30, 60_000)
  if (rl) return rl

  const guard = await requireAdminRole(request)
  if (!guard.ok) return guard.response

  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json(
      { error: 'invalid_account_id' },
      { status: 400, headers: NO_STORE },
    )
  }

  const parsed = await readJsonObjectOr400(request)
  if (!parsed.ok) return parsed.response
  const allowed =
    typeof parsed.body.allowed === 'boolean' ? parsed.body.allowed : null
  if (allowed === null) {
    return NextResponse.json(
      { error: 'allowed (boolean) is required' },
      { status: 400, headers: NO_STORE },
    )
  }

  const pool = getDbPool()
  const result = await pool.query(
    `update accounts set postpaid_allowed = $2 where id = $1 returning id, postpaid_allowed`,
    [id, allowed],
  )
  if (result.rows.length === 0) {
    return NextResponse.json(
      { error: 'account_not_found' },
      { status: 404, headers: NO_STORE },
    )
  }
  return NextResponse.json(
    { accountId: id, postpaidAllowed: Boolean(result.rows[0].postpaid_allowed) },
    { status: 200, headers: NO_STORE },
  )
}
