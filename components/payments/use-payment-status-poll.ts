'use client'

import { useEffect } from 'react'

// SBP-PAY (2026-05-19) — receipt-token-gated status poll for the
// /api/payments/[invoiceId] endpoint.
//
// §0a BLOCKER#2 + BLOCKER#3 closures:
//   - URL = `/api/payments/[invoiceId]` (NO `/status` suffix — the
//     route at app/api/payments/[invoiceId]/route.ts is the canonical
//     status reader for both card and SBP flows).
//   - X-Receipt-Token header threaded on every fetch (route gates on
//     it via lib/payments/receipt-token-gate.ts:21-29; bare fetch =
//     401). The token is the plain value returned ONCE in the
//     create-qr response — the server only persists the SHA-256 hash.
//   - Response shape `{ order: { status, providerMessage, ... } }`
//     (nested under `order`); the hook reads `data.order.status`.
//
// Lifecycle:
//   - Polls every 3 seconds for up to 10 minutes (200 attempts).
//   - On `status='paid'` → fires `onPaid()` + clears the interval.
//   - On `status='failed'` → fires `onFailed(providerMessage)`.
//   - On `status='cancelled'` → fires `onFailed('cancelled')`.
//   - On 401 (receipt-token mismatch / state drift) → fires `onFailed`
//     with `'receipt_token_mismatch'` so the modal closes
//     deterministically.
//   - On other non-2xx → keeps polling (transient blip).
//   - On 10-minute timeout → fires `onTimeout()`; clears interval.
//
// The hook is intentionally side-effect-only (returns void). The
// modal component owns the React state for paid / failed / timeout
// transitions and the redirect to /thank-you.

export type UsePaymentStatusPollArgs = {
  invoiceId: string
  receiptToken: string
  onPaid: () => void
  onFailed: (reason?: string) => void
  onTimeout: () => void
  // Test seam: override the poll interval (default 3000ms) and the
  // hard timeout (default 600_000ms). Production callers don't pass
  // these; the unit test for the hook passes shorter values.
  intervalMs?: number
  timeoutMs?: number
}

export function usePaymentStatusPoll({
  invoiceId,
  receiptToken,
  onPaid,
  onFailed,
  onTimeout,
  intervalMs = 3000,
  timeoutMs = 600_000,
}: UsePaymentStatusPollArgs): void {
  useEffect(() => {
    if (!invoiceId || !receiptToken) {
      return
    }

    let cancelled = false

    const tick = async () => {
      if (cancelled) return
      try {
        const res = await fetch(
          `/api/payments/${encodeURIComponent(invoiceId)}`,
          {
            headers: { 'X-Receipt-Token': receiptToken },
            cache: 'no-store',
          },
        )
        if (cancelled) return
        if (!res.ok) {
          // 401 = receipt-token-mismatch (state drift / token rotated);
          // surface as onFailed so the modal closes deterministically.
          if (res.status === 401) {
            onFailed('receipt_token_mismatch')
            window.clearInterval(interval)
            window.clearTimeout(timeout)
            cancelled = true
          }
          // Other non-2xx: keep polling (transient network blip).
          return
        }
        const data = (await res.json()) as {
          order?: { status?: string; providerMessage?: string }
        }
        const status = data?.order?.status
        if (status === 'paid') {
          onPaid()
          window.clearInterval(interval)
          window.clearTimeout(timeout)
          cancelled = true
        } else if (status === 'failed') {
          onFailed(data?.order?.providerMessage)
          window.clearInterval(interval)
          window.clearTimeout(timeout)
          cancelled = true
        } else if (status === 'cancelled') {
          onFailed('cancelled')
          window.clearInterval(interval)
          window.clearTimeout(timeout)
          cancelled = true
        }
      } catch {
        // Network blip — keep polling; next tick will retry.
      }
    }

    const interval = window.setInterval(() => {
      void tick()
    }, intervalMs)
    const timeout = window.setTimeout(() => {
      if (cancelled) return
      window.clearInterval(interval)
      onTimeout()
      cancelled = true
    }, timeoutMs)

    return () => {
      cancelled = true
      window.clearInterval(interval)
      window.clearTimeout(timeout)
    }
    // We intentionally omit onPaid / onFailed / onTimeout from deps —
    // callers wrap them in useCallback at the mount boundary, and the
    // effect should re-run only when the invoice or token change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId, receiptToken, intervalMs, timeoutMs])
}
