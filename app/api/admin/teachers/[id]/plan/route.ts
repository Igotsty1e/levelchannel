import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { listAccountRoles } from '@/lib/auth/accounts'
import { requireAdminRole } from '@/lib/auth/guards'
import { getDbPool } from '@/lib/db/pool'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

// SAAS-PIVOT Epic 6 Day 6 (2026-05-22) — admin plan-toggle for a teacher.
//
// Plan: docs/plans/saas-pivot-master.md §3 Epic 6 + §5 Day 6.
//
// Contract:
//   POST /api/admin/teachers/<id>/plan
//   Body: { planSlug: 'free' | 'mid' | 'pro' | 'operator-managed' }
//
// Anti-spoof: re-verifies admin role + target is a teacher.
//
// Downgrade gate: if the target plan has a `learner_limit` and the
// teacher already has MORE active learners than the cap, refuse with
// 409 cap_exceeded. Admin must unlink learners first.
//
// Best-effort audit: log to console (auth_audit_events doesn't have
// a `teacher_plan_changed` event type allowlist row by default; we
// keep it console-only until the audit-taxonomy wave adds it).

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const KNOWN_PLAN_SLUGS = new Set(['free', 'mid', 'pro', 'operator-managed'])

type RouteParams = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: RouteParams) {
  const origin = enforceTrustedBrowserOrigin(request)
  if (origin) return origin

  const rl = await enforceRateLimit(request, 'admin:teachers:plan', 20, 60_000)
  if (rl) return rl

  const auth = await requireAdminRole(request)
  if (!auth.ok) return auth.response

  const { id: teacherAccountId } = await params
  if (!UUID_PATTERN.test(teacherAccountId)) {
    return NextResponse.json(
      { error: 'invalid_teacher_id' },
      { status: 400, headers: NO_STORE },
    )
  }

  let body: { planSlug?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'invalid_body' },
      { status: 400, headers: NO_STORE },
    )
  }

  const planSlug = String(body.planSlug ?? '')
  if (!KNOWN_PLAN_SLUGS.has(planSlug)) {
    return NextResponse.json(
      { error: 'invalid_plan_slug' },
      { status: 400, headers: NO_STORE },
    )
  }

  // Anti-spoof: target must be a teacher.
  const targetRoles = await listAccountRoles(teacherAccountId)
  if (!targetRoles.includes('teacher')) {
    return NextResponse.json(
      { error: 'target_not_teacher' },
      { status: 404, headers: NO_STORE },
    )
  }

  const pool = getDbPool()

  // Downgrade gate: if the new plan has a learner_limit, check active
  // link count. learner_count > new_plan.learner_limit → 409.
  const planRow = await pool.query<{ learner_limit: number | null }>(
    `select learner_limit from teacher_subscription_plans where slug = $1`,
    [planSlug],
  )
  if (planRow.rows.length === 0) {
    return NextResponse.json(
      { error: 'plan_not_found' },
      { status: 404, headers: NO_STORE },
    )
  }
  const learnerLimit = planRow.rows[0].learner_limit
  if (learnerLimit !== null) {
    const linkCount = await pool.query<{ c: string }>(
      `select count(*)::text as c
         from learner_teacher_links
        where teacher_account_id = $1::uuid
          and unlinked_at is null`,
      [teacherAccountId],
    )
    const currentLearners = Number(linkCount.rows[0]?.c ?? 0)
    if (currentLearners > learnerLimit) {
      return NextResponse.json(
        {
          error: 'cap_exceeded',
          message: `У учителя сейчас ${currentLearners} учеников, новый тариф «${planSlug}» допускает максимум ${learnerLimit}. Сначала разорвите связи.`,
          currentLearners,
          newLimit: learnerLimit,
        },
        { status: 409, headers: NO_STORE },
      )
    }
  }

  // Upsert the subscription row. Existing row update; new row insert.
  await pool.query(
    `insert into teacher_subscriptions (account_id, plan_slug, state)
       values ($1::uuid, $2, 'active')
       on conflict (account_id) do update
         set plan_slug = excluded.plan_slug,
             state = 'active',
             updated_at = now()`,
    [teacherAccountId, planSlug],
  )

  // Best-effort console audit. auth_audit_events doesn't expose a
  // canonical event_type for this transition; promoting it there is
  // tracked separately (audit-taxonomy wave). Console-on-prod is
  // structured + grep'able for operator forensics.
  console.info('[admin.teacher.plan]', {
    operatorAccountId: auth.account.id,
    operatorEmail: auth.account.email,
    targetAccountId: teacherAccountId,
    newPlanSlug: planSlug,
    timestamp: new Date().toISOString(),
  })

  return NextResponse.json(
    { ok: true, planSlug },
    { status: 200, headers: NO_STORE },
  )
}
