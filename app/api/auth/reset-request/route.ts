import { NextResponse } from 'next/server'

import { recordAuthAuditEvent } from '@/lib/audit/auth-events'
import { getAccountByEmail } from '@/lib/auth/accounts'
import { rateLimitScope } from '@/lib/auth/email-hash'
import { createPasswordReset } from '@/lib/auth/resets'
import { sendResetEmail } from '@/lib/email/dispatch'
import { validateCustomerEmail } from '@/lib/payments/catalog'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
  getClientIp,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/auth/reset-request
//
// Anti-enumeration: identical { ok: true } response for known and
// unknown emails. Side effects only on the known-email path; unknown
// path no-ops. Per /plan-eng-review D1, the symmetric-work principle
// applies less strictly here than register because the response time
// dominator is `getAccountByEmail` (one indexed lookup, ~5ms) — the
// difference between "found" and "not found" is sub-millisecond at the
// DB level. Resend dispatch on found accounts adds latency; not running
// it on unknown leaks signal. We accept this trade-off for now: rate
// limiting (5/min/IP + 3/hour/email-hash) caps how much an attacker can
// extract before tripping a bucket.

const noStore = { 'Cache-Control': 'no-store, max-age=0' }

export async function POST(request: Request) {
  const rl = await enforceRateLimit(request, 'auth:reset-request:ip', 5, 60_000)
  if (rl) return rl

  const origin = enforceTrustedBrowserOrigin(request)
  if (origin) return origin

  let body: { email?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { ok: true },
      { status: 200, headers: noStore },
    )
  }

  const emailValidation = validateCustomerEmail(String(body.email || ''))
  if (!emailValidation.ok) {
    return NextResponse.json(
      { ok: true },
      { status: 200, headers: noStore },
    )
  }

  const email = emailValidation.email

  const emailRl = await enforceRateLimit(
    request,
    rateLimitScope('reset_request', email),
    3,
    60 * 60_000,
  )
  if (emailRl) return emailRl

  const account = await getAccountByEmail(email)
  if (account && !account.disabledAt) {
    const { token } = await createPasswordReset(account.id)
    await sendResetEmail(email, token)
  }

  // Wave 5 — record on EVERY path (known + unknown + disabled) using
  // email_hash + nullable account_id. The audit row exists regardless
  // of whether the email matched, so a row alone does not leak
  // existence. The alert query keys off email_hash + count; an
  // attacker spraying emails to enumerate creates a high-volume
  // pattern that the alert catches.
  await recordAuthAuditEvent({
    eventType: 'auth.reset.requested',
    accountId: account?.id ?? null,
    email,
    clientIp: getClientIp(request),
    userAgent: request.headers.get('user-agent'),
  })

  return NextResponse.json({ ok: true }, { status: 200, headers: noStore })
}
