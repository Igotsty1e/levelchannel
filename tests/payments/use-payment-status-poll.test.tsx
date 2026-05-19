// @vitest-environment jsdom

import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { usePaymentStatusPoll } from '@/components/payments/use-payment-status-poll'

// Helper: wait N real ms; the hook polls on real timers so we yield
// the event loop between ticks. The intervals/timeouts in each test
// are intentionally tiny (5-30ms) to keep the whole suite fast.
function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

// SBP-PAY (2026-05-19) — pins the hook contract per §0a BLOCKER#2 +
// BLOCKER#3 + §2.7 closures:
//   - GET /api/payments/[invoiceId] (NO /status suffix).
//   - X-Receipt-Token header on every request.
//   - Reads data.order.status (nested).
//   - Calls onPaid / onFailed / onTimeout exactly once each.
//   - 401 → onFailed('receipt_token_mismatch').

const ORIGINAL_FETCH = globalThis.fetch

function TestHarness(props: {
  invoiceId: string
  receiptToken: string
  onPaid: () => void
  onFailed: (reason?: string) => void
  onTimeout: () => void
  intervalMs?: number
  timeoutMs?: number
}) {
  usePaymentStatusPoll(props)
  return null
}

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH
  vi.restoreAllMocks()
})

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('usePaymentStatusPoll', () => {
  it('fires onPaid when /api/payments/[invoiceId] returns order.status=paid', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ order: { status: 'paid' } }),
    ) as unknown as typeof fetch
    const onPaid = vi.fn()
    const onFailed = vi.fn()
    const onTimeout = vi.fn()

    render(
      <TestHarness
        invoiceId="lc_test1"
        receiptToken="tok"
        onPaid={onPaid}
        onFailed={onFailed}
        onTimeout={onTimeout}
        intervalMs={10}
        timeoutMs={10_000}
      />,
    )

    await sleep(40)
    expect(onPaid).toHaveBeenCalledTimes(1)
    expect(onFailed).not.toHaveBeenCalled()
    expect(onTimeout).not.toHaveBeenCalled()
  })

  it('fires onFailed with providerMessage when status=failed', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({
        order: { status: 'failed', providerMessage: 'Bank declined.' },
      }),
    ) as unknown as typeof fetch
    const onFailed = vi.fn()

    render(
      <TestHarness
        invoiceId="lc_test2"
        receiptToken="tok"
        onPaid={vi.fn()}
        onFailed={onFailed}
        onTimeout={vi.fn()}
        intervalMs={10}
        timeoutMs={10_000}
      />,
    )

    await sleep(40)
    expect(onFailed).toHaveBeenCalledTimes(1)
    expect(onFailed).toHaveBeenCalledWith('Bank declined.')
  })

  it('fires onFailed("receipt_token_mismatch") on 401', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ error: 'unauthorized' }, 401),
    ) as unknown as typeof fetch
    const onFailed = vi.fn()

    render(
      <TestHarness
        invoiceId="lc_test3"
        receiptToken="bad-token"
        onPaid={vi.fn()}
        onFailed={onFailed}
        onTimeout={vi.fn()}
        intervalMs={10}
        timeoutMs={10_000}
      />,
    )

    await sleep(40)
    expect(onFailed).toHaveBeenCalledWith('receipt_token_mismatch')
  })

  it('sends X-Receipt-Token header on every poll', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ order: { status: 'pending' } }),
    )
    globalThis.fetch = fetchMock as unknown as typeof fetch

    render(
      <TestHarness
        invoiceId="lc_test4"
        receiptToken="plain-token-xyz"
        onPaid={vi.fn()}
        onFailed={vi.fn()}
        onTimeout={vi.fn()}
        intervalMs={10}
        timeoutMs={50}
      />,
    )

    await sleep(50)
    expect(fetchMock).toHaveBeenCalled()
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('/api/payments/lc_test4')
    expect((init as RequestInit | undefined)?.headers).toMatchObject({
      'X-Receipt-Token': 'plain-token-xyz',
    })
  })

  it('uses GET /api/payments/[invoiceId] WITHOUT /status suffix', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ order: { status: 'pending' } }),
    )
    globalThis.fetch = fetchMock as unknown as typeof fetch

    render(
      <TestHarness
        invoiceId="lc_test5"
        receiptToken="tok"
        onPaid={vi.fn()}
        onFailed={vi.fn()}
        onTimeout={vi.fn()}
        intervalMs={10}
        timeoutMs={50}
      />,
    )

    await sleep(40)
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toBe('/api/payments/lc_test5')
    expect(url).not.toContain('/status')
  })

  it('fires onTimeout after the timeoutMs window', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ order: { status: 'pending' } }),
    ) as unknown as typeof fetch
    const onTimeout = vi.fn()

    render(
      <TestHarness
        invoiceId="lc_test6"
        receiptToken="tok"
        onPaid={vi.fn()}
        onFailed={vi.fn()}
        onTimeout={onTimeout}
        intervalMs={20}
        timeoutMs={40}
      />,
    )

    await sleep(80)
    expect(onTimeout).toHaveBeenCalledTimes(1)
  })
})
