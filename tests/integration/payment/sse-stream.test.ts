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
  return json.order.invoiceId as string
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
    const invoiceId = await createPendingOrder('paid-flow')

    const streamRes = await streamHandler(
      buildRequest(`/api/payments/${invoiceId}/stream`),
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
    const invoiceId = await createPendingOrder('terminal-fast')
    await mockConfirmHandler(
      buildRequest(`/api/payments/mock/${invoiceId}/confirm`, { body: {} }),
      { params: Promise.resolve({ invoiceId }) },
    )

    const res = await streamHandler(
      buildRequest(`/api/payments/${invoiceId}/stream`),
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
})
