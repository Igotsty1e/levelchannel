import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { GET as debtSummaryHandler } from '@/app/api/admin/debt-summary/route'
import { POST as loginHandler } from '@/app/api/auth/login/route'
import { POST as registerHandler } from '@/app/api/auth/register/route'
import {
  getAccountByEmail,
  grantAccountRole,
  markAccountVerified,
} from '@/lib/auth/accounts'
import { getDbPool } from '@/lib/db/pool'

import '../setup'
import { buildRequest, extractSessionCookie, freshInvoiceId } from '../helpers'

// Wave 58 — admin debt aggregator.
//
// Predicate parity with `listAccountPostpaidDebt`: a slot counts as
// debt iff it's completed/no_show_learner AND has no active
// consumption AND has no allocation against a paid order that is not
// fully refunded. The aggregate sums `expected_amount_kopecks` per
// account.

beforeAll(() => {
  process.env.BILLING_WAVE_ACTIVE = 'true'
})

afterAll(() => {
  delete process.env.BILLING_WAVE_ACTIVE
})

async function adminCookie() {
  const email = `debt-admin-${Date.now()}@example.com`
  const password = 'StrongPassword123'
  await registerHandler(
    buildRequest('/api/auth/register', {
      body: { email, password, personalDataConsentAccepted: true },
    }),
  )
  const created = await getAccountByEmail(email)
  await markAccountVerified(created!.id)
  await grantAccountRole(created!.id, 'admin', null)
  const login = await loginHandler(
    buildRequest('/api/auth/login', { body: { email, password } }),
  )
  return extractSessionCookie(login.headers.get('Set-Cookie'))!
}

type SeedOpts = {
  emailPrefix: string
  tariffKopecks: number
  debtSlotCount: number
  paidSlotCount?: number
}

async function seedLearnerWithDebt(
  opts: SeedOpts,
): Promise<{ accountId: string; email: string }> {
  const pool = getDbPool()
  const email = `${opts.emailPrefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
  const learner = await pool.query(
    `insert into accounts (email, password_hash, email_verified_at)
     values ($1, 'dummy', now()) returning id`,
    [email],
  )
  const learnerId = String(learner.rows[0].id)
  const teacher = await pool.query(
    `insert into accounts (email, password_hash, email_verified_at)
     values ($1, 'dummy', now()) returning id`,
    [`${email}-teacher`],
  )
  const teacherId = String(teacher.rows[0].id)
  await pool.query(
    `insert into account_roles (account_id, role) values ($1, 'teacher')`,
    [teacherId],
  )
  const tariff = await pool.query(
    `insert into pricing_tariffs (slug, title_ru, amount_kopecks)
     values ($1, '60 мин', $2)
     returning id`,
    [`${opts.emailPrefix}-tariff-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, opts.tariffKopecks],
  )
  const tariffId = String(tariff.rows[0].id)

  // Debt slots: completed, learner_account_id set, no allocation.
  for (let i = 0; i < opts.debtSlotCount; i++) {
    await pool.query(
      `insert into lesson_slots
         (teacher_account_id, start_at, duration_minutes, status, learner_account_id, booked_at, tariff_id)
       values ($1,
               date_trunc('hour', (now() - interval '1 day' - $4::interval) at time zone 'Europe/Moscow') at time zone 'Europe/Moscow',
               60, 'completed', $2, now() - interval '2 days', $3)`,
      [teacherId, learnerId, tariffId, `${i + 1} hours`],
    )
  }
  // Paid slots: same shape but with paid allocation, must NOT appear in debt.
  for (let i = 0; i < (opts.paidSlotCount ?? 0); i++) {
    const slot = await pool.query(
      `insert into lesson_slots
         (teacher_account_id, start_at, duration_minutes, status, learner_account_id, booked_at, tariff_id)
       values ($1,
               date_trunc('hour', (now() - interval '2 days' - $4::interval) at time zone 'Europe/Moscow') at time zone 'Europe/Moscow',
               60, 'completed', $2, now() - interval '3 days', $3)
       returning id`,
      [teacherId, learnerId, tariffId, `${i + 1} hours`],
    )
    const slotId = String(slot.rows[0].id)
    const invoiceId = freshInvoiceId('lc_debt_paid')
    await pool.query(
      `insert into payment_orders
         (invoice_id, amount_rub, currency, description, provider, status,
          created_at, updated_at, paid_at, customer_email, receipt_email, receipt)
       values ($1, $2, 'RUB', 'paid', 'mock', 'paid', now(), now(), now(),
               $3, $3, '{}'::jsonb)`,
      [invoiceId, (opts.tariffKopecks / 100).toFixed(2), email],
    )
    await pool.query(
      `insert into payment_allocations
         (payment_order_id, kind, target_id, amount_kopecks)
       values ($1, 'lesson_slot', $2, $3)`,
      [invoiceId, slotId, opts.tariffKopecks],
    )
  }
  return { accountId: learnerId, email }
}

describe('GET /api/admin/debt-summary', () => {
  it('aggregates per-account debt across all learners and sorts by total desc', async () => {
    const cookie = await adminCookie()
    const heavy = await seedLearnerWithDebt({
      emailPrefix: 'debt-heavy',
      tariffKopecks: 350_000,
      debtSlotCount: 3, // 3 × 3500 = 10,500₽
    })
    const light = await seedLearnerWithDebt({
      emailPrefix: 'debt-light',
      tariffKopecks: 250_000,
      debtSlotCount: 1, // 2500₽
    })

    const res = await debtSummaryHandler(
      buildRequest('/api/admin/debt-summary', { cookie }),
    )
    expect(res.status).toBe(200)
    const json = await res.json()

    const ours = json.rows.filter(
      (r: { accountId: string }) =>
        r.accountId === heavy.accountId || r.accountId === light.accountId,
    )
    expect(ours).toHaveLength(2)
    // Sorted by total_debt_kopecks desc — heavy must come first.
    const heavyIdx = ours.findIndex(
      (r: { accountId: string }) => r.accountId === heavy.accountId,
    )
    const lightIdx = ours.findIndex(
      (r: { accountId: string }) => r.accountId === light.accountId,
    )
    expect(heavyIdx).toBeLessThan(lightIdx)
    expect(ours[heavyIdx].totalDebtKopecks).toBe(1_050_000)
    expect(ours[heavyIdx].slotCount).toBe(3)
    expect(ours[lightIdx].totalDebtKopecks).toBe(250_000)
    expect(ours[lightIdx].slotCount).toBe(1)
  })

  it('paid slots do not contribute to the debt total', async () => {
    const cookie = await adminCookie()
    const mixed = await seedLearnerWithDebt({
      emailPrefix: 'debt-mixed',
      tariffKopecks: 350_000,
      debtSlotCount: 1, // owes for 1 slot
      paidSlotCount: 2, // 2 paid slots — must NOT be in the aggregate
    })

    const res = await debtSummaryHandler(
      buildRequest('/api/admin/debt-summary', { cookie }),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    const row = json.rows.find(
      (r: { accountId: string }) => r.accountId === mixed.accountId,
    )
    expect(row).toBeDefined()
    expect(row.totalDebtKopecks).toBe(350_000)
    expect(row.slotCount).toBe(1)
  })

  it('minKopecks filter drops accounts below the threshold', async () => {
    const cookie = await adminCookie()
    const big = await seedLearnerWithDebt({
      emailPrefix: 'debt-big',
      tariffKopecks: 500_000,
      debtSlotCount: 2,
    })
    const small = await seedLearnerWithDebt({
      emailPrefix: 'debt-small',
      tariffKopecks: 200_000,
      debtSlotCount: 1,
    })

    // 300_000 kopecks threshold → small (200_000) drops, big (1_000_000) stays.
    const res = await debtSummaryHandler(
      buildRequest('/api/admin/debt-summary?minKopecks=300000', { cookie }),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    const ids = json.rows.map((r: { accountId: string }) => r.accountId)
    expect(ids).toContain(big.accountId)
    expect(ids).not.toContain(small.accountId)
  })

  it('format=csv returns text/csv with the stable column order', async () => {
    const cookie = await adminCookie()
    await seedLearnerWithDebt({
      emailPrefix: 'debt-csv',
      tariffKopecks: 350_000,
      debtSlotCount: 1,
    })
    const res = await debtSummaryHandler(
      buildRequest('/api/admin/debt-summary?format=csv', { cookie }),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/csv')
    expect(res.headers.get('Content-Disposition')).toContain(
      'postpaid-debt-summary.csv',
    )
    const text = await res.text()
    const lines = text.trim().split('\n')
    expect(lines[0]).toBe(
      'account_id,email,display_name,total_debt_kopecks,total_debt_rub,slot_count,slots_without_tariff,oldest_debt_slot_at',
    )
    expect(lines.length).toBeGreaterThan(1)
  })

  it('rejects unauthenticated callers with 401', async () => {
    const res = await debtSummaryHandler(
      buildRequest('/api/admin/debt-summary', {}),
    )
    expect(res.status).toBe(401)
  })
})
