import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { requireAdminRole } from '@/lib/auth/guards'
import { revokeTeacherPackageGrant } from '@/lib/billing/teacher-grant'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

// SAAS-PIVOT Epic 3 Day 4 (2026-05-22) — admin override revoke for
// teacher-driven grants.
//
// Plan: docs/plans/saas-pivot-master.md §5 Day 4 step 11 + round-29
// closure.
//
// POST /api/admin/teacher-grant/[id]/revoke
//   [id] = invoice_id of the teacher_grant payment_orders row.
//
// Same single-TX flow as the teacher route, but bypasses the
// granted_by_teacher_id ownership check (operator can revoke
// anyone's teacher_grant — e.g. when the teacher is unavailable or
// in case of dispute escalation). The audit row carries
// actor='admin:revoke' so the source is distinguishable.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const INVOICE_ID_PATTERN = /^lc_[a-z0-9_]{8,48}$/i

type RouteParams = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: RouteParams) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(
    request,
    'admin:teacher-grant:revoke:ip',
    20,
    60_000,
  )
  if (rl) return rl

  const guard = await requireAdminRole(request)
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
    teacherAccountId: null,
    bypassTeacherOwnership: true,
  })

  switch (result.kind) {
    case 'revoked':
      return NextResponse.json(
        { ok: true, restoredConsumptions: result.restoredConsumptions },
        { status: 200, headers: NO_STORE },
      )
    case 'order_not_found':
      return NextResponse.json(
        { error: 'order_not_found' },
        { status: 404, headers: NO_STORE },
      )
    case 'order_not_owned_by_teacher':
      // Unreachable for the admin route (bypassTeacherOwnership=true
      // disables this branch in the helper); kept for exhaustiveness.
      return NextResponse.json(
        { error: 'order_not_owned_by_teacher' },
        { status: 500, headers: NO_STORE },
      )
    case 'order_not_teacher_grant':
      return NextResponse.json(
        {
          error: 'order_not_teacher_grant',
          message:
            'Этот заказ не teacher_grant — admin revoke на него не действует.',
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
