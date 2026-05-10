import { NextResponse } from 'next/server'

import { readJsonObjectOr400 } from '@/lib/api/json-body'
import { requireAdminRole } from '@/lib/auth/guards'
import {
  type BulkPreviewInput,
  bulkGeneratePreview,
} from '@/lib/scheduling/slots'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' }

// POST /api/admin/slots/bulk-preview — pure (no DB write); returns
// the array of `{ startAt, date, time }` the bulk-create would emit
// for the given recurring template. Lets the admin UI render a
// preview list with per-row deselect before commit.

export async function POST(request: Request) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(request, 'admin:slots:ip', 30, 60_000)
  if (rl) return rl

  const guard = await requireAdminRole(request)
  if (!guard.ok) return guard.response

  const parsed = await readJsonObjectOr400(request)
  if (!parsed.ok) return parsed.response
  const raw = parsed.body

  const input: Partial<BulkPreviewInput> = {}
  if (Array.isArray(raw.weekdays)) {
    input.weekdays = raw.weekdays.filter((n): n is number =>
      typeof n === 'number',
    )
  }
  if (typeof raw.startTime === 'string') input.startTime = raw.startTime
  if (typeof raw.startDate === 'string') input.startDate = raw.startDate
  if (typeof raw.weeks === 'number') input.weeks = raw.weeks
  if (typeof raw.durationMinutes === 'number') {
    input.durationMinutes = raw.durationMinutes
  }
  if (Array.isArray(raw.skipDates)) {
    input.skipDates = raw.skipDates.filter((s): s is string => typeof s === 'string')
  }
  if (typeof raw.timezone === 'string') input.timezone = raw.timezone

  const result = bulkGeneratePreview(input as BulkPreviewInput)
  if (!result.ok) {
    return NextResponse.json(
      { error: `${result.error.field}/${result.error.reason}` },
      { status: 400, headers: NO_STORE },
    )
  }
  return NextResponse.json(
    { slots: result.slots },
    { status: 200, headers: NO_STORE },
  )
}
