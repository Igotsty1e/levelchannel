// BCS-DEF-5-TG (2026-05-21) — TS mirror of scripts/lib/
// teacher-daily-digest-telegram-template.mjs.
//
// The .mjs runtime is canonical; this TS mirror exists for unit tests +
// drift pinning. Behaviour must be byte-identical for identical input.

import { pluralRu } from '@/lib/copy/plural-ru'

const BODY_CAP = 1024

export type TelegramDigestSlotInput = {
  startAtIso: string
  learnerDisplayName: string | null
  learnerEmail: string
  zoomUrl: string | null
}

export type TelegramDigestRenderInput = {
  teacherDisplayName: string | null
  teacherTimezone: string
  slots: TelegramDigestSlotInput[]
  siteUrl: string
}

function formatLocalHHMM(iso: string, tz: string): string {
  const parts = new Intl.DateTimeFormat('ru-RU', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso))
  const hh = parts.find((p) => p.type === 'hour')?.value ?? '00'
  const mm = parts.find((p) => p.type === 'minute')?.value ?? '00'
  const safeHh = hh === '24' ? '00' : hh
  return `${safeHh}:${mm}`
}

function pickLearnerLabel(displayName: string | null, email: string): string {
  const trimmedName = typeof displayName === 'string' ? displayName.trim() : ''
  if (trimmedName.length > 0) return trimmedName
  return email
}

function buildSlotLine(
  slot: TelegramDigestSlotInput,
  tz: string,
  includeZoom: boolean,
): string {
  const time = formatLocalHHMM(slot.startAtIso, tz)
  const learnerLabel = pickLearnerLabel(slot.learnerDisplayName, slot.learnerEmail)
  const base = `   ${time} — ${learnerLabel}`
  if (!includeZoom) return base
  if (typeof slot.zoomUrl === 'string' && slot.zoomUrl.trim().length > 0) {
    return `${base} (zoom: ${slot.zoomUrl.trim()})`
  }
  return base
}

function assemble(args: {
  header: string
  slotLines: string[]
  truncatedSuffix: string | null
  cta: string
  footer: string
}): string {
  const { header, slotLines, truncatedSuffix, cta, footer } = args
  const parts: string[] = [header, '']
  if (slotLines.length > 0) {
    parts.push(slotLines.join('\n'))
  }
  if (truncatedSuffix) {
    parts.push(truncatedSuffix)
  }
  parts.push('', cta, '', footer)
  return parts.join('\n')
}

export function renderTeacherDailyDigestTelegram(
  input: TelegramDigestRenderInput,
): string {
  const n = input.slots.length
  if (n === 0) {
    throw new Error('renderTeacherDailyDigestTelegram: slots.length must be >= 1')
  }

  const noun = pluralRu(n, 'занятие', 'занятия', 'занятий')
  const header = `LevelChannel — занятия на сегодня\n\n   ${n} ${noun}`
  const cta = `Открыть календарь: ${input.siteUrl}/teacher`
  const footer = 'Отписаться от Telegram-дайджеста: /stop'

  let slotLines = input.slots.map((s) =>
    buildSlotLine(s, input.teacherTimezone, true),
  )
  let body = assemble({ header, slotLines, truncatedSuffix: null, cta, footer })
  if (body.length <= BODY_CAP) return body

  slotLines = input.slots.map((s) =>
    buildSlotLine(s, input.teacherTimezone, false),
  )
  body = assemble({ header, slotLines, truncatedSuffix: null, cta, footer })
  if (body.length <= BODY_CAP) return body

  for (let kept = n - 1; kept >= 1; kept -= 1) {
    const dropped = n - kept
    const truncatedSuffix = `   (+${dropped} ещё, см. календарь)`
    const trimmedLines = slotLines.slice(0, kept)
    body = assemble({
      header,
      slotLines: trimmedLines,
      truncatedSuffix,
      cta,
      footer,
    })
    if (body.length <= BODY_CAP) return body
  }

  return assemble({
    header,
    slotLines: [],
    truncatedSuffix: `   (${n} ${noun}, см. календарь)`,
    cta,
    footer,
  })
}
