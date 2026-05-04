import { getPublicPayment } from '@/lib/payments/provider'
import { subscribeToStatus } from '@/lib/payments/status-bus'
import {
  enforceRateLimit,
  isValidInvoiceId,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// SSE endpoint for live payment status. Replaces the 4-second polling
// loop in components/payments/pricing-section.tsx with a server push.
//
// Contract:
//   - GET /api/payments/<invoiceId>/stream
//   - Initial event: `event: status\ndata: <PublicPaymentOrder JSON>\n\n`
//     reflects the current DB state, fired immediately. If already
//     terminal, the connection closes right after.
//   - On every status mutation routed through markOrderPaid /
//     markOrderFailed / markOrderCancelled, an emit on the in-process
//     status-bus produces a `status` event for this invoiceId.
//   - Heartbeat comment (`:hb\n\n`) every 25 seconds so nginx / network
//     idle timers don't close the connection.
//   - Hard cap: 5 minutes per connection (longer than 3DS dance + a
//     buffer; clients reconnect via EventSource auto-retry).
//   - When the order reaches a terminal status, the stream closes
//     after sending the final event (clean shutdown — client gets
//     EventSource `error` and won't reconnect because terminal status
//     is already in hand).
//
// Authz: identical to GET /api/payments/<invoiceId> — anyone holding
// the (randomized 18-hex) invoiceId can read the status. The SSE
// endpoint enforces the same boundary, no stronger.
//
// Multi-instance future: swap subscribeToStatus for a PG LISTEN/NOTIFY
// or Redis-backed wrapper without touching the route shape.

const HEARTBEAT_INTERVAL_MS = 25_000
const MAX_CONNECTION_MS = 5 * 60_000
const TERMINAL_STATUSES = new Set<string>(['paid', 'failed', 'cancelled'])

function sseFrame(eventName: string, data: string): string {
  return `event: ${eventName}\ndata: ${data}\n\n`
}

type RouteParams = { params: Promise<{ invoiceId: string }> }

export async function GET(request: Request, { params }: RouteParams) {
  const { invoiceId } = await params

  if (!isValidInvoiceId(invoiceId)) {
    return new Response(JSON.stringify({ error: 'Invalid payment id.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const rateLimited = await enforceRateLimit(
    request,
    'payments:stream',
    20,
    60_000,
  )
  if (rateLimited) return rateLimited

  const initial = await getPublicPayment(invoiceId)
  if (!initial) {
    return new Response(JSON.stringify({ error: 'Payment not found.' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      let unsubscribe: (() => void) | null = null
      let heartbeat: ReturnType<typeof setInterval> | null = null
      let hardCap: ReturnType<typeof setTimeout> | null = null

      const safeEnqueue = (chunk: string): boolean => {
        if (closed) return false
        try {
          controller.enqueue(encoder.encode(chunk))
          return true
        } catch {
          // Controller closed mid-enqueue; treat as terminal.
          closed = true
          return false
        }
      }

      const cleanup = () => {
        if (closed) return
        closed = true
        if (unsubscribe) unsubscribe()
        if (heartbeat) clearInterval(heartbeat)
        if (hardCap) clearTimeout(hardCap)
        try {
          controller.close()
        } catch {
          // already closed
        }
      }

      // 1) Initial state. If terminal, send and close.
      safeEnqueue(sseFrame('status', JSON.stringify({ order: initial })))
      if (TERMINAL_STATUSES.has(initial.status)) {
        cleanup()
        return
      }

      // 2) Subscribe to bus for future transitions.
      unsubscribe = subscribeToStatus(invoiceId, (update) => {
        if (closed) return
        const ok = safeEnqueue(
          sseFrame('status', JSON.stringify({ order: update.order })),
        )
        if (ok && TERMINAL_STATUSES.has(update.status)) {
          cleanup()
        }
      })

      // 3) Heartbeat keeps idle proxies from closing the connection.
      heartbeat = setInterval(() => {
        if (closed) return
        // SSE comment line — clients ignore it, but the bytes flush
        // through any keep-alive idle timer on the path.
        safeEnqueue(`:hb ${Date.now()}\n\n`)
      }, HEARTBEAT_INTERVAL_MS)

      // 4) Hard cap. EventSource on the client will auto-reconnect
      // and pick up the current DB status as the new initial event.
      hardCap = setTimeout(() => {
        cleanup()
      }, MAX_CONNECTION_MS)

      // 5) Client disconnect — release the bus listener immediately.
      const signal = request.signal
      if (signal.aborted) {
        cleanup()
      } else {
        signal.addEventListener('abort', cleanup, { once: true })
      }
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      // Tells nginx (and similar proxies) NOT to buffer this response,
      // so each event byte hits the client immediately.
      'X-Accel-Buffering': 'no',
    },
  })
}
