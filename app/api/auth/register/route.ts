import { NextResponse } from 'next/server'

import { recordAuthAuditEvent } from '@/lib/audit/auth-events'
import {
  createAccount,
  getAccountByEmail,
  normalizeAccountEmail,
} from '@/lib/auth/accounts'
import { recordConsent } from '@/lib/auth/consents'
import { getDummyHash } from '@/lib/auth/dummy-hash'
import { rateLimitScope } from '@/lib/auth/email-hash'
import { hashPassword, verifyPassword } from '@/lib/auth/password'
import { validatePasswordPolicy } from '@/lib/auth/policy'
import { createEmailVerification } from '@/lib/auth/verifications'
import {
  sendAlreadyRegisteredEmail,
  sendVerifyEmail,
} from '@/lib/email/dispatch'
import { PERSONAL_DATA_DOCUMENT_VERSION } from '@/lib/legal/personal-data'
import { validateCustomerEmail } from '@/lib/payments/catalog'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
  getClientIp,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/auth/register
//
// Anti-enumeration via symmetric work (per /plan-eng-review D1):
// - new-email path: hashPassword (~250ms bcrypt) → INSERT account →
//   record consent → create verify token → send verify email.
// - existing-email path: dummy verifyPassword (~250ms bcrypt) → no DB
//   write → send "already registered" email through the same Resend SDK.
// Both paths consume one bcrypt cycle and one Resend dispatch. Response
// body is byte-equal: { ok: true }.

const noStore = { 'Cache-Control': 'no-store, max-age=0' }

export async function POST(request: Request) {
  const rl = await enforceRateLimit(request, 'auth:register:ip', 5, 60_000)
  if (rl) return rl

  const origin = enforceTrustedBrowserOrigin(request)
  if (origin) return origin

  let body: {
    email?: string
    password?: string
    personalDataConsentAccepted?: boolean
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'Invalid request body.' },
      { status: 400, headers: noStore },
    )
  }

  const emailValidation = validateCustomerEmail(String(body.email || ''))
  if (!emailValidation.ok) {
    return NextResponse.json(
      { error: emailValidation.message },
      { status: 400, headers: noStore },
    )
  }

  const passwordPolicy = validatePasswordPolicy(body.password)
  if (!passwordPolicy.ok) {
    return NextResponse.json(
      { error: passwordPolicy.message },
      { status: 400, headers: noStore },
    )
  }

  if (body.personalDataConsentAccepted !== true) {
    return NextResponse.json(
      { error: 'Подтвердите согласие на обработку персональных данных.' },
      { status: 400, headers: noStore },
    )
  }

  const email = emailValidation.email
  const password = String(body.password)

  const emailRl = await enforceRateLimit(
    request,
    rateLimitScope('register', email),
    3,
    60 * 60_000,
  )
  if (emailRl) return emailRl

  const existing = await getAccountByEmail(email)

  if (existing) {
    // Existing-email path: same wall-clock budget as new-email path.
    await verifyPassword(password, await getDummyHash())
    await sendAlreadyRegisteredEmail(email)
    // Wave 5 — audit the register attempt on a known email. Reason
    // tag distinguishes from a legit register so the alert query can
    // tell "abuser sweeping known emails" apart from organic load.
    // Response stays generic for anti-enumeration; reason is INTERNAL.
    await recordAuthAuditEvent({
      eventType: 'auth.register.created',
      accountId: existing.id,
      email,
      clientIp: getClientIp(request),
      userAgent: request.headers.get('user-agent'),
      payload: { branch: 'already_registered' },
    })
  } else {
    // New-email path.
    const passwordHash = await hashPassword(password)
    const account = await createAccount({
      email,
      passwordHash,
    })
    await recordConsent({
      accountId: account.id,
      documentKind: 'personal_data',
      documentVersion: PERSONAL_DATA_DOCUMENT_VERSION,
      ip: getClientIp(request),
      userAgent: request.headers.get('user-agent') || null,
    })
    const { token } = await createEmailVerification(account.id)
    await sendVerifyEmail(email, token)
    await recordAuthAuditEvent({
      eventType: 'auth.register.created',
      accountId: account.id,
      email,
      clientIp: getClientIp(request),
      userAgent: request.headers.get('user-agent'),
      payload: { branch: 'new_account' },
    })
  }

  return NextResponse.json({ ok: true }, { status: 200, headers: noStore })
}

export { normalizeAccountEmail }
