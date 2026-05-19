// BCS-DEF-4 (2026-05-19) — learner lesson reminder template.
//
// Plan: docs/plans/bcs-def-4-learner-reminders.md §2.8.
//
// Two body variants gated on `lesson_slots.zoom_url`:
//   - With Zoom: includes a "Войти:" line with the URL.
//   - Without Zoom: omits the line entirely — never writes
//     "ссылка отсутствует" / "нет ссылки" / "—" placeholders.
//
// Tone authority: docs/content-style.md (Russian copy rules) —
// «занятие» not «урок», «оплатить» not «заплатить», em-dash sign-off,
// non-breaking space between digit and unit (U+00A0).

import { escapeHtml } from '@/lib/email/escape'

export type LearnerLessonReminderParams = {
  /**
   * The number of minutes until lesson start. Used to render the
   * subject + first sentence. Operator-tunable via
   * LEARNER_REMINDER_WINDOW_MINUTES.
   */
  windowMinutes: number
  /**
   * Teacher's `account_profiles.display_name`. Pass null when
   * the teacher hasn't set a display name; the template falls
   * back to «вашим учителем» (literal — no PII leak, no teacher
   * email rendered).
   */
  teacherDisplayName: string | null
  /**
   * Optional `lesson_slots.zoom_url`. Empty string is treated
   * identically to null (the without-Zoom variant is rendered).
   * Validated as https-only ≤512 chars by migration 0056.
   */
  zoomUrl: string | null
  /**
   * Lesson start time (UTC, comes from `lesson_slots.start_at`).
   */
  startAt: Date
  /**
   * Lesson duration in minutes (`lesson_slots.duration_minutes`).
   */
  durationMinutes: number
  /**
   * Learner's IANA timezone string from `account_profiles.timezone`.
   * Pass null for the default (Europe/Moscow per the
   * migration 0048 backfill allowlist).
   */
  learnerTimezone: string | null
  /**
   * Optional learner display name. When set, the salutation is
   * «Здравствуйте, %name%.»; when null/empty, «Здравствуйте.»
   * per docs/content-style.md §8.
   */
  learnerDisplayName: string | null
  /**
   * Absolute URL for the "Если нужно перенести" cabinet link.
   * Caller injects `${paymentConfig.siteUrl}/cabinet` so staging
   * and test environments don't leak prod links.
   */
  cabinetUrl: string
}

// Render the lesson start time in the learner's timezone with the
// 24-hour format pinned by docs/content-style.md §9. Pure helper so
// tests can assert the exact substring.
function renderLocalStart(startAt: Date, learnerTimezone: string | null): {
  dateTime: string
  tzLabel: string
} {
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

// docs/content-style.md §9 — non-breaking space between digit and unit.
const NBSP = '\u00A0'

export function renderLearnerLessonReminderEmail(
  params: LearnerLessonReminderParams,
): { subject: string; text: string; html: string } {
  const teacher =
    params.teacherDisplayName && params.teacherDisplayName.trim().length > 0
      ? params.teacherDisplayName.trim()
      : 'вашим учителем'

  const showZoom =
    typeof params.zoomUrl === 'string' && params.zoomUrl.trim().length > 0
  const zoomUrl = showZoom ? params.zoomUrl!.trim() : null

  const { dateTime, tzLabel } = renderLocalStart(
    params.startAt,
    params.learnerTimezone,
  )

  // Subject: «Через 60 минут — занятие на LevelChannel»; the digit-unit
  // gap is U+00A0 per docs/content-style.md §9. Subject ≤ 8 words
  // (LevelChannel = 1 token).
  const subject = `Через ${params.windowMinutes}${NBSP}минут — занятие на LevelChannel`

  // Salutation per §8.
  const salutation =
    params.learnerDisplayName && params.learnerDisplayName.trim().length > 0
      ? `Здравствуйте, ${params.learnerDisplayName.trim()}.`
      : 'Здравствуйте.'

  // Plain-text body. Each Russian unit-after-number occurrence uses
  // U+00A0 (NBSP regex pin in tests).
  const textLines: string[] = [
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

  const text = textLines.join('\n')

  // HTML body. User-supplied display_name + zoom URL are escapeHtml-ed;
  // cabinetUrl is env-driven from paymentConfig.siteUrl (validated origin).
  const safeTeacher = escapeHtml(teacher)
  const safeZoomUrl = zoomUrl ? escapeHtml(zoomUrl) : null
  const safeDateTime = escapeHtml(dateTime)
  const safeTz = escapeHtml(tzLabel)
  const safeCabinet = escapeHtml(params.cabinetUrl)
  const safeSalutation = escapeHtml(salutation)

  const zoomBlock = safeZoomUrl
    ? `
  <p style="font-size:15px;line-height:1.6;margin:0 0 8px;">
    Войти: <a href="${safeZoomUrl}" style="color:#C87878;">${safeZoomUrl}</a>
  </p>`
    : ''

  const html = `
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0B0B0C;">
  <p style="font-size:15px;line-height:1.6;margin:0 0 12px;">${safeSalutation}</p>
  <p style="font-size:15px;line-height:1.6;margin:0 0 12px;">
    Через ${params.windowMinutes}${NBSP}минут — занятие с учителем ${safeTeacher}.
  </p>
  <p style="font-size:15px;line-height:1.6;margin:0 0 4px;">Когда: ${safeDateTime} (${safeTz})</p>
  <p style="font-size:15px;line-height:1.6;margin:0 0 8px;">Длительность: ${params.durationMinutes}${NBSP}минут</p>${zoomBlock}
  <p style="font-size:14px;line-height:1.6;color:#5F5F67;margin:16px 0 4px;">
    Если нужно перенести: <a href="${safeCabinet}" style="color:#C87878;">${safeCabinet}</a>
  </p>
  <p style="font-size:13px;line-height:1.6;color:#5F5F67;margin:16px 0 0;">— Команда LevelChannel</p>
</div>
`.trim()

  return { subject, text, html }
}
