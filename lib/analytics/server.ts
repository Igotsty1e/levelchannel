/**
 * Server-side analytics utilities.
 *
 * Все security-sensitive операции (HMAC verification, IP truncation,
 * UA parsing, batch INSERT) собраны здесь.
 *
 * Cookie format: lc_aid=<uuid>:<base64(HMAC-SHA256(EVENTS_AID_SECRET, uuid))>
 *
 * Verifier rejects:
 *   - missing/malformed cookie
 *   - signature mismatch (timing-safe compare)
 *   - uuid not in canonical v4 format
 *
 * При REJECT → POST /api/events отвечает 401 + Set-Cookie с новым signed UUID.
 * Client cookie-rotation handler перевыпустит и ретрайит.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

import type { PoolClient, QueryResult } from 'pg'

const COOKIE_NAME = 'lc_aid'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EVENT_NAME_RE = /^[a-z][a-z0-9_]{0,63}$/

function getSecret(): string {
  const s = process.env.EVENTS_AID_SECRET
  if (!s || s.length < 32) {
    throw new Error(
      'EVENTS_AID_SECRET not set or too short (≥32 chars required). See .env.example.',
    )
  }
  return s
}

/** Подписывает anonymous_id → формат cookie. */
export function signAnonymousId(uuid: string): string {
  const sig = createHmac('sha256', getSecret()).update(uuid).digest('base64url')
  return `${uuid}:${sig}`
}

/** Верифицирует cookie. Возвращает uuid или null. */
export function verifySignedAnonymousId(raw: string | undefined): string | null {
  if (!raw) return null
  const idx = raw.indexOf(':')
  if (idx <= 0) return null
  const uuid = raw.slice(0, idx)
  const givenSigB64 = raw.slice(idx + 1)
  if (!UUID_RE.test(uuid)) return null
  if (!givenSigB64) return null
  const expected = createHmac('sha256', getSecret()).update(uuid).digest()
  let given: Buffer
  try {
    given = Buffer.from(givenSigB64, 'base64url')
  } catch {
    return null
  }
  if (given.length !== expected.length) return null
  try {
    if (!timingSafeEqual(given, expected)) return null
  } catch {
    return null
  }
  return uuid.toLowerCase()
}

// ─── IP truncation (privacy) ────────────────────────────────────────

/**
 * Truncates IP to /24 (IPv4) or /48 (IPv6). Returns null если invalid.
 * Postgres `inet` тип принимает оба формата.
 */
export function truncateIp(ip: string | undefined | null): string | null {
  if (!ip) return null
  const trimmed = ip.trim()
  if (!trimmed) return null
  // IPv4
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(trimmed)) {
    const parts = trimmed.split('.')
    return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`
  }
  // IPv6 — берём первые 3 группы (48 bits), остальное нулим
  if (trimmed.includes(':')) {
    const parts = trimmed.split(':')
    if (parts.length < 3) return null
    return `${parts[0]}:${parts[1]}:${parts[2]}::/48`
  }
  return null
}

// ─── User-Agent parsing (no external deps — minimal regex) ──────────

export type ParsedUA = {
  family: string | null
  os: string | null
  device: 'mobile' | 'tablet' | 'desktop' | null
}

const UA_FAMILY_RE = [
  { re: /\bChrome\/([\d.]+)/i, name: 'Chrome' },
  { re: /\bFirefox\/([\d.]+)/i, name: 'Firefox' },
  { re: /\bSafari\/([\d.]+)/i, name: 'Safari' },
  { re: /\bEdg\/([\d.]+)/i, name: 'Edge' },
  { re: /\bYaBrowser\/([\d.]+)/i, name: 'Yandex' },
  { re: /\bOpera\/([\d.]+)/i, name: 'Opera' },
]

const UA_OS_RE = [
  { re: /Windows NT 10\.0/i, name: 'Windows 10/11' },
  { re: /Windows NT 11\.0/i, name: 'Windows 11' },
  { re: /Mac OS X ([\d_]+)/i, name: 'macOS' },
  { re: /Android (\d+)/i, name: 'Android' },
  { re: /iPhone OS (\d+_\d+)/i, name: 'iOS' },
  { re: /iPad/i, name: 'iPadOS' },
  { re: /Linux/i, name: 'Linux' },
]

export function parseUserAgent(ua: string | undefined | null): ParsedUA {
  if (!ua) return { family: null, os: null, device: null }
  const family = UA_FAMILY_RE.find((p) => p.re.test(ua))?.name ?? null
  const os = UA_OS_RE.find((p) => p.re.test(ua))?.name ?? null
  let device: ParsedUA['device'] = 'desktop'
  if (/iPhone|Android.*Mobile/i.test(ua)) device = 'mobile'
  else if (/iPad|Android(?!.*Mobile)|Tablet/i.test(ua)) device = 'tablet'
  return { family, os, device }
}

// ─── URL sanitization ───────────────────────────────────────────────

/**
 * Возвращает path + только utm_* query params. Tokens/secrets дропаются.
 * Cap 512 chars.
 */
export function sanitizeUrl(rawUrl: string | undefined | null): string | null {
  if (!rawUrl) return null
  try {
    const parsed = new URL(rawUrl, 'http://x') // base for relative
    const utm = new URLSearchParams()
    parsed.searchParams.forEach((v, k) => {
      if (k.startsWith('utm_')) utm.set(k, v.slice(0, 64))
    })
    const qs = utm.toString()
    const path = parsed.pathname.slice(0, 256)
    const out = qs ? `${path}?${qs}` : path
    return out.slice(0, 512)
  } catch {
    return null
  }
}

/** Origin-only referrer (drops path/query). */
export function sanitizeReferrer(raw: string | undefined | null): string | null {
  if (!raw) return null
  try {
    const u = new URL(raw)
    return u.origin.slice(0, 128)
  } catch {
    return null
  }
}

// ─── UTM extraction ─────────────────────────────────────────────────

export function extractUtm(rawUrl: string | undefined | null): Record<string, string> {
  if (!rawUrl) return {}
  try {
    const parsed = new URL(rawUrl, 'http://x')
    const out: Record<string, string> = {}
    parsed.searchParams.forEach((v, k) => {
      if (k.startsWith('utm_')) out[k.slice(4)] = v.slice(0, 64)
    })
    return out
  } catch {
    return {}
  }
}

// ─── Clock skew clamp ───────────────────────────────────────────────

const PAST_SKEW_MS = 60 * 60 * 1000 // 1 hour
const FUTURE_SKEW_MS = 60 * 1000 // 1 minute

export function clampOccurredAt(clientISO: string, serverNow: Date): Date | null {
  const t = new Date(clientISO)
  if (Number.isNaN(t.getTime())) return null
  const ts = t.getTime()
  const min = serverNow.getTime() - PAST_SKEW_MS
  const max = serverNow.getTime() + FUTURE_SKEW_MS
  if (ts < min || ts > max) return null
  return t
}

// ─── Event name validation ─────────────────────────────────────────

export function isValidEventName(name: unknown): name is string {
  return typeof name === 'string' && EVENT_NAME_RE.test(name)
}

// ─── linkAnonymousIdToAccount (called from /api/auth/register + login) ──

/**
 * Backfill: после signup/login присваиваем account_id всем pre-signup
 * events этого anonymous_id (где account_id IS NULL).
 *
 * Вызывается ВНУТРИ существующей transaction signup/login route'ы —
 * atomic с account creation.
 *
 * Возвращает количество обновлённых events.
 */
export async function linkAnonymousIdToAccount(
  client: PoolClient,
  anonymousId: string,
  accountId: string,
): Promise<number> {
  // Validate UUIDs to avoid SQL surprises.
  if (!UUID_RE.test(anonymousId) || !UUID_RE.test(accountId)) {
    return 0
  }
  // UPDATE across partitions — index `(anonymous_id, occurred_at desc)`
  // per partition gives index scan; only touches partitions with
  // matching anonymous_id. At identity-cardinality this is cheap.
  const result: QueryResult<{ count: string }> = await client.query(
    `update events
        set account_id = $2
      where anonymous_id = $1
        and account_id is null
      returning 1`,
    [anonymousId, accountId],
  )
  return result.rowCount ?? 0
}

// ─── Cookie helpers ─────────────────────────────────────────────────

export const ANONYMOUS_ID_COOKIE = COOKIE_NAME

/** Cookie max-age = 2 years. */
export const ANONYMOUS_ID_MAX_AGE_SEC = 2 * 365 * 24 * 60 * 60

/**
 * Server-side identify: вызывается в /api/auth/register + login после
 * успешного создания/верификации аккаунта.
 *
 * Reads lc_aid cookie from request, verifies HMAC, runs UPDATE backfill
 * на pre-signup events (account_id IS NULL → set to account_id).
 *
 * Best-effort: если cookie нет / invalid / DB error — возвращает 0,
 * auth flow не падает из-за analytics.
 */
export async function identifyAccountFromRequest(
  request: Request,
  accountId: string,
): Promise<number> {
  try {
    const cookieHeader = request.headers.get('cookie') ?? ''
    const aidRaw = cookieHeader
      .split(/;\s*/)
      .find((c) => c.startsWith(`${COOKIE_NAME}=`))
      ?.slice(COOKIE_NAME.length + 1)
    const anonymousId = verifySignedAnonymousId(aidRaw)
    if (!anonymousId) return 0

    const { getDbPool } = await import('@/lib/db/pool')
    const pool = getDbPool()
    const client = await pool.connect()
    try {
      return await linkAnonymousIdToAccount(client, anonymousId, accountId)
    } finally {
      client.release()
    }
  } catch {
    return 0
  }
}
