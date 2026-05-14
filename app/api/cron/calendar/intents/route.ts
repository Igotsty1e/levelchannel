// BCS-OP-ROLLOUT plan §4.1 — intent cron trigger.

import { NextResponse } from 'next/server'

import { requireCronSecret } from '@/lib/api/cron-auth'
import { NO_STORE } from '@/lib/api/http-headers'
import { drainIntents } from '@/lib/calendar/intent-worker'
import { enforceRateLimit } from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const authGate = requireCronSecret(request)
  if (authGate) return authGate
  const rl = await enforceRateLimit(request, 'cron:calendar-intents:ip', 12, 60_000)
  if (rl) return rl

  const t0 = Date.now()
  try {
    const result = await drainIntents({})
    const durationMs = Date.now() - t0
    const summary = {
      total: result.outcomes.length,
      succeeded: result.outcomes.filter((o) => o.kind === 'succeeded').length,
      blocked_integration: result.outcomes.filter(
        (o) => o.kind === 'blocked_integration',
      ).length,
      terminal_failures: result.outcomes.filter(
        (o) => o.kind === 'terminal_failure',
      ).length,
    }
    console.log(
      JSON.stringify({
        probe: 'cron-calendar-intents',
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
    console.error('[cron/calendar/intents] failed', e)
    return NextResponse.json(
      { ok: false, error: 'worker_failed' },
      { status: 500, headers: NO_STORE },
    )
  }
}
