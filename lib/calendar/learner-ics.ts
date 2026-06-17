// 2026-06-17 — .ics feed для учеников.
//
// Subscription URL: /api/learner/calendar.ics?account=<accountId>&token=<hmac>
// Calendar apps (Google Calendar, Apple Calendar) подписываются на
// URL и периодически тянут — авторизация cookie не работает, поэтому
// signed token в query.

import { createHmac, timingSafeEqual } from 'node:crypto'

const TOKEN_SECRET_ENV = 'LEARNER_ICS_TOKEN_SECRET'

function readSecret(): string {
  const v = process.env[TOKEN_SECRET_ENV]
  if (!v || v.length < 32) {
    throw new Error(
      `${TOKEN_SECRET_ENV} not set or too short (≥32 chars required). See .env.example.`,
    )
  }
  return v
}

export function signLearnerIcsToken(accountId: string): string {
  return createHmac('sha256', readSecret())
    .update(`learner-ics:v1:${accountId}`)
    .digest('hex')
}

export function verifyLearnerIcsToken(accountId: string, token: string): boolean {
  try {
    const expected = signLearnerIcsToken(accountId)
    if (expected.length !== token.length) return false
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(token, 'hex'))
  } catch {
    return false
  }
}

type IcsSlot = {
  id: string
  startAtIso: string
  durationMinutes: number
  status: string
  teacherEmail: string | null
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
    const description =
      `Учитель: ${slot.teacherEmail ?? 'не указан'}\\n` +
      `Статус: ${slot.status}\\n` +
      `Открыть в кабинете: ${siteUrl}/cabinet`
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
