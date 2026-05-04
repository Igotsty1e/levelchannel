import { NextResponse } from 'next/server'

import { setAssignedTeacher } from '@/lib/auth/accounts'
import { requireAdminRole } from '@/lib/auth/guards'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const noStore = { 'Cache-Control': 'no-store, max-age=0' }
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

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body.' },
      { status: 400, headers: noStore },
    )
  }
  const raw =
    typeof body === 'object' && body !== null
      ? (body as Record<string, unknown>)
      : {}
  const teacherIdRaw = raw.teacherAccountId
  let teacherId: string | null
  if (teacherIdRaw === null) {
    teacherId = null
  } else if (typeof teacherIdRaw === 'string' && UUID_PATTERN.test(teacherIdRaw)) {
    teacherId = teacherIdRaw
  } else {
    return NextResponse.json(
      { error: 'teacherAccountId must be a uuid or null.' },
      { status: 400, headers: noStore },
    )
  }

  await setAssignedTeacher(id, teacherId)
  return NextResponse.json({ ok: true }, { status: 200, headers: noStore })
}
