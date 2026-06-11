// teacher-no-slots-mode (Задача 2.1, Sub-PR C, 2026-06-11).
//
// Batched notification: учитель назначил пачку занятий одному ученику;
// per-event email rate-limit fired; cron посылает one digest со списком
// всех новых назначений вместо N отдельных писем.
//
// Tone — same authority as learner-direct-assign-notice (docs/content-
// style.md): «занятие», NBSP between digit and unit, «вам».

import { escapeHtml } from '@/lib/email/escape'

export type LearnerDirectAssignDigestLesson = {
  startAt: Date
  durationMinutes: number
}

export type LearnerDirectAssignDigestParams = {
  teacherDisplayName: string | null
  lessons: ReadonlyArray<LearnerDirectAssignDigestLesson>
  learnerTimezone: string | null
  learnerDisplayName: string | null
  cabinetUrl: string
}

const NBSP = '\u00A0'

function fmt(date: Date, tz: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: tz,
    day: '2-digit',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

export function renderLearnerDirectAssignDigestEmail(
  params: LearnerDirectAssignDigestParams,
): { subject: string; text: string; html: string } {
  const teacher =
    params.teacherDisplayName && params.teacherDisplayName.trim().length > 0
      ? params.teacherDisplayName.trim()
      : 'учитель'
  const tz = params.learnerTimezone ?? 'Europe/Moscow'
  const lessons = [...params.lessons].sort(
    (a, b) => a.startAt.getTime() - b.startAt.getTime(),
  )
  const count = lessons.length

  const salutation =
    params.learnerDisplayName && params.learnerDisplayName.trim().length > 0
      ? `Здравствуйте, ${params.learnerDisplayName.trim()}.`
      : 'Здравствуйте.'

  const subject =
    count === 1
      ? `Назначено занятие — ${fmt(lessons[0].startAt, tz)}`
      : `Назначено ${count}${NBSP}занятий`

  const textLines: string[] = [
    salutation,
    '',
    count === 1
      ? `${teacher} назначил${teacher === 'учитель' ? '' : '(а)'} вам занятие:`
      : `${teacher} назначил${teacher === 'учитель' ? '' : '(а)'} вам ${count}${NBSP}занятий:`,
    '',
  ]

  for (const l of lessons) {
    textLines.push(
      `  • ${fmt(l.startAt, tz)} (${tz}) · ${l.durationMinutes}${NBSP}мин`,
    )
  }
  textLines.push('')
  textLines.push(`Перенести или отменить: ${params.cabinetUrl}`)
  textLines.push('')
  textLines.push('— Команда LevelChannel')

  const text = textLines.join('\n')

  const safeTeacher = escapeHtml(teacher)
  const safeSalutation = escapeHtml(salutation)
  const safeCabinet = escapeHtml(params.cabinetUrl)
  const safeTz = escapeHtml(tz)
  const lessonRows = lessons
    .map(
      (l) =>
        `<li style="margin:4px 0;">${escapeHtml(fmt(l.startAt, tz))} · ${l.durationMinutes}${NBSP}мин</li>`,
    )
    .join('')

  const html = `
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0B0B0C;">
  <p style="font-size:15px;line-height:1.6;margin:0 0 12px;">${safeSalutation}</p>
  <p style="font-size:15px;line-height:1.6;margin:0 0 12px;">
    ${safeTeacher} назначил${teacher === 'учитель' ? '' : '(а)'} вам ${count === 1 ? 'занятие' : `${count}${NBSP}занятий`}:
  </p>
  <ul style="font-size:15px;line-height:1.6;margin:0 0 12px;padding-left:20px;">
    ${lessonRows}
  </ul>
  <p style="font-size:13px;line-height:1.6;color:#5F5F67;margin:0 0 4px;">
    Часовой пояс: ${safeTz}.
  </p>
  <p style="font-size:14px;line-height:1.6;color:#5F5F67;margin:16px 0 4px;">
    Перенести или отменить: <a href="${safeCabinet}" style="color:#C87878;">${safeCabinet}</a>
  </p>
  <p style="font-size:13px;line-height:1.6;color:#5F5F67;margin:16px 0 0;">— Команда LevelChannel</p>
</div>
`.trim()

  return { subject, text, html }
}
