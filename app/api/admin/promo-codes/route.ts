import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { readJsonObjectOr400 } from '@/lib/api/json-body'
import { requireAdminRole } from '@/lib/auth/guards'
import { getDbPool } from '@/lib/db/pool'
import { createPromoCode } from '@/lib/promo/codes'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const rl = await enforceRateLimit(request, 'admin:promo:ip', 60, 60_000)
  if (rl) return rl
  const guard = await requireAdminRole(request)
  if (!guard.ok) return guard.response

  const pool = getDbPool()
  const result = await pool.query(
    `select id, code, description, grant_plan_slug, grant_days,
            max_redemptions, redemption_count,
            valid_from, valid_until, created_at, revoked_at,
            revoked_reason, requires_email_verified
       from promo_codes
      order by created_at desc
      limit 200`,
  )
  return NextResponse.json({ rows: result.rows }, { status: 200, headers: NO_STORE })
}

export async function POST(request: Request) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate
  const rl = await enforceRateLimit(request, 'admin:promo:ip', 30, 60_000)
  if (rl) return rl
  const guard = await requireAdminRole(request)
  if (!guard.ok) return guard.response

  const parsed = await readJsonObjectOr400(request)
  if (!parsed.ok) return parsed.response
  const raw = parsed.body

  const code = typeof raw.code === 'string' ? raw.code : ''
  const grantPlanSlug = typeof raw.grantPlanSlug === 'string' ? raw.grantPlanSlug : 'pro'
  const grantDays = typeof raw.grantDays === 'number' ? raw.grantDays : 0
  const description = typeof raw.description === 'string' ? raw.description : null
  const maxRedemptionsRaw = raw.maxRedemptions
  const maxRedemptions =
    typeof maxRedemptionsRaw === 'number'
      ? maxRedemptionsRaw
      : maxRedemptionsRaw === null || maxRedemptionsRaw === undefined
        ? null
        : Number(maxRedemptionsRaw)
  const validUntilRaw = typeof raw.validUntil === 'string' ? raw.validUntil : null
  const requiresEmailVerified =
    typeof raw.requiresEmailVerified === 'boolean' ? raw.requiresEmailVerified : true

  let validUntil: Date | null = null
  if (validUntilRaw && validUntilRaw.trim() !== '') {
    const d = new Date(validUntilRaw)
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json(
        { error: 'validUntil/invalid_date' },
        { status: 400, headers: NO_STORE },
      )
    }
    validUntil = d
  }

  const pool = getDbPool()
  const client = await pool.connect()
  try {
    const result = await createPromoCode(client, {
      code,
      description,
      grantPlanSlug,
      grantDays,
      maxRedemptions: maxRedemptions ?? null,
      validFrom: null,
      validUntil,
      requiresEmailVerified,
      createdByAccountId: guard.account.id,
    })
    const row = await client.query(
      `select id, code, description, grant_plan_slug as "grantPlanSlug",
              grant_days as "grantDays",
              max_redemptions as "maxRedemptions",
              redemption_count as "redemptionCount",
              valid_from as "validFrom",
              valid_until as "validUntil",
              created_at as "createdAt",
              revoked_at as "revokedAt"
         from promo_codes
        where id = $1::uuid`,
      [result.id],
    )
    return NextResponse.json(row.rows[0], { status: 201, headers: NO_STORE })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown_error'
    if (message.startsWith('promo/')) {
      return NextResponse.json({ error: message }, { status: 400, headers: NO_STORE })
    }
    if (message.includes('promo_codes_code_key')) {
      return NextResponse.json(
        { error: 'code/already_taken' },
        { status: 409, headers: NO_STORE },
      )
    }
    throw err
  } finally {
    client.release()
  }
}
