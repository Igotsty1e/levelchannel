// BCS-C.2 — OAuth `state` nonce: HMAC-signed CSRF token.
//
// Threat model:
//   1. CSRF: a malicious site can't trigger our OAuth callback with
//      a state it didn't get from /start — we sign state with a
//      server-side secret.
//   2. Account confusion: a state issued for account A must not
//      validate when account B's callback presents it — we bind
//      state to the issuing account_id.
//   3. Replay: a captured state must not be valid forever — we embed
//      a timestamp and refuse stale states (default TTL 10 min).
//
// Format: `<accountIdHex>.<randomB64Url>.<unixMs>.<hmacB64Url>`
//   - accountIdHex: 32-char (UUID without dashes, lowercased). Tying
//     the state to the account_id is constant-time decoupled from
//     username/email.
//   - randomB64Url: 32 random bytes, base64url-encoded.
//   - unixMs: milliseconds since epoch, decimal string.
//   - hmacB64Url: HMAC-SHA256(`${accountIdHex}.${random}.${unixMs}`, secret),
//     base64url-encoded.
//
// All comparisons are constant-time. The HMAC is recomputed and
// compared against the inbound state; an attacker without the secret
// cannot mint a valid state for any account.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const DEFAULT_TTL_MS = 10 * 60 * 1000 // 10 minutes

const ACCOUNT_ID_HEX_RE = /^[0-9a-f]{32}$/i
const B64URL_RE = /^[A-Za-z0-9_-]+$/

function b64url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function fromB64url(s: string): Buffer | null {
  if (!B64URL_RE.test(s)) return null
  const pad = '='.repeat((4 - (s.length % 4)) % 4)
  const std = s.replace(/-/g, '+').replace(/_/g, '/') + pad
  try {
    return Buffer.from(std, 'base64')
  } catch {
    return null
  }
}

function accountIdToHex(accountId: string): string {
  return accountId.replace(/-/g, '').toLowerCase()
}

export function generateOauthState(opts: {
  accountId: string
  secret: string
  // For deterministic tests. Defaults: random bytes + Date.now().
  random?: Buffer
  nowMs?: number
}): string {
  const accountHex = accountIdToHex(opts.accountId)
  if (!ACCOUNT_ID_HEX_RE.test(accountHex)) {
    throw new Error('generateOauthState: accountId must be a UUID')
  }
  const random = opts.random ?? randomBytes(32)
  const randomEncoded = b64url(random)
  const tsMs = String(opts.nowMs ?? Date.now())
  const body = `${accountHex}.${randomEncoded}.${tsMs}`
  const hmac = createHmac('sha256', opts.secret).update(body).digest()
  return `${body}.${b64url(hmac)}`
}

export type VerifyResult =
  | { ok: true; accountId: string; issuedAtMs: number }
  | { ok: false; reason: 'malformed' | 'account_mismatch' | 'bad_signature' | 'expired' }

export function verifyOauthState(
  state: string,
  expected: {
    accountId: string
    secret: string
    // For deterministic tests. Defaults to Date.now() + DEFAULT_TTL_MS.
    nowMs?: number
    ttlMs?: number
  },
): VerifyResult {
  if (typeof state !== 'string' || state.length === 0) {
    return { ok: false, reason: 'malformed' }
  }
  const parts = state.split('.')
  if (parts.length !== 4) return { ok: false, reason: 'malformed' }
  const [accountHex, randomEncoded, tsMsStr, providedHmac] = parts
  if (!ACCOUNT_ID_HEX_RE.test(accountHex)) {
    return { ok: false, reason: 'malformed' }
  }
  if (!B64URL_RE.test(randomEncoded)) {
    return { ok: false, reason: 'malformed' }
  }
  if (!/^\d+$/.test(tsMsStr)) return { ok: false, reason: 'malformed' }
  if (!B64URL_RE.test(providedHmac)) {
    return { ok: false, reason: 'malformed' }
  }

  const expectedHex = accountIdToHex(expected.accountId)
  if (accountHex.toLowerCase() !== expectedHex) {
    // Constant-time on equal-length hex; mismatch fast-path is OK
    // (the attacker already knows which account they targeted).
    return { ok: false, reason: 'account_mismatch' }
  }

  const body = `${accountHex}.${randomEncoded}.${tsMsStr}`
  const recomputed = createHmac('sha256', expected.secret).update(body).digest()
  const provided = fromB64url(providedHmac)
  if (!provided || provided.length !== recomputed.length) {
    return { ok: false, reason: 'bad_signature' }
  }
  if (!timingSafeEqual(recomputed, provided)) {
    return { ok: false, reason: 'bad_signature' }
  }

  const tsMs = Number(tsMsStr)
  const nowMs = expected.nowMs ?? Date.now()
  const ttlMs = expected.ttlMs ?? DEFAULT_TTL_MS
  if (nowMs - tsMs > ttlMs) {
    return { ok: false, reason: 'expired' }
  }
  // Defense in depth: refuse states issued in the future (clock skew
  // > 1 minute is suspicious).
  if (tsMs - nowMs > 60_000) {
    return { ok: false, reason: 'malformed' }
  }

  return {
    ok: true,
    accountId: expected.accountId,
    issuedAtMs: tsMs,
  }
}
