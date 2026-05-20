// @vitest-environment jsdom

import { act, fireEvent, render, waitFor } from '@testing-library/react'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest'

// PAY-CP-RESCUE (2026-05-20) — RTL regression for the widget-throw
// rollback. When CloudPayments JS bundle didn't load (race or ad-blocker),
// `openCloudPaymentsWidget` throws synchronously AFTER the order has
// been created server-side. The rollback wraps the widget call in a
// nested try/catch and calls `/api/payments/<invoiceId>/cancel` so the
// order doesn't stay pending and lock the primary CTA. Three cases
// are pinned here:
//
//   1. widget-throw + cancelOrder succeeds → cancel POST fires; phase
//      returns to 'idle'; error message visible.
//   2. widget-throw + cancelOrder fails    → phase stays 'pending';
//      sidebar «Сбросить незавершённый платёж» affordance preserved.
//   3. mock-provider                       → widget call skipped
//      entirely; no rollback POST.

const pushMock = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    refresh: vi.fn(),
    back: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
}))

import { PricingSection } from '@/components/payments/pricing-section'

type FetchHandler = (
  url: string,
  init?: RequestInit,
) => Promise<Response> | Response

function mockFetch(handler: FetchHandler) {
  const spy = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    return Promise.resolve(handler(url, init))
  })
  // @ts-expect-error — vitest jsdom; replacing global.
  global.fetch = spy
  return spy as unknown as MockInstance
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const SAMPLE_ORDER = {
  invoiceId: 'lc_rollback_test_0001',
  amountRub: 3500,
  description: 'Test order',
  customerEmail: 'rollback@example.com',
  status: 'pending' as const,
  provider: 'cloudpayments' as const,
  paymentMethod: 'card' as const,
  createdAt: '2026-05-20T00:00:00Z',
  updatedAt: '2026-05-20T00:00:00Z',
}

const SAMPLE_INTENT = {
  publicId: 'pk_test',
  description: 'Test order',
  amount: 3500,
  currency: 'RUB',
  invoiceId: SAMPLE_ORDER.invoiceId,
  accountId: SAMPLE_ORDER.customerEmail,
  email: SAMPLE_ORDER.customerEmail,
  successRedirectUrl: 'https://levelchannel.ru/thank-you',
  failRedirectUrl: 'https://levelchannel.ru/pay',
}

function fillAndSubmit(container: HTMLElement) {
  const emailInput = container.querySelector(
    'input[type="email"], input[placeholder*="you@example"]',
  ) as HTMLInputElement | null
  expect(emailInput, 'email input present').not.toBeNull()
  fireEvent.change(emailInput!, {
    target: { value: 'rollback@example.com' },
  })

  // Personal-data consent checkbox — last checkbox in the form
  // (remember-card is opt-in and unchecked by default).
  const checkboxes = container.querySelectorAll(
    'input[type="checkbox"]',
  ) as NodeListOf<HTMLInputElement>
  const consentCheckbox = checkboxes[checkboxes.length - 1]
  expect(consentCheckbox, 'consent checkbox present').toBeDefined()
  fireEvent.click(consentCheckbox)

  const primaryButton = Array.from(
    container.querySelectorAll('button'),
  ).find((b) => /Перейти к оплате|Сначала завершите/.test(b.textContent || ''))
  expect(primaryButton, 'primary CTA present').toBeDefined()
  fireEvent.click(primaryButton!)
}

describe('PricingSection — widget-throw rollback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    pushMock.mockClear()
    // Force the in-process check `cloudPaymentsReady()` → false by
    // making sure window.cp is absent. This is the actual trigger for
    // openCloudPaymentsWidget to throw.
    delete (window as unknown as { cp?: unknown }).cp
  })

  afterEach(() => {
    // @ts-expect-error — vitest jsdom cleanup.
    delete global.fetch
  })

  it('cancels the order when the widget cannot open', async () => {
    let cancelFired = false
    const fetchSpy = mockFetch((url, init) => {
      if (url.includes('/api/payments/saved-card')) {
        return jsonResponse({ savedCard: null })
      }
      if (
        url.includes(`/api/payments/${SAMPLE_ORDER.invoiceId}/cancel`)
      ) {
        cancelFired = true
        expect(init?.method).toBe('POST')
        // Receipt token MUST be threaded into the cancel request via
        // the X-Receipt-Token header so the receipt-token gate accepts
        // the call. Plain query-param fallback is forbidden here per
        // Wave 6.1 #4 Phase 2.
        const headers = (init?.headers as Record<string, string>) || {}
        expect(headers['X-Receipt-Token']).toBe('plain-token-abc')
        return jsonResponse({ ok: true })
      }
      if (url === '/api/payments' || url.endsWith('/api/payments')) {
        return jsonResponse({
          order: SAMPLE_ORDER,
          checkoutIntent: SAMPLE_INTENT,
          receiptToken: 'plain-token-abc',
        })
      }
      if (url.includes(`/api/payments/${SAMPLE_ORDER.invoiceId}`)) {
        // Fallback for any background poll / fetchOrder follow-up.
        return jsonResponse({ order: SAMPLE_ORDER })
      }
      return jsonResponse({ error: 'unexpected_url' }, 500)
    })

    const { container, findByText } = render(<PricingSection />)

    await act(async () => {
      fillAndSubmit(container)
    })

    // The /api/payments POST + the /cancel POST must both fire. Use
    // waitFor because the click sequence is async (fetch + widget
    // probe + cancel).
    await waitFor(() => {
      expect(cancelFired).toBe(true)
    })

    expect(fetchSpy).toHaveBeenCalled()

    // The widget-throw error message lands in the checkout state.
    // The exact copy comes from openCloudPaymentsWidget's throw at
    // pricing-section.tsx (function-level helper) — both that copy
    // and the rollback fallback copy are acceptable here.
    await findByText(
      /Платёжная форма CloudPayments|Не удалось открыть платёжную форму/,
    )
  })

  it('preserves the «Сбросить» affordance when rollback itself fails — and it stays clickable with token', async () => {
    let cancelCallCount = 0
    let resetCallReceiptToken: string | null = null
    const fetchSpy = mockFetch((url, init) => {
      if (url.includes('/api/payments/saved-card')) {
        return jsonResponse({ savedCard: null })
      }
      if (
        url.includes(`/api/payments/${SAMPLE_ORDER.invoiceId}/cancel`)
      ) {
        cancelCallCount += 1
        if (cancelCallCount === 1) {
          // First call = the rollback inside the widget-throw catch.
          // Force it to fail so the user sees the manual-reset path.
          return jsonResponse({ error: 'cancel_failed' }, 500)
        }
        // Second call = the user clicking «Сбросить незавершённый
        // платёж». Capture the receipt token to prove the rollback
        // state preserved it (wave-paranoia round-1 BLOCKER closure).
        const headers = (init?.headers as Record<string, string>) || {}
        resetCallReceiptToken = headers['X-Receipt-Token'] ?? null
        return jsonResponse({ ok: true })
      }
      if (url === '/api/payments' || url.endsWith('/api/payments')) {
        return jsonResponse({
          order: SAMPLE_ORDER,
          checkoutIntent: SAMPLE_INTENT,
          receiptToken: 'plain-token-abc',
        })
      }
      if (url.includes(`/api/payments/${SAMPLE_ORDER.invoiceId}`)) {
        return jsonResponse({ order: SAMPLE_ORDER })
      }
      return jsonResponse({ error: 'unexpected_url' }, 500)
    })

    const { container, findByText } = render(<PricingSection />)

    await act(async () => {
      fillAndSubmit(container)
    })

    await waitFor(() => {
      const calls = fetchSpy.mock.calls.map(
        (call) => (call[0] as string) || '',
      )
      expect(
        calls.some((c) =>
          c.includes(`/api/payments/${SAMPLE_ORDER.invoiceId}/cancel`),
        ),
      ).toBe(true)
    })

    // Specific rollback-failure copy from the new catch branch.
    await findByText(/Не удалось корректно закрыть незавершённый платёж/)

    // The «Сбросить незавершённый платёж» button must render — this
    // is the BLOCKER from wave-paranoia round 1: it's the only way
    // the user gets out of the stuck-pending state.
    const resetButton = await waitFor(() => {
      const button = Array.from(
        container.querySelectorAll('button'),
      ).find((b) =>
        /Сбросить незавершённый платёж/.test(b.textContent || ''),
      )
      expect(button, '«Сбросить незавершённый платёж» button is rendered').toBeDefined()
      return button!
    })

    await act(async () => {
      fireEvent.click(resetButton)
    })

    // Critical assertion (wave-paranoia round-1 BLOCKER closure):
    // the manual-reset request MUST carry the receipt token — without
    // it the receipt-token gate returns 401 and the row stays stuck.
    await waitFor(() => {
      expect(cancelCallCount).toBe(2)
      expect(resetCallReceiptToken).toBe('plain-token-abc')
    })
  })

  it('does not roll back on the mock provider path', async () => {
    const mockOrder = { ...SAMPLE_ORDER, provider: 'mock' as const }
    let cancelFired = false
    mockFetch((url) => {
      if (url.includes('/api/payments/saved-card')) {
        return jsonResponse({ savedCard: null })
      }
      if (
        url.includes(`/api/payments/${SAMPLE_ORDER.invoiceId}/cancel`)
      ) {
        cancelFired = true
        return jsonResponse({ ok: true })
      }
      if (url === '/api/payments' || url.endsWith('/api/payments')) {
        // Mock provider returns no checkoutIntent — the client
        // branches before openCloudPaymentsWidget, so no throw and
        // no rollback.
        return jsonResponse({
          order: mockOrder,
          checkoutIntent: null,
          receiptToken: 'plain-token-abc',
        })
      }
      if (url.includes(`/api/payments/${SAMPLE_ORDER.invoiceId}`)) {
        return jsonResponse({ order: mockOrder })
      }
      return jsonResponse({ error: 'unexpected_url' }, 500)
    })

    const { container } = render(<PricingSection />)

    await act(async () => {
      fillAndSubmit(container)
    })

    // Give microtasks a chance to flush — but the cancel POST must
    // NEVER fire on the mock path.
    await new Promise((r) => setTimeout(r, 10))
    expect(cancelFired).toBe(false)
  })
})
