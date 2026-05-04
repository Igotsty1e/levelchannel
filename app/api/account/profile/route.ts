import { NextResponse } from 'next/server'

import { requireAuthenticated } from '@/lib/auth/guards'
import {
  type AccountProfileUpdate,
  getAccountProfile,
  upsertAccountProfile,
  validateProfileUpdate,
} from '@/lib/auth/profiles'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET  /api/account/profile  → current profile, null fields if none
// PATCH /api/account/profile → set / clear named fields. Omit a key to
//                              keep current value; pass null to clear.
//
// Origin gate on PATCH only — GET is a same-origin cabinet bootstrap
// like /api/auth/me. The PATCH side mutates state.

const noStore = { 'Cache-Control': 'no-store, max-age=0' }

export async function GET(request: Request) {
  const rl = await enforceRateLimit(request, 'account:profile:ip', 60, 60_000)
  if (rl) return rl

  const auth = await requireAuthenticated(request)
  if (!auth.ok) return auth.response

  const profile = await getAccountProfile(auth.account.id)
  return NextResponse.json(
    {
      profile: profile ?? {
        accountId: auth.account.id,
        displayName: null,
        timezone: null,
        locale: null,
        createdAt: null,
        updatedAt: null,
      },
    },
    { status: 200, headers: noStore },
  )
}

export async function PATCH(request: Request) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(request, 'account:profile:ip', 30, 60_000)
  if (rl) return rl

  const auth = await requireAuthenticated(request)
  if (!auth.ok) return auth.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body.' },
      { status: 400, headers: noStore },
    )
  }
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json(
      { error: 'Body must be a JSON object.' },
      { status: 400, headers: noStore },
    )
  }

  const update: AccountProfileUpdate = {}
  const raw = body as Record<string, unknown>
  if ('displayName' in raw) {
    if (raw.displayName !== null && typeof raw.displayName !== 'string') {
      return NextResponse.json(
        { error: 'displayName must be string or null.' },
        { status: 400, headers: noStore },
      )
    }
    update.displayName = raw.displayName as string | null
  }
  if ('timezone' in raw) {
    if (raw.timezone !== null && typeof raw.timezone !== 'string') {
      return NextResponse.json(
        { error: 'timezone must be string or null.' },
        { status: 400, headers: noStore },
      )
    }
    update.timezone = raw.timezone as string | null
  }
  if ('locale' in raw) {
    if (raw.locale !== null && typeof raw.locale !== 'string') {
      return NextResponse.json(
        { error: 'locale must be string or null.' },
        { status: 400, headers: noStore },
      )
    }
    update.locale = raw.locale as string | null
  }

  const validation = validateProfileUpdate(update)
  if (validation) {
    return NextResponse.json(
      { error: `${validation.field}/${validation.reason}` },
      { status: 400, headers: noStore },
    )
  }

  const profile = await upsertAccountProfile(auth.account.id, update)
  return NextResponse.json({ profile }, { status: 200, headers: noStore })
}
