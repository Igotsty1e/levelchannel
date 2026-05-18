// SAAS-3+4 TINV.1 (2026-05-18) — teacher invite token primitives.
//
// Foundation lib for the invite-link flow per
// docs/plans/teacher-self-reg-invite.md §3.3 + §3.5.
//
// This file ships the PURE-FUNCTION primitives (HMAC sign/verify +
// env contract). The DB-bound primitives (`createInviteForTeacher`,
// `redeemInviteAndBindLearnerAtomic`) land in a follow-up sub-PR
// (TINV.3) once the helper-refactor for (executor | pool) signatures
// is in place (TINV.2).
//
// Token wire format (per §3.3):
//   <base64url(payload)>.<base64url(hmac)>
//
// where:
//   payload = utf8 JSON { v: 1, iid: <uuid>, tid: <uuid>, exp: <epoch-seconds> }
//   hmac    = HMAC-SHA256(TEACHER_INVITE_SECRET, base64url(payload))
//
// Verify uses `timingSafeEqual` — never a plain `===` on the hmac
// bytes, even though the secret is the only sensitive part.

import { createHmac, timingSafeEqual } from 'node:crypto'

// Per-call env read (no module-scope memoization, matching the
// `email-hash.ts` pattern so rotation takes effect on the next
// request without a process restart).
//
// Production-required, dev-fallback. Boot-fails if unset in production.
const DEV_FALLBACK_SECRET = 'lc-dev-teacher-invite-fallback'

export function getTeacherInviteSecret(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const raw = (env.TEACHER_INVITE_SECRET ?? '').trim()
  if (raw.length > 0) return raw
  if (env.NODE_ENV === 'production') {
    throw new Error('TEACHER_INVITE_SECRET is required in production')
  }
  return DEV_FALLBACK_SECRET
}

export type InvitePayloadV1 = {
  v: 1
  /** Database id of the teacher_invites row (uuid). */
  iid: string
  /** Inviting teacher's account id (uuid). Duplicated from the row
   *  for a fast preview; server still re-fetches by `iid` and trusts
   *  the DB value (anti-spoof). */
  tid: string
  /** Expiry as epoch SECONDS (not ms). */
  exp: number
}

// Type-only alias — currently identical to V1 but kept distinct so a
// future v2 schema can be added with discriminated-union semantics.
export type InvitePayload = InvitePayloadV1

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function base64urlEncode(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function base64urlDecode(s: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null
  // Re-pad for `Buffer.from` (which is lenient but stricter is safer).
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  try {
    return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64')
  } catch {
    return null
  }
}

function hmacSign(secret: string, payloadEncoded: string): string {
  return base64urlEncode(
    createHmac('sha256', secret).update(payloadEncoded).digest(),
  )
}

/**
 * Sign an invite payload into the wire token.
 * Caller is responsible for ensuring the payload is well-formed; this
 * function does not validate `iid` / `tid` uuid shape (verify does).
 */
export function signInviteToken(
  payload: InvitePayload,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const secret = getTeacherInviteSecret(env)
  const payloadEncoded = base64urlEncode(
    Buffer.from(JSON.stringify(payload), 'utf-8'),
  )
  const hmac = hmacSign(secret, payloadEncoded)
  return `${payloadEncoded}.${hmac}`
}

/**
 * Verify a wire token and return its payload, or `null` on ANY failure.
 *
 * Returns `null` (with no detail) on:
 *   - malformed shape (not exactly two `.`-separated parts).
 *   - base64url decode failure.
 *   - JSON parse failure.
 *   - HMAC mismatch.
 *   - version mismatch (only `v: 1` supported today).
 *   - missing/invalid iid or tid uuid.
 *   - missing/invalid exp.
 *   - expired token (exp <= now-seconds).
 *
 * Anti-enumeration: the response surface is uniformly `null` so a caller
 * can't distinguish "tampered HMAC" from "expired" via the lib.
 */
export function verifyInviteToken(
  token: string,
  env: NodeJS.ProcessEnv = process.env,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): InvitePayload | null {
  if (typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [payloadEncoded, hmacEncoded] = parts
  if (!payloadEncoded || !hmacEncoded) return null

  // HMAC check first (constant-time compare on equal-length buffers).
  const secret = getTeacherInviteSecret(env)
  const expectedHmac = hmacSign(secret, payloadEncoded)
  const expectedBuf = base64urlDecode(expectedHmac)
  const actualBuf = base64urlDecode(hmacEncoded)
  if (!expectedBuf || !actualBuf) return null
  if (expectedBuf.length !== actualBuf.length) return null
  try {
    if (!timingSafeEqual(expectedBuf, actualBuf)) return null
  } catch {
    return null
  }

  // Payload decode + parse.
  const payloadBuf = base64urlDecode(payloadEncoded)
  if (!payloadBuf) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(payloadBuf.toString('utf-8'))
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const obj = parsed as Record<string, unknown>
  if (obj.v !== 1) return null
  if (typeof obj.iid !== 'string' || !UUID_RE.test(obj.iid)) return null
  if (typeof obj.tid !== 'string' || !UUID_RE.test(obj.tid)) return null
  if (typeof obj.exp !== 'number' || !Number.isFinite(obj.exp)) return null
  if (obj.exp <= nowSeconds) return null

  return { v: 1, iid: obj.iid, tid: obj.tid, exp: obj.exp }
}

/**
 * Default invite lifetime — 7 days from issue. Not env-tunable for
 * MVP; tunable knob lives behind operator_settings if/when needed.
 */
export const TEACHER_INVITE_DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60
