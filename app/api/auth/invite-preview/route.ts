// POST /api/auth/invite-preview
// Body: { inviteToken: string }
//
// Anonymous-accessible endpoint that returns the inviting teacher's
// display name for a valid invite token. Used by the /register page
// to render «Вас пригласил {teacher_name}» banner (Sub-PR C4 per
// `docs/plans/onboarding-tooltips-spec-2026-05-31.md §1.2`
// `learner-invite-from-teacher-name`).
//
// The token holder already has the link; surfacing the inviter's
// display name is not an enumeration risk. Returns 404 with a
// generic shape on invalid/expired tokens (no leak about which
// state failed).

import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { getAuthPool } from '@/lib/auth/pool'
import { formatProfileNameForRender } from '@/lib/auth/profile-name'
import { verifyInviteToken } from '@/lib/auth/teacher-invites'
import { enforceRateLimit } from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  // Defense-in-depth rate limit — anonymous endpoint that takes a
  // token + does a DB lookup. 60/minute per IP is generous for
  // legitimate single-form-mount usage.
  const rl = await enforceRateLimit(request, 'auth:invite-preview:ip', 60, 60_000)
  if (rl) return rl

  let body: unknown = null
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'invalid_json' },
      { status: 400, headers: NO_STORE },
    )
  }
  const token =
    body && typeof body === 'object'
      ? String((body as { inviteToken?: unknown }).inviteToken ?? '').trim()
      : ''
  if (token === '') {
    return NextResponse.json(
      { error: 'invite_token_missing' },
      { status: 400, headers: NO_STORE },
    )
  }

  const payload = verifyInviteToken(token)
  if (!payload) {
    // 404 on every "not a usable token" branch — no leak of which
    // failure (bad signature / expired / revoked).
    return NextResponse.json(
      { error: 'invite_not_found' },
      { status: 404, headers: NO_STORE },
    )
  }

  // Look up inviter + their display name. The invite row is the
  // anti-spoof: the token's `tid` is duplicated from the row;
  // server still re-fetches by `iid` to validate state.
  const pool = getAuthPool()
  const r = await pool.query<{
    email: string
    display_name: string | null
    first_name: string | null
    last_name: string | null
  }>(
    `select a.email, p.display_name, p.first_name, p.last_name
       from teacher_invites ti
       join accounts a on a.id = ti.teacher_account_id
       left join account_profiles p on p.account_id = a.id
      where ti.id = $1::uuid
        and ti.used_at is null
        and ti.revoked_at is null
        and ti.expires_at > now()
      limit 1`,
    [payload.iid],
  )
  const row = r.rows[0]
  if (!row) {
    return NextResponse.json(
      { error: 'invite_not_found' },
      { status: 404, headers: NO_STORE },
    )
  }

  const teacherName = formatProfileNameForRender({
    firstName: row.first_name ?? null,
    lastName: row.last_name ?? null,
    displayName: row.display_name ?? null,
    fallbackEmail: row.email,
  })

  return NextResponse.json(
    { ok: true, teacherName },
    { headers: NO_STORE },
  )
}
