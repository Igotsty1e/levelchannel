import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { getAuditPool } from '@/lib/audit/pool'
import {
  PAYMENT_AUDIT_EVENT_TYPES,
  listPaymentAuditEventsByInvoice,
  recordPaymentAuditEvent,
  rublesToKopecks,
} from '@/lib/audit/payment-events'

// Real-Postgres integration. Verifies:
//   - the migration is applied and the table is reachable
//   - recorder + reader round-trip every column correctly
//   - multiple events on one invoice land in created_at order
//   - the event_type CHECK constraint matches our exported enum

const TEST_INVOICE_ID = 'lc_audit_int_test'

beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL must be set for integration tests. Run via npm run test:integration.',
    )
  }
  const pool = getAuditPool()
  if (!pool) throw new Error('audit pool not configured')

  // Foreign-key prereq: payment_orders row that audit will reference.
  // We bypass the route layer here — just need an order row.
  await pool.query(
    `insert into payment_orders (
      invoice_id, amount_rub, currency, description, provider, status,
      created_at, updated_at, customer_email, receipt_email, receipt
    ) values (
      $1, 2500.00, 'RUB', 'Audit integration test', 'mock', 'pending',
      now(), now(), 'test@example.com', 'test@example.com', '{}'::jsonb
    ) on conflict (invoice_id) do nothing`,
    [TEST_INVOICE_ID],
  )
})

afterEach(async () => {
  const pool = getAuditPool()
  if (!pool) return
  await pool.query('delete from payment_audit_events where invoice_id = $1', [
    TEST_INVOICE_ID,
  ])
})

afterAll(async () => {
  const pool = getAuditPool()
  if (!pool) return
  await pool.query('delete from payment_audit_events where invoice_id = $1', [
    TEST_INVOICE_ID,
  ])
  await pool.query('delete from payment_orders where invoice_id = $1', [
    TEST_INVOICE_ID,
  ])
  await pool.end()
})

describe('payment_audit_events — integration', () => {
  it('round-trips every column through recorder + reader', async () => {
    const written = await recordPaymentAuditEvent({
      eventType: 'order.created',
      invoiceId: TEST_INVOICE_ID,
      customerEmail: 'test@example.com',
      clientIp: '203.0.113.42',
      userAgent: 'Mozilla/5.0',
      amountKopecks: rublesToKopecks(2500),
      toStatus: 'pending',
      actor: 'user',
      idempotencyKey: 'idem-test-1',
      requestId: 'req-test-1',
      payload: { provider: 'mock', rememberCard: false },
    })
    expect(written).toBe(true)

    const events = await listPaymentAuditEventsByInvoice(TEST_INVOICE_ID)
    expect(events).toHaveLength(1)

    const ev = events[0]
    expect(ev.eventType).toBe('order.created')
    expect(ev.invoiceId).toBe(TEST_INVOICE_ID)
    expect(ev.customerEmail).toBe('test@example.com')
    expect(ev.clientIp).toBe('203.0.113.42')
    expect(ev.userAgent).toBe('Mozilla/5.0')
    expect(ev.amountKopecks).toBe(250000)
    expect(ev.fromStatus).toBeNull()
    expect(ev.toStatus).toBe('pending')
    expect(ev.actor).toBe('user')
    expect(ev.idempotencyKey).toBe('idem-test-1')
    expect(ev.requestId).toBe('req-test-1')
    expect(ev.payload).toEqual({ provider: 'mock', rememberCard: false })
    expect(ev.id).toBeTypeOf('string')
    expect(typeof ev.createdAt).toBe('string')
  })

  it('orders multiple events by created_at ascending', async () => {
    await recordPaymentAuditEvent({
      eventType: 'order.created',
      invoiceId: TEST_INVOICE_ID,
      customerEmail: 'test@example.com',
      amountKopecks: 250000,
      toStatus: 'pending',
      actor: 'user',
    })
    // Tiny delay so created_at tick separates the rows even on a fast box.
    await new Promise((r) => setTimeout(r, 5))
    await recordPaymentAuditEvent({
      eventType: 'mock.confirmed',
      invoiceId: TEST_INVOICE_ID,
      customerEmail: 'test@example.com',
      amountKopecks: 250000,
      fromStatus: 'pending',
      toStatus: 'paid',
      actor: 'system',
      payload: { source: 'mock.manual_confirm' },
    })

    const events = await listPaymentAuditEventsByInvoice(TEST_INVOICE_ID)
    expect(events.map((e) => e.eventType)).toEqual([
      'order.created',
      'mock.confirmed',
    ])
  })

  it('rejects an event_type outside the CHECK constraint', async () => {
    const pool = getAuditPool()
    if (!pool) throw new Error('audit pool not configured')

    await expect(
      pool.query(
        `insert into payment_audit_events (
           event_type, invoice_id, customer_email, amount_kopecks, actor
         ) values ('bogus.type', $1, 'x@y.com', 100, 'user')`,
        [TEST_INVOICE_ID],
      ),
    ).rejects.toThrow(/payment_audit_events_event_type_check|violates check/i)
  })

  it('all exported event types pass the CHECK constraint (no enum drift)', async () => {
    // If an enum value is added to PAYMENT_AUDIT_EVENT_TYPES but not to
    // the migration's CHECK list, this will surface immediately.
    for (const eventType of PAYMENT_AUDIT_EVENT_TYPES) {
      const ok = await recordPaymentAuditEvent({
        eventType,
        invoiceId: TEST_INVOICE_ID,
        customerEmail: 'test@example.com',
        amountKopecks: 100,
        actor: 'user',
      })
      expect(ok, `event type ${eventType} must be accepted`).toBe(true)
    }
  })
})
