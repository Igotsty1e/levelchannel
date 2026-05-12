import { describe, expect, it } from 'vitest'

import { POST as deleteHandler } from '@/app/api/account/delete/route'
import { POST as loginHandler } from '@/app/api/auth/login/route'
import { POST as registerHandler } from '@/app/api/auth/register/route'
import { getAccountByEmail, getAccountById } from '@/lib/auth/accounts'
import {
  accountHasInFlightPackageGrant,
  checkAccountInFlightPackageGrant,
} from '@/lib/billing/deletion-guard'
import { getDbPool } from '@/lib/db/pool'

import '../setup'
import { buildRequest, extractSessionCookie, freshInvoiceId } from '../helpers'

// Wave 59 — deletion-guard re-check.
// Closes the contract gap from prepay-postpay-billing.md v9
// §"Account-lifecycle policy during in-flight package grant".
//
// Helper: `accountHasInFlightPackageGrant(accountId)`.
//   Branch A — pending/3ds_required within 15 min → inFlight=true
//   Branch B — paid order with no package_purchases row → inFlight=true
//   Otherwise → inFlight=false
//
// Wired at: (1) `/api/account/delete` route (schedule step),
//           (2) cron anonymizer `scripts/db-retention-cleanup.mjs`
//               (execute step, re-check inside per-row tx).

async function register(email: string) {
  const password = 'StrongPassword123'
  await registerHandler(
    buildRequest('/api/auth/register', {
      body: { email, password, personalDataConsentAccepted: true },
    }),
  )
  const created = await getAccountByEmail(email)
  expect(created).not.toBeNull()
  const login = await loginHandler(
    buildRequest('/api/auth/login', { body: { email, password } }),
  )
  const cookie = extractSessionCookie(login.headers.get('Set-Cookie'))
  return { cookie: cookie!, accountId: created!.id, email }
}

async function seedPendingPackageOrder(
  accountId: string,
  email: string,
  opts: { status: 'pending' | '3ds_required' | 'paid'; ageSec?: number } = {
    status: 'pending',
  },
): Promise<string> {
  const pool = getDbPool()
  const invoiceId = freshInvoiceId('lc_guard_pkg')
  const ageSec = opts.ageSec ?? 30
  await pool.query(
    `insert into payment_orders
       (invoice_id, amount_rub, currency, description, provider, status,
        created_at, updated_at, paid_at, customer_email, receipt_email,
        receipt, metadata)
     values ($1, '3500.00', 'RUB', 'guard test', 'mock', $2,
             now() - make_interval(secs => $3),
             now() - make_interval(secs => $3),
             case when $2 = 'paid' then now() else null end,
             $4, $4, '{}'::jsonb,
             jsonb_build_object('accountId', $5::text, 'packageSlug', 'test-pkg'))`,
    [invoiceId, opts.status, ageSec, email, accountId],
  )
  return invoiceId
}

describe('accountHasInFlightPackageGrant', () => {
  it('returns inFlight=false when no package orders exist', async () => {
    const { accountId } = await register('guard-empty@example.com')
    const r = await accountHasInFlightPackageGrant(accountId)
    expect(r.inFlight).toBe(false)
    expect(r.reason).toBeNull()
  })

  it('Branch A: pending order < 15 min flags inFlight=true', async () => {
    const { accountId, email } = await register('guard-pending@example.com')
    await seedPendingPackageOrder(accountId, email, { status: 'pending' })
    const r = await accountHasInFlightPackageGrant(accountId)
    expect(r.inFlight).toBe(true)
    expect(r.reason).toBe('pending_within_15min')
  })

  it('Branch A: 3ds_required within 15 min flags inFlight=true', async () => {
    const { accountId, email } = await register('guard-3ds@example.com')
    await seedPendingPackageOrder(accountId, email, { status: '3ds_required' })
    const r = await accountHasInFlightPackageGrant(accountId)
    expect(r.inFlight).toBe(true)
    expect(r.reason).toBe('pending_within_15min')
  })

  it('Branch A: stale pending order (> 15 min) does NOT flag', async () => {
    const { accountId, email } = await register('guard-stale@example.com')
    await seedPendingPackageOrder(accountId, email, {
      status: 'pending',
      ageSec: 30 * 60, // 30 minutes ago — outside the 15-min bound
    })
    const r = await accountHasInFlightPackageGrant(accountId)
    expect(r.inFlight).toBe(false)
  })

  it('Branch B: paid order without package_purchases row flags inFlight=true (no time bound)', async () => {
    const { accountId, email } = await register('guard-paid-not-granted@example.com')
    // Old paid order — Branch B has no time bound.
    await seedPendingPackageOrder(accountId, email, {
      status: 'paid',
      ageSec: 60 * 60, // 1 hour ago — Branch A would not match
    })
    const r = await accountHasInFlightPackageGrant(accountId)
    expect(r.inFlight).toBe(true)
    expect(r.reason).toBe('paid_not_granted')
  })

  it('Branch B precedence: paid_not_granted wins over pending_within_15min', async () => {
    const { accountId, email } = await register('guard-precedence@example.com')
    await seedPendingPackageOrder(accountId, email, { status: 'pending' })
    await seedPendingPackageOrder(accountId, email, { status: 'paid' })
    const r = await accountHasInFlightPackageGrant(accountId)
    expect(r.inFlight).toBe(true)
    expect(r.reason).toBe('paid_not_granted')
  })

  it('paid order WITH package_purchases row does NOT flag', async () => {
    const { accountId, email } = await register('guard-fully-granted@example.com')
    const invoiceId = await seedPendingPackageOrder(accountId, email, {
      status: 'paid',
    })
    // Materialize the package_purchases row — Branch B closes.
    const pool = getDbPool()
    const pkg = await pool.query(
      `insert into lesson_packages
         (slug, title_ru, duration_minutes, count, amount_kopecks, is_active)
       values ($1, 'guard test pkg', 60, 10, 350000, true)
       returning id`,
      [`guard-pkg-${Date.now()}`],
    )
    await pool.query(
      `insert into package_purchases
         (account_id, package_id, payment_order_id, amount_kopecks, currency,
          title_snapshot, duration_minutes, count_initial, expires_at)
       values ($1, $2, $3, 350000, 'RUB', '10x60', 60, 10, now() + interval '180 days')`,
      [accountId, pkg.rows[0].id, invoiceId],
    )
    const r = await accountHasInFlightPackageGrant(accountId)
    expect(r.inFlight).toBe(false)
  })

  it('checkAccountInFlightPackageGrant accepts a tx client for in-tx re-check', async () => {
    const { accountId, email } = await register('guard-tx@example.com')
    await seedPendingPackageOrder(accountId, email, { status: 'pending' })
    const pool = getDbPool()
    const client = await pool.connect()
    try {
      await client.query('begin')
      const r = await checkAccountInFlightPackageGrant(client, accountId)
      expect(r.inFlight).toBe(true)
      await client.query('rollback')
    } finally {
      client.release()
    }
  })
})

describe('POST /api/account/delete deletion-guard wiring', () => {
  it('refuses schedule with 409 when Branch A matches', async () => {
    const { cookie, accountId, email } = await register(
      'delete-guard-pending@example.com',
    )
    await seedPendingPackageOrder(accountId, email, { status: 'pending' })
    const res = await deleteHandler(
      buildRequest('/api/account/delete', {
        cookie,
        body: { confirm: true },
      }),
    )
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error).toBe('in_flight_package_grant')
    expect(json.reason).toBe('pending_within_15min')
    // Crucially: account is NOT scheduled for deletion.
    const account = await getAccountById(accountId)
    expect(account?.disabledAt).toBeNull()
    expect(account?.scheduledPurgeAt).toBeNull()
  })

  it('refuses schedule with 409 when Branch B matches', async () => {
    const { cookie, accountId, email } = await register(
      'delete-guard-paid-not-granted@example.com',
    )
    await seedPendingPackageOrder(accountId, email, {
      status: 'paid',
      ageSec: 60 * 60,
    })
    const res = await deleteHandler(
      buildRequest('/api/account/delete', {
        cookie,
        body: { confirm: true },
      }),
    )
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error).toBe('in_flight_package_grant')
    expect(json.reason).toBe('paid_not_granted')
    expect(json.message).toContain('оператор')
  })

  it('allows schedule when no in-flight grant exists', async () => {
    const { cookie, accountId } = await register('delete-guard-clean@example.com')
    const res = await deleteHandler(
      buildRequest('/api/account/delete', {
        cookie,
        body: { confirm: true },
      }),
    )
    expect(res.status).toBe(200)
    const account = await getAccountById(accountId)
    expect(account?.scheduledPurgeAt).not.toBeNull()
  })
})
