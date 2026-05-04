import { NextResponse } from 'next/server'

import { listOpenFutureSlots } from '@/lib/scheduling/slots'
import { enforceRateLimit } from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const noStore = { 'Cache-Control': 'no-store, max-age=0' }

// GET /api/slots/available?teacher=<uuid>&from=<iso>&to=<iso>
//
// Read-only list of open future slots. Anonymous-readable in this
// wave (mirrors GET /api/payments/[invoiceId] — same loose model);
// booking is gated separately at /api/slots/[id]/book.

export async function GET(request: Request) {
  const rl = await enforceRateLimit(request, 'slots:available:ip', 60, 60_000)
  if (rl) return rl

  const url = new URL(request.url)
  const teacher = url.searchParams.get('teacher')
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')

  const slots = await listOpenFutureSlots({
    teacherAccountId: teacher,
    fromIso: from ?? undefined,
    toIso: to ?? undefined,
  })

  return NextResponse.json({ slots }, { status: 200, headers: noStore })
}
