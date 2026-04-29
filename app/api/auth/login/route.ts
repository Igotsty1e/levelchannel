import { NextResponse } from 'next/server'

import { getAccountByEmail, listAccountRoles } from '@/lib/auth/accounts'
import { constantTimeVerifyPassword } from '@/lib/auth/dummy-hash'
import { rateLimitScope } from '@/lib/auth/email-hash'
import {
  buildSessionCookie,
  createSession,
} from '@/lib/auth/sessions'
import { validateCustomerEmail } from '@/lib/payments/catalog'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
  getClientIp,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/auth/login
//
// Constant-time (per /plan-eng-review D3): verifyPassword always runs
// against either the real account hash OR a module-load dummyHash —
// wall-clock identical for unknown email / disabled account / wrong
// password. Identical 401 body in all rejection cases (anti-enumeration).
//
// Allow login on unverified email (D4) — payment/booking routes gate
// on email_verified_at separately. UI surfaces the prompt.

const noStore = { 'Cache-Control': 'no-store, max-age=0' }
const isProd = process.env.NODE_ENV === 'production'

export async function POST(request: Request) {
  const rl = enforceRateLimit(request, 'auth:login:ip', 10, 60_000)
  if (rl) return rl

  const origin = enforceTrustedBrowserOrigin(request)
  if (origin) return origin

  let body: { email?: string; password?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'Invalid request body.' },
      { status: 400, headers: noStore },
    )
  }

  const emailValidation = validateCustomerEmail(String(body.email || ''))
  // Don't 400 on bad email shape — same generic 401 to avoid signaling
  // "this email is shaped wrong therefore unknown". Use empty string as a
  // sentinel so the lookup misses and constantTimeVerifyPassword runs the
  // dummy branch.
  const email = emailValidation.ok ? emailValidation.email : ''
  const password = String(body.password || '')

  if (email) {
    const emailRl = enforceRateLimit(
      request,
      rateLimitScope('login', email),
      5,
      60_000,
    )
    if (emailRl) return emailRl
  }

  const account = email ? await getAccountByEmail(email) : null
  const accountUsableHash =
    account && !account.disabledAt ? account.passwordHash : null

  const valid = await constantTimeVerifyPassword(password, accountUsableHash)

  if (!valid || !account || account.disabledAt) {
    return NextResponse.json(
      { error: 'Неверный e-mail или пароль.' },
      { status: 401, headers: noStore },
    )
  }

  const { cookieValue } = await createSession({
    accountId: account.id,
    ip: getClientIp(request),
    userAgent: request.headers.get('user-agent') || null,
  })

  const roles = await listAccountRoles(account.id)

  return NextResponse.json(
    {
      account: {
        id: account.id,
        email: account.email,
        emailVerifiedAt: account.emailVerifiedAt,
        disabledAt: account.disabledAt,
        roles,
      },
    },
    {
      status: 200,
      headers: {
        ...noStore,
        'Set-Cookie': buildSessionCookie(cookieValue, isProd),
      },
    },
  )
}
