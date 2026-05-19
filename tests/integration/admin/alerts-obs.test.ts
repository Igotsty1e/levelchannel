import { describe, expect, it, beforeEach, afterEach } from 'vitest'

import { POST as testSendHandler } from '@/app/api/admin/settings/alerts/[probe]/test-send/route'
import { POST as loginHandler } from '@/app/api/auth/login/route'
import { POST as registerHandler } from '@/app/api/auth/register/route'
import {
  getAccountByEmail,
  grantAccountRole,
  markAccountVerified,
} from '@/lib/auth/accounts'
import { getProbeStatus } from '@/lib/admin/probe-status'
import { getDbPool } from '@/lib/db/pool'

import '../setup'
import { buildRequest, extractSessionCookie } from '../helpers'

// ALERTS-OBS (2026-05-16) — integration tests for the test-send
// endpoint + getProbeStatus reads. Plan: docs/plans/alerts-obs.md.

async function makeAdmin(prefix: string): Promise<{ cookie: string; accountId: string }> {
  const email = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
  await registerHandler(
    buildRequest('/api/auth/register', {
      body: { email, password: 'StrongPassword123', personalDataConsentAccepted: true },
    }),
  )
  const acc = await getAccountByEmail(email)
  await markAccountVerified(acc!.id)
  await grantAccountRole(acc!.id, 'admin', null)
  const login = await loginHandler(
    buildRequest('/api/auth/login', { body: { email, password: 'StrongPassword123' } }),
  )
  return {
    cookie: extractSessionCookie(login.headers.get('Set-Cookie'))!,
    accountId: acc!.id,
  }
}

// The integration test harness doesn't ship probe_runs in the
// auth-table truncate list (tests/integration/setup.ts:28-43). We
// truncate locally so each test starts clean.
beforeEach(async () => {
  await getDbPool().query(`truncate table probe_runs restart identity cascade`)
})
afterEach(async () => {
  await getDbPool().query(`truncate table probe_runs restart identity cascade`)
})

describe('POST /api/admin/settings/alerts/[probe]/test-send', () => {
  it('anonymous → 401', async () => {
    const res = await testSendHandler(
      buildRequest('/api/admin/settings/alerts/auth-flow/test-send', {
        body: { confirmReason: 'verifying transport' },
        headers: { 'Idempotency-Key': `test-${Date.now()}-1` },
      }),
      { params: Promise.resolve({ probe: 'auth-flow' }) },
    )
    expect(res.status).toBe(401)
  })

  it('learner (non-admin) → 403', async () => {
    // register without admin role
    const email = `learner-${Date.now()}@example.com`
    await registerHandler(
      buildRequest('/api/auth/register', {
        body: { email, password: 'StrongPassword123', personalDataConsentAccepted: true },
      }),
    )
    const acc = await getAccountByEmail(email)
    await markAccountVerified(acc!.id)
    const login = await loginHandler(
      buildRequest('/api/auth/login', { body: { email, password: 'StrongPassword123' } }),
    )
    const cookie = extractSessionCookie(login.headers.get('Set-Cookie'))!
    const res = await testSendHandler(
      buildRequest('/api/admin/settings/alerts/auth-flow/test-send', {
        cookie,
        body: { confirmReason: 'verifying transport' },
        headers: { 'Idempotency-Key': `test-${Date.now()}-2` },
      }),
      { params: Promise.resolve({ probe: 'auth-flow' }) },
    )
    expect(res.status).toBe(403)
  })

  it('invalid probe name → 400', async () => {
    const { cookie } = await makeAdmin('admin-invalid-probe')
    const res = await testSendHandler(
      buildRequest('/api/admin/settings/alerts/bogus-probe/test-send', {
        cookie,
        body: { confirmReason: 'verifying transport' },
        headers: { 'Idempotency-Key': `test-${Date.now()}-3` },
      }),
      { params: Promise.resolve({ probe: 'bogus-probe' }) },
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('invalid_probe')
  })

  it('missing confirmReason → 400', async () => {
    const { cookie } = await makeAdmin('admin-no-reason')
    const res = await testSendHandler(
      buildRequest('/api/admin/settings/alerts/auth-flow/test-send', {
        cookie,
        body: {},
        headers: { 'Idempotency-Key': `test-${Date.now()}-4` },
      }),
      { params: Promise.resolve({ probe: 'auth-flow' }) },
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('reason_required')
  })

  it('admin + valid env + Resend mock send failure → 502 + probe_runs row with verdict_kind=test_send_failed', async () => {
    // Wave-mode WARN #2 closure: cover the 502 send_failed path.
    // We can't easily make a real Resend call fail in test, so we
    // poison the API key to a clearly-invalid value and ALERT_EMAIL_TO
    // to a synthesized address. Resend will return error in the
    // response body (NOT throw), which we map to 502.
    const { cookie, accountId } = await makeAdmin('admin-send-fail')
    const prevAlertEmailTo = process.env.ALERT_EMAIL_TO
    const prevResendKey = process.env.RESEND_API_KEY
    process.env.ALERT_EMAIL_TO = 'ops-test@example.com'
    process.env.RESEND_API_KEY = 're_invalid_key_for_test'
    try {
      const res = await testSendHandler(
        buildRequest('/api/admin/settings/alerts/calendar-pathology/test-send', {
          cookie,
          body: { confirmReason: 'verifying transport failure path' },
          headers: { 'Idempotency-Key': `test-${Date.now()}-send-fail` },
        }),
        { params: Promise.resolve({ probe: 'calendar-pathology' }) },
      )
      expect(res.status).toBe(502)
      const json = await res.json()
      expect(json.error).toBe('send_failed')
      const probeRow = await getDbPool().query(
        `select verdict_kind, alert_sent, is_test, initiator_account_id, error_message
           from probe_runs
          where probe_name = 'calendar-pathology' and is_test = true
          order by ran_at desc limit 1`,
      )
      expect(probeRow.rows.length).toBe(1)
      expect(probeRow.rows[0].verdict_kind).toBe('test_send_failed')
      expect(probeRow.rows[0].alert_sent).toBe(false)
      expect(probeRow.rows[0].initiator_account_id).toBe(accountId)
      expect(probeRow.rows[0].error_message).toBeTruthy()
    } finally {
      if (prevAlertEmailTo !== undefined) process.env.ALERT_EMAIL_TO = prevAlertEmailTo
      else delete process.env.ALERT_EMAIL_TO
      if (prevResendKey !== undefined) process.env.RESEND_API_KEY = prevResendKey
      else delete process.env.RESEND_API_KEY
    }
  })

  it('admin + missing probe_runs table → 503 migration_pending, no Resend call, no probe_runs row', async () => {
    // Wave-mode WARN #2 closure: cover the 503 migration-pending
    // path. Simulate by dropping the table inside the test (the
    // afterEach recreates via truncate, but we re-migrate via the
    // afterEach is OK since drop+migrate restores it).
    const { cookie } = await makeAdmin('admin-migration-pending')
    const pool = getDbPool()
    await pool.query(`drop table probe_runs cascade`)
    const prevAlertEmailTo = process.env.ALERT_EMAIL_TO
    const prevResendKey = process.env.RESEND_API_KEY
    process.env.ALERT_EMAIL_TO = 'ops-test@example.com'
    process.env.RESEND_API_KEY = 're_should_not_be_used'
    try {
      const res = await testSendHandler(
        buildRequest('/api/admin/settings/alerts/auth-flow/test-send', {
          cookie,
          body: { confirmReason: 'verifying preflight 503' },
          headers: { 'Idempotency-Key': `test-${Date.now()}-pending` },
        }),
        { params: Promise.resolve({ probe: 'auth-flow' }) },
      )
      expect(res.status).toBe(503)
      const json = await res.json()
      expect(json.error).toBe('migration_pending')
    } finally {
      // Restore the table so subsequent tests (and afterEach) work.
      // BCS-DEF-1 Phase 1 (2026-05-19) — CHECK extended to include
      // 'conflict-unresolved' to match migration 0058. Without this
      // any subsequent integration test inserting that probe_name
      // would fail CHECK on the recreated-table state.
      // BCS-DEF-4 (2026-05-19) — CHECK extended further to include
      // 'learner-reminders' (probe_name) and 'channel_disabled_by_operator'
      // (verdict_kind) to match migration 0066. Without this the post-drop
      // recreate diverges from prod and any subsequent test invoking the
      // learner-reminder-dispatch scheduler silently loses its probe_runs
      // row to a swallowed CHECK violation inside recordProbeRun().
      await pool.query(`
        create table if not exists probe_runs (
          id uuid primary key default gen_random_uuid(),
          probe_name text not null check (probe_name in (
            'auth-flow', 'calendar-pathology', 'webhook-flow',
            'conflict-unresolved', 'learner-reminders'
          )),
          ran_at timestamptz not null default now(),
          verdict_kind text not null check (verdict_kind in (
            'alert_sent', 'alert_send_failed', 'dedup_skip',
            'no_failures', 'within_thresholds', 'no_offenders',
            'low_volume_skip', 'all_resolved', 'ok',
            'config_missing', 'error',
            'test_send_succeeded', 'test_send_failed',
            'channel_disabled_by_operator'
          )),
          alert_sent boolean not null default false,
          recipient_email text null,
          alert_email_id text null,
          fingerprint text null,
          stats jsonb null,
          error_message text null,
          is_test boolean not null default false,
          initiator_account_id uuid null references accounts(id) on delete restrict,
          created_at timestamptz not null default now(),
          -- BCS-DEF-1-TG R1 WARN#1 closure (2026-05-19): schema shadow
          -- mirrors migration 0061 — recipient_kind discriminator +
          -- partial index. Without this the post-drop recreate diverges
          -- from prod and a follow-up test seeding Telegram rows would
          -- silently pass.
          recipient_kind text not null default 'email'
            check (recipient_kind in ('email', 'telegram'))
        )
      `)
      await pool.query(`
        create index if not exists probe_runs_real_runs_idx
          on probe_runs (probe_name, ran_at desc) where is_test = false
      `)
      await pool.query(`
        create index if not exists probe_runs_real_alerts_idx
          on probe_runs (probe_name, ran_at desc)
          where alert_sent = true and is_test = false
      `)
      await pool.query(`
        create index if not exists probe_runs_telegram_latest_idx
          on probe_runs (ran_at desc)
          where recipient_kind = 'telegram' and is_test = false
      `)
      if (prevAlertEmailTo !== undefined) process.env.ALERT_EMAIL_TO = prevAlertEmailTo
      else delete process.env.ALERT_EMAIL_TO
      if (prevResendKey !== undefined) process.env.RESEND_API_KEY = prevResendKey
      else delete process.env.RESEND_API_KEY
    }
  })

  it('admin + missing ALERT_EMAIL_TO → 422 + probe_runs row with verdict_kind=test_send_failed', async () => {
    const { cookie, accountId } = await makeAdmin('admin-missing-recipient')
    const prevAlertEmailTo = process.env.ALERT_EMAIL_TO
    const prevResendKey = process.env.RESEND_API_KEY
    delete process.env.ALERT_EMAIL_TO
    process.env.RESEND_API_KEY = 'fake-not-used'

    try {
      const res = await testSendHandler(
        buildRequest('/api/admin/settings/alerts/webhook-flow/test-send', {
          cookie,
          body: { confirmReason: 'verifying transport gracefully' },
          headers: { 'Idempotency-Key': `test-${Date.now()}-5` },
        }),
        { params: Promise.resolve({ probe: 'webhook-flow' }) },
      )
      expect(res.status).toBe(422)
      const json = await res.json()
      expect(json.error).toBe('missing_alert_email_to')

      // probe_runs row was written with is_test=true.
      const probeRow = await getDbPool().query(
        `select probe_name, verdict_kind, is_test, initiator_account_id, error_message
           from probe_runs
          where probe_name = 'webhook-flow'
            and is_test = true
          order by ran_at desc
          limit 1`,
      )
      expect(probeRow.rows.length).toBe(1)
      expect(probeRow.rows[0].verdict_kind).toBe('test_send_failed')
      expect(probeRow.rows[0].is_test).toBe(true)
      expect(probeRow.rows[0].initiator_account_id).toBe(accountId)
      expect(probeRow.rows[0].error_message).toBe('missing_alert_email_to')
    } finally {
      if (prevAlertEmailTo !== undefined) process.env.ALERT_EMAIL_TO = prevAlertEmailTo
      if (prevResendKey !== undefined) process.env.RESEND_API_KEY = prevResendKey
      else delete process.env.RESEND_API_KEY
    }
  })

  // BCS-DEF-1-TEST-FILLOUT item 5 (2026-05-19) — regression pin for
  // the `pg_get_constraintdef` preflight branch added at
  // app/api/admin/settings/alerts/[probe]/test-send/route.ts:119-149.
  // After migration 0058 widens the CHECK to include
  // 'conflict-unresolved', the preflight succeeds and the route lands
  // a probe_runs row with the new probe name (instead of returning
  // 503 migration_pending). We force the Resend hop to fail (poisoned
  // RESEND_API_KEY) so we don't actually send mail; the probe_runs
  // row is still written with is_test=true + verdict_kind=
  // test_send_failed, proving the route walked past the preflight.
  describe('conflict-unresolved probe (BCS-DEF-1 migration 0058 preflight)', () => {
    it('anon → 401', async () => {
      const res = await testSendHandler(
        buildRequest(
          '/api/admin/settings/alerts/conflict-unresolved/test-send',
          {
            body: { confirmReason: 'verifying conflict-unresolved transport' },
            headers: { 'Idempotency-Key': `test-cu-anon-${Date.now()}` },
          },
        ),
        { params: Promise.resolve({ probe: 'conflict-unresolved' }) },
      )
      expect(res.status).toBe(401)
    })

    it('learner (non-admin) → 403', async () => {
      const email = `learner-cu-${Date.now()}@example.com`
      await registerHandler(
        buildRequest('/api/auth/register', {
          body: {
            email,
            password: 'StrongPassword123',
            personalDataConsentAccepted: true,
          },
        }),
      )
      const acc = await getAccountByEmail(email)
      await markAccountVerified(acc!.id)
      const login = await loginHandler(
        buildRequest('/api/auth/login', {
          body: { email, password: 'StrongPassword123' },
        }),
      )
      const cookie = extractSessionCookie(login.headers.get('Set-Cookie'))!
      const res = await testSendHandler(
        buildRequest(
          '/api/admin/settings/alerts/conflict-unresolved/test-send',
          {
            cookie,
            body: { confirmReason: 'verifying conflict-unresolved transport' },
            headers: { 'Idempotency-Key': `test-cu-learner-${Date.now()}` },
          },
        ),
        { params: Promise.resolve({ probe: 'conflict-unresolved' }) },
      )
      expect(res.status).toBe(403)
    })

    it('admin: CHECK-extension preflight passes after migration 0058 → probe_runs row with probe_name=conflict-unresolved, is_test=true (no 503 migration_pending)', async () => {
      const { cookie, accountId } = await makeAdmin('admin-cu-preflight')
      const prevAlertEmailTo = process.env.ALERT_EMAIL_TO
      const prevResendKey = process.env.RESEND_API_KEY
      // Pre-existing env is honoured by the route's preflight
      // (the env check sits AFTER both the probe_runs and the
      // pg_get_constraintdef preflights). We set a real-looking
      // recipient + a poisoned Resend key so the route is forced
      // to walk past BOTH preflights, attempt a real Resend call,
      // and land a probe_runs row with verdict_kind=test_send_failed.
      // If the CHECK preflight rejected 'conflict-unresolved', we'd
      // see a 503 with no probe_runs row at all.
      process.env.ALERT_EMAIL_TO = 'ops-test@example.com'
      process.env.RESEND_API_KEY = 're_invalid_key_for_test'
      try {
        const res = await testSendHandler(
          buildRequest(
            '/api/admin/settings/alerts/conflict-unresolved/test-send',
            {
              cookie,
              body: {
                confirmReason: 'verifying conflict-unresolved CHECK extension',
              },
              headers: {
                'Idempotency-Key': `test-cu-preflight-${Date.now()}`,
              },
            },
          ),
          { params: Promise.resolve({ probe: 'conflict-unresolved' }) },
        )
        // Load-bearing: NOT 503 migration_pending (CHECK extension
        // preflight passed) and NOT 400 invalid_probe (isProbeName
        // accepts 'conflict-unresolved'). Resend hop fails → 502.
        expect(res.status).not.toBe(503)
        expect(res.status).not.toBe(400)
        const json = await res.json()
        // The migration_pending error code is what the preflight
        // would have returned had it rejected the probe name.
        expect(json.error).not.toBe('migration_pending')
        expect(json.error).not.toBe('invalid_probe')

        // probe_runs got a row with the new probe name. This is the
        // strongest assertion: the INSERT executed against the
        // post-migration CHECK without raising 23514, AND the route's
        // CHECK preflight had to walk past the conflict-unresolved
        // value verbatim in pg_get_constraintdef.
        const probeRow = await getDbPool().query(
          `select probe_name, verdict_kind, is_test, initiator_account_id
             from probe_runs
            where probe_name = 'conflict-unresolved'
              and is_test = true
            order by ran_at desc
            limit 1`,
        )
        expect(probeRow.rows.length).toBe(1)
        expect(probeRow.rows[0].probe_name).toBe('conflict-unresolved')
        expect(probeRow.rows[0].is_test).toBe(true)
        expect(probeRow.rows[0].initiator_account_id).toBe(accountId)
      } finally {
        if (prevAlertEmailTo !== undefined)
          process.env.ALERT_EMAIL_TO = prevAlertEmailTo
        else delete process.env.ALERT_EMAIL_TO
        if (prevResendKey !== undefined)
          process.env.RESEND_API_KEY = prevResendKey
        else delete process.env.RESEND_API_KEY
      }
    })
  })

  it('AUDIT-CODE-2: 422 missing-env path does NOT poison idempotency cache (retry with same key after env is set sends real email)', async () => {
    const { cookie } = await makeAdmin('admin-cache-poison')
    const prevAlertEmailTo = process.env.ALERT_EMAIL_TO
    const prevResendKey = process.env.RESEND_API_KEY
    const idempotencyKey = `test-cache-poison-${Date.now()}`

    try {
      // Attempt #1: ALERT_EMAIL_TO missing → 422.
      delete process.env.ALERT_EMAIL_TO
      process.env.RESEND_API_KEY = 'fake-for-422-path'
      const r1 = await testSendHandler(
        buildRequest('/api/admin/settings/alerts/auth-flow/test-send', {
          cookie,
          body: { confirmReason: 'cache poison repro' },
          headers: { 'Idempotency-Key': idempotencyKey },
        }),
        { params: Promise.resolve({ probe: 'auth-flow' }) },
      )
      expect(r1.status).toBe(422)
      const j1 = await r1.json()
      expect(j1.error).toBe('missing_alert_email_to')

      // Attempt #2: operator sets ALERT_EMAIL_TO, retries with SAME
      // Idempotency-Key. Before AUDIT-CODE-2 fix this returned the
      // cached 422 body and never reached Resend. After fix: the env
      // check runs OUTSIDE withIdempotency, so the second attempt
      // proceeds (and either succeeds or returns 502 from Resend).
      // We poison the Resend key so we don't actually send mail —
      // the assertion is that the response is NOT the cached 422.
      process.env.ALERT_EMAIL_TO = 'ops-cache-poison@example.com'
      const r2 = await testSendHandler(
        buildRequest('/api/admin/settings/alerts/auth-flow/test-send', {
          cookie,
          body: { confirmReason: 'cache poison repro' },
          headers: { 'Idempotency-Key': idempotencyKey },
        }),
        { params: Promise.resolve({ probe: 'auth-flow' }) },
      )
      // The second call MUST escape the cached 422. It might be 200
      // (Resend mock returned ok) or 502 (real Resend rejected the
      // poisoned key). Either way, NOT 422 with the cache-body.
      expect(r2.status).not.toBe(422)

      // Post-merge paranoia round 1 WARN #2 closure — strengthen the
      // load-bearing assertion. Beyond "status !== 422", prove the
      // second attempt actually executed the live send path: a NEW
      // probe_runs row was written with a distinct fingerprint AND
      // a non-null recipient (the env was set before retry). If the
      // cache had replayed, no second row would exist.
      const probeRows = await getDbPool().query(
        `select fingerprint, recipient_email
           from probe_runs
          where probe_name = 'auth-flow'
            and is_test = true
          order by ran_at asc`,
      )
      expect(probeRows.rows.length).toBeGreaterThanOrEqual(2)
      const fingerprints = new Set(
        probeRows.rows.map((r) => String(r.fingerprint)),
      )
      expect(fingerprints.size).toBe(probeRows.rows.length)
      const recipients = probeRows.rows.map((r) => r.recipient_email)
      expect(recipients).toContain(null) // first attempt: env missing
      expect(recipients).toContain('ops-cache-poison@example.com') // second
    } finally {
      if (prevAlertEmailTo !== undefined) process.env.ALERT_EMAIL_TO = prevAlertEmailTo
      else delete process.env.ALERT_EMAIL_TO
      if (prevResendKey !== undefined) process.env.RESEND_API_KEY = prevResendKey
      else delete process.env.RESEND_API_KEY
    }
  })
})

describe('getProbeStatus (lib/admin/probe-status)', () => {
  it('returns nulls when no probe_runs rows exist', async () => {
    const status = await getProbeStatus('auth-flow')
    expect('migrationPending' in status).toBe(false)
    if ('migrationPending' in status) return
    expect(status.probeName).toBe('auth-flow')
    expect(status.lastRun).toBeNull()
    expect(status.lastAlert).toBeNull()
  })

  it('reads latest real run + ignores test-send rows', async () => {
    const pool = getDbPool()
    // 1) real run (no alert sent — within_thresholds)
    await pool.query(
      `insert into probe_runs (probe_name, verdict_kind, stats, is_test)
       values ($1, 'within_thresholds', $2::jsonb, false)`,
      [
        'auth-flow',
        JSON.stringify({
          totalFailed: 7,
          thresholds: { AUTH_FLOW_WINDOW_MINUTES: 60, AUTH_FLOW_MAX_PER_IP: 50 },
        }),
      ],
    )
    // 2) test-send row — must NOT appear as last run
    await pool.query(
      `insert into probe_runs (probe_name, verdict_kind, alert_sent, recipient_email, is_test, stats)
       values ('auth-flow', 'test_send_succeeded', true, 'ops@example.com', true, '{}'::jsonb)`,
    )
    const status = await getProbeStatus('auth-flow')
    if ('migrationPending' in status) throw new Error('unexpected migration pending')
    expect(status.lastRun?.verdictKind).toBe('within_thresholds')
    expect(status.lastAlert).toBeNull() // test row excluded
  })

  it('reads latest real alert (alert_sent=true, is_test=false)', async () => {
    const pool = getDbPool()
    await pool.query(
      `insert into probe_runs (probe_name, verdict_kind, alert_sent, recipient_email,
                                fingerprint, alert_email_id, stats, is_test)
       values ('webhook-flow', 'alert_sent', true, 'ops@example.com',
               'abc123', 'resend-id-xyz', $1::jsonb, false)`,
      [JSON.stringify({ created: 10, paidWebhooks: 1, thresholds: {} })],
    )
    const status = await getProbeStatus('webhook-flow')
    if ('migrationPending' in status) throw new Error('unexpected migration pending')
    expect(status.lastAlert?.recipientEmail).toBe('ops@example.com')
    expect(status.lastAlert?.fingerprint).toBe('abc123')
    expect(status.lastAlert?.alertEmailId).toBe('resend-id-xyz')
  })
})

describe('probe_runs schema invariants', () => {
  it('rejects unknown probe_name via CHECK constraint', async () => {
    const pool = getDbPool()
    await expect(
      pool.query(
        `insert into probe_runs (probe_name, verdict_kind) values ('made-up', 'ok')`,
      ),
    ).rejects.toThrow(/probe_runs_probe_name_check|check constraint/i)
  })

  it('rejects unknown verdict_kind via CHECK constraint', async () => {
    const pool = getDbPool()
    await expect(
      pool.query(
        `insert into probe_runs (probe_name, verdict_kind) values ('auth-flow', 'made_up_kind')`,
      ),
    ).rejects.toThrow(/probe_runs_verdict_kind_check|check constraint/i)
  })

  it('partial index probe_runs_real_runs_idx exists with the expected WHERE clause', async () => {
    const pool = getDbPool()
    const r = await pool.query(
      `select indexdef from pg_indexes
        where indexname = 'probe_runs_real_runs_idx'`,
    )
    expect(r.rows.length).toBe(1)
    expect(String(r.rows[0].indexdef)).toMatch(/where \(is_test = false\)/i)
  })

  it('partial index probe_runs_real_alerts_idx exists with the expected WHERE clause', async () => {
    const pool = getDbPool()
    const r = await pool.query(
      `select indexdef from pg_indexes
        where indexname = 'probe_runs_real_alerts_idx'`,
    )
    expect(r.rows.length).toBe(1)
    const def = String(r.rows[0].indexdef).toLowerCase()
    expect(def).toContain('alert_sent = true')
    expect(def).toContain('is_test = false')
  })
})
