import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { getDbPool } from '@/lib/db/pool'

import '../setup'

// BCS-DEF-1-TG (2026-05-19) — full-path redaction: fetch+Abort error
// gets stringified and written to recordProbeRun.errorMessage with
// the token redacted. Plan §4.1 + §3.1a.
//
// Strategy: import sendTelegramMessage with a fetchImpl stub that
// throws a TypeError carrying the token in its message. Capture the
// resulting `detail` and assert no token leakage.

const moduleUrl = new URL(
  '../../../scripts/lib/telegram-alerts.mjs',
  import.meta.url,
).href
const probeRunsUrl = new URL(
  '../../../scripts/lib/probe-runs.mjs',
  import.meta.url,
).href

const FAKE_TOKEN = '1234567890:ABCDEFGHijklmnopQRSTuvwxyz_-XYZ123'
const FAKE_CHAT = '999000111'

interface TelegramHelpers {
  sendTelegramMessage: (params: {
    botToken: string
    chatId: string
    text: string
    retryMax?: number
    fetchImpl?: typeof fetch
    timeoutMs?: number
    backoffMs?: number
    sleepImpl?: (ms: number) => Promise<void>
  }) => Promise<
    | { ok: true; messageId: string }
    | { ok: false; error: string; detail?: string }
  >
  redactTelegramSecret: (text: string, token: string) => string
}

interface ProbeRunsHelpers {
  recordProbeRun: (
    pool: unknown,
    params: Record<string, unknown>,
  ) => Promise<void>
  PROBE_NAMES: Record<string, string>
  VERDICT_KINDS: Record<string, string>
  RECIPIENT_KINDS: Record<string, string>
}

async function loadModules(): Promise<{
  tg: TelegramHelpers
  pr: ProbeRunsHelpers
}> {
  return {
    tg: (await import(moduleUrl)) as TelegramHelpers,
    pr: (await import(probeRunsUrl)) as ProbeRunsHelpers,
  }
}

beforeEach(async () => {
  await getDbPool().query(`truncate table probe_runs restart identity cascade`)
})
afterEach(async () => {
  await getDbPool().query(`truncate table probe_runs restart identity cascade`)
})

describe('Telegram secret redaction — recordProbeRun.errorMessage', () => {
  it('TypeError carrying token in message → probe_runs.error_message is redacted', async () => {
    const { tg, pr } = await loadModules()
    const networkErr = new TypeError(
      `fetch failed at https://api.telegram.org/bot${FAKE_TOKEN}/sendMessage`,
    )
    const fetchImpl = (async () => {
      throw networkErr
    }) as unknown as typeof fetch

    const result = await tg.sendTelegramMessage({
      botToken: FAKE_TOKEN,
      chatId: FAKE_CHAT,
      text: 'paging',
      retryMax: 0,
      fetchImpl,
      sleepImpl: async () => {},
      backoffMs: 0,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.detail).toBeTruthy()

    // Imitate the per-probe Telegram block's recordProbeRun call.
    const redacted = tg.redactTelegramSecret(
      result.detail ?? result.error,
      FAKE_TOKEN,
    )
    await pr.recordProbeRun(getDbPool(), {
      probeName: pr.PROBE_NAMES.AUTH_FLOW,
      verdictKind: pr.VERDICT_KINDS.ALERT_SEND_FAILED,
      recipientKind: pr.RECIPIENT_KINDS.TELEGRAM,
      recipientEmail: FAKE_CHAT,
      stats: {},
      errorMessage: redacted,
    })

    const row = (
      await getDbPool().query(
        `select error_message from probe_runs
          where probe_name = 'auth-flow' and recipient_kind = 'telegram'
          order by ran_at desc limit 1`,
      )
    ).rows[0]
    expect(row).toBeDefined()
    const stored = String(row.error_message)
    expect(stored).not.toContain(FAKE_TOKEN)
    expect(stored).not.toContain(FAKE_TOKEN.slice(-8))
    expect(stored).not.toMatch(/bot1234567890/)
    expect(stored).toContain('[REDACTED]')
  })
})
