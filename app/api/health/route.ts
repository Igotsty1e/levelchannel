import { NextResponse } from 'next/server'

import { getHealthProbePool } from '@/lib/db/pool'
import { paymentConfig, isCloudPaymentsConfigured } from '@/lib/payments/config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// `version` — git SHA of the deployed commit. Populated by the autodeploy
// script's `export GIT_SHA=$(git rev-parse HEAD)` before `npm run build`.
// Returned as `null` when the env var is unset (local dev, fresh runs)
// so consumers can distinguish "this build doesn't carry version info"
// from "version mismatch". Used by .github/workflows/uptime-probe.yml
// to flag autodeploy drift (last main commit vs prod-deployed SHA).
function readDeployedVersion(): string | null {
  const sha = process.env.GIT_SHA?.trim()
  if (!sha) return null
  // Defense in depth: only forward if the value looks like a SHA. An
  // accidentally bound non-hex string (e.g. "main") would mislead the
  // probe — better to surface as null.
  return /^[a-f0-9]{7,64}$/i.test(sha) ? sha : null
}

// Race a query against a 2-second timeout. The shared pool exposes us
// to a congested-pool worst-case latency that an ad-hoc Pool with
// `connectionTimeoutMillis: 2_000` used to cap. Keep the same upper
// bound here so external uptime probes don't hang.
const PROBE_TIMEOUT_MS = 2_000

async function probeDatabase(): Promise<'ok' | 'fail'> {
  try {
    const pool = getHealthProbePool()
    await Promise.race([
      pool.query('select 1'),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`db probe timeout > ${PROBE_TIMEOUT_MS}ms`)),
          PROBE_TIMEOUT_MS,
        ),
      ),
    ])
    return 'ok'
  } catch {
    return 'fail'
  }
}

// Хост-process и внешний uptime monitor пингуют этот эндпоинт.
// Возвращаем 200, если приложение в принципе живо и базовые контуры
// сконфигурированы; 503, если что-то критичное отсутствует — например,
// payments=cloudpayments, но нет API Secret. В таком состоянии платить
// нельзя, и мы не должны казаться "здоровыми".
//
// Pool factory parity (lesson learned 2026-05-07, refined 2026-05-07):
// the database probe goes through `getHealthProbePool()`, a tiny
// max=2 pool dedicated to health checks, instead of the shared
// production singleton. The dedicated pool reuses the SAME
// `resolveSslConfig` factory, so a regression in TLS / env handling
// (the 2026-05-07 hotfix class of bug) still fails health loud — the
// blind spot is closed by sharing the SSL resolver, not by sharing
// the singleton. The dedication prevents a saturated production pool
// from making health-probe latency tip over and triggering false
// uptime alerts. See `lib/db/pool.ts:HEALTH_POOL_MAX` for the
// rationale.
export async function GET() {
  const checks: Record<string, 'ok' | 'fail' | 'skip'> = {
    runtime: 'ok',
  }

  if (paymentConfig.provider === 'cloudpayments') {
    checks.cloudpaymentsConfig = isCloudPaymentsConfigured() ? 'ok' : 'fail'
  } else {
    checks.cloudpaymentsConfig = 'skip'
  }

  if (paymentConfig.storageBackend === 'postgres') {
    if (!paymentConfig.databaseUrl) {
      checks.database = 'fail'
    } else {
      checks.database = await probeDatabase()
    }
  } else {
    checks.database = 'skip'
  }

  const ok = Object.values(checks).every((value) => value !== 'fail')

  return NextResponse.json(
    {
      status: ok ? 'ok' : 'degraded',
      provider: paymentConfig.provider,
      storage: paymentConfig.storageBackend,
      version: readDeployedVersion(),
      checks,
    },
    {
      status: ok ? 200 : 503,
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    },
  )
}
