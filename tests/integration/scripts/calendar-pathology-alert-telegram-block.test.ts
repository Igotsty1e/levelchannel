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
// calendar-pathology probe. Plan §3.3 + §3.3a.

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
  await execFileP(
    process.execPath,
    ['scripts/calendar-pathology-alert.mjs'],
    { env, cwd: process.cwd() },
  )
}

describe('calendar-pathology probe — Telegram block gather-then-dispatch', () => {
  it('no offenders → one no_offenders row, channels not dispatched', async () => {
    await runProbe(probeEnv())
    const rows = (
      await getDbPool().query(
        `select verdict_kind, recipient_kind from probe_runs
          where probe_name = 'calendar-pathology' and is_test = false`,
      )
    ).rows
    expect(rows.length).toBe(1)
    expect(rows[0].verdict_kind).toBe('no_offenders')
    expect(rows[0].recipient_kind).toBe('email')
  })

  it('TELEGRAM_ALERTS_MASTER_SWITCH=1 with no offenders → still no telegram row (pre-dispatch verdict)', async () => {
    const admin = await makeAdmin('cp-tg-on-no-offenders')
    await setOperatorSetting({
      key: 'TELEGRAM_ALERTS_MASTER_SWITCH',
      value: '1',
      expectedUpdatedAt: null,
      byAccountId: admin,
    })
    await runProbe(probeEnv())
    const rows = (
      await getDbPool().query(
        `select recipient_kind from probe_runs
          where probe_name = 'calendar-pathology' and is_test = false`,
      )
    ).rows
    // Verdict is no_offenders which short-circuits BEFORE channel
    // dispatch. Only one email row.
    expect(rows.length).toBe(1)
    expect(rows[0].recipient_kind).toBe('email')
  })
})
