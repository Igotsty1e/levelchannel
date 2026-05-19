import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { getDbPool } from '@/lib/db/pool'

import '../setup'

// BCS-DEF-1-TG (2026-05-19) — gather-then-dispatch behaviour for the
// webhook-flow probe (stateless, no dedup_skip case). Plan §3.3.

const execFileP = promisify(execFile)

async function clearState(): Promise<void> {
  const pool = getDbPool()
  await pool.query(`delete from probe_runs`)
  await pool.query(`delete from payment_audit_events`)
}

beforeEach(async () => {
  await clearState()
})
afterEach(async () => {
  await clearState()
})

function probeEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DATABASE_URL: process.env.DATABASE_URL ?? '',
    ALERT_EMAIL_TO: '',
    RESEND_API_KEY: '',
    TELEGRAM_BOT_TOKEN: '',
    TELEGRAM_ALERT_CHAT_ID: '',
    ...extra,
  } as NodeJS.ProcessEnv
}

async function runProbe(env: NodeJS.ProcessEnv): Promise<void> {
  await execFileP(process.execPath, ['scripts/webhook-flow-alert.mjs'], {
    env,
    cwd: process.cwd(),
  })
}

describe('webhook-flow probe — Telegram block gather-then-dispatch', () => {
  it('low_volume_skip → one row, no channel dispatch', async () => {
    await runProbe(probeEnv())
    const rows = (
      await getDbPool().query(
        `select verdict_kind, recipient_kind from probe_runs
          where probe_name = 'webhook-flow' and is_test = false`,
      )
    ).rows
    expect(rows.length).toBe(1)
    expect(rows[0].verdict_kind).toBe('low_volume_skip')
    expect(rows[0].recipient_kind).toBe('email')
  })
})
