import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { readJsonObjectOr400 } from '@/lib/api/json-body'
import { truncateIp } from '@/lib/analytics/server'
import { recordAuthAuditEvent } from '@/lib/audit/auth-events'
import { getAccountById, setAccountPassword } from '@/lib/auth/accounts'
import { constantTimeVerifyPassword } from '@/lib/auth/dummy-hash'
import { hashPassword, verifyPassword } from '@/lib/auth/password'
import { validatePasswordPolicy } from '@/lib/auth/policy'
import { requireAuthenticated } from '@/lib/auth/guards'
import {
  buildSessionCookie,
  createSession,
  revokeAllSessionsForAccount,
} from '@/lib/auth/sessions'
import { sendPasswordChangedEmail } from '@/lib/email/dispatch'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
  getClientIp,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/account/password/change
//
// In-cabinet password change for an already-logged-in user.
//
// Plan: docs/plans/in-cabinet-password-change-2026-06-09.md
//
// Flow:
//   1. Origin gate (CSRF) + per-IP rate limit + auth guard.
//   2. Parse body { currentPassword, newPassword }.
//   3. Per-account rate limit (anti-brute on currentPassword).
//   4. Always run BOTH validatePasswordPolicy(newPassword) AND
//      constantTimeVerifyPassword(currentPassword, accountHash) so the
//      response timing does not leak which field was wrong.
//   5. Reject if newPassword same as currentPassword.
//   6. Hash new password, write via setAccountPassword.
//   7. revokeAllSessionsForAccount BEFORE createSession (mirrors the
//      reset-confirm pattern — actor stays logged in on THIS device,
//      every other device drops).
//   8. Audit success row.
//   9. Fire-and-forget security e-mail to the account.

const isProd = process.env.NODE_ENV === 'production'

function uaSummary(raw: string | null): string | null {
  if (!raw) return null
  return raw.slice(0, 200)
}

export async function POST(request: Request) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rlIp = await enforceRateLimit(request, 'account-pw-change:ip', 5, 60_000)
  if (rlIp) return rlIp

  const auth = await requireAuthenticated(request)
  if (!auth.ok) return auth.response

  const rlAcc = await enforceRateLimit(
    request,
    `account-pw-change:acc:${auth.account.id}`,
    5,
    60_000,
  )
  if (rlAcc) return rlAcc

  const parsed = await readJsonObjectOr400(request)
  if (!parsed.ok) return parsed.response
  const raw = parsed.body
  const currentPassword =
    typeof raw.currentPassword === 'string' ? raw.currentPassword : ''
  const newPassword =
    typeof raw.newPassword === 'string' ? raw.newPassword : ''

  const ipPrefix = truncateIp(getClientIp(request))
  const ua = uaSummary(request.headers.get('user-agent'))

  // Re-fetch the canonical account to get the live password hash. The
  // session.account snapshot may be stale on a slow lookupSession cache;
  // we refresh from `accounts` for this security-sensitive operation.
  const account = await getAccountById(auth.account.id)
  if (!account) {
    return NextResponse.json(
      { error: 'account/not_found' },
      { status: 401, headers: NO_STORE },
    )
  }

  // Step 4 — run BOTH operations regardless of outcome to neutralise
  // timing differences between "wrong current" and "weak new".
  const policy = validatePasswordPolicy(newPassword)
  const currentOk = await constantTimeVerifyPassword(
    currentPassword,
    account.passwordHash,
  )

  if (!currentOk) {
    await recordAuthAuditEvent({
      eventType: 'password.changed.in_cabinet.bad_current',
      accountId: account.id,
      email: account.email,
      clientIp: getClientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return NextResponse.json(
      { error: 'password/current/invalid' },
      { status: 401, headers: NO_STORE },
    )
  }

  if (!policy.ok) {
    return NextResponse.json(
      {
        error: `password/new/${policy.reason}`,
        message: policy.message,
      },
      { status: 400, headers: NO_STORE },
    )
  }

  // Same-as-current — only AFTER we know currentPassword is right and
  // newPassword passes policy. Avoids leaking either side.
  if (await verifyPassword(newPassword, account.passwordHash)) {
    return NextResponse.json(
      {
        error: 'password/new/same_as_current',
        message: 'Новый пароль совпадает со старым — выберите другой.',
      },
      { status: 400, headers: NO_STORE },
    )
  }

  const newHash = await hashPassword(newPassword)
  await setAccountPassword(account.id, newHash)

  // Step 7 — revoke ALL existing sessions for this account (including
  // the current one), then mint a fresh session cookie so the actor
  // stays logged in on THIS device.
  await revokeAllSessionsForAccount(account.id)
  const { cookieValue } = await createSession({
    accountId: account.id,
    ip: getClientIp(request),
    userAgent: request.headers.get('user-agent') || null,
  })

  // Step 8 — audit success row.
  await recordAuthAuditEvent({
    eventType: 'password.changed.in_cabinet',
    accountId: account.id,
    email: account.email,
    clientIp: getClientIp(request),
    userAgent: request.headers.get('user-agent'),
  })

  // Step 9 — fire-and-forget security notification. Don't fail the
  // route if Resend is down — we already changed the password.
  void sendPasswordChangedEmail(account.email, {
    ipPrefix,
    uaSummary: ua,
    changedAtIso: new Date().toISOString(),
  }).catch(() => {
    // Silent — operator can grep the auth audit row if needed.
  })

  return NextResponse.json(
    { ok: true },
    {
      status: 200,
      headers: {
        ...NO_STORE,
        'Set-Cookie': buildSessionCookie(cookieValue, isProd),
      },
    },
  )
}
