import { NextResponse } from 'next/server'

import { requireLearnerArchetype } from '@/lib/auth/guards'
import { listSlotsForLearner } from '@/lib/scheduling/slots'
import { enforceRateLimit } from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const noStore = { 'Cache-Control': 'no-store, max-age=0' }

export async function GET(request: Request) {
  const rl = await enforceRateLimit(request, 'slots:mine:ip', 60, 60_000)
  if (rl) return rl

  const auth = await requireLearnerArchetype(request)
  if (!auth.ok) return auth.response

  const slots = await listSlotsForLearner(auth.account.id, 50)
  return NextResponse.json({ slots }, { status: 200, headers: noStore })
}
