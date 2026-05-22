import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { readJsonObjectOr400 } from '@/lib/api/json-body'
import { requireTeacherAndVerified } from '@/lib/auth/guards'
import {
  TeacherRenameLearnerError,
  renameLearnerByTeacher,
} from '@/lib/auth/teacher-learner-mutations'
import { enforceAccountRateLimit } from '@/lib/security/account-rate-limit'
import { enforceTrustedBrowserOrigin } from '@/lib/security/request'

// SAAS-PIVOT — teacher renames their linked learner.
//
// Plan: owner-requested 2026-05-23. One-PR feature.
//
// Anti-spoof: `teacherId = session.account.id` (NEVER from body).
// `renameLearnerByTeacher` re-asserts every check (link membership,
// archetype) at the helper boundary, so a future call site can't
// drift from this route's semantics.
//
// Rate limit: 10 per hour per TEACHER (not per IP). Renames are an
// editor surface; per-account is the right unit because shared NAT
// would otherwise pool legitimate teachers' caps and VPN-rotation
// would let one teacher slip the per-IP cap. See `account-rate-limit.ts`
// for the rationale.
//
// CSRF: `enforceTrustedBrowserOrigin` rejects cross-site POSTs.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type RouteParams = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: RouteParams) {
  const { id: learnerId } = await params

  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const guard = await requireTeacherAndVerified(request)
  if (!guard.ok) return guard.response

  // Rate-limit AFTER auth so anonymous probes don't burn the teacher's
  // per-account bucket. 10/hour matches the manual-edit cadence (one
  // typo correction occasionally + a few onboarding renames). Burst
  // window measured in milliseconds.
  const rl = await enforceAccountRateLimit(
    guard.account.id,
    'teacher:rename-learner',
    10,
    60 * 60 * 1000,
  )
  if (rl) return rl

  if (!UUID_PATTERN.test(learnerId)) {
    // Match the helper's 404 shape — no info leak on shape-invalid id.
    return NextResponse.json(
      { error: 'not_found' },
      { status: 404, headers: NO_STORE },
    )
  }

  const parsed = await readJsonObjectOr400(request, { coded: true })
  if (!parsed.ok) return parsed.response
  const body = parsed.body

  // Body shape: `{ displayName?: string, email?: string }`. We accept
  // strings only — passing `null` is rejected, because clearing the
  // display_name or email via this surface is not a supported workflow
  // (the cabinet has its own self-service editor).
  let displayName: string | undefined
  if ('displayName' in body) {
    if (typeof body.displayName !== 'string') {
      return NextResponse.json(
        {
          error: 'displayName_invalid',
          message: 'displayName должен быть строкой.',
        },
        { status: 400, headers: NO_STORE },
      )
    }
    displayName = body.displayName
  }

  let email: string | undefined
  if ('email' in body) {
    if (typeof body.email !== 'string') {
      return NextResponse.json(
        {
          error: 'email_invalid',
          message: 'email должен быть строкой.',
        },
        { status: 400, headers: NO_STORE },
      )
    }
    email = body.email
  }

  if (displayName === undefined && email === undefined) {
    return NextResponse.json(
      {
        error: 'noop',
        message: 'Передайте displayName и/или email.',
      },
      { status: 400, headers: NO_STORE },
    )
  }

  try {
    const result = await renameLearnerByTeacher(
      guard.account.id,
      learnerId,
      { displayName, email },
    )
    return NextResponse.json(
      { ok: true, updated: result.updated },
      { status: 200, headers: NO_STORE },
    )
  } catch (err) {
    if (err instanceof TeacherRenameLearnerError) {
      switch (err.reason) {
        case 'not_found':
        case 'invalid_learner_id':
          return NextResponse.json(
            { error: 'not_found' },
            { status: 404, headers: NO_STORE },
          )
        case 'wrong_archetype':
          return NextResponse.json(
            {
              error: 'wrong_archetype',
              message:
                'Этот аккаунт не является учеником (роль администратора или учителя).',
            },
            { status: 422, headers: NO_STORE },
          )
        case 'email_in_use':
          return NextResponse.json(
            {
              error: 'email_in_use',
              message: 'Этот email уже используется другим аккаунтом.',
            },
            { status: 409, headers: NO_STORE },
          )
        case 'email_invalid':
          return NextResponse.json(
            {
              error: 'email_invalid',
              message: 'email имеет неверный формат.',
            },
            { status: 400, headers: NO_STORE },
          )
        case 'displayName_empty':
          return NextResponse.json(
            {
              error: 'displayName_empty',
              message: 'Имя не может быть пустым.',
            },
            { status: 400, headers: NO_STORE },
          )
        case 'displayName_too_long':
          return NextResponse.json(
            {
              error: 'displayName_too_long',
              message: 'Имя не длиннее 60 символов.',
            },
            { status: 400, headers: NO_STORE },
          )
        case 'noop':
          return NextResponse.json(
            {
              error: 'noop',
              message: 'Передайте displayName и/или email.',
            },
            { status: 400, headers: NO_STORE },
          )
        case 'invalid_teacher_id':
          // Defensive — teacherId comes from session.account.id, which
          // is always a UUID. Treat as 500 if we get here.
          break
      }
    }
    console.error('[teacher.learners.rename] unexpected error', {
      learnerId,
      teacherId: guard.account.id,
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json(
      { error: 'internal_error' },
      { status: 500, headers: NO_STORE },
    )
  }
}
