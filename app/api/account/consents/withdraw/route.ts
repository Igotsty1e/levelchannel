import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { readJsonObjectOr400 } from '@/lib/api/json-body'
import { disableAccount } from '@/lib/auth/accounts'
import { withdrawConsent } from '@/lib/auth/consents'
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

// POST /api/account/consents/withdraw
//
// 152-ФЗ ст.9 §5 surface: a learner can withdraw a previously given
// consent. In MVP the only operator-required consent is `personal_data`.
// Withdrawing it disables the account (the operator must stop processing
// PD) and revokes all sessions; the row stays in place — withdrawal
// does NOT trigger anonymization (that's the deletion path, see
// /api/account/delete).
//
// Body shape:
//   { documentKind: 'personal_data' }
//
// On success the cabinet client should redirect to /login (cookie was
// cleared in the response).

const isProd = process.env.NODE_ENV === 'production'

const ALLOWED_KINDS = new Set(['personal_data'])

export async function POST(request: Request) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(
    request,
    'account:consent:withdraw:ip',
    5,
    60_000,
  )
  if (rl) return rl

  const auth = await requireAuthenticated(request)
  if (!auth.ok) return auth.response

  const parsed = await readJsonObjectOr400(request)
  if (!parsed.ok) return parsed.response

  const documentKind = parsed.body.documentKind
  if (typeof documentKind !== 'string' || !ALLOWED_KINDS.has(documentKind)) {
    return NextResponse.json(
      { error: 'documentKind must be one of: personal_data.' },
      { status: 400, headers: NO_STORE },
    )
  }

  const withdrawn = await withdrawConsent({
    accountId: auth.account.id,
    documentKind: documentKind as 'personal_data',
  })
  if (!withdrawn) {
    return NextResponse.json(
      { error: 'No active consent of that kind to withdraw.' },
      { status: 404, headers: NO_STORE },
    )
  }

  // Withdrawing personal_data is the heavy side: the operator MUST
  // stop processing PD. Disable the account and revoke sessions in
  // the same transaction-equivalent: two best-effort updates, both
  // are idempotent and run on a single connection.
  if (documentKind === 'personal_data') {
    await disableAccount(auth.account.id)
    await revokeAllSessionsForAccount(auth.account.id)
  }

  return NextResponse.json(
    { ok: true, revokedAt: withdrawn.revokedAt },
    {
      status: 200,
      headers: {
        ...NO_STORE,
        'Set-Cookie': buildSessionClearCookie(isProd),
      },
    },
  )
}
