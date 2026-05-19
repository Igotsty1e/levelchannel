import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createSbpQr } from '@/lib/payments/cloudpayments-api'

// SBP-PAY (2026-05-19) — hermetic test for the createSbpQr() client
// in lib/payments/cloudpayments-api.ts. Mocks `globalThis.fetch` per
// the existing cloudpayments-api.test.ts pattern. Mirrors the
// chargeWithSavedToken / refundTransaction discriminated-union
// shape.

const ORIGINAL_FETCH = globalThis.fetch

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH
})

function mockFetchResponse(
  payload: unknown,
  init: { ok?: boolean; status?: number } = {},
) {
  globalThis.fetch = vi.fn(
    async () =>
      new Response(JSON.stringify(payload), {
        status: init.status ?? 200,
        headers: { 'content-type': 'application/json' },
      }),
  ) as unknown as typeof fetch
}

const baseRequest = {
  amount: 3500,
  invoiceId: 'lc_sbptest000000001',
  accountId: 'user@example.com',
  description: 'СБП-платёж тест',
}

describe('createSbpQr', () => {
  it('returns success with transactionId + qrUrl on Success:true', async () => {
    mockFetchResponse({
      Success: true,
      Message: null,
      Model: {
        TransactionId: 999111,
        QrUrl: 'https://qr.nspk.ru/AS10001Q1234',
        Image: 'iVBORw0KGgo=',
      },
    })

    const result = await createSbpQr(baseRequest)
    expect(result.kind).toBe('success')
    if (result.kind === 'success') {
      expect(result.transactionId).toBe('999111')
      expect(result.qrUrl).toBe('https://qr.nspk.ru/AS10001Q1234')
      expect(result.image).toBe('iVBORw0KGgo=')
    }
  })

  it('classifies declined gateway response as kind:declined', async () => {
    mockFetchResponse({
      Success: false,
      Message: 'СБП-платёж отклонён банком получателя.',
      Model: {
        ReasonCode: '5051',
        CardHolderMessage: 'СБП-платёж отклонён банком получателя.',
      },
    })

    const result = await createSbpQr(baseRequest)
    expect(result.kind).toBe('declined')
    if (result.kind === 'declined') {
      expect(result.reasonCode).toBe('5051')
      expect(result.message).toContain('отклонён')
    }
  })

  it('returns kind:error on network error (fetch throws)', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('Network unreachable')
    }) as unknown as typeof fetch

    const result = await createSbpQr(baseRequest)
    expect(result.kind).toBe('error')
    if (result.kind === 'error') {
      expect(result.message).toContain('Network')
    }
  })

  it('returns kind:error on HTTP 5xx', async () => {
    mockFetchResponse({}, { status: 502 })

    const result = await createSbpQr(baseRequest)
    expect(result.kind).toBe('error')
    if (result.kind === 'error') {
      expect(result.message).toContain('HTTP 502')
    }
  })

  it('returns kind:error on malformed Success:true without TransactionId', async () => {
    // Defensive parse — Success:true with no Model.TransactionId is
    // a malformed gateway response, NOT a decline. Operator dashboard
    // is the source of truth for whether money moved; we treat as
    // error so the caller leaves the order pending for retry.
    mockFetchResponse({
      Success: true,
      Model: { QrUrl: 'https://qr.nspk.ru/AS10001Q' },
    })

    const result = await createSbpQr(baseRequest)
    expect(result.kind).toBe('error')
    if (result.kind === 'error') {
      expect(result.message).toContain('Success=true')
    }
  })

  it('returns kind:error on malformed Success:true without QrUrl', async () => {
    mockFetchResponse({
      Success: true,
      Model: { TransactionId: 1 },
    })

    const result = await createSbpQr(baseRequest)
    expect(result.kind).toBe('error')
  })

  it('sends the right wire body to the gateway', async () => {
    let captured: { url?: string; init?: RequestInit } = {}
    globalThis.fetch = vi.fn(async (input: unknown, init?: unknown) => {
      captured = {
        url: typeof input === 'string' ? input : String(input),
        init: init as RequestInit,
      }
      return new Response(
        JSON.stringify({
          Success: true,
          Model: { TransactionId: 1, QrUrl: 'https://x' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as unknown as typeof fetch

    await createSbpQr({ ...baseRequest, jsonData: '{"invoiceId":"x"}' })

    expect(captured.url).toContain(
      'api.cloudpayments.ru/payments/qr/sbp/create',
    )
    const headers = (captured.init?.headers || {}) as Record<string, string>
    expect(headers.Authorization).toMatch(/^Basic /)
    const body = JSON.parse(String(captured.init?.body))
    expect(body.Amount).toBe(3500)
    expect(body.Currency).toBe('RUB')
    expect(body.InvoiceId).toBe(baseRequest.invoiceId)
    expect(body.AccountId).toBe(baseRequest.accountId)
    expect(body.Description).toBe(baseRequest.description)
    expect(body.JsonData).toBe('{"invoiceId":"x"}')
  })
})
