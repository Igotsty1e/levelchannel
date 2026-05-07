import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { __resetAuditEncryptionKeyCache } from '@/lib/audit/encryption'

// We test the recorder's behaviour without touching real Postgres:
// mock `@/lib/audit/pool` to return a fake pool whose .query() we
// observe. The recorder under test must:
//   1. forward all fields to the right SQL columns
//   2. swallow errors (best-effort) and log a warning
//   3. silently no-op when pool is null (no DATABASE_URL configured)
//   4. (Wave 2.1) pass the AUDIT_ENCRYPTION_KEY as the last bind so
//      pgcrypto's pgp_sym_encrypt can populate the *_enc columns;
//      pass null when the key is absent (dev fallback)

const queryMock = vi.fn()
const getAuditPoolMock = vi.fn()

vi.mock('@/lib/audit/pool', () => ({
  getAuditPool: () => getAuditPoolMock(),
}))

import { recordPaymentAuditEvent } from '@/lib/audit/payment-events'

describe('recordPaymentAuditEvent', () => {
  beforeEach(() => {
    queryMock.mockReset()
    queryMock.mockResolvedValue({ rowCount: 1 })
    getAuditPoolMock.mockReset()
    getAuditPoolMock.mockReturnValue({ query: queryMock })
    delete process.env.AUDIT_ENCRYPTION_KEY
    __resetAuditEncryptionKeyCache()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.AUDIT_ENCRYPTION_KEY
    __resetAuditEncryptionKeyCache()
  })

  it('inserts all fields in the right SQL bind order', async () => {
    const ok = await recordPaymentAuditEvent({
      eventType: 'order.created',
      invoiceId: 'lc_abc12345',
      accountId: 'acct-uuid',
      customerEmail: 'a@b.com',
      clientIp: '203.0.113.42',
      userAgent: 'Mozilla/5.0',
      amountKopecks: 250000,
      fromStatus: null,
      toStatus: 'pending',
      actor: 'user',
      idempotencyKey: 'idem-key-1',
      requestId: 'req-1',
      payload: { description: 'Lesson' },
    })

    expect(ok).toBe(true)
    expect(queryMock).toHaveBeenCalledTimes(1)

    const [sql, binds] = queryMock.mock.calls[0]
    expect(sql).toContain('insert into payment_audit_events')
    expect(sql).toContain('customer_email_enc')
    expect(sql).toContain('pgp_sym_encrypt')

    expect(binds).toEqual([
      'order.created',
      'lc_abc12345',
      'acct-uuid',
      'a@b.com',
      '203.0.113.42',
      'Mozilla/5.0',
      250000,
      null,
      'pending',
      'user',
      'idem-key-1',
      'req-1',
      JSON.stringify({ description: 'Lesson' }),
      // No AUDIT_ENCRYPTION_KEY in test env → encryption key bind is null;
      // the SQL CASE clauses leave the *_enc columns NULL.
      null,
    ])
  })

  it('substitutes null defaults for unset optional fields', async () => {
    await recordPaymentAuditEvent({
      eventType: 'webhook.pay.received',
      invoiceId: 'lc_xyz12345',
      customerEmail: 'c@d.com',
      amountKopecks: 100000,
      actor: 'webhook:cloudpayments:pay',
    })

    const [, binds] = queryMock.mock.calls[0]
    // accountId, clientIp, userAgent, fromStatus, toStatus,
    // idempotencyKey, requestId must all be null. payload is empty {}.
    expect(binds[2]).toBeNull() // accountId
    expect(binds[4]).toBeNull() // clientIp
    expect(binds[5]).toBeNull() // userAgent
    expect(binds[7]).toBeNull() // fromStatus
    expect(binds[8]).toBeNull() // toStatus
    expect(binds[10]).toBeNull() // idempotencyKey
    expect(binds[11]).toBeNull() // requestId
    expect(binds[12]).toBe(JSON.stringify({}))
    expect(binds[13]).toBeNull() // encryption key
  })

  it('returns false but does not throw when the insert fails', async () => {
    queryMock.mockRejectedValueOnce(new Error('PG outage'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const ok = await recordPaymentAuditEvent({
      eventType: 'order.created',
      invoiceId: 'lc_die12345',
      customerEmail: 'e@f.com',
      amountKopecks: 100000,
      actor: 'user',
    })

    expect(ok).toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
    const [tag, ctx] = warn.mock.calls[0]
    expect(tag).toContain('[audit] payment-event insert failed')
    expect(ctx).toMatchObject({
      eventType: 'order.created',
      invoiceId: 'lc_die12345',
      error: 'PG outage',
    })
  })

  it('returns false silently when no pool is configured', async () => {
    getAuditPoolMock.mockReturnValueOnce(null)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const ok = await recordPaymentAuditEvent({
      eventType: 'order.created',
      invoiceId: 'lc_nopg1234',
      customerEmail: 'x@y.com',
      amountKopecks: 100000,
      actor: 'user',
    })

    expect(ok).toBe(false)
    expect(queryMock).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  })

  it('passes AUDIT_ENCRYPTION_KEY as the last bind when set', async () => {
    process.env.AUDIT_ENCRYPTION_KEY = 'a'.repeat(40)
    __resetAuditEncryptionKeyCache()

    await recordPaymentAuditEvent({
      eventType: 'order.created',
      invoiceId: 'lc_enc12345',
      customerEmail: 'enc@example.com',
      clientIp: '198.51.100.1',
      amountKopecks: 100000,
      actor: 'user',
    })

    const [, binds] = queryMock.mock.calls[0]
    expect(binds[13]).toBe('a'.repeat(40))
  })

  it('returns false (best-effort) when AUDIT_ENCRYPTION_KEY is too short', async () => {
    process.env.AUDIT_ENCRYPTION_KEY = 'short-key'
    __resetAuditEncryptionKeyCache()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const ok = await recordPaymentAuditEvent({
      eventType: 'order.created',
      invoiceId: 'lc_shortkey1',
      customerEmail: 'a@b.com',
      amountKopecks: 100000,
      actor: 'user',
    })

    expect(ok).toBe(false)
    expect(queryMock).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
    const [, ctx] = warn.mock.calls[0]
    expect(ctx.error).toMatch(/at least 32 characters/i)
  })
})
