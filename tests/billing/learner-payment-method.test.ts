// mig 0101 — unit tests для helper'а learner-payment-method.
//
// DB-touch тесты живут в tests/integration/ (отдельный wave). Здесь —
// pure logic / type-shape ассерты.

import { describe, expect, it } from 'vitest'

describe('learner-payment-method module', () => {
  it('exports the current pair-payment helpers', async () => {
    const mod = await import('@/lib/billing/learner-payment-method')
    expect(typeof mod.getPaymentMethodForPair).toBe('function')
    expect(typeof mod.setPaymentMethodForPair).toBe('function')
  })
})
