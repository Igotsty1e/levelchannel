import { NextResponse } from 'next/server'

import { listAccountPostpaidDebt } from '@/lib/billing/packages'
import { getCurrentSession } from '@/lib/auth/sessions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' }

// Billing wave PR 3 — own postpaid-debt list. Read-only own data.
// Used by the cabinet "К оплате" section.

export async function GET(request: Request) {
  const session = await getCurrentSession(request)
  if (!session) {
    return NextResponse.json(
      { error: 'Not authenticated.' },
      { status: 401, headers: NO_STORE },
    )
  }
  const debt = await listAccountPostpaidDebt(session.account.id)
  return NextResponse.json(
    { debt },
    { status: 200, headers: NO_STORE },
  )
}
