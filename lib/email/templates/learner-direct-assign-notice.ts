// teacher-direct-assign (Задача 2.2, Sub-PR B, 2026-06-11).
//
// Учитель назначил конкретное время для конкретного ученика. Письмо
// уведомляет ученика о новом занятии (не reminder before lesson, а
// notification at booking-time).
//
// Tone authority: docs/content-style.md — «занятие» not «урок»,
// non-breaking space между числом и единицей (U+00A0), приветствие
// per §8.

import { escapeHtml } from '@/lib/email/escape'

export type LearnerDirectAssignNoticeParams = {
  teacherDisplayName: string | null
  startAt: Date
  durationMinutes: number
  learnerTimezone: string | null
  learnerDisplayName: string | null
  /**
   * Absolute URL для кабинета учеnика. Caller передаёт
   * `${paymentConfig.siteUrl}/cabinet`.
   */
  cabinetUrl: string
}

const NBSP = '\u00A0'

function renderLocalStart(
  startAt: Date,
  learnerTimezone: string | null,
): { dateTime: string; tzLabel: string } {
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

export function renderLearnerDirectAssignNoticeEmail(
  params: LearnerDirectAssignNoticeParams,
): { subject: string; text: string; html: string } {
  const teacher =
    params.teacherDisplayName && params.teacherDisplayName.trim().length > 0
      ? params.teacherDisplayName.trim()
      : 'учитель'

  const { dateTime, tzLabel } = renderLocalStart(
    params.startAt,
    params.learnerTimezone,
  )

  const subject = `Назначено занятие — ${dateTime}`

  const salutation =
    params.learnerDisplayName && params.learnerDisplayName.trim().length > 0
      ? `Здравствуйте, ${params.learnerDisplayName.trim()}.`
      : 'Здравствуйте.'

  const textLines: string[] = [
    salutation,
    '',
    `${teacher} назначил${teacher === 'учитель' ? '' : '(а)'} вам занятие.`,
    '',
    `Когда: ${dateTime} (${tzLabel})`,
    `Длительность: ${params.durationMinutes}${NBSP}минут`,
    '',
    `Если нужно перенести или отменить: ${params.cabinetUrl}`,
    '',
    '— Команда LevelChannel',
  ]

  const text = textLines.join('\n')

  const safeTeacher = escapeHtml(teacher)
  const safeDateTime = escapeHtml(dateTime)
  const safeTz = escapeHtml(tzLabel)
  const safeCabinet = escapeHtml(params.cabinetUrl)
  const safeSalutation = escapeHtml(salutation)

  const html = `
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0B0B0C;">
  <p style="font-size:15px;line-height:1.6;margin:0 0 12px;">${safeSalutation}</p>
  <p style="font-size:15px;line-height:1.6;margin:0 0 12px;">
    ${safeTeacher} назначил${teacher === 'учитель' ? '' : '(а)'} вам занятие.
  </p>
  <p style="font-size:15px;line-height:1.6;margin:0 0 4px;">Когда: ${safeDateTime} (${safeTz})</p>
  <p style="font-size:15px;line-height:1.6;margin:0 0 8px;">Длительность: ${params.durationMinutes}${NBSP}минут</p>
  <p style="font-size:14px;line-height:1.6;color:#5F5F67;margin:16px 0 4px;">
    Если нужно перенести или отменить: <a href="${safeCabinet}" style="color:#C87878;">${safeCabinet}</a>
  </p>
  <p style="font-size:13px;line-height:1.6;color:#5F5F67;margin:16px 0 0;">— Команда LevelChannel</p>
</div>
`.trim()

  return { subject, text, html }
}
