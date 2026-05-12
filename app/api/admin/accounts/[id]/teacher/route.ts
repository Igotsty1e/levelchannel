import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { readJsonObjectOr400 } from '@/lib/api/json-body'
import {
  AssignedTeacherRoleError,
  setAssignedTeacher,
} from '@/lib/auth/accounts'
import { requireAdminRole } from '@/lib/auth/guards'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type RouteParams = { params: Promise<{ id: string }> }

// POST /api/admin/accounts/[id]/teacher  { teacherAccountId: string | null }
//
// Assigns a teacher to a learner account. `null` unassigns. Pure
// admin-side endpoint; the learner sees the result in their
// /cabinet → «Записаться» (slot list filters by their teacher).

export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params

  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(request, 'admin:teacher:ip', 30, 60_000)
  if (rl) return rl

  const guard = await requireAdminRole(request)
  if (!guard.ok) return guard.response

  const parsed = await readJsonObjectOr400(request)
  if (!parsed.ok) return parsed.response
  const teacherIdRaw = parsed.body.teacherAccountId
  let teacherId: string | null
  if (teacherIdRaw === null) {
    teacherId = null
  } else if (typeof teacherIdRaw === 'string' && UUID_PATTERN.test(teacherIdRaw)) {
    teacherId = teacherIdRaw
  } else {
    return NextResponse.json(
      { error: 'teacherAccountId must be a uuid or null.' },
      { status: 400, headers: NO_STORE },
    )
  }

  try {
    await setAssignedTeacher(id, teacherId)
  } catch (err) {
    if (err instanceof AssignedTeacherRoleError) {
      // Codex 2026-05-08 — target account does not have `teacher`
      // role. Surface as 400 with an actionable message; the admin
      // UI can render this directly.
      return NextResponse.json(
        {
          error: 'not_a_teacher',
          message: 'Этот аккаунт не зарегистрирован как преподаватель.',
        },
        { status: 400, headers: NO_STORE },
      )
    }
    throw err
  }
  return NextResponse.json({ ok: true }, { status: 200, headers: NO_STORE })
}
