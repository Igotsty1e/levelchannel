import { describe, expect, it } from 'vitest'

import { POST as createHandler } from '@/app/api/payments/route'
import { POST as mockConfirmHandler } from '@/app/api/payments/mock/[invoiceId]/confirm/route'
import { GET as streamHandler } from '@/app/api/payments/[invoiceId]/stream/route'

import { buildRequest } from '../helpers'
import './setup'

// End-to-end SSE smoke. Single Postgres + the in-process status bus.
//
// What we cover:
//   1) initial state event fires on connection
//   2) markOrderPaid (via mock-confirm route handler) reaches the open
//      stream as a `status` event with status='paid'
//   3) the stream closes on terminal status (no further reads)
//
// Not covered here (out of scope for this suite):
//   - multi-instance pub/sub (ships when we move past one app process)
//   - heartbeat cadence (we do not exercise the 25-second timer in
//     unit time)

async function readSseUntilTerminal(
  body: ReadableStream<Uint8Array>,
  maxMs = 5_000,
): Promise<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    if (buf.includes('"status":"paid"')) {
      try {
        await reader.cancel()
      } catch {
        // already closed
      }
      break
    }
  }
  return buf
}

async function createPendingOrder(invoiceTag: string) {
  const res = await createHandler(
    buildRequest('/api/payments', {
      body: {
        amountRub: 1500,
        customerEmail: `sse-${invoiceTag}@example.com`,
        personalDataConsentAccepted: true,
      },
    }),
  )
  expect(res.status).toBe(200)
  const json = await res.json()
  // Wave 6.1 Phase 2 — return token alongside id; SSE route gates on
  // it via `?token=` query param (EventSource cannot set headers).
  return {
    invoiceId: json.order.invoiceId as string,
    receiptToken: json.receiptToken as string,
  }
}

describe('GET /api/payments/[invoiceId]/stream', () => {
  it('returns 400 on malformed invoiceId', async () => {
    const res = await streamHandler(
      buildRequest('/api/payments/not-an-invoice/stream'),
      { params: Promise.resolve({ invoiceId: 'not-an-invoice' }) },
    )
    expect(res.status).toBe(400)
  })

  it('returns 404 on unknown invoiceId', async () => {
    const res = await streamHandler(
      buildRequest('/api/payments/lc_unknownunknownunknown/stream'),
      {
        params: Promise.resolve({ invoiceId: 'lc_unknownunknownunknown' }),
      },
    )
    expect(res.status).toBe(404)
  })

  it('streams initial state and a paid update from markOrderPaid', async () => {
    const { invoiceId, receiptToken } = await createPendingOrder('paid-flow')

    const streamRes = await streamHandler(
      buildRequest(`/api/payments/${invoiceId}/stream`, {
        searchParams: { token: receiptToken },
      }),
      { params: Promise.resolve({ invoiceId }) },
    )
    expect(streamRes.status).toBe(200)
    expect(streamRes.headers.get('content-type')).toContain('text/event-stream')

    // Kick off the consumer; it'll wait until "status":"paid" appears
    // in the framed body OR the deadline elapses.
    const collected = readSseUntilTerminal(streamRes.body!, 5_000)

    // Brief delay to ensure the SSE handler has subscribed before we
    // mutate the row (the bus emit only reaches subscribers attached
    // at emit time).
    await new Promise((r) => setTimeout(r, 50))

    const confirmRes = await mockConfirmHandler(
      buildRequest(`/api/payments/mock/${invoiceId}/confirm`, {
        body: {},
      }),
      { params: Promise.resolve({ invoiceId }) },
    )
    expect(confirmRes.status).toBe(200)

    const buf = await collected
    expect(buf).toContain('event: status')
    // Initial state pending, then paid push:
    expect(buf).toMatch(/"status":"pending"[\s\S]*"status":"paid"/)
  })

  it('closes immediately when the order is already terminal', async () => {
    const { invoiceId, receiptToken } = await createPendingOrder('terminal-fast')
    await mockConfirmHandler(
      buildRequest(`/api/payments/mock/${invoiceId}/confirm`, { body: {} }),
      { params: Promise.resolve({ invoiceId }) },
    )

    const res = await streamHandler(
      buildRequest(`/api/payments/${invoiceId}/stream`, {
        searchParams: { token: receiptToken },
      }),
      { params: Promise.resolve({ invoiceId }) },
    )
    expect(res.status).toBe(200)

    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    // The stream should send the terminal initial event then close;
    // a single read is enough.
    const { value, done } = await reader.read()
    if (value) buf += decoder.decode(value, { stream: true })
    expect(buf).toContain('"status":"paid"')

    // Subsequent read returns done=true (stream closed).
    if (!done) {
      const next = await reader.read()
      expect(next.done).toBe(true)
    }
  })

  // Wave 21 — receipt-token gate negative cases (Codex Wave 13 Pass 3 #6).
  // The stream MUST refuse missing/wrong/cross-invoice tokens with 401
  // and not stream order state. Receipt token is the capability for
  // reading payment status; without these tests a future regression
  // could open the stream to anyone who guesses an invoice id.

  // Codex Wave 21 review feedback. Asserting only `status === 401` is
  // too weak for "and not stream order state": a regression could
  // return 401 with order JSON in the body. Pin three things on every
  // negative case: status, content-type is NOT event-stream, and the
  // body does NOT contain status/invoiceId fields from the order row.
  async function assertRejectedStream(res: Response): Promise<void> {
    expect(res.status).toBe(401)
    expect(res.headers.get('content-type') ?? '').not.toContain(
      'text/event-stream',
    )
    const body = await res.text()
    expect(body).not.toContain('"status":"pending"')
    expect(body).not.toContain('"status":"paid"')
    expect(body).not.toContain('lc_')
  }

  it('refuses 401 on missing token', async () => {
    const { invoiceId } = await createPendingOrder('no-token')
    const res = await streamHandler(
      buildRequest(`/api/payments/${invoiceId}/stream`),
      { params: Promise.resolve({ invoiceId }) },
    )
    await assertRejectedStream(res)
  })

  it('refuses 401 on wrong token', async () => {
    const { invoiceId } = await createPendingOrder('bad-token')
    const res = await streamHandler(
      buildRequest(`/api/payments/${invoiceId}/stream`, {
        searchParams: { token: 'definitely-not-the-real-token' },
      }),
      { params: Promise.resolve({ invoiceId }) },
    )
    await assertRejectedStream(res)
  })

  it('refuses 401 when the token belongs to a DIFFERENT invoice', async () => {
    const a = await createPendingOrder('cross-a')
    const b = await createPendingOrder('cross-b')
    const res = await streamHandler(
      buildRequest(`/api/payments/${a.invoiceId}/stream`, {
        // Use B's token against A's invoice — must reject.
        searchParams: { token: b.receiptToken },
      }),
      { params: Promise.resolve({ invoiceId: a.invoiceId }) },
    )
    await assertRejectedStream(res)
  })
})
