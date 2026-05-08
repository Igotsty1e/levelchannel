import { timingSafeEqual } from 'crypto'

import { hashToken } from '@/lib/auth/tokens'
import type { PaymentOrder } from '@/lib/payments/types'

// Wave 6.1 #4 Phase 2 — gate the [invoiceId] routes (GET, cancel,
// stream) on a server-issued receipt_token.
//
// Threat model recap:
//
//   Pre-wave: anyone who learned an invoiceId could read order
//   status, open an SSE stream, and cancel a pending order. invoiceId
//   was an accidental capability-secret. Phase 1 added the schema
//   column; Phase 1.5 minted + returned the plain token from
//   POST /api/payments. Phase 2 (here) enforces it.
//
// Token transport:
//   - `?token=<plain>` query param (used by SSE EventSource which
//     does not let JS set custom headers, and by the redirect to
//     /thank-you)
//   - `X-Receipt-Token: <plain>` header (preferred for fetch /
//     POST cancel — keeps tokens out of access logs)
//
//   When both are present, the header wins. Both being absent is the
//   "no token" path, gated by `evaluateGrace` below.
//
// Grace policy:
//
//   Pre-Phase-1.5 orders have `receipt_token_hash = NULL`. Their
//   creators never received a token. We must not break their
//   in-flight thank-you / cancel UX. So:
//
//     - NULL hash + order < 24h old → ALLOW (legacy grace window).
//     - NULL hash + order ≥ 24h old → DENY (legacy grace expired).
//     - Hash present + token missing → DENY immediately (every
//       new order has a token; missing it is a UI bug or a probe).
//     - Hash present + token present + mismatch → DENY.
//     - Hash present + token present + match → ALLOW.
//
//   The 24h legacy grace lets in-flight orders from before the
//   Phase 1.5 deploy complete normally; once that window closes,
//   all routes require a real token. After Phase 3 (≥7 days
//   confidence after Phase 2), the legacy grace can be reduced to
//   minutes or removed entirely.
//
// Constant-time compare:
//
//   hashToken returns a 64-char hex sha256. We compare hex-string
//   buffers of equal length — `timingSafeEqual` does the rest. A
//   length mismatch is never a real-world condition (sha256 hex is
//   always 64 chars), but be defensive.

export type ReceiptGateVerdict =
  | { ok: true; reason: 'token_match' | 'legacy_grace' }
  | {
      ok: false
      reason:
        | 'token_required'
        | 'token_mismatch'
        | 'legacy_grace_expired'
    }

const LEGACY_GRACE_MS = 24 * 60 * 60 * 1000

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
  order: Pick<PaymentOrder, 'createdAt' | 'receiptTokenHash'>,
  presentedToken: string | null,
  nowMs: number = Date.now(),
): ReceiptGateVerdict {
  const storedHash = order.receiptTokenHash ?? null

  // Legacy row (pre-Phase-1.5): hash never minted. Allow for the
  // 24h grace window after creation, then close.
  if (!storedHash) {
    const createdMs = new Date(order.createdAt).getTime()
    if (Number.isNaN(createdMs)) {
      // Defensive: refuse rather than treat as fresh.
      return { ok: false, reason: 'legacy_grace_expired' }
    }
    const ageMs = nowMs - createdMs
    if (ageMs <= LEGACY_GRACE_MS) {
      return { ok: true, reason: 'legacy_grace' }
    }
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
