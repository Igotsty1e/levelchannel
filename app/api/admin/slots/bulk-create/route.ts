import { NextResponse } from 'next/server'

import { requireAdminRole } from '@/lib/auth/guards'
import {
  type BulkCreateInput,
  bulkCreateSlots,
} from '@/lib/scheduling/slots'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const noStore = { 'Cache-Control': 'no-store, max-age=0' }

// POST /api/admin/slots/bulk-create
// Body:
//   {
//     teacherAccountId, durationMinutes, notes?,
//     slots: [{ startAt }, ...]
//   }
//
// Atomic-batch insert. Conflicts on (teacher_account_id, start_at)
// skip without aborting the batch — the response surfaces both the
// created rows and the conflicting startAts so the UI can tell the
// operator which ones already existed.

export async function POST(request: Request) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(request, 'admin:slots:ip', 30, 60_000)
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
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json(
      { error: 'Body must be a JSON object.' },
      { status: 400, headers: noStore },
    )
  }
  const raw = body as Record<string, unknown>

  const input: Partial<BulkCreateInput> = {}
  if (typeof raw.teacherAccountId === 'string') {
    input.teacherAccountId = raw.teacherAccountId
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
    typeof input.teacherAccountId !== 'string' ||
    typeof input.durationMinutes !== 'number' ||
    !Array.isArray(input.slots)
  ) {
    return NextResponse.json(
      {
        error:
          'teacherAccountId, durationMinutes, slots[] are required.',
      },
      { status: 400, headers: noStore },
    )
  }

  try {
    const result = await bulkCreateSlots(input as BulkCreateInput)
    return NextResponse.json(
      {
        created: result.created,
        skippedConflicts: result.skippedConflicts,
      },
      { status: 201, headers: noStore },
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    return NextResponse.json({ error: msg }, { status: 400, headers: noStore })
  }
}
