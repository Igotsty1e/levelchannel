import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Wave 6.1 #4 Phase 1.5 — verify createPayment mints a receipt token,
// hashes it onto the order row, and surfaces the plain token in the
// response. Phase 2 will gate the [invoiceId] routes on this; this
// test pins the foundation so a future regression doesn't quietly
// stop minting and leave Phase 2 toothless.

const createOrderMock = vi.fn().mockResolvedValue(undefined)

vi.mock('@/lib/payments/store', () => ({
  createOrder: (...a: unknown[]) => createOrderMock(...a),
}))

vi.mock('@/lib/payments/cloudpayments-api', () => ({
  chargeWithSavedToken: vi.fn(),
  confirmThreeDs: vi.fn(),
}))

vi.mock('@/lib/payments/cloudpayments', () => ({
  buildCloudPaymentsWidgetIntent: () => ({
    publicId: 'cp-public',
    invoiceId: 'lc_test123',
    amount: 1000,
    currency: 'RUB',
    description: 'test',
    accountId: 'a@b.com',
    email: 'a@b.com',
    skin: 'mini',
    requireEmail: true,
    invoiceParticulars: '',
  }),
  createCloudPaymentsOrder: (
    amountRub: number,
    customerEmail: string,
    invoiceId: string,
  ) => ({
    invoiceId,
    amountRub,
    currency: 'RUB' as const,
    description: 'test',
    provider: 'cloudpayments' as const,
    status: 'pending' as const,
    createdAt: '2026-05-08T00:00:00Z',
    updatedAt: '2026-05-08T00:00:00Z',
    customerEmail,
    receiptEmail: customerEmail,
    receipt: { items: [] },
    events: [],
  }),
}))

vi.mock('@/lib/payments/mock', () => ({
  createMockOrder: () => ({}),
}))

vi.mock('@/lib/payments/config', () => ({
  paymentConfig: { provider: 'cloudpayments' },
}))

vi.mock('@/lib/payments/status-bus', () => ({
  emitStatusChange: vi.fn(),
}))

import { createPayment } from '@/lib/payments/provider'

describe('createPayment — receipt token (Wave 6.1 Phase 1.5)', () => {
  beforeEach(() => {
    createOrderMock.mockReset()
    createOrderMock.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns a receiptToken in the response (32-byte random, base64url)', async () => {
    const result = await createPayment(1000, 'a@b.com', {
      personalDataConsent: { revisionId: 'r1', acceptedAt: '2026-05-08T00:00:00Z' },
    })

    expect(result.receiptToken).toBeTruthy()
    expect(typeof result.receiptToken).toBe('string')
    // base64url of 32 bytes is 43 chars (no padding).
    expect(result.receiptToken.length).toBeGreaterThanOrEqual(40)
    // base64url alphabet only — no `+`, `/`, or `=`.
    expect(result.receiptToken).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('persists sha256(receiptToken) as receipt_token_hash on the order row', async () => {
    const result = await createPayment(1000, 'a@b.com', {
      personalDataConsent: { revisionId: 'r1', acceptedAt: '2026-05-08T00:00:00Z' },
    })

    expect(createOrderMock).toHaveBeenCalledTimes(1)
    const persisted = createOrderMock.mock.calls[0][0]
    expect(persisted.receiptTokenHash).toBeTruthy()
    // sha256 hex is 64 chars.
    expect(persisted.receiptTokenHash).toMatch(/^[a-f0-9]{64}$/)
    // Plain token is NOT persisted.
    expect(persisted.receiptToken).toBeUndefined()
    // Plain token is NOT equal to the hash (sanity).
    expect(persisted.receiptTokenHash).not.toBe(result.receiptToken)
  })

  it('mints a fresh token per call (not reused across orders)', async () => {
    const a = await createPayment(1000, 'a@b.com', {
      personalDataConsent: { revisionId: 'r1', acceptedAt: '2026-05-08T00:00:00Z' },
    })
    const b = await createPayment(1500, 'a@b.com', {
      personalDataConsent: { revisionId: 'r1', acceptedAt: '2026-05-08T00:00:00Z' },
    })

    expect(a.receiptToken).not.toBe(b.receiptToken)
    const persistedA = createOrderMock.mock.calls[0][0]
    const persistedB = createOrderMock.mock.calls[1][0]
    expect(persistedA.receiptTokenHash).not.toBe(persistedB.receiptTokenHash)
  })

  it('does NOT leak the plain token in the order body returned to the caller', async () => {
    const result = await createPayment(1000, 'a@b.com', {
      personalDataConsent: { revisionId: 'r1', acceptedAt: '2026-05-08T00:00:00Z' },
    })

    // The plain token belongs in `result.receiptToken`, not on the
    // public order shape (which is the persisted-data view + serialized
    // to clients on read endpoints). receiptTokenHash is also stripped
    // from the public order — Pick<...> in PublicPaymentOrder excludes
    // both the hash and the plain token.
    expect((result.order as Record<string, unknown>).receiptToken).toBeUndefined()
    expect((result.order as Record<string, unknown>).receiptTokenHash).toBeUndefined()
  })
})
