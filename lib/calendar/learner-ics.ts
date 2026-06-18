// 2026-06-17 — .ics feed для учеников.
//
// Subscription URL: /api/learner/calendar.ics?account=<accountId>&token=<hmac>
// Calendar apps (Google Calendar, Apple Calendar) подписываются на
// URL и периодически тянут — авторизация cookie не работает, поэтому
// signed token в query.
//
// 2026-06-18 codex-audit BLOCKER §5.1 fix — token-versioning:
// - HMAC over (accountId | version | expiresAt), не только accountId
// - version читается из accounts.ics_token_version (mig 0133)
// - bump version → старые токены invalid → effective revoke
// - expiresAt = +90 дней → calendar apps re-sync прозрачно через
//   /cabinet/settings/calendar (на странице токен подписывается заново)

import { createHmac, timingSafeEqual } from 'node:crypto'

const TOKEN_SECRET_ENV = 'LEARNER_ICS_TOKEN_SECRET'
const TOKEN_TTL_DAYS = 90
const TOKEN_TTL_MS = TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000

function readSecret(): string {
  const v = process.env[TOKEN_SECRET_ENV]
  if (!v || v.length < 32) {
    throw new Error(
      `${TOKEN_SECRET_ENV} not set or too short (≥32 chars required). See .env.example.`,
    )
  }
  return v
}

/**
 * Token format: `<expiresAtMs>.<hmacHex>`
 * Where hmac = HMAC-SHA256(secret, "learner-ics:v2:${accountId}:${version}:${expiresAtMs}")
 *
 * `version` приходит из БД (`accounts.ics_token_version`). Bump версии
 * → старые токены сразу invalid (per-account revoke без ротации
 * глобального секрета).
 */
export function signLearnerIcsToken(
  accountId: string,
  version: number,
  expiresAtMs: number = Date.now() + TOKEN_TTL_MS,
): string {
  const hmac = createHmac('sha256', readSecret())
    .update(`learner-ics:v2:${accountId}:${version}:${expiresAtMs}`)
    .digest('hex')
  return `${expiresAtMs}.${hmac}`
}

export function verifyLearnerIcsToken(
  accountId: string,
  version: number,
  token: string,
): boolean {
  try {
    const dotIdx = token.indexOf('.')
    if (dotIdx <= 0) return false
    const expiresAtStr = token.slice(0, dotIdx)
    const hmacHex = token.slice(dotIdx + 1)
    const expiresAtMs = Number(expiresAtStr)
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
      return false
    }
    const expected = createHmac('sha256', readSecret())
      .update(`learner-ics:v2:${accountId}:${version}:${expiresAtMs}`)
      .digest('hex')
    if (expected.length !== hmacHex.length) return false
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(hmacHex, 'hex'))
  } catch {
    return false
  }
}

type IcsSlot = {
  id: string
  startAtIso: string
  durationMinutes: number
  status: string
  tariffTitleRu: string | null
}

function formatIcsDate(iso: string): string {
  const d = new Date(iso)
  const yyyy = d.getUTCFullYear().toString().padStart(4, '0')
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, '0')
  const dd = d.getUTCDate().toString().padStart(2, '0')
  const hh = d.getUTCHours().toString().padStart(2, '0')
  const mi = d.getUTCMinutes().toString().padStart(2, '0')
  const ss = d.getUTCSeconds().toString().padStart(2, '0')
  return `${yyyy}${mm}${dd}T${hh}${mi}${ss}Z`
}

function escapeIcsText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

export function buildLearnerIcs(slots: IcsSlot[], siteUrl: string): string {
  const lines: string[] = []
  lines.push('BEGIN:VCALENDAR')
  lines.push('VERSION:2.0')
  lines.push('PRODID:-//LevelChannel//Learner Lessons//RU')
  lines.push('CALSCALE:GREGORIAN')
  lines.push('METHOD:PUBLISH')
  lines.push('X-WR-CALNAME:LevelChannel — мои занятия')
  lines.push('X-WR-TIMEZONE:Europe/Moscow')

  const now = formatIcsDate(new Date().toISOString())
  for (const slot of slots) {
    if (slot.status === 'cancelled') continue
    const dtstart = formatIcsDate(slot.startAtIso)
    const end = new Date(
      new Date(slot.startAtIso).getTime() + slot.durationMinutes * 60 * 1000,
    ).toISOString()
    const dtend = formatIcsDate(end)
    const summary = `Занятие${slot.tariffTitleRu ? ' — ' + slot.tariffTitleRu : ''}`
    // 2026-06-18 codex-audit BLOCKER §5.1 fix: убрали teacher email из
    // ICS body — PII не должен утекать через subscription URL даже
    // когда token валидный.
    const description =
      `Статус: ${slot.status}\\n` + `Открыть в кабинете: ${siteUrl}/cabinet`
    lines.push('BEGIN:VEVENT')
    lines.push(`UID:slot-${slot.id}@levelchannel.ru`)
    lines.push(`DTSTAMP:${now}`)
    lines.push(`DTSTART:${dtstart}`)
    lines.push(`DTEND:${dtend}`)
    lines.push(`SUMMARY:${escapeIcsText(summary)}`)
    lines.push(`DESCRIPTION:${description}`)
    lines.push(`URL:${siteUrl}/cabinet`)
    lines.push('END:VEVENT')
  }

  lines.push('END:VCALENDAR')
  // RFC 5545 — CRLF line breaks.
  return lines.join('\r\n') + '\r\n'
}
