// BCS-DEF-4 (2026-05-19) — scheduler-local mirror of the learner
// lesson reminder template. The systemd timer execs this .mjs file
// directly (`node scripts/learner-reminder-dispatch.mjs`), so it
// cannot import the TS template via `@/`.
//
// This mirror MUST stay text-identical to the TS template for body
// content; it differs only in HTML rendering (the scheduler always
// asks for plain text per the dispatch path which goes through the
// TS sendLearnerLessonReminderEmail wrapper). For safety the mirror
// is used ONLY by the Telegram sub-loop in the scheduler — the email
// path runs through the dispatch.ts wrapper which builds HTML.
//
// Plan: docs/plans/bcs-def-4-learner-reminders.md §2.4 step 5e.

// docs/content-style.md §9 — non-breaking space between digit and unit.
const NBSP = '\u00A0'

function renderLocalStart(startAt, learnerTimezone) {
  const tz = learnerTimezone ?? 'Europe/Moscow'
  const dateTime = new Intl.DateTimeFormat('ru-RU', {
    timeZone: tz,
    day: '2-digit',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(startAt)
  return { dateTime, tzLabel: tz }
}

/**
 * Render the plain-text body for either channel.
 *
 * @param {object} params
 * @param {number} params.windowMinutes
 * @param {string|null} params.teacherDisplayName
 * @param {string|null} params.zoomUrl
 * @param {Date} params.startAt
 * @param {number} params.durationMinutes
 * @param {string|null} params.learnerTimezone
 * @param {string|null} params.learnerDisplayName
 * @param {string} params.cabinetUrl
 * @returns {{ subject: string, text: string }}
 */
export function renderLearnerLessonReminderText(params) {
  const teacher =
    params.teacherDisplayName && String(params.teacherDisplayName).trim().length > 0
      ? String(params.teacherDisplayName).trim()
      : 'вашим учителем'
  const showZoom =
    typeof params.zoomUrl === 'string' && params.zoomUrl.trim().length > 0
  const zoomUrl = showZoom ? params.zoomUrl.trim() : null
  const { dateTime, tzLabel } = renderLocalStart(
    params.startAt,
    params.learnerTimezone,
  )

  const subject = `Через ${params.windowMinutes}${NBSP}минут — занятие на LevelChannel`

  const salutation =
    params.learnerDisplayName && String(params.learnerDisplayName).trim().length > 0
      ? `Здравствуйте, ${String(params.learnerDisplayName).trim()}.`
      : 'Здравствуйте.'

  const textLines = [
    salutation,
    '',
    `Через ${params.windowMinutes}${NBSP}минут — занятие с учителем ${teacher}.`,
    '',
    `Когда: ${dateTime} (${tzLabel})`,
    `Длительность: ${params.durationMinutes}${NBSP}минут`,
  ]
  if (showZoom) {
    textLines.push(`Войти: ${zoomUrl}`)
  }
  textLines.push('')
  textLines.push(`Если нужно перенести: ${params.cabinetUrl}`)
  textLines.push('')
  textLines.push('— Команда LevelChannel')

  return { subject, text: textLines.join('\n') }
}
