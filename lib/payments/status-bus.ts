import { EventEmitter } from 'node:events'

import type { PublicPaymentOrder } from '@/lib/payments/types'

// In-process pub/sub for payment status transitions. The SSE endpoint
// at /api/payments/[invoiceId]/stream subscribes here and pushes the
// new status to the open browser tab as soon as a webhook handler /
// 3DS callback / one-click route mutates the order.
//
// Why in-process and not Redis or PG LISTEN/NOTIFY:
//   - Single-instance app today; cross-instance pub/sub is unused.
//   - The SSE endpoint reads the FRESH status from the DB at first
//     event regardless of whether the bus message was delivered, so
//     "missed event because the listener was on instance B and the
//     webhook landed on instance A" is recoverable: the client also
//     keeps the existing 4-second poll as a fallback. Bus is the
//     accelerator, DB is the source of truth.
//   - When we go multi-instance, swap this for a PG LISTEN/NOTIFY
//     wrapper with the same `subscribe`/`emit` API and nothing else
//     changes.
//
// Channel design:
//   - one event name per `invoiceId` ("status:lc_xxx") — keeps each
//     subscriber's listener count at 1, no per-event filtering on hot
//     paths.
//   - global EventEmitter has unlimited listeners (we set
//     `setMaxListeners(0)` so a 30-tab abuse case doesn't print Node's
//     "memory leak" warning).
//
// Lifecycle expectations:
//   - subscribers MUST call the returned unsubscribe before the SSE
//     connection terminates; the route handler attaches it to
//     `request.signal` for guaranteed cleanup on client disconnect.
//   - emit calls are fire-and-forget. A listener throwing does NOT
//     bubble — Node's `emit` swallows listener exceptions when there
//     is no `error` handler attached, but to be safe each listener
//     wraps its body in try/catch.

declare global {
  // eslint-disable-next-line no-var
  var __levelchannelStatusBus: EventEmitter | undefined
}

function getBus(): EventEmitter {
  if (!global.__levelchannelStatusBus) {
    const bus = new EventEmitter()
    bus.setMaxListeners(0)
    global.__levelchannelStatusBus = bus
  }
  return global.__levelchannelStatusBus
}

export type StatusUpdate = {
  invoiceId: string
  status: PublicPaymentOrder['status']
  order: PublicPaymentOrder
}

function channel(invoiceId: string): string {
  return `status:${invoiceId}`
}

export function subscribeToStatus(
  invoiceId: string,
  listener: (update: StatusUpdate) => void,
): () => void {
  const bus = getBus()
  const ch = channel(invoiceId)
  const wrapped = (update: StatusUpdate) => {
    try {
      listener(update)
    } catch (err) {
      console.warn('[status-bus] listener threw:', {
        invoiceId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  bus.on(ch, wrapped)
  return () => bus.off(ch, wrapped)
}

export function emitStatusChange(update: StatusUpdate): void {
  const bus = getBus()
  bus.emit(channel(update.invoiceId), update)
}

// Test-only: nuke all listeners between tests so subscriptions don't
// leak across cases.
export function __resetStatusBusForTesting(): void {
  global.__levelchannelStatusBus?.removeAllListeners()
}
