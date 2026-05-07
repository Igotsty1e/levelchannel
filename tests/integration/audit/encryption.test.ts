import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { __resetAuditEncryptionKeyCache } from '@/lib/audit/encryption'
import {
  listPaymentAuditEventsByInvoice,
  recordPaymentAuditEvent,
} from '@/lib/audit/payment-events'
import { getAuditPool } from '@/lib/audit/pool'

// Wave 2.1 — at-rest encryption integration. Verifies the migration
// 0025 + recorder + reader against a real Postgres so the pgcrypto
// SQL syntax + ON CONFLICT semantics + key-handling round-trip
// across the full stack.

const TEST_INVOICE_ID = 'lc_audit_enc_int'
const TEST_KEY = 'a'.repeat(48)

beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must be set for integration tests.')
  }
  process.env.AUDIT_ENCRYPTION_KEY = TEST_KEY
  __resetAuditEncryptionKeyCache()

  const pool = getAuditPool()
  if (!pool) throw new Error('audit pool not configured')
  await pool.query(
    `insert into payment_orders (
      invoice_id, amount_rub, currency, description, provider, status,
      created_at, updated_at, customer_email, receipt_email, receipt
    ) values (
      $1, 1000.00, 'RUB', 'Audit enc integration', 'mock', 'pending',
      now(), now(), 'roundtrip@example.com', 'roundtrip@example.com', '{}'::jsonb
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
  delete process.env.AUDIT_ENCRYPTION_KEY
  __resetAuditEncryptionKeyCache()
  const pool = getAuditPool()
  if (!pool) return
  await pool.query('delete from payment_audit_events where invoice_id = $1', [
    TEST_INVOICE_ID,
  ])
  await pool.query('delete from payment_orders where invoice_id = $1', [
    TEST_INVOICE_ID,
  ])
})

describe('payment_audit_events — at-rest encryption', () => {
  it('with key set, write populates _enc columns; read returns decrypted plaintext', async () => {
    const ok = await recordPaymentAuditEvent({
      eventType: 'order.created',
      invoiceId: TEST_INVOICE_ID,
      customerEmail: 'roundtrip@example.com',
      clientIp: '203.0.113.42',
      amountKopecks: 100000,
      actor: 'user',
    })
    expect(ok).toBe(true)

    const pool = getAuditPool()!
    const raw = await pool.query(
      `select customer_email, client_ip, customer_email_enc, client_ip_enc
       from payment_audit_events where invoice_id = $1`,
      [TEST_INVOICE_ID],
    )
    expect(raw.rows).toHaveLength(1)
    const row = raw.rows[0]
    // Phase A of the migration: dual-write. Plaintext is still
    // populated until Phase B nulls it out.
    expect(row.customer_email).toBe('roundtrip@example.com')
    expect(row.client_ip).toBe('203.0.113.42')
    // Encrypted bytea is non-null and not equal to the plaintext.
    expect(row.customer_email_enc).not.toBeNull()
    expect(row.client_ip_enc).not.toBeNull()
    expect(row.customer_email_enc.toString('utf8')).not.toContain('roundtrip')

    // Read path returns the decrypted value (sourced from the _enc
    // column when present per the SQL CASE).
    const events = await listPaymentAuditEventsByInvoice(TEST_INVOICE_ID)
    expect(events).toHaveLength(1)
    expect(events[0].customerEmail).toBe('roundtrip@example.com')
    expect(events[0].clientIp).toBe('203.0.113.42')
  })

  it('with key set, null email/ip leaves _enc columns null', async () => {
    await recordPaymentAuditEvent({
      eventType: 'webhook.pay.received',
      invoiceId: TEST_INVOICE_ID,
      customerEmail: null,
      clientIp: null,
      amountKopecks: 100000,
      actor: 'webhook:cloudpayments:pay',
    })

    const pool = getAuditPool()!
    const raw = await pool.query(
      `select customer_email, client_ip, customer_email_enc, client_ip_enc
       from payment_audit_events where invoice_id = $1`,
      [TEST_INVOICE_ID],
    )
    expect(raw.rows[0].customer_email).toBeNull()
    expect(raw.rows[0].client_ip).toBeNull()
    expect(raw.rows[0].customer_email_enc).toBeNull()
    expect(raw.rows[0].client_ip_enc).toBeNull()
  })

  it('reader prefers _enc over plaintext when both are present', async () => {
    // Write a row with normal dual-write.
    await recordPaymentAuditEvent({
      eventType: 'order.created',
      invoiceId: TEST_INVOICE_ID,
      customerEmail: 'real@example.com',
      clientIp: '198.51.100.10',
      amountKopecks: 100000,
      actor: 'user',
    })

    // Mutate the plaintext column directly to a *different* value
    // to prove the reader is sourcing from _enc (decrypted), not the
    // mutated plaintext.
    const pool = getAuditPool()!
    await pool.query(
      `update payment_audit_events
          set customer_email = 'tampered@example.com', client_ip = '0.0.0.0'
        where invoice_id = $1`,
      [TEST_INVOICE_ID],
    )

    const events = await listPaymentAuditEventsByInvoice(TEST_INVOICE_ID)
    expect(events).toHaveLength(1)
    // The reader must return the encrypted value, not the tampered
    // plaintext. This is what makes Phase B (NULL plaintext) safe to
    // run later — the read path already trusts the encrypted column.
    expect(events[0].customerEmail).toBe('real@example.com')
    expect(events[0].clientIp).toBe('198.51.100.10')
  })

  it('reader falls back to plaintext when _enc is null (Phase A pre-backfill)', async () => {
    // Simulate a legacy row written before encryption was deployed:
    // plaintext set, _enc null.
    const pool = getAuditPool()!
    await pool.query(
      `insert into payment_audit_events (
        event_type, invoice_id, customer_email, client_ip,
        amount_kopecks, actor, payload
      ) values (
        'order.created', $1, 'legacy@example.com', '192.0.2.1',
        100000, 'user', '{}'::jsonb
      )`,
      [TEST_INVOICE_ID],
    )

    const events = await listPaymentAuditEventsByInvoice(TEST_INVOICE_ID)
    expect(events).toHaveLength(1)
    expect(events[0].customerEmail).toBe('legacy@example.com')
    expect(events[0].clientIp).toBe('192.0.2.1')
  })

  it('round-trip survives non-ASCII content (UTF-8 in pg_sym_encrypt)', async () => {
    await recordPaymentAuditEvent({
      eventType: 'order.created',
      invoiceId: TEST_INVOICE_ID,
      customerEmail: 'тест@пример.рф',
      clientIp: '203.0.113.42',
      amountKopecks: 100000,
      actor: 'user',
    })
    const events = await listPaymentAuditEventsByInvoice(TEST_INVOICE_ID)
    expect(events[0].customerEmail).toBe('тест@пример.рф')
  })
})
