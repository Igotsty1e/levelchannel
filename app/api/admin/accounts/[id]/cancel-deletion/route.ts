import { NextResponse } from 'next/server'

import { cancelAccountDeletion } from '@/lib/auth/accounts'
import { requireAdminRole } from '@/lib/auth/guards'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const noStore = { 'Cache-Control': 'no-store, max-age=0' }

type RouteParams = { params: Promise<{ id: string }> }

// POST /api/admin/accounts/[id]/cancel-deletion
//
// Operator-side cancel of a learner-requested deletion during the
// 30-day grace window. Clears disabled_at + scheduled_purge_at. The
// learner can log in again with their old credentials (password_hash
// is untouched in stage 1).
//
// No-op (and 200 ok) if the row was never scheduled for purge or has
// already been purged — idempotent.

export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params

  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(
    request,
    'admin:cancel-deletion:ip',
    30,
    60_000,
  )
  if (rl) return rl

  const guard = await requireAdminRole(request)
  if (!guard.ok) return guard.response

  await cancelAccountDeletion(id)
  return NextResponse.json({ ok: true }, { status: 200, headers: noStore })
}
