import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { requireTeacherWithCurrentSaasOfferConsent } from '@/lib/auth/guards'
import { revokeTeacherPackageGrant } from '@/lib/billing/teacher-grant'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

// SAAS-PIVOT Epic 3 Day 4 (2026-05-22) — teacher-driven grant revoke.
//
// Plan: docs/plans/saas-pivot-master.md §3 Epic 3 + §5 Day 4 step 11.
//
// POST /api/teacher/packages/[id]/revoke
//   [id] = invoice_id of the teacher_grant payment_orders row.
//   Body: empty.
//
// Voids the matching package_purchases row + restores active
// consumptions + updates payment_orders.status='teacher_revoked'.
// NO payment_allocation_reversals row (non-money).
//
// Anti-spoof: the helper verifies
// payment_orders.granted_by_teacher_id === session.account.id and
// payment_orders.provider === 'teacher_grant'.
//
// Gate: refuses if any consumption on the purchase is active
// (unrestored). Once Day 5A's lesson_completions table lands, the
// gate flips to "any consumption with a lesson_completions row".

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// invoice_id pattern matches lib/security/request.ts INVOICE_ID_PATTERN.
const INVOICE_ID_PATTERN = /^lc_[a-z0-9_]{8,48}$/i

type RouteParams = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: RouteParams) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(
    request,
    'teacher:packages:revoke:ip',
    20,
    60_000,
  )
  if (rl) return rl

  const guard = await requireTeacherWithCurrentSaasOfferConsent(request)
  if (!guard.ok) return guard.response

  const { id: invoiceId } = await params
  if (!INVOICE_ID_PATTERN.test(invoiceId)) {
    return NextResponse.json(
      { error: 'invalid_invoice_id' },
      { status: 400, headers: NO_STORE },
    )
  }

  const result = await revokeTeacherPackageGrant({
    invoiceId,
    teacherAccountId: guard.account.id,
    bypassTeacherOwnership: false,
  })

  switch (result.kind) {
    case 'revoked':
      return NextResponse.json(
        { ok: true, restoredConsumptions: result.restoredConsumptions },
        { status: 200, headers: NO_STORE },
      )
    case 'order_not_found':
    case 'order_not_owned_by_teacher':
      // Anti-spoof: same 404 for both.
      return NextResponse.json(
        { error: 'order_not_found' },
        { status: 404, headers: NO_STORE },
      )
    case 'order_not_teacher_grant':
      return NextResponse.json(
        {
          error: 'order_not_teacher_grant',
          message:
            'Этот заказ не выдан учителем — отмена возможна только для teacher_grant.',
        },
        { status: 422, headers: NO_STORE },
      )
    case 'already_revoked':
      return NextResponse.json(
        { error: 'already_revoked' },
        { status: 409, headers: NO_STORE },
      )
    case 'has_completed_consumptions':
      return NextResponse.json(
        {
          error: 'has_completed_consumptions',
          message:
            'У пакета есть проведённые занятия — отмена невозможна.',
        },
        { status: 422, headers: NO_STORE },
      )
    case 'purchase_not_found':
      return NextResponse.json(
        { error: 'purchase_not_found' },
        { status: 500, headers: NO_STORE },
      )
    default: {
      const _exhaustive: never = result
      void _exhaustive
      return NextResponse.json(
        { error: 'unknown_revoke_result' },
        { status: 500, headers: NO_STORE },
      )
    }
  }
}
