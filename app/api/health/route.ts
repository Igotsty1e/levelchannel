import { NextResponse } from 'next/server'

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

// Хост-process и внешний uptime monitor пингуют этот эндпоинт.
// Возвращаем 200, если приложение в принципе живо и базовые контуры
// сконфигурированы; 503, если что-то критичное отсутствует — например,
// payments=cloudpayments, но нет API Secret. В таком состоянии платить
// нельзя, и мы не должны казаться "здоровыми".
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
      try {
        const { Pool } = await import('pg')
        const probe = new Pool({
          connectionString: paymentConfig.databaseUrl,
          // Health-check не должен висеть дольше пары секунд.
          connectionTimeoutMillis: 2_000,
          idleTimeoutMillis: 1_000,
          max: 1,
        })
        await probe.query('select 1')
        await probe.end()
        checks.database = 'ok'
      } catch {
        checks.database = 'fail'
      }
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
