// BCS-OP-ROLLOUT plan §4.1 — pull cron trigger. systemd timer
// `levelchannel-calendar-pull.timer` invokes
// scripts/calendar-cron.mjs which POSTs here on 127.0.0.1:3000.
//
// Auth: loopback-Host + bearer secret (lib/api/cron-auth.ts).
// Rate limit: 12/min/IP defense-in-depth in case the route + secret
// somehow get exposed beyond loopback.

import { NextResponse } from 'next/server'

import { requireCronSecret } from '@/lib/api/cron-auth'
import { NO_STORE } from '@/lib/api/http-headers'
import { drainPullJobs } from '@/lib/calendar/pull-worker'
import { enforceRateLimit } from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const authGate = requireCronSecret(request)
  if (authGate) return authGate
  const rl = await enforceRateLimit(request, 'cron:calendar-pull:ip', 12, 60_000)
  if (rl) return rl

  const t0 = Date.now()
  try {
    const result = await drainPullJobs({})
    const durationMs = Date.now() - t0
    // BCS-OP-ROLLOUT §4.3.1 — explicit allowlist summary; outcomes are
    // enum-shaped + counts (safe; no PII).
    const summary = {
      total: result.outcomes.length,
      succeeded: result.outcomes.filter((o) => o.kind === 'succeeded').length,
      retried: result.outcomes.filter((o) => o.kind === 'retried').length,
      terminal_failures: result.outcomes.filter(
        (o) => o.kind === 'terminal_failure',
      ).length,
      skipped: result.outcomes.filter((o) => o.kind === 'skipped').length,
    }
    console.log(
      JSON.stringify({
        probe: 'cron-calendar-pull',
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
    console.error('[cron/calendar/pull] failed', e)
    return NextResponse.json(
      { ok: false, error: 'worker_failed' },
      { status: 500, headers: NO_STORE },
    )
  }
}
