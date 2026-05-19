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
    //
    // AUDIT-CODE-8 (2026-05-17) — `succeeded` outcomes now carry
    // per-job `intervalsAfter` + `durationMs`. Aggregate into the
    // cron tick summary so operators see "pulled N foreign busy
    // intervals this tick" + "slowest job took X ms" without diving
    // into per-job logs.
    const succeededOutcomes = result.outcomes.filter(
      (o): o is Extract<typeof o, { kind: 'succeeded' }> =>
        o.kind === 'succeeded',
    )
    const intervalsPulledTotal = succeededOutcomes.reduce(
      (acc, o) => acc + o.intervalsAfter,
      0,
    )
    const jobDurations = succeededOutcomes.map((o) => o.durationMs)
    const maxJobDurationMs =
      jobDurations.length > 0 ? Math.max(...jobDurations) : 0
    const avgJobDurationMs =
      jobDurations.length > 0
        ? Math.round(
            jobDurations.reduce((a, b) => a + b, 0) / jobDurations.length,
          )
        : 0
    // BCS-DEF-7 Phase 2 (2026-05-19) — per-tick delta vs full-rewrite
    // breakdown for operator dashboards. `delta_410_reissued` counts
    // retries triggered by sync_token_expired (Google rotated the
    // token under us; the runner null'd the column and the job
    // re-enqueued for a fresh full-rewrite).
    const pullsDelta = succeededOutcomes.filter((o) => o.mode === 'delta').length
    const pullsFull = succeededOutcomes.filter((o) => o.mode === 'full').length
    const delta410Reissued = result.outcomes.filter(
      (o) =>
        o.kind === 'retried' && o.reason.includes('sync_token_expired'),
    ).length
    const summary = {
      total: result.outcomes.length,
      succeeded: succeededOutcomes.length,
      retried: result.outcomes.filter((o) => o.kind === 'retried').length,
      terminal_failures: result.outcomes.filter(
        (o) => o.kind === 'terminal_failure',
      ).length,
      skipped: result.outcomes.filter((o) => o.kind === 'skipped').length,
      intervals_pulled_total: intervalsPulledTotal,
      max_job_duration_ms: maxJobDurationMs,
      avg_job_duration_ms: avgJobDurationMs,
      pulls_delta: pullsDelta,
      pulls_full: pullsFull,
      delta_410_reissued: delta410Reissued,
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
