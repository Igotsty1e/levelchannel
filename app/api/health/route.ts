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
  } catch (err) {
    // Codex Wave 13 (Pass 2 #25) — surface the actual reason in
    // journalctl. The /api/health response stays a clean
    // `database: 'fail'` (no leak to anonymous probes), but the
    // operator can grep for `[health.probe]` to see why. Without
    // this log, a degraded prod returns `{database:'fail'}` with no
    // way to tell pool-init vs SSL vs query timeout apart.
    //
    // Codex Wave 16 LOW — pg drivers occasionally include the
    // connection target (host:port, sometimes user) in `err.message`.
    // Prefer `err.code` (PG SQLSTATE) and `err.name`; truncate the
    // message at 200 chars so a pathological driver string can't
    // dump credentials into journald.
    const e = err as { name?: string; code?: string; message?: string }
    const msg =
      typeof e.message === 'string' ? e.message.slice(0, 200) : String(err)
    console.warn('[health.probe] db probe failed:', {
      name: e.name,
      code: e.code,
      message: msg,
    })
    return 'fail'
  }
}

// Хост-process и внешний uptime monitor пингуют этот эндпоинт.
// Возвращаем 200, если приложение в принципе живо и базовые контуры
// сконфигурированы; 503, если что-то критичное отсутствует — например,
// payments=cloudpayments, но нет API Secret. В таком состоянии платить
// нельзя, и мы не должны казаться "здоровыми".
//
// Codex 2026-05-08 (LOW-MEDIUM) — anonymous response is slim
// (`{status, version}` only). Detailed `{provider, storage, checks}`
// requires a header that matches `HEALTH_DETAIL_SECRET`. Uptime probe
// and operator scripts include the header. Anonymous probes (bots,
// scanners) get just enough to detect outage without the
// fingerprinting surface (provider name, storage backend, per-check
// granularity).
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
function isPrivilegedHealthRequest(request: Request): boolean {
  const provided = request.headers.get('x-health-detail')?.trim() || ''
  if (!provided) return false
  const expected = process.env.HEALTH_DETAIL_SECRET?.trim() || ''
  if (!expected) return false
  // Lengths must match before timingSafeEqual (which throws on
  // mismatched length). Both sides are short strings so a-priori
  // length comparison doesn't leak useful info.
  if (provided.length !== expected.length) return false
  // Constant-time compare. Header secret is operator-side; the
  // timing-leak threat is theoretical here, but keeps the door
  // closed.
  const a = Buffer.from(provided, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('crypto').timingSafeEqual(a, b)
}

export async function GET(request: Request) {
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
  const privileged = isPrivilegedHealthRequest(request)

  const body = privileged
    ? {
        status: ok ? 'ok' : 'degraded',
        provider: paymentConfig.provider,
        storage: paymentConfig.storageBackend,
        version: readDeployedVersion(),
        checks,
      }
    : {
        status: ok ? 'ok' : 'degraded',
        version: readDeployedVersion(),
      }

  return NextResponse.json(body, {
    status: ok ? 200 : 503,
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  })
}
