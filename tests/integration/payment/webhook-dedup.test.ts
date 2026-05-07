import { describe, expect, it } from 'vitest'

import { getDbPool } from '@/lib/db/pool'
import {
  ensureWebhookDeliveriesSchema,
  lookupWebhookDelivery,
  purgeStaleWebhookDeliveries,
  recordWebhookDelivery,
} from '@/lib/payments/webhook-dedup'

import './setup'

// Wave 1 (security) — webhook delivery dedup, real Postgres.
//
// The unit suite mocks lookup/record. This suite exercises the
// physical schema + SQL paths that survive a deploy: PK constraint,
// CHECK constraints (provider/kind whitelist), nullable invoice_id,
// jsonb body roundtrip, and ON CONFLICT DO NOTHING semantics under
// concurrent-style inserts.

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
        'received_at',
      ]),
    )
  })

  it('first delivery persists; lookup returns the cached body verbatim', async () => {
    await recordWebhookDelivery({
      provider: 'cloudpayments',
      kind: 'pay',
      transactionId: 'tx-int-1',
      invoiceId: 'lc_int_test_1',
      outcome: { status: 200, body: { code: 0 } },
    })

    const cached = await lookupWebhookDelivery(
      'cloudpayments',
      'pay',
      'tx-int-1',
    )
    expect(cached).toEqual({ status: 200, body: { code: 0 } })
  })

  it('duplicate insert under same (provider, kind, txId) is a no-op', async () => {
    await recordWebhookDelivery({
      provider: 'cloudpayments',
      kind: 'pay',
      transactionId: 'tx-int-dup',
      invoiceId: 'lc_int_test_2',
      outcome: { status: 200, body: { code: 0 } },
    })

    // Second insert with a DIFFERENT body simulates the race where two
    // retries reach the persist step at almost the same time.
    await recordWebhookDelivery({
      provider: 'cloudpayments',
      kind: 'pay',
      transactionId: 'tx-int-dup',
      invoiceId: 'lc_int_test_2',
      outcome: { status: 200, body: { code: 99 } },
    })

    const cached = await lookupWebhookDelivery(
      'cloudpayments',
      'pay',
      'tx-int-dup',
    )
    // First write wins per ON CONFLICT DO NOTHING.
    expect(cached).toEqual({ status: 200, body: { code: 0 } })
  })

  it('different kind under same txId stores as a separate row', async () => {
    await recordWebhookDelivery({
      provider: 'cloudpayments',
      kind: 'check',
      transactionId: 'tx-int-multi',
      invoiceId: 'lc_int_test_3',
      outcome: { status: 200, body: { code: 0 } },
    })
    await recordWebhookDelivery({
      provider: 'cloudpayments',
      kind: 'pay',
      transactionId: 'tx-int-multi',
      invoiceId: 'lc_int_test_3',
      outcome: { status: 200, body: { code: 0 } },
    })

    const checkRow = await lookupWebhookDelivery(
      'cloudpayments',
      'check',
      'tx-int-multi',
    )
    const payRow = await lookupWebhookDelivery(
      'cloudpayments',
      'pay',
      'tx-int-multi',
    )
    expect(checkRow).not.toBeNull()
    expect(payRow).not.toBeNull()

    const result = await getDbPool().query(
      `select count(*)::int as n from webhook_deliveries
       where transaction_id = $1`,
      ['tx-int-multi'],
    )
    expect(result.rows[0].n).toBe(2)
  })

  it('missing row returns null, not a throw', async () => {
    const cached = await lookupWebhookDelivery(
      'cloudpayments',
      'pay',
      'never-seen-this',
    )
    expect(cached).toBeNull()
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
    })
    const cached = await lookupWebhookDelivery(
      'cloudpayments',
      'pay',
      'tx-int-orphan',
    )
    expect(cached).toEqual({ status: 200, body: { code: 0 } })
  })

  it('purge removes rows older than retention window', async () => {
    await recordWebhookDelivery({
      provider: 'cloudpayments',
      kind: 'pay',
      transactionId: 'tx-int-fresh',
      invoiceId: 'lc_int_test_fresh',
      outcome: { status: 200, body: { code: 0 } },
    })
    // Backdate one row to simulate a stale delivery.
    await getDbPool().query(
      `insert into webhook_deliveries (
         provider, kind, transaction_id, invoice_id,
         response_status, response_body, received_at
       ) values ($1, $2, $3, $4, $5, $6::jsonb, now() - interval '120 days')`,
      [
        'cloudpayments',
        'pay',
        'tx-int-stale',
        'lc_int_test_stale',
        200,
        JSON.stringify({ code: 0 }),
      ],
    )

    await purgeStaleWebhookDeliveries(90)

    const fresh = await lookupWebhookDelivery(
      'cloudpayments',
      'pay',
      'tx-int-fresh',
    )
    const stale = await lookupWebhookDelivery(
      'cloudpayments',
      'pay',
      'tx-int-stale',
    )
    expect(fresh).not.toBeNull()
    expect(stale).toBeNull()
  })
})
