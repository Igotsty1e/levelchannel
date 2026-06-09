import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { readJsonObjectOr400 } from '@/lib/api/json-body'
import { requireTeacherAndVerified } from '@/lib/auth/guards'
import { getDbPool } from '@/lib/db/pool'
import { PromoRedeemError, redeemPromoCode } from '@/lib/promo/codes'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
  getClientIp,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate
  const rl = await enforceRateLimit(request, 'teacher:promo:redeem:ip', 5, 60_000)
  if (rl) return rl
  const guard = await requireTeacherAndVerified(request)
  if (!guard.ok) return guard.response

  const parsed = await readJsonObjectOr400(request)
  if (!parsed.ok) return parsed.response
  const code = typeof parsed.body.code === 'string' ? parsed.body.code : ''
  if (!code.trim()) {
    return NextResponse.json(
      { error: 'code/required' },
      { status: 400, headers: NO_STORE },
    )
  }

  const pool = getDbPool()
  const client = await pool.connect()
  try {
    await client.query('begin')
    const result = await redeemPromoCode(client, {
      codeRaw: code,
      accountId: guard.account.id,
      ip: getClientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    await client.query('commit')
    return NextResponse.json(
      {
        ok: true,
        grantedPlanSlug: result.grantedPlanSlug,
        grantedDays: result.grantedDays,
        grantedUntil: result.grantedUntil.toISOString(),
      },
      { status: 200, headers: NO_STORE },
    )
  } catch (err) {
    await client.query('rollback').catch(() => {})
    if (err instanceof PromoRedeemError) {
      const httpStatus = err.reason === 'unknown_code' ? 404 : 400
      return NextResponse.json(
        { error: err.reason, meta: err.meta ?? null },
        { status: httpStatus, headers: NO_STORE },
      )
    }
    throw err
  } finally {
    client.release()
  }
}
