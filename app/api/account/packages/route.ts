import { NextResponse } from 'next/server'

import { listAccountActivePackages } from '@/lib/billing/packages'
import { getCurrentSession } from '@/lib/auth/sessions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' }

// Billing wave PR 2 — own packages list. Read-only own data.
// Used by the cabinet "Мои пакеты" section (PR 3) and the
// BookConfirmModal billing-preview (PR 3).

export async function GET(request: Request) {
  const session = await getCurrentSession(request)
  if (!session) {
    return NextResponse.json(
      { error: 'Not authenticated.' },
      { status: 401, headers: NO_STORE },
    )
  }
  const packages = await listAccountActivePackages(session.account.id)
  return NextResponse.json(
    { packages },
    { status: 200, headers: NO_STORE },
  )
}
