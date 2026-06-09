import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { readJsonObjectOr400 } from '@/lib/api/json-body'
import { requireAdminRole } from '@/lib/auth/guards'
import { getDbPool } from '@/lib/db/pool'
import { revokePromoCode } from '@/lib/promo/codes'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate
  const rl = await enforceRateLimit(request, 'admin:promo:revoke:ip', 30, 60_000)
  if (rl) return rl
  const guard = await requireAdminRole(request)
  if (!guard.ok) return guard.response

  const { id } = await params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'id/invalid' }, { status: 400, headers: NO_STORE })
  }
  const parsed = await readJsonObjectOr400(request)
  if (!parsed.ok) return parsed.response
  const reason = typeof parsed.body.reason === 'string' ? parsed.body.reason : ''
  if (!reason.trim()) {
    return NextResponse.json(
      { error: 'reason/required' },
      { status: 400, headers: NO_STORE },
    )
  }

  const pool = getDbPool()
  const client = await pool.connect()
  try {
    await revokePromoCode(client, id, reason.slice(0, 200))
    return NextResponse.json({ ok: true }, { status: 200, headers: NO_STORE })
  } finally {
    client.release()
  }
}
