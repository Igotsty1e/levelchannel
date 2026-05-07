import { NextResponse } from 'next/server'

import { recordAuthAuditEvent } from '@/lib/audit/auth-events'
import { getAccountById, setAccountPassword } from '@/lib/auth/accounts'
import { hashPassword } from '@/lib/auth/password'
import { validatePasswordPolicy } from '@/lib/auth/policy'
import { consumePasswordReset } from '@/lib/auth/resets'
import {
  buildSessionCookie,
  createSession,
  revokeAllSessionsForAccount,
} from '@/lib/auth/sessions'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
  getClientIp,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/auth/reset-confirm
//
// Per /plan-eng-review mech-5: revokeAllSessionsForAccount BEFORE
// createSession. Old sessions die first; the new session for the actor
// who just reset is on a clean slate.

const noStore = { 'Cache-Control': 'no-store, max-age=0' }
const isProd = process.env.NODE_ENV === 'production'

export async function POST(request: Request) {
  const rl = await enforceRateLimit(request, 'auth:reset-confirm:ip', 10, 60_000)
  if (rl) return rl

  const origin = enforceTrustedBrowserOrigin(request)
  if (origin) return origin

  let body: { token?: string; password?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'Invalid request body.' },
      { status: 400, headers: noStore },
    )
  }

  const policy = validatePasswordPolicy(body.password)
  if (!policy.ok) {
    return NextResponse.json(
      { error: policy.message },
      { status: 400, headers: noStore },
    )
  }

  const consumed = await consumePasswordReset(String(body.token || ''))
  if (!consumed) {
    return NextResponse.json(
      { error: 'Ссылка недействительна или уже использована.' },
      { status: 400, headers: noStore },
    )
  }

  const newHash = await hashPassword(String(body.password))
  await setAccountPassword(consumed.accountId, newHash)

  // Sign out everywhere FIRST, then issue the actor's new session.
  await revokeAllSessionsForAccount(consumed.accountId)
  const { cookieValue } = await createSession({
    accountId: consumed.accountId,
    ip: getClientIp(request),
    userAgent: request.headers.get('user-agent') || null,
  })

  // Wave 5 — record the successful reset. The token has been consumed
  // by here; refusing to record on a missing email lookup would lose
  // the audit signal, so we look up the account row and use its email.
  const account = await getAccountById(consumed.accountId)
  if (account) {
    await recordAuthAuditEvent({
      eventType: 'auth.reset.confirmed',
      accountId: account.id,
      email: account.email,
      clientIp: getClientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
  }

  return NextResponse.json(
    { ok: true },
    {
      status: 200,
      headers: {
        ...noStore,
        'Set-Cookie': buildSessionCookie(cookieValue, isProd),
      },
    },
  )
}
