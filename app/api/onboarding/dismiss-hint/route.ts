// POST /api/onboarding/dismiss-hint
// Body: { hintKey: 'snake_case_key_from_ONBOARDING_HINT_KEYS' }
//
// Authorization: any authenticated account. `accountId` derives from the
// session — never from the body (anti-spoof).
//
// Behaviour: idempotent UPSERT into `account_onboarding_state.dismissed_hints`.
// Repeat-dismiss of the same key returns 200 with the same shape.
//
// Errors:
//   400 — `hint_key_missing` (empty/absent body field) /
//         `unknown_hint_key` (not in ONBOARDING_HINT_KEYS whitelist) /
//         `invalid_json` (body present but malformed).
//   401 — anonymous (no session cookie).
//   403 — origin-gate fails (request from untrusted origin).
//   429 — rate-limit (>30 dismisses per 60s per account).
//
// Plan: docs/plans/onboarding-flows-2026-05-31.md §0f Closure for
// BLOCKER #3 (final §0e contract for the dismiss API).

import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { requireAuthenticated } from '@/lib/auth/guards'
import { isOnboardingHintKey } from '@/lib/onboarding/keys'
import { dismissOnboardingHint } from '@/lib/onboarding/state'
import { enforceAccountRateLimit } from '@/lib/security/account-rate-limit'
import { enforceTrustedBrowserOrigin } from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const origin = enforceTrustedBrowserOrigin(request)
  if (origin) return origin

  const auth = await requireAuthenticated(request)
  if (!auth.ok) return auth.response

  const rl = await enforceAccountRateLimit(
    auth.account.id,
    'onboarding-dismiss-hint',
    30,
    60_000,
  )
  if (rl) return rl

  const rawText = await request.text()
  if (rawText.trim().length === 0) {
    return NextResponse.json(
      { error: 'hint_key_missing' },
      { status: 400, headers: NO_STORE },
    )
  }
  let body: unknown
  try {
    body = JSON.parse(rawText)
  } catch {
    return NextResponse.json(
      { error: 'invalid_json' },
      { status: 400, headers: NO_STORE },
    )
  }
  const hintKey =
    body && typeof body === 'object'
      ? String((body as { hintKey?: unknown }).hintKey ?? '').trim()
      : ''
  if (hintKey === '') {
    return NextResponse.json(
      { error: 'hint_key_missing' },
      { status: 400, headers: NO_STORE },
    )
  }
  if (!isOnboardingHintKey(hintKey)) {
    return NextResponse.json(
      { error: 'unknown_hint_key' },
      { status: 400, headers: NO_STORE },
    )
  }

  const state = await dismissOnboardingHint(auth.account.id, hintKey)
  const dismissedAt = state.dismissedHints[hintKey] ?? new Date().toISOString()
  return NextResponse.json(
    { ok: true, hintKey, dismissedAt },
    { headers: NO_STORE },
  )
}
