#!/usr/bin/env node
// BCS-OP-ROLLOUT plan §4.4 — parameterised cron entry for the 6
// calendar workers. systemd timers point at this single script with
// CALENDAR_CRON_TARGET set to the worker name.
//
// Why one script not six: same code path for all six routes;
// per-target customisation is just an env-var dispatch + a small
// lookup table for the timeout.
//
// Per-target HTTP timeout (plan §4.4 table) = TimeoutStartSec − 30s
// so the Node fetch aborts and logs a clean error 30s before systemd
// would SIGKILL.
//
// Auth: reads CRON_SHARED_SECRET from the env file (same one the app
// reads) and sends Authorization: Bearer <secret>. The route gates
// on loopback Host (we POST to 127.0.0.1) + bearer match.
//
// Exit codes:
//   0 — 2xx response from the route
//   1 — non-2xx response or network/fetch error
//   2 — config error (unknown target, missing secret)

const TIMEOUTS_SEC = {
  pull: 570, // service TimeoutStartSec=600
  push: 270, // 300
  intents: 270, // 300
  'renew-channels': 570, // 600
  'revive-blocked': 90, // 120
  reconcile: 870, // 900
}

const target = process.env.CALENDAR_CRON_TARGET ?? ''
const secret = process.env.CRON_SHARED_SECRET ?? ''
const port = process.env.CALENDAR_CRON_PORT ?? '3000'
const host = process.env.CALENDAR_CRON_HOST ?? '127.0.0.1'

if (!target || !(target in TIMEOUTS_SEC)) {
  console.error(
    JSON.stringify({
      probe: 'calendar-cron',
      level: 'error',
      kind: 'unknown_target',
      target,
      valid_targets: Object.keys(TIMEOUTS_SEC),
    }),
  )
  process.exit(2)
}
if (!secret) {
  console.error(
    JSON.stringify({
      probe: 'calendar-cron',
      level: 'error',
      kind: 'missing_secret',
      message: 'CRON_SHARED_SECRET not set in env file',
    }),
  )
  process.exit(2)
}

const timeoutSec = TIMEOUTS_SEC[target]
const url = `http://${host}:${port}/api/cron/calendar/${target}`
const t0 = Date.now()

const controller = new AbortController()
const timeoutHandle = setTimeout(() => controller.abort(), timeoutSec * 1000)

try {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${secret}`,
      'content-type': 'application/json',
      // No Origin / Sec-Fetch-Site — the route's host gate is the
      // primary check. (See lib/api/cron-auth.ts.)
    },
    signal: controller.signal,
  })
  clearTimeout(timeoutHandle)
  const durationMs = Date.now() - t0
  let bodyText = ''
  try {
    bodyText = await res.text()
  } catch {
    // ignore
  }
  const logLevel = res.ok ? 'info' : 'error'
  console.log(
    JSON.stringify({
      probe: 'calendar-cron',
      level: logLevel,
      target,
      url,
      status: res.status,
      duration_ms: durationMs,
      body: bodyText.slice(0, 4096),
    }),
  )
  process.exit(res.ok ? 0 : 1)
} catch (e) {
  clearTimeout(timeoutHandle)
  const durationMs = Date.now() - t0
  const kind = e?.name === 'AbortError' ? 'timeout' : 'network'
  console.error(
    JSON.stringify({
      probe: 'calendar-cron',
      level: 'error',
      target,
      url,
      kind,
      message: e instanceof Error ? e.message : String(e),
      duration_ms: durationMs,
    }),
  )
  process.exit(1)
}
