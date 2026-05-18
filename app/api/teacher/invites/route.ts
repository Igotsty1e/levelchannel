import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { recordAuthAuditEvent } from '@/lib/audit/auth-events'
import { requireTeacherAndVerified } from '@/lib/auth/guards'
import {
  createInviteForTeacher,
  listInvitesForTeacher,
} from '@/lib/auth/teacher-invites'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
  getClientIp,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// SAAS-3+4 TINV.4 (2026-05-18) — teacher invite generation + list.
//
// POST → generate a new invite link for the authenticated teacher.
// GET  → list the teacher's invites (status display in cabinet UI).
//
// Per docs/plans/teacher-self-reg-invite.md §3.6. The full ms-budget
// anti-enumeration timing test + cross-teacher authz integration test
// land with TINV.8.

// Per-account rate-limit cap. Round-2 paranoia WARN about
// enforceRateLimit always appending IP is acknowledged: the round-3
// note in the plan recommends a dedicated enforceAccountRateLimit
// helper. That helper is a TINV.4-follow-up; for this slice the
// existing enforceRateLimit is used (key includes IP). VPN/IP
// rotation can bypass the per-teacher cap; the email-verify gate +
// 5/h IP-cap still provide a reasonable floor for the MVP.
const GENERATE_RATE_LIMIT_PER_HOUR = 5

export async function POST(request: Request) {
  const origin = enforceTrustedBrowserOrigin(request)
  if (origin) return origin

  const auth = await requireTeacherAndVerified(request)
  if (!auth.ok) return auth.response
  const teacherAccountId = auth.account.id

  const rl = await enforceRateLimit(
    request,
    `teacher:invite-generate:${teacherAccountId}`,
    GENERATE_RATE_LIMIT_PER_HOUR,
    60 * 60_000,
  )
  if (rl) return rl

  const invite = await createInviteForTeacher(teacherAccountId)
  await recordAuthAuditEvent({
    eventType: 'auth.invite.created',
    accountId: teacherAccountId,
    email: auth.account.email,
    clientIp: getClientIp(request),
    userAgent: request.headers.get('user-agent'),
    payload: {
      inviteId: invite.id,
      expiresAt: invite.expiresAt.toISOString(),
    },
  })
  return NextResponse.json(
    {
      ok: true,
      id: invite.id,
      url: invite.url,
      expiresAt: invite.expiresAt.toISOString(),
    },
    { status: 200, headers: NO_STORE },
  )
}

export async function GET(request: Request) {
  const auth = await requireTeacherAndVerified(request)
  if (!auth.ok) return auth.response

  // Lighter rate-limit on list — read-only, used by the cabinet UI poll.
  const rl = await enforceRateLimit(
    request,
    `teacher:invite-list:${auth.account.id}`,
    60,
    60_000,
  )
  if (rl) return rl

  const rows = await listInvitesForTeacher(auth.account.id)
  return NextResponse.json(
    {
      ok: true,
      invites: rows.map((r) => ({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        expiresAt: r.expiresAt.toISOString(),
        usedAt: r.usedAt?.toISOString() ?? null,
        usedByEmail: r.usedByEmail,
        revokedAt: r.revokedAt?.toISOString() ?? null,
        status: r.status,
      })),
    },
    { status: 200, headers: NO_STORE },
  )
}
