import { NextResponse } from 'next/server'

import { paymentConfig, isCloudPaymentsConfigured } from '@/lib/payments/config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Render и uptime monitor пингуют этот эндпоинт.
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
      checks,
    },
    {
      status: ok ? 200 : 503,
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    },
  )
}
