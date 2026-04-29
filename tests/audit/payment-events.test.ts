import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// We test the recorder's behaviour without touching real Postgres:
// mock `@/lib/audit/pool` to return a fake pool whose .query() we
// observe. The recorder under test must:
//   1. forward all fields to the right SQL columns
//   2. swallow errors (best-effort) and log a warning
//   3. silently no-op when pool is null (no DATABASE_URL configured)

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
  })

  afterEach(() => {
    vi.restoreAllMocks()
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
})
