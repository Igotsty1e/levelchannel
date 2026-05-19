import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  getLatestTelegramRun,
  getProbeStatus,
} from '@/lib/admin/probe-status'
import { getDbPool } from '@/lib/db/pool'

import '../setup'

// BCS-DEF-1-TG (2026-05-19) — integration tests for migration 0061
// (probe_runs.recipient_kind) and the per-recipient row pattern
// (plan §2.4, §3.4, §3.4a, §3.5a).

beforeEach(async () => {
  await getDbPool().query(`truncate table probe_runs restart identity cascade`)
})
afterEach(async () => {
  await getDbPool().query(`truncate table probe_runs restart identity cascade`)
})

describe('migration 0061 — probe_runs.recipient_kind', () => {
  it("INSERT with recipient_kind='telegram' succeeds (CHECK accepts it)", async () => {
    const pool = getDbPool()
    await pool.query(
      `insert into probe_runs (probe_name, verdict_kind, recipient_kind)
       values ('auth-flow', 'alert_sent', 'telegram')`,
    )
    const r = await pool.query(
      `select recipient_kind from probe_runs where probe_name = 'auth-flow'`,
    )
    expect(r.rows[0].recipient_kind).toBe('telegram')
  })

  it("INSERT with recipient_kind='slack' fails CHECK", async () => {
    const pool = getDbPool()
    await expect(
      pool.query(
        `insert into probe_runs (probe_name, verdict_kind, recipient_kind)
         values ('auth-flow', 'alert_sent', 'slack')`,
      ),
    ).rejects.toThrow(/recipient_kind|check constraint/i)
  })

  it("legacy INSERT without recipient_kind defaults to 'email'", async () => {
    const pool = getDbPool()
    await pool.query(
      `insert into probe_runs (probe_name, verdict_kind)
       values ('webhook-flow', 'within_thresholds')`,
    )
    const r = await pool.query(
      `select recipient_kind from probe_runs where probe_name = 'webhook-flow'`,
    )
    expect(r.rows[0].recipient_kind).toBe('email')
  })

  it('partial index probe_runs_telegram_latest_idx exists with the expected WHERE clause', async () => {
    const pool = getDbPool()
    const r = await pool.query(
      `select indexdef from pg_indexes
        where indexname = 'probe_runs_telegram_latest_idx'`,
    )
    expect(r.rows.length).toBe(1)
    const def = String(r.rows[0].indexdef).toLowerCase()
    expect(def).toContain("recipient_kind = 'telegram'")
    expect(def).toContain('is_test = false')
  })
})

describe('per-recipient rows — same probe + tick, both channels', () => {
  it('email + telegram rows with same fingerprint coexist (per-recipient pattern)', async () => {
    const pool = getDbPool()
    await pool.query(
      `insert into probe_runs (probe_name, verdict_kind, alert_sent,
                                recipient_email, fingerprint, recipient_kind)
       values
         ('auth-flow', 'alert_sent', true, 'ops@example.com', 'fp123', 'email'),
         ('auth-flow', 'alert_sent', true, '999000111', 'fp123', 'telegram')`,
    )
    const r = await pool.query(
      `select count(*)::int as n from probe_runs where probe_name = 'auth-flow'`,
    )
    expect(r.rows[0].n).toBe(2)
  })

  it('email-OK + telegram-FAIL → two rows with distinct verdict_kinds', async () => {
    const pool = getDbPool()
    await pool.query(
      `insert into probe_runs (probe_name, verdict_kind, alert_sent,
                                recipient_email, fingerprint, recipient_kind)
       values
         ('calendar-pathology', 'alert_sent', true, 'ops@example.com', 'fp42', 'email'),
         ('calendar-pathology', 'alert_send_failed', false, '999000111', 'fp42', 'telegram')`,
    )
    const rows = (
      await pool.query(
        `select recipient_kind, verdict_kind, alert_sent
           from probe_runs
          where probe_name = 'calendar-pathology'
          order by recipient_kind`,
      )
    ).rows
    expect(rows).toHaveLength(2)
    expect(rows[0].recipient_kind).toBe('email')
    expect(rows[0].verdict_kind).toBe('alert_sent')
    expect(rows[1].recipient_kind).toBe('telegram')
    expect(rows[1].verdict_kind).toBe('alert_send_failed')
  })
})

describe('getProbeStatus — email-channel-only filter (R1 BLOCKER#6 closure)', () => {
  it('returns the EMAIL last-run row even when a NEWER telegram row exists', async () => {
    const pool = getDbPool()
    // Older email row.
    await pool.query(
      `insert into probe_runs (probe_name, verdict_kind, alert_sent,
                                recipient_email, fingerprint, alert_email_id,
                                recipient_kind, ran_at, stats)
       values ('webhook-flow', 'alert_sent', true, 'ops@example.com',
               'older-fp', 'resend-id-older', 'email',
               now() - interval '10 minutes', '{}'::jsonb)`,
    )
    // Newer Telegram row.
    await pool.query(
      `insert into probe_runs (probe_name, verdict_kind, alert_sent,
                                recipient_email, fingerprint, alert_email_id,
                                recipient_kind, ran_at, stats)
       values ('webhook-flow', 'alert_sent', true, '999000111',
               'newer-fp', '777', 'telegram',
               now() - interval '1 minute', '{}'::jsonb)`,
    )
    const status = await getProbeStatus('webhook-flow')
    if ('migrationPending' in status) throw new Error('unexpected pending')
    expect(status.lastRun?.verdictKind).toBe('alert_sent')
    // Critical: email row wins (older but email-channel).
    expect(status.lastAlert?.recipientEmail).toBe('ops@example.com')
    expect(status.lastAlert?.alertEmailId).toBe('resend-id-older')
    expect(status.lastAlert?.fingerprint).toBe('older-fp')
  })
})

describe('getLatestTelegramRun — channel-wide observability', () => {
  it('returns the latest telegram row across all probes', async () => {
    const pool = getDbPool()
    await pool.query(
      `insert into probe_runs (probe_name, verdict_kind, alert_sent,
                                recipient_email, alert_email_id,
                                recipient_kind, ran_at, stats)
       values
         ('auth-flow', 'alert_sent', true, '999000111', '101',
          'telegram', now() - interval '5 minutes', '{}'::jsonb),
         ('webhook-flow', 'alert_sent', true, '999000111', '202',
          'telegram', now() - interval '1 minute', '{}'::jsonb)`,
    )
    const r = await getLatestTelegramRun()
    if ('migrationPending' in r && r.migrationPending) {
      throw new Error('unexpected pending')
    }
    expect(r.lastRun).not.toBeNull()
    expect(r.lastRun?.probeName).toBe('webhook-flow')
    expect(r.lastRun?.messageId).toBe('202')
    expect(r.lastRun?.chatId).toBe('999000111')
  })

  it('ignores email rows', async () => {
    const pool = getDbPool()
    await pool.query(
      `insert into probe_runs (probe_name, verdict_kind, alert_sent,
                                recipient_email, recipient_kind, stats)
       values ('auth-flow', 'alert_sent', true, 'ops@example.com',
               'email', '{}'::jsonb)`,
    )
    const r = await getLatestTelegramRun()
    if ('migrationPending' in r && r.migrationPending) {
      throw new Error('unexpected pending')
    }
    expect(r.lastRun).toBeNull()
  })

  it('returns migrationPending when the recipient_kind column is missing (42703)', async () => {
    const pool = getDbPool()
    await pool.query(`alter table probe_runs drop column recipient_kind`)
    try {
      const status = await getProbeStatus('auth-flow')
      expect('migrationPending' in status && status.migrationPending).toBe(true)
      const tg = await getLatestTelegramRun()
      expect('migrationPending' in tg && tg.migrationPending).toBe(true)
    } finally {
      // Restore the column for subsequent tests / afterEach.
      await pool.query(
        `alter table probe_runs
         add column if not exists recipient_kind text not null default 'email'
         check (recipient_kind in ('email', 'telegram'))`,
      )
      await pool.query(
        `create index if not exists probe_runs_telegram_latest_idx
           on probe_runs (ran_at desc)
           where recipient_kind = 'telegram' and is_test = false`,
      )
    }
  })
})
