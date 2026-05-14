// BCS-OP-ROLLOUT plan §4.1 — reconcile cron trigger (BCS-G.1 F9‴
// bounded reconcile sweep).
//
// PII contract (plan §4.3.1): outcome strings from skipped_network /
// skipped_shape MAY contain remote error text that occasionally
// includes emails. Aggregate counts only; do NOT log the details
// array with its slotId+outcome.message pairs.

import { NextResponse } from 'next/server'

import { requireCronSecret } from '@/lib/api/cron-auth'
import { NO_STORE } from '@/lib/api/http-headers'
import { runReconcileSweep } from '@/lib/calendar/reconcile-runner'
import { enforceRateLimit } from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const authGate = requireCronSecret(request)
  if (authGate) return authGate
  const rl = await enforceRateLimit(
    request,
    'cron:calendar-reconcile:ip',
    12,
    60_000,
  )
  if (rl) return rl

  const t0 = Date.now()
  try {
    const result = await runReconcileSweep()
    const durationMs = Date.now() - t0
    const summary = {
      picked: result.picked,
      outcomes: result.outcomes,
    }
    console.log(
      JSON.stringify({
        probe: 'cron-calendar-reconcile',
        level: 'info',
        duration_ms: durationMs,
        ...summary,
      }),
    )
    return NextResponse.json(
      { ok: true, ...summary, duration_ms: durationMs },
      { headers: NO_STORE },
    )
  } catch (e) {
    console.error('[cron/calendar/reconcile] failed', e)
    return NextResponse.json(
      { ok: false, error: 'worker_failed' },
      { status: 500, headers: NO_STORE },
    )
  }
}
