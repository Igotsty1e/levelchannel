// BCS-DEF-5 (2026-05-19) — TS mirror of scripts/lib/
// teacher-daily-digest-template.mjs.
//
// The .mjs cron script is the canonical runtime renderer. This TS
// mirror exists for unit tests + drift pinning (byte-identical
// rendered output for the same input params). See
// docs/plans/bcs-def-5-teacher-reminders.md §2.5.

import { escapeHtml } from '@/lib/email/escape'
import { pluralRu } from '@/lib/copy/plural-ru'

export type DigestSlotInput = {
  startAtIso: string
  learnerDisplayName: string | null
  learnerEmail: string
  zoomUrl: string | null
}

export type DigestRenderInput = {
  teacherDisplayName: string | null
  teacherTimezone: string
  slots: DigestSlotInput[]
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

export function renderTeacherDailyDigestEmail(
  input: DigestRenderInput,
): { subject: string; text: string; html: string } {
  const n = input.slots.length
  if (n === 0) {
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
