// BCS-OP-ROLLOUT plan §4.1 — channel-renewal cron trigger.
//
// PII contract (plan §4.3.1): summary log MUST NOT leak the
// externalCalendarId values from RenewSweepOutcome.details — they can
// be email-like Google calendar ids (third-party PII). Aggregate only.

import { NextResponse } from 'next/server'

import { requireCronSecret } from '@/lib/api/cron-auth'
import { NO_STORE } from '@/lib/api/http-headers'
import { renewExpiringChannels } from '@/lib/calendar/channel-renewer'
import { enforceRateLimit } from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const authGate = requireCronSecret(request)
  if (authGate) return authGate
  const rl = await enforceRateLimit(
    request,
    'cron:calendar-renew-channels:ip',
    12,
    60_000,
  )
  if (rl) return rl

  const t0 = Date.now()
  try {
    const result = await renewExpiringChannels()
    const durationMs = Date.now() - t0
    // EXPLICIT allowlist (plan §4.3.1) — drop details[].externalCalendarId.
    const summary = {
      attempted: result.attempted,
      renewed: result.renewed,
      failed: result.failed,
    }
    console.log(
      JSON.stringify({
        probe: 'cron-calendar-renew-channels',
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
    console.error('[cron/calendar/renew-channels] failed', e)
    return NextResponse.json(
      { ok: false, error: 'worker_failed' },
      { status: 500, headers: NO_STORE },
    )
  }
}
