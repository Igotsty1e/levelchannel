// PKG-RECON RECON.1 — operator-facing list of paid_not_granted
// orders. The /admin/reconciliation/package-grants page reads this
// endpoint for the operator queue.
//
// Per plan §4.11 (round 1 WARN #12 closure) — explicit auth shape:
// origin → rate-limit → admin role. Same discipline as the POST
// action routes (which ship in RECON.2-4).

import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { requireAdminRole } from '@/lib/auth/guards'
import { listPaidNotGrantedOrders } from '@/lib/billing/paid-not-granted'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(
    request,
    'admin:reconciliation:list:ip',
    30,
    60_000,
  )
  if (rl) return rl

  const auth = await requireAdminRole(request)
  if (!auth.ok) return auth.response

  const url = new URL(request.url)
  const limitParam = Number(url.searchParams.get('limit') ?? '50')
  const offsetParam = Number(url.searchParams.get('offset') ?? '0')
  const limit =
    Number.isFinite(limitParam) && limitParam > 0
      ? Math.min(limitParam, 200)
      : 50
  const offset =
    Number.isFinite(offsetParam) && offsetParam >= 0 ? offsetParam : 0

  const result = await listPaidNotGrantedOrders({ limit, offset })
  return NextResponse.json(
    {
      orders: result.rows,
      total: result.total,
      limit,
      offset,
    },
    { headers: NO_STORE },
  )
}
