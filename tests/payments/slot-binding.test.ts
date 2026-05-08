import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Codex 2026-05-08 (HIGH) — slot binding gate on POST /api/payments.
// Tests cover the four reject paths (not_found / not_owner /
// not_in_payable_state / tariff_mismatch) plus the happy-path tariff-
// matched and tariff-absent (legacy) cases.

const queryMock = vi.fn()
const getDbPoolMock = vi.fn(() => ({ query: queryMock }))

vi.mock('@/lib/db/pool', () => ({
  getDbPool: () => getDbPoolMock(),
}))

import { validatePaymentSlotBinding } from '@/lib/payments/slot-binding'

const SLOT_ID = '11111111-1111-1111-1111-111111111111'
const LEARNER_ID = '22222222-2222-2222-2222-222222222222'
const OTHER_LEARNER = '33333333-3333-3333-3333-333333333333'

describe('validatePaymentSlotBinding', () => {
  beforeEach(() => {
    queryMock.mockReset()
  })

  afterEach(() => vi.restoreAllMocks())

  it('rejects not_found when no slot row exists', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] })
    const result = await validatePaymentSlotBinding({
      slotId: SLOT_ID,
      learnerAccountId: LEARNER_ID,
      amountRub: 1000,
    })
    expect(result).toEqual({ ok: false, reason: 'not_found' })
  })

  it('rejects not_owner when slot is booked by a different learner', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          learner_account_id: OTHER_LEARNER,
          status: 'booked',
          tariff_id: 't1',
          tariff_amount_kopecks: 100000,
        },
      ],
    })
    const result = await validatePaymentSlotBinding({
      slotId: SLOT_ID,
      learnerAccountId: LEARNER_ID,
      amountRub: 1000,
    })
    expect(result).toEqual({ ok: false, reason: 'not_owner' })
  })

  it('rejects not_owner when slot has no learner (open slot, not yet booked)', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          learner_account_id: null,
          status: 'open',
          tariff_id: 't1',
          tariff_amount_kopecks: 100000,
        },
      ],
    })
    const result = await validatePaymentSlotBinding({
      slotId: SLOT_ID,
      learnerAccountId: LEARNER_ID,
      amountRub: 1000,
    })
    expect(result).toEqual(
      expect.objectContaining({ ok: false, reason: 'not_owner' }),
    )
  })

  it('rejects not_in_payable_state for cancelled slot owned by learner', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          learner_account_id: LEARNER_ID,
          status: 'cancelled',
          tariff_id: 't1',
          tariff_amount_kopecks: 100000,
        },
      ],
    })
    const result = await validatePaymentSlotBinding({
      slotId: SLOT_ID,
      learnerAccountId: LEARNER_ID,
      amountRub: 1000,
    })
    expect(result).toEqual(
      expect.objectContaining({ ok: false, reason: 'not_in_payable_state' }),
    )
  })

  it('rejects tariff_mismatch when amount differs from bound tariff', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          learner_account_id: LEARNER_ID,
          status: 'booked',
          tariff_id: 't1',
          tariff_amount_kopecks: 100000, // 1000.00 ₽
        },
      ],
    })
    const result = await validatePaymentSlotBinding({
      slotId: SLOT_ID,
      learnerAccountId: LEARNER_ID,
      amountRub: 1, // 1 ₽ → 100 kopecks → drift = 99900
    })
    expect(result).toEqual(
      expect.objectContaining({ ok: false, reason: 'tariff_mismatch' }),
    )
  })

  it('accepts when amount matches the bound tariff exactly', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          learner_account_id: LEARNER_ID,
          status: 'booked',
          tariff_id: 't1',
          tariff_amount_kopecks: 250000, // 2500 ₽
        },
      ],
    })
    const result = await validatePaymentSlotBinding({
      slotId: SLOT_ID,
      learnerAccountId: LEARNER_ID,
      amountRub: 2500,
    })
    expect(result).toEqual({ ok: true, tariffAmountKopecks: 250000 })
  })

  it('accepts within 1-kopeck rounding tolerance', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          learner_account_id: LEARNER_ID,
          status: 'booked',
          tariff_id: 't1',
          tariff_amount_kopecks: 250001, // 2500.01 ₽
        },
      ],
    })
    // amountRub 2500 → 250000 kopecks → drift = 1 → within tolerance.
    const result = await validatePaymentSlotBinding({
      slotId: SLOT_ID,
      learnerAccountId: LEARNER_ID,
      amountRub: 2500,
    })
    expect(result.ok).toBe(true)
  })

  it('accepts a slot with no tariff binding (operator chose ad-hoc pricing)', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          learner_account_id: LEARNER_ID,
          status: 'booked',
          tariff_id: null,
          tariff_amount_kopecks: null,
        },
      ],
    })
    const result = await validatePaymentSlotBinding({
      slotId: SLOT_ID,
      learnerAccountId: LEARNER_ID,
      amountRub: 1234,
    })
    expect(result).toEqual({ ok: true, tariffAmountKopecks: null })
  })
})
