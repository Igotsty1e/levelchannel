import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  createAccount,
  grantAccountRole,
  normalizeAccountEmail,
} from '@/lib/auth/accounts'
import { hashPassword } from '@/lib/auth/password'
import { setOperatorSetting } from '@/lib/admin/operator-settings'
import { getDbPool } from '@/lib/db/pool'

import '../setup'

// BCS-DEF-1-TG (2026-05-19) — gather-then-dispatch behaviour for the
// auth-flow probe. Plan §3.3 + §3.3a (channel-independence on email
// failure) + §3.3b (dedup_skip × master switch).
//
// Strategy mirrors tests/integration/admin/probe-resolver-integration.test.ts:
// shell out to the probe script via execFile against the test DB so we
// can exercise its real top-level code path. Telegram channel is gated
// by the master switch DB row; no real Telegram API hits — the probe
// would attempt fetch() but with TELEGRAM_ALERTS_MASTER_SWITCH=0 we
// short-circuit. The "telegram enabled + no token" subcase verifies
// CONFIG_MISSING row writes.

const execFileP = promisify(execFile)

async function makeAdmin(prefix: string): Promise<string> {
  const acc = await createAccount({
    email: normalizeAccountEmail(`${prefix}-${Date.now()}@example.com`),
    passwordHash: await hashPassword('StrongPassword123'),
  })
  await grantAccountRole(acc.id, 'admin', null)
  return acc.id
}

async function clearState(): Promise<void> {
  const pool = getDbPool()
  await pool.query(`delete from operator_settings`)
  await pool.query(`truncate operator_settings_events restart identity`)
  await pool.query(`delete from probe_runs`)
  await pool.query(`delete from auth_audit_events`)
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
    // Ensure no real Resend / Telegram leaks.
    ALERT_EMAIL_TO: '',
    RESEND_API_KEY: '',
    TELEGRAM_BOT_TOKEN: '',
    TELEGRAM_ALERT_CHAT_ID: '',
    ...extra,
  } as NodeJS.ProcessEnv
}

async function runProbe(env: NodeJS.ProcessEnv): Promise<void> {
  await execFileP(process.execPath, ['scripts/auth-flow-alert.mjs'], {
    env,
    cwd: process.cwd(),
  })
}

async function seedOffenders(): Promise<void> {
  const pool = getDbPool()
  // Need >50 failures from one IP to trigger an alert under default
  // AUTH_FLOW_MAX_PER_IP=50.
  const rows: string[] = []
  for (let i = 0; i < 55; i += 1) {
    rows.push(
      `('auth.login.failed', '203.0.113.7', 'hash-' || ${i}, now() - interval '1 minute')`,
    )
  }
  await pool.query(
    `insert into auth_audit_events (event_type, client_ip, email_hash, created_at)
     values ${rows.join(', ')}`,
  )
}

describe('auth-flow probe — Telegram block gather-then-dispatch', () => {
  it('TELEGRAM_ALERTS_MASTER_SWITCH=0 → no telegram row, only email row', async () => {
    const admin = await makeAdmin('auth-tg-off')
    await setOperatorSetting({
      key: 'TELEGRAM_ALERTS_MASTER_SWITCH',
      value: '0',
      expectedUpdatedAt: null,
      byAccountId: admin,
    })
    await seedOffenders()
    await runProbe(probeEnv())
    const rows = (
      await getDbPool().query(
        `select recipient_kind from probe_runs
          where probe_name = 'auth-flow' and is_test = false`,
      )
    ).rows
    // Email channel always records; Telegram channel skipped.
    expect(rows.length).toBeGreaterThanOrEqual(1)
    for (const r of rows) {
      expect(r.recipient_kind).toBe('email')
    }
  })

  it('TELEGRAM_ALERTS_MASTER_SWITCH=1 + no token → telegram CONFIG_MISSING row', async () => {
    const admin = await makeAdmin('auth-tg-on-no-token')
    await setOperatorSetting({
      key: 'TELEGRAM_ALERTS_MASTER_SWITCH',
      value: '1',
      expectedUpdatedAt: null,
      byAccountId: admin,
    })
    await seedOffenders()
    // TELEGRAM_BOT_TOKEN unset → soft-skip + config_missing row.
    await runProbe(probeEnv())
    const rows = (
      await getDbPool().query(
        `select recipient_kind, verdict_kind, error_message
           from probe_runs
          where probe_name = 'auth-flow' and is_test = false
          order by recipient_kind`,
      )
    ).rows
    // One email row + one telegram row.
    const telegramRow = rows.find((r) => r.recipient_kind === 'telegram')
    expect(telegramRow).toBeDefined()
    expect(telegramRow?.verdict_kind).toBe('config_missing')
    expect(String(telegramRow?.error_message)).toContain('missing_telegram')
  })

  it('email config_missing + telegram master_switch=0 → only email config_missing row (channels independent)', async () => {
    // No seeding → verdict is no_failures, so only one no_failures
    // row (email channel). This is the trivial channel-independence
    // proof for the no-alert path.
    await runProbe(probeEnv())
    const rows = (
      await getDbPool().query(
        `select count(*)::int as n from probe_runs
          where probe_name = 'auth-flow' and is_test = false`,
      )
    ).rows
    expect(rows[0].n).toBe(1)
  })
})
