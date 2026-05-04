import { afterEach, describe, expect, it } from 'vitest'

import {
  __resetStatusBusForTesting,
  emitStatusChange,
  subscribeToStatus,
} from '@/lib/payments/status-bus'

import type { PublicPaymentOrder } from '@/lib/payments/types'

const baseOrder: PublicPaymentOrder = {
  invoiceId: '',
  amountRub: 1500,
  currency: 'RUB',
  description: 'Test order',
  provider: 'mock',
  status: 'paid',
  createdAt: '2026-05-04T00:00:00Z',
  updatedAt: '2026-05-04T00:01:00Z',
  paidAt: '2026-05-04T00:01:00Z',
}

describe('payments/status-bus', () => {
  afterEach(() => {
    __resetStatusBusForTesting()
  })

  it('delivers an emit to a matching subscriber', () => {
    const updates: string[] = []
    const unsub = subscribeToStatus('lc_a', (u) => updates.push(u.status))

    emitStatusChange({
      invoiceId: 'lc_a',
      status: 'paid',
      order: { ...baseOrder, invoiceId: 'lc_a' },
    })

    expect(updates).toEqual(['paid'])
    unsub()
  })

  it('isolates subscribers across invoiceIds', () => {
    const a: string[] = []
    const b: string[] = []
    const ua = subscribeToStatus('lc_a', (u) => a.push(u.status))
    const ub = subscribeToStatus('lc_b', (u) => b.push(u.status))

    emitStatusChange({
      invoiceId: 'lc_a',
      status: 'paid',
      order: { ...baseOrder, invoiceId: 'lc_a' },
    })
    emitStatusChange({
      invoiceId: 'lc_b',
      status: 'failed',
      order: { ...baseOrder, invoiceId: 'lc_b', status: 'failed' },
    })

    expect(a).toEqual(['paid'])
    expect(b).toEqual(['failed'])
    ua()
    ub()
  })

  it('unsubscribe stops further deliveries', () => {
    const got: string[] = []
    const unsub = subscribeToStatus('lc_x', (u) => got.push(u.status))
    unsub()

    emitStatusChange({
      invoiceId: 'lc_x',
      status: 'paid',
      order: { ...baseOrder, invoiceId: 'lc_x' },
    })

    expect(got).toEqual([])
  })

  it('listener exception does not break other listeners', () => {
    const survived: string[] = []
    const u1 = subscribeToStatus('lc_y', () => {
      throw new Error('boom')
    })
    const u2 = subscribeToStatus('lc_y', (u) => survived.push(u.status))

    emitStatusChange({
      invoiceId: 'lc_y',
      status: 'paid',
      order: { ...baseOrder, invoiceId: 'lc_y' },
    })

    expect(survived).toEqual(['paid'])
    u1()
    u2()
  })
})
