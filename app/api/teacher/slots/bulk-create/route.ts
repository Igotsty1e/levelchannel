import { NextResponse } from 'next/server'

import { requireTeacherAndVerified } from '@/lib/auth/guards'
import {
  type BulkCreateInput,
  bulkCreateSlots,
  SlotTeacherRoleError,
} from '@/lib/scheduling/slots'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' }

// Wave C — teacher bulk-create. Same shape as the admin equivalent
// but binds teacherAccountId from session (body is ignored).

export async function POST(request: Request) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(
    request,
    'teacher:slots:bulk:ip',
    20,
    60_000,
  )
  if (rl) return rl

  const guard = await requireTeacherAndVerified(request)
  if (!guard.ok) return guard.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body.' },
      { status: 400, headers: NO_STORE },
    )
  }
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json(
      { error: 'Body must be a JSON object.' },
      { status: 400, headers: NO_STORE },
    )
  }
  const raw = body as Record<string, unknown>

  const input: Partial<BulkCreateInput> = {
    teacherAccountId: guard.account.id, // bound to session
  }
  if (typeof raw.durationMinutes === 'number') {
    input.durationMinutes = raw.durationMinutes
  }
  if (typeof raw.notes === 'string' || raw.notes === null) {
    input.notes = raw.notes as string | null
  }
  if (typeof raw.tariffId === 'string' || raw.tariffId === null) {
    input.tariffId = raw.tariffId as string | null
  }
  if (Array.isArray(raw.slots)) {
    input.slots = raw.slots
      .filter(
        (s): s is { startAt: string } =>
          typeof s === 'object' &&
          s !== null &&
          typeof (s as Record<string, unknown>).startAt === 'string',
      )
      .map((s) => ({ startAt: s.startAt }))
  }

  if (
    typeof input.durationMinutes !== 'number' ||
    !Array.isArray(input.slots)
  ) {
    return NextResponse.json(
      { error: 'durationMinutes and slots[] are required.' },
      { status: 400, headers: NO_STORE },
    )
  }

  try {
    const result = await bulkCreateSlots(input as BulkCreateInput)
    return NextResponse.json(
      {
        created: result.created,
        skippedConflicts: result.skippedConflicts,
      },
      { status: 201, headers: NO_STORE },
    )
  } catch (err) {
    if (err instanceof SlotTeacherRoleError) {
      return NextResponse.json(
        { error: 'Внутренняя ошибка проверки роли.' },
        { status: 500, headers: NO_STORE },
      )
    }
    // Unknown errors → 500 with logging; mirrors single-create.
    console.error('[teacher.slots.bulk-create] unexpected error', err)
    return NextResponse.json(
      { error: 'internal_error' },
      { status: 500, headers: NO_STORE },
    )
  }
}
