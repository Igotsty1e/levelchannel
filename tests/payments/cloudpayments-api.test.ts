import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  chargeWithSavedToken,
  confirmThreeDs,
} from '@/lib/payments/cloudpayments-api'

const ORIGINAL_FETCH = globalThis.fetch

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH
})

function mockFetchResponse(payload: unknown, init: { ok?: boolean; status?: number } = {}) {
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify(payload), {
      status: init.status ?? 200,
      headers: { 'content-type': 'application/json' },
    }),
  ) as unknown as typeof fetch
}

describe('chargeWithSavedToken', () => {
  const baseRequest = {
    amount: 1000,
    token: 'tk_test',
    accountId: 'user@example.com',
    invoiceId: 'lc_charge_abc12345',
    description: 'Test',
  }

  it('returns success when CloudPayments confirms the charge', async () => {
    mockFetchResponse({
      Success: true,
      Message: null,
      Model: { TransactionId: 555, Status: 'Completed' },
    })

    const result = await chargeWithSavedToken(baseRequest)
    expect(result.kind).toBe('success')
    if (result.kind === 'success') {
      expect(result.transactionId).toBe('555')
    }
  })

  it('returns requires_3ds when AcsUrl is present', async () => {
    mockFetchResponse({
      Success: false,
      Model: {
        TransactionId: 777,
        PaReq: 'pareq-abc',
        AcsUrl: 'https://bank.example.com/acs',
        ThreeDsCallbackId: 'cb-abc-123',
      },
    })

    const result = await chargeWithSavedToken(baseRequest)
    expect(result.kind).toBe('requires_3ds')
    if (result.kind === 'requires_3ds') {
      expect(result.acsUrl).toBe('https://bank.example.com/acs')
      expect(result.paReq).toBe('pareq-abc')
      expect(result.threeDsCallbackId).toBe('cb-abc-123')
    }
  })

  it('extracts Token from success response', async () => {
    mockFetchResponse({
      Success: true,
      Model: {
        TransactionId: 999,
        Token: 'tk_returned',
        CardLastFour: '4242',
        CardType: 'Visa',
        CardExpDate: '12/29',
      },
    })

    const result = await chargeWithSavedToken(baseRequest)
    if (result.kind === 'success') {
      expect(result.token).toBe('tk_returned')
      expect(result.cardLastFour).toBe('4242')
      expect(result.cardType).toBe('Visa')
      expect(result.cardExpDate).toBe('12/29')
    } else {
      throw new Error(`expected success, got ${result.kind}`)
    }
  })

  it('returns declined for explicit decline', async () => {
    mockFetchResponse({
      Success: false,
      Message: 'Card was declined',
      Model: {
        TransactionId: 888,
        ReasonCode: 5051,
        CardHolderMessage: 'Insufficient funds',
      },
    })

    const result = await chargeWithSavedToken(baseRequest)
    expect(result.kind).toBe('declined')
    if (result.kind === 'declined') {
      expect(result.reasonCode).toBe('5051')
      expect(result.message).toContain('Insufficient')
    }
  })

  it('returns error on non-2xx HTTP', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('boom', { status: 500 }),
    ) as unknown as typeof fetch
    const result = await chargeWithSavedToken(baseRequest)
    expect(result.kind).toBe('error')
    if (result.kind === 'error') {
      expect(result.message).toContain('HTTP 500')
    }
  })

  it('returns error on network failure', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('boom')
    }) as unknown as typeof fetch
    const result = await chargeWithSavedToken(baseRequest)
    expect(result.kind).toBe('error')
    if (result.kind === 'error') {
      expect(result.message).toBe('boom')
    }
  })

  it('describes success/decline/error for confirmThreeDs', async () => {
    // success
    mockFetchResponse({
      Success: true,
      Model: { TransactionId: 1, Token: 'tk_after_3ds' },
    })
    const success = await confirmThreeDs({ transactionId: '1', paRes: 'pa-res' })
    expect(success.kind).toBe('success')
    if (success.kind === 'success') {
      expect(success.token).toBe('tk_after_3ds')
    }

    // decline
    mockFetchResponse({
      Success: false,
      Message: '3DS failed',
      Model: { TransactionId: 1, ReasonCode: 5005 },
    })
    const declined = await confirmThreeDs({ transactionId: '1', paRes: 'pa-res' })
    expect(declined.kind).toBe('declined')
    if (declined.kind === 'declined') {
      expect(declined.reasonCode).toBe('5005')
    }

    // network error
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch
    const errored = await confirmThreeDs({ transactionId: '1', paRes: 'pa-res' })
    expect(errored.kind).toBe('error')
  })

  it('passes Basic Auth header with Public ID and API Secret', async () => {
    let captured: RequestInit | undefined
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      captured = init
      return new Response(
        JSON.stringify({ Success: true, Model: { TransactionId: 1 } }),
        { status: 200 },
      )
    }) as unknown as typeof fetch

    await chargeWithSavedToken(baseRequest)

    expect(captured).toBeDefined()
    const headers = captured?.headers as Record<string, string>
    expect(headers.Authorization).toMatch(/^Basic /)
    const decoded = Buffer.from(
      headers.Authorization.replace(/^Basic /, ''),
      'base64',
    ).toString('utf8')
    expect(decoded).toBe('test_public_id:test_api_secret')
  })
})
