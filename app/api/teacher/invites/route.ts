import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { recordAuthAuditEvent } from '@/lib/audit/auth-events'
import { requireTeacherWithCurrentSaasOfferConsent } from '@/lib/auth/guards'
import {
  createInviteForTeacher,
  isValidInviteDefaultPaymentMethod,
  listInvitesForTeacher,
  TeacherInviteOwnershipError,
  type InviteDefaultPaymentMethod,
} from '@/lib/auth/teacher-invites'
import { enforceAccountRateLimit } from '@/lib/security/account-rate-limit'
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

// Per-account rate-limit cap. SAAS-3+4 TINV.4-follow-up (2026-05-18):
// uses `enforceAccountRateLimit` (key: `account:<id>:<scope>`, no IP
// suffix). This closes round-2 WARN#5+#6 — the original
// `enforceRateLimit` always appended `:${ip}` to the key, making the
// per-teacher cap actually per-teacher-per-IP and VPN-bypassable.
const GENERATE_RATE_LIMIT_PER_HOUR = 5

export async function POST(request: Request) {
  const origin = enforceTrustedBrowserOrigin(request)
  if (origin) return origin

  const auth = await requireTeacherWithCurrentSaasOfferConsent(request)
  if (!auth.ok) return auth.response
  const teacherAccountId = auth.account.id

  const rl = await enforceAccountRateLimit(
    teacherAccountId,
    'invite-generate',
    GENERATE_RATE_LIMIT_PER_HOUR,
    60 * 60_000,
  )
  if (rl) return rl

  // Per-learner-payment-method §Scope item 6 — teacher may seed a
  // default payment method for the (teacher, learner) pair when the
  // invite is redeemed. Body is optional; missing / empty / null
  // defaults to 'none' (legacy behaviour — booking blocked until the
  // teacher picks a method on the learner card). An explicit value
  // outside the allow-list ('postpaid' | 'none' — epic-b dropped
  // 'prepaid_packages')
  // is rejected with 422 so the client surfaces a validation error
  // rather than silently falling back to 'none' (which would be a
  // foot-gun if the client misspelled an enum constant).
  // Distinguish "empty body" (legacy client / no body at all) from
  // "body present but malformed JSON". Empty body → defaults to
  // 'none'. Malformed JSON → 422 fail-closed (codex-paranoia wave
  // round-2 WARN #2 closure: silent fallback would let a misspelled
  // enum-carrying body slip through and create the wrong invite).
  let defaultPaymentMethod: InviteDefaultPaymentMethod = 'none'
  let defaultTariffIds: string[] = []
  let defaultPackageIds: string[] = []
  // Epic C follow-up (2026-06-19) — comment to seed teacher_note.
  let teacherNoteSeed: string | null = null
  const rawText = await request.text()
  if (rawText.trim().length > 0) {
    let body: unknown
    try {
      body = JSON.parse(rawText)
    } catch {
      return NextResponse.json(
        {
          error: 'invalid_json',
          // epic-b Sub-PR B.1/B.2 (2026-06-11): dropped 'prepaid_packages'.
          valid: ['postpaid', 'none'],
        },
        { status: 422, headers: NO_STORE },
      )
    }
    if (body && typeof body === 'object') {
      const raw = (body as { defaultPaymentMethod?: unknown }).defaultPaymentMethod
      if (raw !== undefined && raw !== null && raw !== '') {
        if (!isValidInviteDefaultPaymentMethod(raw)) {
          return NextResponse.json(
            {
              error: 'invalid_default_payment_method',
              // epic-b Sub-PR B.1/B.2 (2026-06-11): dropped 'prepaid_packages'.
          valid: ['postpaid', 'none'],
            },
            { status: 422, headers: NO_STORE },
          )
        }
        defaultPaymentMethod = raw
      }
      const tariffParsed = parseInviteUuidArray(
        (body as { defaultTariffIds?: unknown }).defaultTariffIds,
        'defaultTariffIds',
      )
      if (tariffParsed.error) {
        return NextResponse.json(
          { error: tariffParsed.error },
          { status: 422, headers: NO_STORE },
        )
      }
      defaultTariffIds = tariffParsed.ids
      const packageParsed = parseInviteUuidArray(
        (body as { defaultPackageIds?: unknown }).defaultPackageIds,
        'defaultPackageIds',
      )
      if (packageParsed.error) {
        return NextResponse.json(
          { error: packageParsed.error },
          { status: 422, headers: NO_STORE },
        )
      }
      defaultPackageIds = packageParsed.ids
    }

    // Epic C follow-up (2026-06-19) — учитель сразу пишет приватный
    // комментарий о ученике. trim + null fallback; 2000 char cap
    // дублируется в createInviteForTeacher (throw маппится в 400).
    const rawSeed = (body as { teacherNoteSeed?: unknown }).teacherNoteSeed
    if (typeof rawSeed === 'string') {
      const trimmed = rawSeed.trim()
      if (trimmed.length > 2000) {
        return NextResponse.json(
          {
            error: 'teacher_note_seed_too_long',
            message: 'Длина комментария — до 2000 символов.',
          },
          { status: 400, headers: NO_STORE },
        )
      }
      teacherNoteSeed = trimmed.length > 0 ? trimmed : null
    } else if (rawSeed !== undefined && rawSeed !== null) {
      return NextResponse.json(
        {
          error: 'invalid_teacher_note_seed',
          message: 'Поле teacherNoteSeed должно быть строкой или null.',
        },
        { status: 400, headers: NO_STORE },
      )
    }
  }

  let invite: Awaited<ReturnType<typeof createInviteForTeacher>>
  try {
    invite = await createInviteForTeacher(teacherAccountId, {
      defaultPaymentMethod,
      defaultTariffIds,
      defaultPackageIds,
      teacherNoteSeed,
    })
  } catch (err) {
    if (err instanceof TeacherInviteOwnershipError) {
      return NextResponse.json(
        { error: err.kind },
        { status: 403, headers: NO_STORE },
      )
    }
    throw err
  }
  await recordAuthAuditEvent({
    eventType: 'auth.invite.created',
    accountId: teacherAccountId,
    email: auth.account.email,
    clientIp: getClientIp(request),
    userAgent: request.headers.get('user-agent'),
    payload: {
      inviteId: invite.id,
      expiresAt: invite.expiresAt.toISOString(),
      defaultPaymentMethod: invite.defaultPaymentMethod,
      defaultTariffCount: invite.defaultTariffIds.length,
      defaultPackageCount: invite.defaultPackageIds.length,
    },
  })
  return NextResponse.json(
    {
      ok: true,
      id: invite.id,
      url: invite.url,
      expiresAt: invite.expiresAt.toISOString(),
      defaultPaymentMethod: invite.defaultPaymentMethod,
      defaultTariffIds: invite.defaultTariffIds,
      defaultPackageIds: invite.defaultPackageIds,
    },
    { status: 200, headers: NO_STORE },
  )
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function parseInviteUuidArray(
  raw: unknown,
  field: string,
): { ids: string[]; error?: string } {
  if (raw === undefined || raw === null) return { ids: [] }
  if (!Array.isArray(raw)) return { ids: [], error: `invalid_${field}` }
  if (raw.length > 20) return { ids: [], error: `${field}_cap_exceeded` }
  const seen = new Set<string>()
  for (const v of raw) {
    if (typeof v !== 'string' || !UUID_PATTERN.test(v)) {
      return { ids: [], error: `invalid_${field}` }
    }
    seen.add(v)
  }
  return { ids: Array.from(seen) }
}

export async function GET(request: Request) {
  const auth = await requireTeacherWithCurrentSaasOfferConsent(request)
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
