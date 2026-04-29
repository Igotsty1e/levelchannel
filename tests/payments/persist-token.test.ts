import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CloudPaymentsWebhookPayload } from '@/lib/payments/cloudpayments-webhook'
import type { PaymentOrder, SavedCardToken } from '@/lib/payments/types'

const upsertCardTokenMock = vi.fn<(token: SavedCardToken) => Promise<SavedCardToken>>()

vi.mock('@/lib/payments/store', async () => {
  return {
    listOrders: vi.fn(),
    getOrder: vi.fn(),
    createOrder: vi.fn(),
    updateOrder: vi.fn(),
    getCardTokenByEmail: vi.fn(),
    upsertCardToken: (token: SavedCardToken) => upsertCardTokenMock(token),
    touchCardTokenUsedAt: vi.fn(),
    deleteCardToken: vi.fn(),
  }
})

const { maybePersistTokenFromWebhook } = await import('@/lib/payments/tokens')

function buildOrder(rememberCard: boolean | undefined): PaymentOrder {
  return {
    invoiceId: 'lc_test_persist1234',
    amountRub: 100,
    currency: 'RUB',
    description: 'test',
    provider: 'cloudpayments',
    status: 'paid',
    createdAt: '2026-04-29T00:00:00.000Z',
    updatedAt: '2026-04-29T00:00:00.000Z',
    customerEmail: 'user@example.com',
    receiptEmail: 'user@example.com',
    receipt: {
      items: [],
      email: 'user@example.com',
      isBso: false,
      amounts: { electronic: 100, advancePayment: 0, credit: 0, provision: 0 },
    },
    metadata:
      rememberCard === undefined ? undefined : { rememberCard, source: 'widget' },
    events: [],
  }
}

beforeEach(() => {
  upsertCardTokenMock.mockReset()
  upsertCardTokenMock.mockImplementation(async (t) => t)
})

describe('maybePersistTokenFromWebhook', () => {
  it('stores the token when user opted in via order metadata', async () => {
    const payload: CloudPaymentsWebhookPayload = {
      Token: 'tk_alpha',
      CardLastFour: '4242',
      CardType: 'Visa',
      CardExpDate: '12/29',
    }

    const result = await maybePersistTokenFromWebhook(
      payload,
      'user@example.com',
      buildOrder(true),
    )

    expect(upsertCardTokenMock).toHaveBeenCalledOnce()
    expect(result?.token).toBe('tk_alpha')
    expect(result?.cardLastFour).toBe('4242')
  })

  it('skips when user did not opt in', async () => {
    const payload: CloudPaymentsWebhookPayload = { Token: 'tk_alpha' }
    const result = await maybePersistTokenFromWebhook(
      payload,
      'user@example.com',
      buildOrder(false),
    )

    expect(upsertCardTokenMock).not.toHaveBeenCalled()
    expect(result).toBeNull()
  })

  it('skips when payload has no Token even with consent', async () => {
    const result = await maybePersistTokenFromWebhook(
      {},
      'user@example.com',
      buildOrder(true),
    )

    expect(upsertCardTokenMock).not.toHaveBeenCalled()
    expect(result).toBeNull()
  })

  it('falls back to webhook Data field when order has no metadata consent', async () => {
    const payload: CloudPaymentsWebhookPayload = {
      Token: 'tk_alpha',
      Data: '{"rememberCard":true}',
    }
    const result = await maybePersistTokenFromWebhook(
      payload,
      'user@example.com',
      buildOrder(undefined),
    )

    expect(upsertCardTokenMock).toHaveBeenCalledOnce()
    expect(result?.token).toBe('tk_alpha')
  })

  it('does not persist when consent is false even if Token is present', async () => {
    const payload: CloudPaymentsWebhookPayload = {
      Token: 'tk_alpha',
      Data: '{"rememberCard":false}',
    }
    const result = await maybePersistTokenFromWebhook(
      payload,
      'user@example.com',
      null,
    )

    expect(upsertCardTokenMock).not.toHaveBeenCalled()
    expect(result).toBeNull()
  })
})
