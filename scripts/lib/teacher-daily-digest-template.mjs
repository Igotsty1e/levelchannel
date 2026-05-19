// BCS-DEF-5 (2026-05-19) — daily teacher digest email template
// (canonical .mjs runtime version).
//
// Plan: docs/plans/bcs-def-5-teacher-reminders.md §2.5.
//
// Russian copy per docs/content-style.md (§8 Email Tone): subject 4-8
// words, body opens with the fact, sign-off uses em-dash («— Команда
// LevelChannel»). Vocabulary is medium ("занятие", not "урок").
//
// Subject — pluralised noun + count:
//   1 slot   → "LevelChannel — 1 занятие на сегодня"
//   2 slots  → "LevelChannel — 2 занятия на сегодня"
//   5 slots  → "LevelChannel — 5 занятий на сегодня"
//
// Body shape (plain text; html mirrors via <pre>):
//
//   Здравствуйте, Анна.
//
//   На сегодня у вас 3 занятия:
//
//      09:00 — учащийся Иван П.
//      Войти: https://meet.google.com/abc-defg-hij
//
//      11:00 — учащийся Мария К.
//
//      14:30 — учащийся student@example.com
//      Войти: https://meet.google.com/xyz-uvw-rst
//
//   Управлять занятиями: https://levelchannel.ru/teacher
//
//   — Команда LevelChannel
//
// Field rules:
//   - greeting falls back to "Здравствуйте." when displayName is null
//   - per-slot learnerLabel = displayName if set, else email
//   - zoom_url line OMITTED entirely when null (no placeholder)
//   - every dynamic field passes through escapeHtml() for the html
//     variant; plain text never gets escaped (defence depth)
//
// A TS mirror at lib/email/templates/teacher-daily-digest.ts exists for
// type-safety + a drift-pinning test (tests/email/
// teacher-daily-digest.test.ts) that asserts byte-identical rendered
// output for the same input params.

import { pluralRu } from './plural-ru.mjs'

const HTML_ENTITIES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => HTML_ENTITIES[c] || c)
}

/**
 * @typedef {{
 *   startAtIso: string,
 *   learnerDisplayName: string | null,
 *   learnerEmail: string,
 *   zoomUrl: string | null,
 * }} DigestSlotInput
 *
 * @typedef {{
 *   teacherDisplayName: string | null,
 *   teacherTimezone: string,
 *   slots: DigestSlotInput[],
 *   siteUrl: string,
 * }} DigestRenderInput
 */

/**
 * Format `start_at` (ISO UTC) as HH:MM in the teacher's local TZ.
 * Uses Intl.DateTimeFormat with 'ru-RU' (24-hour, leading-zero).
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
  // The 'ru-RU' formatter can return '24:00' for midnight on some
  // platforms (rare). Normalize.
  const safeHh = hh === '24' ? '00' : hh
  return `${safeHh}:${mm}`
}

function pickLearnerLabel(displayName, email) {
  const trimmedName = typeof displayName === 'string' ? displayName.trim() : ''
  if (trimmedName.length > 0) return trimmedName
  return email
}

/**
 * @param {DigestRenderInput} input
 * @returns {{ subject: string, text: string, html: string }}
 */
export function renderTeacherDailyDigestEmail(input) {
  const n = input.slots.length
  if (n === 0) {
    // Empty-day case is gated upstream; defensive guard so we never
    // emit a degenerate "0 занятий" subject.
    throw new Error('renderTeacherDailyDigestEmail: slots.length must be >= 1')
  }

  const noun = pluralRu(n, 'занятие', 'занятия', 'занятий')
  const subject = `LevelChannel — ${n} ${noun} на сегодня`

  const greetingName =
    typeof input.teacherDisplayName === 'string'
      && input.teacherDisplayName.trim().length > 0
      ? input.teacherDisplayName.trim()
      : null
  const greetingText = greetingName
    ? `Здравствуйте, ${greetingName}.`
    : 'Здравствуйте.'
  const greetingHtml = greetingName
    ? `Здравствуйте, ${escapeHtml(greetingName)}.`
    : 'Здравствуйте.'

  const introText = `На сегодня у вас ${n} ${noun}:`
  const introHtml = introText

  const slotBlocks = input.slots.map((slot) => {
    const time = formatLocalHHMM(slot.startAtIso, input.teacherTimezone)
    const learnerLabel = pickLearnerLabel(
      slot.learnerDisplayName,
      slot.learnerEmail,
    )
    const lines = [`   ${time} — учащийся ${learnerLabel}`]
    if (typeof slot.zoomUrl === 'string' && slot.zoomUrl.trim().length > 0) {
      lines.push(`   Войти: ${slot.zoomUrl.trim()}`)
    }
    return lines.join('\n')
  })

  const slotBlocksHtml = input.slots.map((slot) => {
    const time = formatLocalHHMM(slot.startAtIso, input.teacherTimezone)
    const learnerLabel = pickLearnerLabel(
      slot.learnerDisplayName,
      slot.learnerEmail,
    )
    const lines = [
      `   ${escapeHtml(time)} — учащийся ${escapeHtml(learnerLabel)}`,
    ]
    if (typeof slot.zoomUrl === 'string' && slot.zoomUrl.trim().length > 0) {
      lines.push(`   Войти: ${escapeHtml(slot.zoomUrl.trim())}`)
    }
    return lines.join('\n')
  })

  const ctaText = `Управлять занятиями: ${input.siteUrl}/teacher`
  const ctaHtml = `Управлять занятиями: ${escapeHtml(input.siteUrl)}/teacher`
  const signoff = '— Команда LevelChannel'

  const text = [
    greetingText,
    '',
    introText,
    '',
    slotBlocks.join('\n\n'),
    '',
    ctaText,
    '',
    signoff,
  ].join('\n')

  // The <pre> wrapper preserves layout fidelity (matches operator-payment-
  // notify.ts shape). Wrapping the whole body inside <pre> means
  // monospace rendering in mail clients — acceptable for an operator-
  // adjacent digest. Each dynamic field is escapeHtml'd above.
  const htmlInner = [
    greetingHtml,
    '',
    introHtml,
    '',
    slotBlocksHtml.join('\n\n'),
    '',
    ctaHtml,
    '',
    signoff,
  ].join('\n')
  const html = `<pre style="font-family: ui-monospace, monospace; white-space: pre-wrap; line-height: 1.5;">${htmlInner}</pre>`

  return { subject, text, html }
}
