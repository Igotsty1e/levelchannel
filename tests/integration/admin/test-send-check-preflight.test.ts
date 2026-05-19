import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { POST as testSendHandler } from '@/app/api/admin/settings/alerts/[probe]/test-send/route'
import { POST as loginHandler } from '@/app/api/auth/login/route'
import { POST as registerHandler } from '@/app/api/auth/register/route'
import {
  getAccountByEmail,
  grantAccountRole,
  markAccountVerified,
} from '@/lib/auth/accounts'
import { getDbPool } from '@/lib/db/pool'

import '../setup'
import { buildRequest, extractSessionCookie } from '../helpers'

// BCS-DEF-1 wave-paranoia round-1 WARN closure (2026-05-19) — pin
// the CHECK-extension preflight added to the admin test-send route.
//
// Setup: temporarily drop the `probe_runs_probe_name_check`
// constraint and replace it with a 3-value enum WITHOUT
// 'conflict-unresolved'. Then POST /api/admin/settings/alerts/
// conflict-unresolved/test-send. The route MUST return 503
// migration_pending BEFORE any Resend call is attempted and BEFORE
// any probe_runs row is written.
//
// afterEach restores the full 4-value CHECK so subsequent tests
// (and the parent alerts-obs.test.ts) continue to see migration
// 0058's enum state.

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

beforeEach(async () => {
  await getDbPool().query(`truncate table probe_runs restart identity cascade`)
})
afterEach(async () => {
  const pool = getDbPool()
  // Restore the canonical migration-0058 4-value CHECK so the test
  // doesn't poison sibling integration suites that assume
  // 'conflict-unresolved' is a valid probe name.
  await pool.query(
    `alter table probe_runs drop constraint if exists probe_runs_probe_name_check`,
  )
  await pool.query(`
    alter table probe_runs
      add constraint probe_runs_probe_name_check
      check (probe_name in (
        'auth-flow', 'calendar-pathology', 'webhook-flow',
        'conflict-unresolved'
      ))
  `)
  await pool.query(`truncate table probe_runs restart identity cascade`)
})

describe('POST /api/admin/settings/alerts/[probe]/test-send — CHECK-extension preflight', () => {
  it('returns 503 migration_pending when the CHECK does not enumerate the requested probe (no Resend call, no probe_runs row)', async () => {
    const { cookie } = await makeAdmin('admin-check-preflight')
    const pool = getDbPool()

    // Simulate the pre-migration-0058 state: drop the 4-value CHECK
    // and reinstall a 3-value CHECK without 'conflict-unresolved'.
    await pool.query(
      `alter table probe_runs drop constraint if exists probe_runs_probe_name_check`,
    )
    await pool.query(`
      alter table probe_runs
        add constraint probe_runs_probe_name_check
        check (probe_name in (
          'auth-flow', 'calendar-pathology', 'webhook-flow'
        ))
    `)

    // Poison env so that if the preflight were skipped we'd see
    // either a 502 Resend call attempt or a probe_runs INSERT
    // failure — neither is the contract.
    const prevAlertEmailTo = process.env.ALERT_EMAIL_TO
    const prevResendKey = process.env.RESEND_API_KEY
    process.env.ALERT_EMAIL_TO = 'ops-test@example.com'
    process.env.RESEND_API_KEY = 're_should_not_be_used_check_preflight'

    try {
      const res = await testSendHandler(
        buildRequest('/api/admin/settings/alerts/conflict-unresolved/test-send', {
          cookie,
          body: { confirmReason: 'verifying CHECK-extension preflight' },
          headers: { 'Idempotency-Key': `test-check-preflight-${Date.now()}` },
        }),
        { params: Promise.resolve({ probe: 'conflict-unresolved' }) },
      )
      expect(res.status).toBe(503)
      const json = await res.json()
      expect(json.error).toBe('migration_pending')
      // The message references the probe name so the operator knows
      // which migration is pending.
      expect(String(json.message)).toContain('conflict-unresolved')

      // No probe_runs row was written — the preflight short-circuits
      // before either the env-missing branch or the live-send
      // branch can INSERT.
      const rows = await pool.query(
        `select count(*)::int as n from probe_runs
          where probe_name = 'conflict-unresolved'`,
      )
      expect(rows.rows[0].n).toBe(0)
    } finally {
      if (prevAlertEmailTo !== undefined) process.env.ALERT_EMAIL_TO = prevAlertEmailTo
      else delete process.env.ALERT_EMAIL_TO
      if (prevResendKey !== undefined) process.env.RESEND_API_KEY = prevResendKey
      else delete process.env.RESEND_API_KEY
    }
  })

  it('a probe name still present in the narrowed CHECK proceeds past the preflight (control case)', async () => {
    // Control: with the same narrowed 3-value CHECK, 'auth-flow' is
    // still enumerated. The preflight must NOT short-circuit on it;
    // the request proceeds to the env / Resend branches. We use the
    // env-missing path (422 + missing_alert_email_to) as a cheap
    // observable that the preflight let the request through.
    const { cookie } = await makeAdmin('admin-check-control')
    const pool = getDbPool()
    await pool.query(
      `alter table probe_runs drop constraint if exists probe_runs_probe_name_check`,
    )
    await pool.query(`
      alter table probe_runs
        add constraint probe_runs_probe_name_check
        check (probe_name in (
          'auth-flow', 'calendar-pathology', 'webhook-flow'
        ))
    `)

    const prevAlertEmailTo = process.env.ALERT_EMAIL_TO
    const prevResendKey = process.env.RESEND_API_KEY
    delete process.env.ALERT_EMAIL_TO
    process.env.RESEND_API_KEY = 'fake-not-used-control'

    try {
      const res = await testSendHandler(
        buildRequest('/api/admin/settings/alerts/auth-flow/test-send', {
          cookie,
          body: { confirmReason: 'control case for preflight' },
          headers: { 'Idempotency-Key': `test-check-control-${Date.now()}` },
        }),
        { params: Promise.resolve({ probe: 'auth-flow' }) },
      )
      expect(res.status).toBe(422)
      const json = await res.json()
      expect(json.error).toBe('missing_alert_email_to')
    } finally {
      if (prevAlertEmailTo !== undefined) process.env.ALERT_EMAIL_TO = prevAlertEmailTo
      if (prevResendKey !== undefined) process.env.RESEND_API_KEY = prevResendKey
      else delete process.env.RESEND_API_KEY
    }
  })
})
