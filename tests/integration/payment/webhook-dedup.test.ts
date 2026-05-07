import { describe, expect, it } from 'vitest'

import { getDbPool } from '@/lib/db/pool'
import {
  ensureWebhookDeliveriesSchema,
  lookupWebhookDelivery,
  purgeStaleWebhookDeliveries,
  recordWebhookDelivery,
} from '@/lib/payments/webhook-dedup'

import './setup'

// Wave 1.2 (security) — webhook delivery dedup, real Postgres.
// Wave 2.3 (security) — request-fingerprint additions.
//
// The unit suite mocks lookup/record. This suite exercises the
// physical schema + SQL paths that survive a deploy: PK constraint,
// CHECK constraints (provider/kind whitelist), nullable invoice_id +
// request_fingerprint, jsonb body roundtrip, ON CONFLICT DO NOTHING
// semantics under concurrent-style inserts, and the Wave 2.3
// fingerprint-mismatch branch in lookup.

describe('webhook_deliveries (integration)', () => {
  it('schema is created idempotently and survives repeated calls', async () => {
    await ensureWebhookDeliveriesSchema()
    await ensureWebhookDeliveriesSchema()

    const result = await getDbPool().query(
      `select column_name from information_schema.columns
       where table_name = 'webhook_deliveries'
       order by column_name`,
    )
    const cols = result.rows.map((r) => r.column_name as string)
    expect(cols).toEqual(
      expect.arrayContaining([
        'provider',
        'kind',
        'transaction_id',
        'invoice_id',
        'response_status',
        'response_body',
        'request_fingerprint',
        'received_at',
      ]),
    )
  })

  it('first delivery persists; lookup returns kind=hit with cached body', async () => {
    await recordWebhookDelivery({
      provider: 'cloudpayments',
      kind: 'pay',
      transactionId: 'tx-int-1',
      invoiceId: 'lc_int_test_1',
      outcome: { status: 200, body: { code: 0 } },
      requestFingerprint: 'a'.repeat(64),
    })

    const cached = await lookupWebhookDelivery(
      'cloudpayments',
      'pay',
      'tx-int-1',
      'a'.repeat(64),
    )
    expect(cached).toEqual({
      kind: 'hit',
      outcome: { status: 200, body: { code: 0 } },
    })
  })

  it('Wave 2.3: lookup with mismatched fingerprint returns kind=fingerprint_mismatch', async () => {
    await recordWebhookDelivery({
      provider: 'cloudpayments',
      kind: 'pay',
      transactionId: 'tx-int-fp-mismatch',
      invoiceId: 'lc_int_legit',
      outcome: { status: 200, body: { code: 0 } },
      requestFingerprint: 'a'.repeat(64),
    })

    const cached = await lookupWebhookDelivery(
      'cloudpayments',
      'pay',
      'tx-int-fp-mismatch',
      'b'.repeat(64), // different fingerprint
    )
    expect(cached).toEqual({
      kind: 'fingerprint_mismatch',
      cachedFingerprint: 'a'.repeat(64),
    })
  })

  it('Wave 2.3: legacy row (null fingerprint) is trusted regardless of incoming fingerprint', async () => {
    await recordWebhookDelivery({
      provider: 'cloudpayments',
      kind: 'pay',
      transactionId: 'tx-int-legacy-null',
      invoiceId: 'lc_int_legacy',
      outcome: { status: 200, body: { code: 0 } },
      requestFingerprint: null, // pre-Wave-2.3 row
    })

    const cached = await lookupWebhookDelivery(
      'cloudpayments',
      'pay',
      'tx-int-legacy-null',
      'a'.repeat(64),
    )
    expect(cached.kind).toBe('hit')
  })

  it('Wave 2.3: caller without fingerprint trivially matches a fingerprinted row', async () => {
    // Defensive: a code path that doesn't compute a fingerprint
    // (legacy caller, or storage_backend non-postgres path that
    // ends up here anyway) gets a cache hit instead of a confusing
    // mismatch.
    await recordWebhookDelivery({
      provider: 'cloudpayments',
      kind: 'pay',
      transactionId: 'tx-int-caller-null',
      invoiceId: 'lc_int_caller',
      outcome: { status: 200, body: { code: 0 } },
      requestFingerprint: 'a'.repeat(64),
    })

    const cached = await lookupWebhookDelivery(
      'cloudpayments',
      'pay',
      'tx-int-caller-null',
      null,
    )
    expect(cached.kind).toBe('hit')
  })

  it('duplicate insert under same (provider, kind, txId) is a no-op', async () => {
    await recordWebhookDelivery({
      provider: 'cloudpayments',
      kind: 'pay',
      transactionId: 'tx-int-dup',
      invoiceId: 'lc_int_test_2',
      outcome: { status: 200, body: { code: 0 } },
      requestFingerprint: 'a'.repeat(64),
    })

    // Second insert with a DIFFERENT body + DIFFERENT fingerprint
    // simulates the attacker-collision attempt the Wave 2.3 fingerprint
    // check is meant to defend against. PK is still (provider, kind,
    // transaction_id), so the second insert is dropped — the first
    // row's fingerprint stays.
    await recordWebhookDelivery({
      provider: 'cloudpayments',
      kind: 'pay',
      transactionId: 'tx-int-dup',
      invoiceId: 'lc_int_test_2',
      outcome: { status: 200, body: { code: 99 } },
      requestFingerprint: 'b'.repeat(64),
    })

    // First write wins per ON CONFLICT DO NOTHING.
    const cached = await lookupWebhookDelivery(
      'cloudpayments',
      'pay',
      'tx-int-dup',
      'a'.repeat(64),
    )
    expect(cached).toEqual({
      kind: 'hit',
      outcome: { status: 200, body: { code: 0 } },
    })

    // The "second" attacker fingerprint also can't impersonate a hit.
    const collision = await lookupWebhookDelivery(
      'cloudpayments',
      'pay',
      'tx-int-dup',
      'b'.repeat(64),
    )
    expect(collision).toEqual({
      kind: 'fingerprint_mismatch',
      cachedFingerprint: 'a'.repeat(64),
    })
  })

  it('different kind under same txId stores as a separate row', async () => {
    await recordWebhookDelivery({
      provider: 'cloudpayments',
      kind: 'check',
      transactionId: 'tx-int-multi',
      invoiceId: 'lc_int_test_3',
      outcome: { status: 200, body: { code: 0 } },
      requestFingerprint: 'c'.repeat(64),
    })
    await recordWebhookDelivery({
      provider: 'cloudpayments',
      kind: 'pay',
      transactionId: 'tx-int-multi',
      invoiceId: 'lc_int_test_3',
      outcome: { status: 200, body: { code: 0 } },
      requestFingerprint: 'c'.repeat(64),
    })

    const checkRow = await lookupWebhookDelivery(
      'cloudpayments',
      'check',
      'tx-int-multi',
      'c'.repeat(64),
    )
    const payRow = await lookupWebhookDelivery(
      'cloudpayments',
      'pay',
      'tx-int-multi',
      'c'.repeat(64),
    )
    expect(checkRow.kind).toBe('hit')
    expect(payRow.kind).toBe('hit')

    const result = await getDbPool().query(
      `select count(*)::int as n from webhook_deliveries
       where transaction_id = $1`,
      ['tx-int-multi'],
    )
    expect(result.rows[0].n).toBe(2)
  })

  it('missing row returns kind=miss, not a throw', async () => {
    const cached = await lookupWebhookDelivery(
      'cloudpayments',
      'pay',
      'never-seen-this',
      'd'.repeat(64),
    )
    expect(cached).toEqual({ kind: 'miss' })
  })

  it('CHECK constraint rejects unknown provider', async () => {
    await expect(
      recordWebhookDelivery({
        provider: 'evil-psp',
        kind: 'pay',
        transactionId: 'tx-int-bad-provider',
        invoiceId: null,
        outcome: { status: 200, body: { code: 0 } },
      }),
    ).rejects.toThrow()
  })

  it('CHECK constraint rejects unknown kind', async () => {
    await expect(
      recordWebhookDelivery({
        provider: 'cloudpayments',
        kind: 'refund',
        transactionId: 'tx-int-bad-kind',
        invoiceId: null,
        outcome: { status: 200, body: { code: 0 } },
      }),
    ).rejects.toThrow()
  })

  it('null invoice_id is allowed (audit grade)', async () => {
    await recordWebhookDelivery({
      provider: 'cloudpayments',
      kind: 'pay',
      transactionId: 'tx-int-orphan',
      invoiceId: null,
      outcome: { status: 200, body: { code: 0 } },
      requestFingerprint: 'e'.repeat(64),
    })
    const cached = await lookupWebhookDelivery(
      'cloudpayments',
      'pay',
      'tx-int-orphan',
      'e'.repeat(64),
    )
    expect(cached).toEqual({
      kind: 'hit',
      outcome: { status: 200, body: { code: 0 } },
    })
  })

  it('purge removes rows older than retention window', async () => {
    await recordWebhookDelivery({
      provider: 'cloudpayments',
      kind: 'pay',
      transactionId: 'tx-int-fresh',
      invoiceId: 'lc_int_test_fresh',
      outcome: { status: 200, body: { code: 0 } },
      requestFingerprint: 'f'.repeat(64),
    })
    // Backdate one row to simulate a stale delivery.
    await getDbPool().query(
      `insert into webhook_deliveries (
         provider, kind, transaction_id, invoice_id,
         response_status, response_body, request_fingerprint, received_at
       ) values ($1, $2, $3, $4, $5, $6::jsonb, $7, now() - interval '120 days')`,
      [
        'cloudpayments',
        'pay',
        'tx-int-stale',
        'lc_int_test_stale',
        200,
        JSON.stringify({ code: 0 }),
        'f'.repeat(64),
      ],
    )

    await purgeStaleWebhookDeliveries(90)

    const fresh = await lookupWebhookDelivery(
      'cloudpayments',
      'pay',
      'tx-int-fresh',
      'f'.repeat(64),
    )
    const stale = await lookupWebhookDelivery(
      'cloudpayments',
      'pay',
      'tx-int-stale',
      'f'.repeat(64),
    )
    expect(fresh.kind).toBe('hit')
    expect(stale).toEqual({ kind: 'miss' })
  })
})
