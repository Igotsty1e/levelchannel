// BCS-DEF-5-TG (2026-05-21) — Telegram body renderer for the daily
// teacher digest (canonical .mjs runtime version).
//
// Plan: docs/plans/bcs-def-5-tg-teacher-telegram-reminders.md §2.4.3.
//
// Plain text only — no parse_mode, no markdown-special chars in output
// (defense against accidental MarkdownV2 escape failures upstream).
// Total body ≤1024 chars (well under Telegram's 4096 sendMessage cap;
// the tighter envelope gives an explicit truncation strategy when a
// teacher has many slots with long display names).
//
// Truncation cascade (in this order, applied until body ≤1024):
//   1. Drop all zoom-url lines.
//   2. Drop trailing slot blocks one at a time; append a single
//      "(+N ещё, см. календарь)" line in their place.
//
// Russian copy per docs/content-style.md (medium vocabulary,
// "занятие" not "урок", em-dash signs-off).

import { pluralRu } from './plural-ru.mjs'

const BODY_CAP = 1024

/**
 * @typedef {{
 *   startAtIso: string,
 *   learnerDisplayName: string | null,
 *   learnerEmail: string,
 *   zoomUrl: string | null,
 * }} TelegramDigestSlotInput
 *
 * @typedef {{
 *   teacherDisplayName: string | null,
 *   teacherTimezone: string,
 *   slots: TelegramDigestSlotInput[],
 *   siteUrl: string,
 * }} TelegramDigestRenderInput
 */

function formatLocalHHMM(iso, tz) {
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

function pickLearnerLabel(displayName, email) {
  const trimmedName = typeof displayName === 'string' ? displayName.trim() : ''
  if (trimmedName.length > 0) return trimmedName
  return email
}

function buildSlotLine(slot, tz, includeZoom) {
  const time = formatLocalHHMM(slot.startAtIso, tz)
  const learnerLabel = pickLearnerLabel(slot.learnerDisplayName, slot.learnerEmail)
  const base = `   ${time} — ${learnerLabel}`
  if (!includeZoom) return base
  if (typeof slot.zoomUrl === 'string' && slot.zoomUrl.trim().length > 0) {
    return `${base} (zoom: ${slot.zoomUrl.trim()})`
  }
  return base
}

function assemble({ header, slotLines, truncatedSuffix, cta, footer }) {
  const parts = [header, '']
  if (slotLines.length > 0) {
    parts.push(slotLines.join('\n'))
  }
  if (truncatedSuffix) {
    parts.push(truncatedSuffix)
  }
  parts.push('', cta, '', footer)
  return parts.join('\n')
}

/**
 * @param {TelegramDigestRenderInput} input
 * @returns {string}
 */
export function renderTeacherDailyDigestTelegram(input) {
  const n = input.slots.length
  if (n === 0) {
    throw new Error('renderTeacherDailyDigestTelegram: slots.length must be >= 1')
  }

  const noun = pluralRu(n, 'занятие', 'занятия', 'занятий')
  const header = `LevelChannel — занятия на сегодня\n\n   ${n} ${noun}`
  const cta = `Открыть календарь: ${input.siteUrl}/teacher`
  const footer = 'Отписаться от Telegram-дайджеста: /stop'

  // Attempt 1: all slots with zoom-urls.
  let slotLines = input.slots.map((s) =>
    buildSlotLine(s, input.teacherTimezone, true),
  )
  let body = assemble({ header, slotLines, truncatedSuffix: null, cta, footer })
  if (body.length <= BODY_CAP) return body

  // Attempt 2: drop zoom-urls.
  slotLines = input.slots.map((s) =>
    buildSlotLine(s, input.teacherTimezone, false),
  )
  body = assemble({ header, slotLines, truncatedSuffix: null, cta, footer })
  if (body.length <= BODY_CAP) return body

  // Attempt 3: drop trailing slots until body fits; emit summary line.
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

  // Pathological fallback — even 1 slot + summary > 1024. Drop ALL
  // slot lines and emit a degenerate "see calendar" body. Should be
  // unreachable in practice (header + cta + footer + 1 truncated line
  // < 400 chars).
  return assemble({
    header,
    slotLines: [],
    truncatedSuffix: `   (${n} ${noun}, см. календарь)`,
    cta,
    footer,
  })
}
