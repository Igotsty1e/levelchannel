import { NextResponse } from 'next/server'

import { requireAdminRole } from '@/lib/auth/guards'
import { deleteOpenSlot, editOpenSlot } from '@/lib/scheduling/slots'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const noStore = { 'Cache-Control': 'no-store, max-age=0' }

type RouteParams = { params: Promise<{ id: string }> }

export async function PATCH(request: Request, { params }: RouteParams) {
  const { id } = await params

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
  const patch: { startAt?: string; durationMinutes?: number; notes?: string | null } = {}
  if ('startAt' in raw && typeof raw.startAt === 'string') {
    patch.startAt = raw.startAt
  }
  if ('durationMinutes' in raw && typeof raw.durationMinutes === 'number') {
    patch.durationMinutes = raw.durationMinutes
  }
  if ('notes' in raw && (typeof raw.notes === 'string' || raw.notes === null)) {
    patch.notes = raw.notes as string | null
  }

  try {
    const slot = await editOpenSlot(id, patch)
    if (!slot) {
      return NextResponse.json(
        { error: 'Слот не найден или уже не open.' },
        { status: 404, headers: noStore },
      )
    }
    return NextResponse.json({ slot }, { status: 200, headers: noStore })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    return NextResponse.json({ error: msg }, { status: 400, headers: noStore })
  }
}

export async function DELETE(request: Request, { params }: RouteParams) {
  const { id } = await params

  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(request, 'admin:slots:ip', 30, 60_000)
  if (rl) return rl

  const guard = await requireAdminRole(request)
  if (!guard.ok) return guard.response

  const ok = await deleteOpenSlot(id)
  if (!ok) {
    return NextResponse.json(
      {
        error:
          'Удалить можно только open-слот; для booked используйте /cancel.',
      },
      { status: 404, headers: noStore },
    )
  }
  return NextResponse.json({ ok: true }, { status: 200, headers: noStore })
}
