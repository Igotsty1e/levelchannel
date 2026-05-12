import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { requestAccountDeletion } from '@/lib/auth/accounts'
import { requireAuthenticated } from '@/lib/auth/guards'
import {
  buildSessionClearCookie,
  revokeAllSessionsForAccount,
} from '@/lib/auth/sessions'
import { accountHasInFlightPackageGrant } from '@/lib/billing/deletion-guard'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/account/delete
//
// Phase 3 deletion contract: stamps disabled_at + scheduled_purge_at
// = now() + 30 days. The retention job (scripts/db-retention-cleanup.mjs)
// anonymizes the row when the timer fires.
//
// Cancellation during the grace window is operator-only at /admin so
// we don't have to ship a self-service unlock surface (which would
// reopen sessions for an account that just asked to be erased).
//
// On success: revoke sessions, clear cookie, return ok=true. The
// cabinet client redirects to a /thank-you-style page or back to the
// landing — that's a UI concern, not this route's.

const isProd = process.env.NODE_ENV === 'production'

export async function POST(request: Request) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(request, 'account:delete:ip', 3, 60_000)
  if (rl) return rl

  const auth = await requireAuthenticated(request)
  if (!auth.ok) return auth.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    body = {}
  }
  // Confirmation: the body must include `confirm: true`. Cheap insurance
  // against a stray fetch firing this off without an explicit flag.
  if (
    typeof body !== 'object' ||
    body === null ||
    (body as Record<string, unknown>).confirm !== true
  ) {
    return NextResponse.json(
      { error: 'Body must include { confirm: true }.' },
      { status: 400, headers: NO_STORE },
    )
  }

  // Wave 59 — deletion-guard re-check. Refuse the schedule if there
  // is an in-flight package grant (Branch A: pending order < 15 min,
  // OR Branch B: paid order with no package_purchases row yet). The
  // cron-side anonymizer re-evaluates the same predicate at the
  // anonymize step, so any grant that lands AFTER scheduling but
  // BEFORE the grace timer fires is still caught.
  const guard = await accountHasInFlightPackageGrant(auth.account.id)
  if (guard.inFlight) {
    return NextResponse.json(
      {
        error: 'in_flight_package_grant',
        reason: guard.reason,
        message:
          guard.reason === 'paid_not_granted'
            ? 'Есть оплаченный, но ещё не выданный пакет. Обратитесь к оператору для сверки.'
            : 'Идёт оплата пакета. Попробуйте через 15 минут.',
      },
      { status: 409, headers: NO_STORE },
    )
  }

  await requestAccountDeletion(auth.account.id, 30)
  await revokeAllSessionsForAccount(auth.account.id)

  const purgeAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()

  return NextResponse.json(
    { ok: true, scheduledPurgeAt: purgeAt },
    {
      status: 200,
      headers: {
        ...NO_STORE,
        'Set-Cookie': buildSessionClearCookie(isProd),
      },
    },
  )
}
