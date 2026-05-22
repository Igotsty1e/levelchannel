import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { requireTeacherAndVerified } from '@/lib/auth/guards'
import { issueTeacherPackageGrant } from '@/lib/billing/teacher-grant'
import { withIdempotency } from '@/lib/security/idempotency'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

// SAAS-PIVOT Epic 3 Day 4 (2026-05-22) — teacher-driven NON-money grant.
//
// Plan: docs/plans/saas-pivot-master.md §3 Epic 3 + §5 Day 4 step 10.
//
// POST /api/teacher/packages/[id]/issue
//   Body: { learnerAccountId: string, allowStacking?: boolean,
//           reason?: string }
//
// The route itself only gates + validates body shape; the heavy
// lifting happens in `lib/billing/teacher-grant.ts:issueTeacherPackageGrant`
// which does the single-TX write of payment_orders +
// package_purchases + payment_allocations and the anti-spoof
// re-checks (package belongs to teacher, learner is in teacher's
// link set).
//
// Anti-spoof: the URL provides `id` (package), the body provides
// learnerAccountId, the session provides teacherAccountId. The
// helper re-verifies the package's `teacher_id === session.teacherId`
// AND the link's `(teacher, learner) IS active`.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type RouteParams = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: RouteParams) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(
    request,
    'teacher:packages:issue:ip',
    20,
    60_000,
  )
  if (rl) return rl

  const guard = await requireTeacherAndVerified(request)
  if (!guard.ok) return guard.response

  const { id: packageId } = await params
  if (!UUID_PATTERN.test(packageId)) {
    return NextResponse.json(
      { error: 'invalid_package_id' },
      { status: 400, headers: NO_STORE },
    )
  }

  let rawBody: string
  let body: {
    learnerAccountId?: string
    allowStacking?: boolean
    reason?: string
  } = {}
  try {
    rawBody = await request.text()
    body = rawBody.length > 0 ? JSON.parse(rawBody) : {}
  } catch {
    return NextResponse.json(
      { error: 'invalid_body' },
      { status: 400, headers: NO_STORE },
    )
  }

  const learnerAccountId =
    typeof body.learnerAccountId === 'string' ? body.learnerAccountId : null
  if (!learnerAccountId || !UUID_PATTERN.test(learnerAccountId)) {
    return NextResponse.json(
      { error: 'invalid_learner_account_id' },
      { status: 400, headers: NO_STORE },
    )
  }

  const allowStacking = body.allowStacking === true
  const reason =
    typeof body.reason === 'string' && body.reason.trim().length > 0
      ? body.reason.trim().slice(0, 1024)
      : null

  return withIdempotency(
    request,
    `teacher:packages:issue:${packageId}:${learnerAccountId}:${guard.account.id}`,
    rawBody,
    async () => {
      const result = await issueTeacherPackageGrant({
        teacherAccountId: guard.account.id,
        learnerAccountId,
        packageId,
        allowStacking,
        reason,
      })
      switch (result.kind) {
        case 'granted':
          return {
            status: 200,
            body: {
              ok: true,
              invoiceId: result.invoiceId,
              purchaseId: result.purchaseId,
              expiresAt: result.expiresAt,
              titleSnapshot: result.titleSnapshot,
              count: result.count,
            },
          }
        case 'package_not_found':
        case 'package_not_owned':
          // Anti-spoof: same 404 for both — don't leak ownership.
          return {
            status: 404,
            body: { error: 'package_not_found' },
          }
        case 'package_inactive':
          return {
            status: 422,
            body: {
              error: 'package_inactive',
              message: 'Cannot issue an inactive package.',
            },
          }
        case 'learner_not_linked':
          return {
            status: 403,
            body: {
              error: 'learner_not_linked',
              message:
                'Этот ученик не привязан к вашему учителю. Выпустите инвайт и подождите регистрации.',
            },
          }
        case 'learner_account_missing':
          return {
            status: 404,
            body: {
              error: 'learner_account_missing',
              message: 'Учётная запись ученика не найдена.',
            },
          }
        case 'already_owns_active_package':
          return {
            status: 409,
            body: {
              error: 'already_owns_active_package',
              existingPurchaseId: result.existingPurchaseId,
              titleSnapshot: result.titleSnapshot,
              message: `У ученика уже есть активный пакет той же длительности (${result.titleSnapshot}). Передайте allowStacking: true для стэкинга.`,
            },
          }
        default: {
          // exhaustive sentinel — TS narrowing should make this
          // unreachable but defensive.
          const _exhaustive: never = result
          void _exhaustive
          return {
            status: 500,
            body: { error: 'unknown_grant_result' },
          }
        }
      }
    },
  )
}
