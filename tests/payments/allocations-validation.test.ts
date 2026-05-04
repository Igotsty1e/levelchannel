import { describe, expect, it, vi } from 'vitest'

// Pure validation paths only — DB integration is in
// tests/integration/payments/allocations.test.ts.

vi.mock('@/lib/db/pool', () => ({
  getDbPool: () => ({
    query: () => Promise.resolve({ rowCount: 0, rows: [] }),
  }),
}))

import { recordAllocation } from '@/lib/payments/allocations'

describe('recordAllocation validation', () => {
  it('rejects invalid kind', async () => {
    const ok = await recordAllocation({
      paymentOrderId: 'lc_x',
      // @ts-expect-error invalid kind
      kind: 'package',
      targetId: 'abc',
      amountKopecks: 1000,
    })
    expect(ok).toBe(false)
  })

  it('rejects negative amount', async () => {
    const ok = await recordAllocation({
      paymentOrderId: 'lc_x',
      kind: 'lesson_slot',
      targetId: 'abc',
      amountKopecks: -100,
    })
    expect(ok).toBe(false)
  })

  it('rejects non-integer amount', async () => {
    const ok = await recordAllocation({
      paymentOrderId: 'lc_x',
      kind: 'lesson_slot',
      targetId: 'abc',
      amountKopecks: 12.5,
    })
    expect(ok).toBe(false)
  })
})
