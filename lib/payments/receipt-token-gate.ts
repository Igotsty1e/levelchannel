import { timingSafeEqual } from 'crypto'

import { hashToken } from '@/lib/auth/tokens'
import type { PaymentOrder } from '@/lib/payments/types'

// Wave 6.1 #4 — gate the [invoiceId] routes (GET, cancel, stream) on
// a server-issued receipt_token.
//
// Threat model recap:
//
//   Pre-wave: anyone who learned an invoiceId could read order
//   status, open an SSE stream, and cancel a pending order. invoiceId
//   was an accidental capability-secret. Phase 1 added the schema
//   column; Phase 1.5 minted + returned the plain token from
//   POST /api/payments. Phase 2 enforced it with a 24h legacy grace
//   for pre-Phase-1.5 NULL-hash rows. Phase 3 (here, 2026-05-14)
//   drops the grace: pre-wave orders are now unreachable via these
//   routes — operators still have audit-log access, customers
//   already received their receipt email.
//
// Token transport:
//   - `?token=<plain>` query param (used by SSE EventSource which
//     does not let JS set custom headers, and by the redirect to
//     /thank-you)
//   - `X-Receipt-Token: <plain>` header (preferred for fetch /
//     POST cancel — keeps tokens out of access logs)
//
//   When both are present, the header wins.
//
// Policy (post Phase 3):
//
//     - NULL hash (pre-wave row) → DENY unconditionally.
//     - Hash present + token missing → DENY (every new order has
//       a token; missing it is a UI bug or a probe).
//     - Hash present + token present + mismatch → DENY.
//     - Hash present + token present + match → ALLOW.
//
// Constant-time compare:
//
//   hashToken returns a 64-char hex sha256. We compare hex-string
//   buffers of equal length — `timingSafeEqual` does the rest. A
//   length mismatch is never a real-world condition (sha256 hex is
//   always 64 chars), but be defensive.

export type ReceiptGateVerdict =
  | { ok: true; reason: 'token_match' }
  | {
      ok: false
      reason:
        | 'token_required'
        | 'token_mismatch'
        | 'legacy_grace_expired'
    }

export function extractReceiptToken(request: Request): string | null {
  const header = request.headers.get('x-receipt-token')
  if (header && header.trim().length > 0) {
    return header.trim()
  }
  try {
    const url = new URL(request.url)
    const param = url.searchParams.get('token')
    if (param && param.trim().length > 0) {
      return param.trim()
    }
  } catch {
    // Non-absolute or malformed URL — rare in Next.js routes; fall
    // through to "no token".
  }
  return null
}

export function evaluateReceiptGate(
  order: Pick<PaymentOrder, 'receiptTokenHash'>,
  presentedToken: string | null,
): ReceiptGateVerdict {
  const storedHash = order.receiptTokenHash ?? null

  // Legacy row (pre-Phase-1.5): hash never minted. Phase 3 drops
  // the 24h grace — pre-wave orders are unreachable via these
  // routes from now on.
  if (!storedHash) {
    return { ok: false, reason: 'legacy_grace_expired' }
  }

  // Hash present: require a matching token.
  if (!presentedToken) {
    return { ok: false, reason: 'token_required' }
  }

  const incomingHash = hashToken(presentedToken)
  if (incomingHash.length !== storedHash.length) {
    return { ok: false, reason: 'token_mismatch' }
  }

  const a = Buffer.from(incomingHash, 'utf8')
  const b = Buffer.from(storedHash, 'utf8')
  if (!timingSafeEqual(a, b)) {
    return { ok: false, reason: 'token_mismatch' }
  }
  return { ok: true, reason: 'token_match' }
}
