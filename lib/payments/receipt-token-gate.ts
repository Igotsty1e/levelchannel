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
  | { ok: true; reason: 'token_match' | 'session_match' }
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
  order: Pick<PaymentOrder, 'receiptTokenHash' | 'metadata'>,
  presentedToken: string | null,
  options: { sessionAccountId?: string | null } = {},
): ReceiptGateVerdict {
  const storedHash = order.receiptTokenHash ?? null

  // Legacy row (pre-Phase-1.5): hash never minted. Phase 3 drops
  // the 24h grace — pre-wave orders are unreachable via these
  // routes from now on. Session fallback does NOT bypass this:
  // pre-Phase-1.5 orders intentionally have no auth proof beyond
  // the hash that was never minted.
  if (!storedHash) {
    return { ok: false, reason: 'legacy_grace_expired' }
  }

  // Token-first path. A valid token wins over any session check —
  // this preserves the token-only invariant for callers who haven't
  // adopted session-fallback (e.g. anonymous /thank-you polls).
  if (presentedToken) {
    const incomingHash = hashToken(presentedToken)
    if (incomingHash.length === storedHash.length) {
      const a = Buffer.from(incomingHash, 'utf8')
      const b = Buffer.from(storedHash, 'utf8')
      if (timingSafeEqual(a, b)) {
        return { ok: true, reason: 'token_match' }
      }
    }
    // Token presented but didn't match — fall through to session
    // check (the holder may have BOTH a token AND a session; the
    // session is the redundancy).
  }

  // RECEIPT-3DS-TOKEN session fallback (2026-05-16).
  // The 3DS-callback server-side redirect to /thank-you cannot
  // carry the plain receipt token (it was returned ONCE at
  // order-init time and only the hash is stored). For
  // authenticated saved-card buyers, accept the session when its
  // account.id matches order.metadata.accountId. The gate is dumb
  // about which sessions are "trusted" — the consumer is
  // responsible for NOT passing admin/teacher sessionAccountId
  // (otherwise an admin could read any order via session-fallback,
  // bypassing the /admin/payments surface's audit trail).
  if (options.sessionAccountId) {
    const meta = order.metadata as { accountId?: unknown } | null | undefined
    const metaAccountId =
      meta && typeof meta.accountId === 'string' && meta.accountId.length > 0
        ? meta.accountId
        : null
    if (metaAccountId && metaAccountId === options.sessionAccountId) {
      return { ok: true, reason: 'session_match' }
    }
  }

  if (!presentedToken) {
    return { ok: false, reason: 'token_required' }
  }
  return { ok: false, reason: 'token_mismatch' }
}
