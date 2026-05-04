import { NextResponse } from 'next/server'

import { requireAdminRole } from '@/lib/auth/guards'
import { cancelSlot } from '@/lib/scheduling/slots'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const noStore = { 'Cache-Control': 'no-store, max-age=0' }

type RouteParams = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params

  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(request, 'admin:slots:ip', 30, 60_000)
  if (rl) return rl

  const guard = await requireAdminRole(request)
  if (!guard.ok) return guard.response

  let body: unknown = null
  try {
    body = await request.json()
  } catch {
    body = {}
  }
  const reason =
    typeof body === 'object' &&
    body !== null &&
    typeof (body as Record<string, unknown>).reason === 'string'
      ? ((body as Record<string, unknown>).reason as string)
      : null

  try {
    const cancelled = await cancelSlot(id, guard.account.id, reason, 'admin')
    if (!cancelled) {
      return NextResponse.json(
        { error: 'Слот уже отменён или не найден.' },
        { status: 404, headers: noStore },
      )
    }
    return NextResponse.json({ slot: cancelled }, { status: 200, headers: noStore })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    return NextResponse.json({ error: msg }, { status: 400, headers: noStore })
  }
}
