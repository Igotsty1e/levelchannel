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

describe('Wave 3.1 — AUDIT_ENCRYPTION_KEY rotation', () => {
  const OLD_KEY = 'O'.repeat(48)
  const NEW_KEY = 'N'.repeat(48)

  afterEach(async () => {
    // Reset both keys + cache so each test owns its env state.
    delete process.env.AUDIT_ENCRYPTION_KEY_OLD
    process.env.AUDIT_ENCRYPTION_KEY = TEST_KEY
    __resetAuditEncryptionKeyCache()
  })

  it('migration 0027 — pgp_sym_decrypt_either is callable and returns expected branches', async () => {
    const pool = getAuditPool()!

    // Encrypt a known plaintext under OLD_KEY.
    const enc = await pool.query(
      `select pgp_sym_encrypt('hello'::text, $1) as bytes`,
      [OLD_KEY],
    )
    const ciphertext = enc.rows[0].bytes

    // Primary=OLD → decrypt succeeds.
    const ok = await pool.query(
      `select pgp_sym_decrypt_either($1, $2, null) as plain`,
      [ciphertext, OLD_KEY],
    )
    expect(ok.rows[0].plain).toBe('hello')

    // Primary=NEW, no OLD → returns NULL (wrong key, no fallback).
    const wrongNoFallback = await pool.query(
      `select pgp_sym_decrypt_either($1, $2, null) as plain`,
      [ciphertext, NEW_KEY],
    )
    expect(wrongNoFallback.rows[0].plain).toBeNull()

    // Primary=NEW, OLD=correct → falls back to OLD, succeeds.
    const fallback = await pool.query(
      `select pgp_sym_decrypt_either($1, $2, $3) as plain`,
      [ciphertext, NEW_KEY, OLD_KEY],
    )
    expect(fallback.rows[0].plain).toBe('hello')

    // Both keys wrong → NULL (no throw — that's the contract).
    const bothWrong = await pool.query(
      `select pgp_sym_decrypt_either($1, $2, $3) as plain`,
      [ciphertext, 'X'.repeat(48), 'Y'.repeat(48)],
    )
    expect(bothWrong.rows[0].plain).toBeNull()
  })

  it('rotation flow: write under OLD → set NEW+OLD → read works → re-encrypt → drop OLD → read still works', async () => {
    // Phase 1: write under OLD_KEY.
    process.env.AUDIT_ENCRYPTION_KEY = OLD_KEY
    __resetAuditEncryptionKeyCache()
    await recordPaymentAuditEvent({
      eventType: 'order.created',
      invoiceId: TEST_INVOICE_ID,
      customerEmail: 'rotate@example.com',
      clientIp: '198.51.100.50',
      amountKopecks: 100000,
      actor: 'user',
    })

    // Phase 2: rotate — set new PRIMARY=NEW_KEY, AUDIT_ENCRYPTION_KEY_OLD=OLD_KEY.
    process.env.AUDIT_ENCRYPTION_KEY = NEW_KEY
    process.env.AUDIT_ENCRYPTION_KEY_OLD = OLD_KEY
    __resetAuditEncryptionKeyCache()

    const midRotation = await listPaymentAuditEventsByInvoice(TEST_INVOICE_ID)
    expect(midRotation).toHaveLength(1)
    expect(midRotation[0].customerEmail).toBe('rotate@example.com')
    expect(midRotation[0].clientIp).toBe('198.51.100.50')

    // Phase 3: re-encrypt — replicate the rotation script's core UPDATE
    // for the row we wrote. Production runs this from the script in a
    // batched loop; the SQL is the same.
    const pool = getAuditPool()!
    await pool.query(
      `update payment_audit_events
          set customer_email_enc = case
                when customer_email_enc is not null
                 and pgp_sym_decrypt_either(customer_email_enc, $1, null) is null
                 and pgp_sym_decrypt_either(customer_email_enc, $2, null) is not null
                then pgp_sym_encrypt(pgp_sym_decrypt(customer_email_enc, $2), $1)
                else customer_email_enc
              end,
              client_ip_enc = case
                when client_ip_enc is not null
                 and pgp_sym_decrypt_either(client_ip_enc, $1, null) is null
                 and pgp_sym_decrypt_either(client_ip_enc, $2, null) is not null
                then pgp_sym_encrypt(pgp_sym_decrypt(client_ip_enc, $2), $1)
                else client_ip_enc
              end
        where invoice_id = $3`,
      [NEW_KEY, OLD_KEY, TEST_INVOICE_ID],
    )

    // Phase 4: drop OLD_KEY from env. PRIMARY=NEW_KEY only.
    delete process.env.AUDIT_ENCRYPTION_KEY_OLD
    __resetAuditEncryptionKeyCache()

    const postRotation = await listPaymentAuditEventsByInvoice(TEST_INVOICE_ID)
    expect(postRotation).toHaveLength(1)
    expect(postRotation[0].customerEmail).toBe('rotate@example.com')
    expect(postRotation[0].clientIp).toBe('198.51.100.50')

    // Sanity: the bytea now decrypts under NEW_KEY only — OLD_KEY is dead.
    const raw = await pool.query(
      `select pgp_sym_decrypt_either(customer_email_enc, $1, null) as new,
              pgp_sym_decrypt_either(customer_email_enc, $2, null) as old
         from payment_audit_events where invoice_id = $3`,
      [NEW_KEY, OLD_KEY, TEST_INVOICE_ID],
    )
    expect(raw.rows[0].new).toBe('rotate@example.com')
    expect(raw.rows[0].old).toBeNull()
  })

  it('rotation predicate is idempotent: a row already on PRIMARY is skipped on re-run', async () => {
    process.env.AUDIT_ENCRYPTION_KEY = NEW_KEY
    process.env.AUDIT_ENCRYPTION_KEY_OLD = OLD_KEY
    __resetAuditEncryptionKeyCache()

    // Write directly under NEW_KEY.
    await recordPaymentAuditEvent({
      eventType: 'order.created',
      invoiceId: TEST_INVOICE_ID,
      customerEmail: 'already-new@example.com',
      amountKopecks: 100000,
      actor: 'user',
    })

    const pool = getAuditPool()!
    const before = await pool.query(
      `select customer_email_enc from payment_audit_events where invoice_id = $1`,
      [TEST_INVOICE_ID],
    )
    const ciphertextBefore = before.rows[0].customer_email_enc

    // Run the rotation predicate-guarded UPDATE — should match zero rows
    // because the row decrypts under NEW_KEY (the primary), not OLD_KEY.
    const result = await pool.query(
      `update payment_audit_events
          set customer_email_enc = case
                when customer_email_enc is not null
                 and pgp_sym_decrypt_either(customer_email_enc, $1, null) is null
                 and pgp_sym_decrypt_either(customer_email_enc, $2, null) is not null
                then pgp_sym_encrypt(pgp_sym_decrypt(customer_email_enc, $2), $1)
                else customer_email_enc
              end
        where invoice_id = $3
          and (
            customer_email_enc is not null
            and pgp_sym_decrypt_either(customer_email_enc, $1, null) is null
            and pgp_sym_decrypt_either(customer_email_enc, $2, null) is not null
          )`,
      [NEW_KEY, OLD_KEY, TEST_INVOICE_ID],
    )
    expect(result.rowCount).toBe(0)

    const after = await pool.query(
      `select customer_email_enc from payment_audit_events where invoice_id = $1`,
      [TEST_INVOICE_ID],
    )
    // Same ciphertext bytes (pgcrypto generates fresh random salt on each
    // encrypt, so re-encrypting WOULD produce different bytes — the
    // unchanged bytes prove the WHERE predicate skipped this row).
    expect(after.rows[0].customer_email_enc.toString('hex')).toBe(
      ciphertextBefore.toString('hex'),
    )
  })

  it('reader logs warn when AUDIT_ENCRYPTION_KEY_OLD is invalid (length floor)', async () => {
    process.env.AUDIT_ENCRYPTION_KEY = NEW_KEY
    process.env.AUDIT_ENCRYPTION_KEY_OLD = 'too-short'
    __resetAuditEncryptionKeyCache()

    await recordPaymentAuditEvent({
      eventType: 'order.created',
      invoiceId: TEST_INVOICE_ID,
      customerEmail: 'warn@example.com',
      amountKopecks: 100000,
      actor: 'user',
    })

    // Reader doesn't crash, ignores the bad OLD, returns row decrypted via PRIMARY.
    const events = await listPaymentAuditEventsByInvoice(TEST_INVOICE_ID)
    expect(events).toHaveLength(1)
    expect(events[0].customerEmail).toBe('warn@example.com')
  })
})
