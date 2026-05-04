import { NextResponse } from 'next/server'

import { requestAccountDeletion } from '@/lib/auth/accounts'
import { requireAuthenticated } from '@/lib/auth/guards'
import {
  buildSessionClearCookie,
  revokeAllSessionsForAccount,
} from '@/lib/auth/sessions'
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

const noStore = { 'Cache-Control': 'no-store, max-age=0' }
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
      { status: 400, headers: noStore },
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
        ...noStore,
        'Set-Cookie': buildSessionClearCookie(isProd),
      },
    },
  )
}
