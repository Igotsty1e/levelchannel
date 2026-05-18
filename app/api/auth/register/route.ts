import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { recordAuthAuditEvent } from '@/lib/audit/auth-events'
import {
  createAccount,
  getAccountByEmail,
  grantAccountRole,
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
import { getCurrentLegalVersion } from '@/lib/legal/versions'
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


export async function POST(request: Request) {
  const rl = await enforceRateLimit(request, 'auth:register:ip', 5, 60_000)
  if (rl) return rl

  const origin = enforceTrustedBrowserOrigin(request)
  if (origin) return origin

  let body: {
    email?: string
    password?: string
    personalDataConsentAccepted?: boolean
    role?: string
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'Invalid request body.' },
      { status: 400, headers: NO_STORE },
    )
  }

  // SAAS-3 (2026-05-18) — registration accepts an optional `role` to
  // distinguish learners from self-registered teachers. Missing/invalid
  // role defaults to 'student', preserving the pre-SaaS default-no-role
  // learner-archetype shape on the existing-email branch (we never
  // grant a role to existing accounts). Only the new-email + teacher
  // branch performs a single extra INSERT into account_roles; the
  // anti-enumeration wall-clock budget is preserved (one INSERT vs
  // 250ms bcrypt is in the noise).
  const requestedRole: 'student' | 'teacher' =
    body.role === 'teacher' ? 'teacher' : 'student'

  const emailValidation = validateCustomerEmail(String(body.email || ''))
  if (!emailValidation.ok) {
    return NextResponse.json(
      { error: emailValidation.message },
      { status: 400, headers: NO_STORE },
    )
  }

  const passwordPolicy = validatePasswordPolicy(body.password)
  if (!passwordPolicy.ok) {
    return NextResponse.json(
      { error: passwordPolicy.message },
      { status: 400, headers: NO_STORE },
    )
  }

  if (body.personalDataConsentAccepted !== true) {
    return NextResponse.json(
      { error: 'Подтвердите согласие на обработку персональных данных.' },
      { status: 400, headers: NO_STORE },
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
    // SAAS-3 (2026-05-18) — self-registered teacher gets an explicit
    // teacher role on the new-email path. Learner-archetype default
    // (no role = learner) is preserved by NOT granting on student.
    // Failure to grant is fatal to register because returning ok:true
    // without the role would silently land a teacher on the learner
    // surface — worse than a fail-fast 5xx that prompts retry.
    if (requestedRole === 'teacher') {
      await grantAccountRole(account.id, 'teacher', null)
    }
    // Legal-versioning sister wave (migration 0032): capture the
    // FK to the snapshot row currently in force, alongside the
    // legacy text version for backward-compat. The lookup is
    // best-effort — if the seed row is somehow missing (fresh test
    // DB before migration applied), the consent still records with
    // the text version and FK = null. Not a hard fail.
    const currentPdVersion = await getCurrentLegalVersion('personal_data').catch(
      () => null,
    )
    await recordConsent({
      accountId: account.id,
      documentKind: 'personal_data',
      documentVersion: PERSONAL_DATA_DOCUMENT_VERSION,
      legalDocumentVersionId: currentPdVersion?.id ?? null,
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
      payload: { branch: 'new_account', role: requestedRole },
    })
  }

  return NextResponse.json({ ok: true }, { status: 200, headers: NO_STORE })
}
