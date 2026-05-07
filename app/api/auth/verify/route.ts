import { NextResponse } from 'next/server'

import { recordAuthAuditEvent } from '@/lib/audit/auth-events'
import { getAccountById, markAccountVerified } from '@/lib/auth/accounts'
import {
  buildSessionCookie,
  createSession,
} from '@/lib/auth/sessions'
import { consumeEmailVerification } from '@/lib/auth/verifications'
import { paymentConfig } from '@/lib/payments/config'
import {
  enforceRateLimit,
  getClientIp,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/auth/verify?token=...
//
// Per /plan-eng-review mech-4: NO origin check — clicked from email is
// the intended cross-origin trust path. Token is single-use and TTL'd
// in lib/auth/single-use-tokens.ts.
//
// 303 redirects (no JSON) since this is a click-through landing endpoint.

const isProd = process.env.NODE_ENV === 'production'

function verifyFailedRedirect(): NextResponse {
  return NextResponse.redirect(
    `${paymentConfig.siteUrl}/verify-failed`,
    { status: 303 },
  )
}

export async function GET(request: Request) {
  const rl = await enforceRateLimit(request, 'auth:verify:ip', 20, 60_000)
  if (rl) return rl

  const url = new URL(request.url)
  const token = url.searchParams.get('token') || ''

  const consumed = await consumeEmailVerification(token)
  if (!consumed) {
    return verifyFailedRedirect()
  }

  await markAccountVerified(consumed.accountId)
  const { cookieValue } = await createSession({
    accountId: consumed.accountId,
    ip: getClientIp(request),
    userAgent: request.headers.get('user-agent') || null,
  })

  // Wave 5 — successful verification audit. Best-effort; falling
  // through on a missing-account read keeps the user-visible redirect
  // working even if audit pool is down.
  const account = await getAccountById(consumed.accountId)
  if (account) {
    await recordAuthAuditEvent({
      eventType: 'auth.verify.success',
      accountId: account.id,
      email: account.email,
      clientIp: getClientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
  }

  const response = NextResponse.redirect(
    `${paymentConfig.siteUrl}/cabinet`,
    { status: 303 },
  )
  response.headers.set('Set-Cookie', buildSessionCookie(cookieValue, isProd))
  response.headers.set('Cache-Control', 'no-store, max-age=0')
  return response
}
