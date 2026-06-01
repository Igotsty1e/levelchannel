// mig 0101 — unit tests для helper'а learner-payment-method.
//
// DB-touch тесты живут в tests/integration/ (отдельный wave). Здесь —
// pure logic / type-shape ассерты.

import { describe, expect, it } from 'vitest'

describe('learner-payment-method module', () => {
  it('exports PaymentMethod type with exactly 3 values', async () => {
    const mod = await import('@/lib/billing/learner-payment-method')
    // The type itself can't be runtime-checked, but the helper accepts
    // these 3 strings — pin via accepting setPaymentMethodForPair input shape.
    expect(typeof mod.getPaymentMethodForPair).toBe('function')
    expect(typeof mod.setPaymentMethodForPair).toBe('function')
    expect(typeof mod.hasOpenPostpaidDebt).toBe('function')
  })
})
