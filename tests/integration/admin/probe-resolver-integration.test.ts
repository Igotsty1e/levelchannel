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

// ALERTS-EDITOR Sub-PR B (2026-05-18) — per-probe integration
// tests verifying that each probe script actually reads
// operator_settings at runtime + writes the new stats.thresholds +
// stats.thresholds_source shape into probe_runs.
//
// Strategy: invoke the probe script via execFile with DATABASE_URL
// pointing at the test DB. ALERT_EMAIL_TO is NOT set, so the
// scripts that try to send go down the CONFIG_MISSING / NO_FAILURES
// / NO_OFFENDERS / LOW_VOLUME_SKIP paths — no Resend call required.
// Then assert the latest probe_runs row for the probe carries the
// expected DB-sourced threshold values.

const execFileP = promisify(execFile)

async function makeAdmin(prefix: string): Promise<string> {
  const acc = await createAccount({
    email: normalizeAccountEmail(`${prefix}@example.com`),
    passwordHash: await hashPassword('StrongPassword123'),
  })
  await grantAccountRole(acc.id, 'admin', null)
  return acc.id
}

async function clearOpSettings(): Promise<void> {
  const pool = getDbPool()
  await pool.query(`delete from operator_settings`)
  // events table: 89-day immutability trigger blocks DELETE on
  // recent rows; TRUNCATE bypasses row-level triggers.
  await pool.query(`truncate operator_settings_events restart identity`)
  await pool.query(`delete from probe_runs`)
}

beforeEach(async () => {
  await clearOpSettings()
})
afterEach(async () => {
  await clearOpSettings()
})

async function readLatestProbeStats(
  probeName: string,
): Promise<Record<string, unknown> | null> {
  const r = await getDbPool().query(
    `select stats from probe_runs
       where probe_name = $1 and is_test = false
       order by ran_at desc limit 1`,
    [probeName],
  )
  if (!r.rows[0]) return null
  return r.rows[0].stats as Record<string, unknown>
}

function probeUrlFor(): string {
  // Re-use the test harness's DATABASE_URL.
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL must be set in the test harness')
  return url
}

function probeEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  // ALERT_EMAIL_TO intentionally absent → CONFIG_MISSING path fires
  // before Resend so no email is sent. probe_runs row still lands.
  return {
    ...process.env,
    DATABASE_URL: probeUrlFor(),
    ...extra,
  } as NodeJS.ProcessEnv
}

describe('calendar-pathology probe reads operator_settings', () => {
  it('DB-sourced CALENDAR_PATHOLOGY_THRESHOLD lands in stats.thresholds + thresholds_source', async () => {
    const admin = await makeAdmin('probe-cp-th')
    await setOperatorSetting({
      key: 'CALENDAR_PATHOLOGY_THRESHOLD',
      value: '5',
      expectedUpdatedAt: null,
      byAccountId: admin,
    })

    await execFileP(
      process.execPath,
      ['scripts/calendar-pathology-alert.mjs'],
      { env: probeEnv(), cwd: process.cwd() },
    )

    const stats = (await readLatestProbeStats('calendar-pathology')) ?? {}
    const thresholds = stats.thresholds as Record<string, unknown>
    const sources = stats.thresholds_source as Record<string, unknown>
    expect(thresholds.CALENDAR_PATHOLOGY_THRESHOLD).toBe(5)
    expect(sources.CALENDAR_PATHOLOGY_THRESHOLD).toBe('db')
    // The other 2 keys still default since we didn't set DB rows.
    expect(sources.CALENDAR_PATHOLOGY_REPORT_LIMIT).toBe('default')
    expect(sources.CALENDAR_PATHOLOGY_DEDUP_WINDOW_MS).toBe('default')
  }, 30_000)

  it('env-sourced CALENDAR_PATHOLOGY_REPORT_LIMIT (with no DB row) lands as env source', async () => {
    await execFileP(
      process.execPath,
      ['scripts/calendar-pathology-alert.mjs'],
      {
        env: probeEnv({ CALENDAR_PATHOLOGY_REPORT_LIMIT: '25' }),
        cwd: process.cwd(),
      },
    )
    const stats = (await readLatestProbeStats('calendar-pathology')) ?? {}
    const thresholds = stats.thresholds as Record<string, unknown>
    const sources = stats.thresholds_source as Record<string, unknown>
    expect(thresholds.CALENDAR_PATHOLOGY_REPORT_LIMIT).toBe(25)
    expect(sources.CALENDAR_PATHOLOGY_REPORT_LIMIT).toBe('env')
  }, 30_000)
})

describe('auth-flow probe reads operator_settings', () => {
  it('DB-sourced AUTH_FLOW_MAX_PER_IP lands in stats.thresholds + thresholds_source', async () => {
    const admin = await makeAdmin('probe-af-ip')
    await setOperatorSetting({
      key: 'AUTH_FLOW_MAX_PER_IP',
      value: '99',
      expectedUpdatedAt: null,
      byAccountId: admin,
    })

    await execFileP(
      process.execPath,
      ['scripts/auth-flow-alert.mjs'],
      { env: probeEnv(), cwd: process.cwd() },
    )

    const stats = (await readLatestProbeStats('auth-flow')) ?? {}
    const thresholds = stats.thresholds as Record<string, unknown>
    const sources = stats.thresholds_source as Record<string, unknown>
    expect(thresholds.AUTH_FLOW_MAX_PER_IP).toBe(99)
    expect(sources.AUTH_FLOW_MAX_PER_IP).toBe('db')
    expect(sources.AUTH_FLOW_WINDOW_MINUTES).toBe('default')
    expect(sources.AUTH_FLOW_MAX_PER_EMAIL_HASH).toBe('default')
    expect(sources.AUTH_FLOW_DEDUP_WINDOW_MS).toBe('default')
  }, 30_000)

  it('mixed DB + env sources resolve correctly per-knob', async () => {
    const admin = await makeAdmin('probe-af-mix')
    await setOperatorSetting({
      key: 'AUTH_FLOW_WINDOW_MINUTES',
      value: '30',
      expectedUpdatedAt: null,
      byAccountId: admin,
    })
    await execFileP(
      process.execPath,
      ['scripts/auth-flow-alert.mjs'],
      {
        env: probeEnv({ AUTH_FLOW_MAX_PER_IP: '40' }),
        cwd: process.cwd(),
      },
    )
    const stats = (await readLatestProbeStats('auth-flow')) ?? {}
    const thresholds = stats.thresholds as Record<string, unknown>
    const sources = stats.thresholds_source as Record<string, unknown>
    expect(thresholds.AUTH_FLOW_WINDOW_MINUTES).toBe(30)
    expect(sources.AUTH_FLOW_WINDOW_MINUTES).toBe('db')
    expect(thresholds.AUTH_FLOW_MAX_PER_IP).toBe(40)
    expect(sources.AUTH_FLOW_MAX_PER_IP).toBe('env')
  }, 30_000)
})

describe('webhook-flow probe reads operator_settings', () => {
  it('DB-sourced WEBHOOK_FLOW_TERMINATED_RATIO (decimal) lands as 0.5 + source=db', async () => {
    const admin = await makeAdmin('probe-wf-ratio')
    await setOperatorSetting({
      key: 'WEBHOOK_FLOW_TERMINATED_RATIO',
      value: '0.5',
      expectedUpdatedAt: null,
      byAccountId: admin,
    })

    await execFileP(
      process.execPath,
      ['scripts/webhook-flow-alert.mjs'],
      { env: probeEnv(), cwd: process.cwd() },
    )

    const stats = (await readLatestProbeStats('webhook-flow')) ?? {}
    const thresholds = stats.thresholds as Record<string, unknown>
    const sources = stats.thresholds_source as Record<string, unknown>
    expect(thresholds.WEBHOOK_FLOW_TERMINATED_RATIO).toBe(0.5)
    expect(sources.WEBHOOK_FLOW_TERMINATED_RATIO).toBe('db')
  }, 30_000)

  it('DB-sourced WEBHOOK_FLOW_MIN_VOLUME lands as int + source=db', async () => {
    const admin = await makeAdmin('probe-wf-vol')
    await setOperatorSetting({
      key: 'WEBHOOK_FLOW_MIN_VOLUME',
      value: '7',
      expectedUpdatedAt: null,
      byAccountId: admin,
    })
    await execFileP(
      process.execPath,
      ['scripts/webhook-flow-alert.mjs'],
      { env: probeEnv(), cwd: process.cwd() },
    )
    const stats = (await readLatestProbeStats('webhook-flow')) ?? {}
    const thresholds = stats.thresholds as Record<string, unknown>
    const sources = stats.thresholds_source as Record<string, unknown>
    expect(thresholds.WEBHOOK_FLOW_MIN_VOLUME).toBe(7)
    expect(sources.WEBHOOK_FLOW_MIN_VOLUME).toBe('db')
  }, 30_000)
})
