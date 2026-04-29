import { NextResponse } from 'next/server'

import { rateLimitScope } from '@/lib/auth/email-hash'
import { getCurrentSession } from '@/lib/auth/sessions'
import { createEmailVerification } from '@/lib/auth/verifications'
import { sendVerifyEmail } from '@/lib/email/dispatch'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/auth/resend-verify
//
// Authenticated path: the caller must be a logged-in account that hasn't
// confirmed its e-mail yet. Phase 1B D4 allows login on unverified e-mail,
// so /cabinet sees a banner — this endpoint is what the banner's button
// hits.
//
// Idempotent on already-verified accounts: returns 200 ok and DOES NOT
// send another email. Behaviour visible to the client is byte-equal so
// the UI doesn't have to branch.
//
// Rate-limited at TWO scopes: per-IP (catches mass abuse) AND per-account
// (limits a single account to 3 sends/hour). The per-account scope is
// what stops a stuck user from generating 50 unconsumed verify tokens
// in the table while clicking refresh — old tokens stay valid (single-
// use enforcement at consume time covers that), but the table doesn't
// get bloat.

const noStore = { 'Cache-Control': 'no-store, max-age=0' }

export async function POST(request: Request) {
  const ipRl = enforceRateLimit(request, 'auth:resend-verify:ip', 10, 60_000)
  if (ipRl) return ipRl

  const origin = enforceTrustedBrowserOrigin(request)
  if (origin) return origin

  const current = await getCurrentSession(request)
  if (!current) {
    return NextResponse.json(
      { error: 'Not authenticated.' },
      { status: 401, headers: noStore },
    )
  }

  const { account } = current

  // Per-account hourly cap. Uses the same rateLimitScope() helper as
  // register/reset-request so the bucket key is HMAC-keyed off the
  // normalized account email.
  const accountRl = enforceRateLimit(
    request,
    rateLimitScope('resend-verify', account.email),
    3,
    60 * 60_000,
  )
  if (accountRl) return accountRl

  // Idempotent on already-verified: pretend we sent. UI hides the banner
  // when emailVerifiedAt is non-null anyway, so this is a defense-in-
  // depth no-op (mid-flight verification, stale UI cache, etc).
  if (account.emailVerifiedAt) {
    return NextResponse.json({ ok: true }, { status: 200, headers: noStore })
  }

  const { token } = await createEmailVerification(account.id)
  await sendVerifyEmail(account.email, token)

  return NextResponse.json({ ok: true }, { status: 200, headers: noStore })
}
