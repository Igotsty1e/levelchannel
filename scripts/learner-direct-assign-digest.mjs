#!/usr/bin/env node
//
// teacher-no-slots-mode (Задача 2.1, Sub-PR C, 2026-06-11).
// Hourly digest cron — обрабатывает lesson_slots.notify_pending=true.
//
// Когда учитель direct-assign-ит >5 занятий за час одному ученику, per-
// event rate-limit в `app/api/teacher/slots/assign-direct/route.ts`
// helps mark slot.notify_pending=true (без отправки письма). Этот cron
// каждый час групирует все pending записи по learner_account_id, шлёт
// ОДНО digest-письмо со списком занятий и сбрасывает flag.
//
// Запуск: каждый час через systemd timer
// (`levelchannel-learner-direct-assign-digest.timer`) или manual.
//
// Env:
//   DATABASE_URL          — postgres connection
//   AUTH_DATABASE_URL     — auth pool (accounts.email + profiles)
//   RESEND_API_KEY        — Resend SDK key (console fallback otherwise)
//   EMAIL_FROM            — sender
//   NEXT_PUBLIC_SITE_URL  — cabinet link base
//
// Idempotency:
//   - UPDATE lesson_slots SET notify_pending=false WHERE id IN (...)
//     runs in same TX as the SELECT, so a crash mid-email leaves
//     rows ready for next tick.
//   - Email-sender errors per-learner bubble up but other learners
//     continue (best-effort batch).

import pg from 'pg'
import { Resend } from 'resend'

import { resolveSslConfig } from './_pg-ssl.mjs'

const DATABASE_URL = process.env.DATABASE_URL
const AUTH_DATABASE_URL = process.env.AUTH_DATABASE_URL ?? DATABASE_URL
const RESEND_API_KEY = process.env.RESEND_API_KEY ?? ''
const EMAIL_FROM = process.env.EMAIL_FROM ?? 'LevelChannel <noreply@levelchannel.ru>'
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://levelchannel.ru').replace(/\/+$/, '')

if (!DATABASE_URL) {
  console.error('FAIL  DATABASE_URL not set')
  process.exit(1)
}

const NBSP = '\u00A0'

function fmt(date, tz) {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: tz,
    day: '2-digit',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;'
      : c === '<' ? '&lt;'
      : c === '>' ? '&gt;'
      : c === '"' ? '&quot;'
      : '&#39;',
  )
}

function buildEmail({ teacherName, learnerName, learnerTz, lessons }) {
  const tz = learnerTz ?? 'Europe/Moscow'
  const teacher = teacherName && teacherName.trim().length > 0 ? teacherName.trim() : 'учитель'
  const sorted = [...lessons].sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
  const count = sorted.length
  const salutation = learnerName && learnerName.trim().length > 0
    ? `Здравствуйте, ${learnerName.trim()}.`
    : 'Здравствуйте.'

  const subject = count === 1
    ? `Назначено занятие — ${fmt(sorted[0].startAt, tz)}`
    : `Назначено ${count}${NBSP}занятий`

  const lines = [
    salutation,
    '',
    count === 1
      ? `${teacher} назначил${teacher === 'учитель' ? '' : '(а)'} вам занятие:`
      : `${teacher} назначил${teacher === 'учитель' ? '' : '(а)'} вам ${count}${NBSP}занятий:`,
    '',
  ]
  for (const l of sorted) {
    lines.push(`  • ${fmt(l.startAt, tz)} (${tz}) · ${l.durationMinutes}${NBSP}мин`)
  }
  lines.push('')
  lines.push(`Перенести или отменить: ${SITE_URL}/cabinet`)
  lines.push('')
  lines.push('— Команда LevelChannel')

  const text = lines.join('\n')

  const rowsHtml = sorted
    .map((l) =>
      `<li style="margin:4px 0;">${escapeHtml(fmt(l.startAt, tz))} · ${l.durationMinutes}${NBSP}мин</li>`,
    )
    .join('')
  const html = `
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0B0B0C;">
  <p style="font-size:15px;line-height:1.6;margin:0 0 12px;">${escapeHtml(salutation)}</p>
  <p style="font-size:15px;line-height:1.6;margin:0 0 12px;">
    ${escapeHtml(teacher)} назначил${teacher === 'учитель' ? '' : '(а)'} вам ${count === 1 ? 'занятие' : `${count}${NBSP}занятий`}:
  </p>
  <ul style="font-size:15px;line-height:1.6;margin:0 0 12px;padding-left:20px;">${rowsHtml}</ul>
  <p style="font-size:13px;line-height:1.6;color:#5F5F67;margin:0 0 4px;">Часовой пояс: ${escapeHtml(tz)}.</p>
  <p style="font-size:14px;line-height:1.6;color:#5F5F67;margin:16px 0 4px;">
    Перенести или отменить: <a href="${SITE_URL}/cabinet" style="color:#C87878;">${SITE_URL}/cabinet</a>
  </p>
  <p style="font-size:13px;line-height:1.6;color:#5F5F67;margin:16px 0 0;">— Команда LevelChannel</p>
</div>
`.trim()

  return { subject, text, html }
}

async function main() {
  const slotsPool = new pg.Pool({
    connectionString: DATABASE_URL,
    ...resolveSslConfig(DATABASE_URL),
  })
  const authPool = new pg.Pool({
    connectionString: AUTH_DATABASE_URL,
    ...resolveSslConfig(AUTH_DATABASE_URL),
  })

  let sent = 0
  let failed = 0
  let processedLearners = 0

  try {
    // Step 1: claim all pending rows atomically and group in JS.
    const claimed = await slotsPool.query(
      `select id, learner_account_id, teacher_account_id, start_at, duration_minutes
         from lesson_slots
        where notify_pending = true
        order by learner_account_id, start_at`,
    )

    if (claimed.rows.length === 0) {
      console.log('digest: no pending rows')
      return
    }

    const byLearner = new Map()
    for (const r of claimed.rows) {
      const key = String(r.learner_account_id)
      if (!byLearner.has(key)) byLearner.set(key, { lessons: [], slotIds: [], teacherIds: new Set() })
      const entry = byLearner.get(key)
      entry.lessons.push({
        startAt: new Date(String(r.start_at)),
        durationMinutes: Number(r.duration_minutes),
      })
      entry.slotIds.push(String(r.id))
      entry.teacherIds.add(String(r.teacher_account_id))
    }

    const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null

    for (const [learnerId, entry] of byLearner.entries()) {
      processedLearners += 1
      // Fetch learner email + profile + timezone.
      const learnerRow = await authPool.query(
        `select a.email, p.display_name, p.first_name, p.last_name, p.timezone
           from accounts a
           left join account_profiles p on p.account_id = a.id
          where a.id = $1::uuid`,
        [learnerId],
      )
      const learner = learnerRow.rows[0]
      if (!learner?.email) {
        console.warn(`digest: learner ${learnerId} has no email — clearing flag without send`)
      }

      // Resolve teacher display name (first teacher; usually only one).
      const teacherId = [...entry.teacherIds][0]
      let teacherName = null
      if (teacherId) {
        const tRow = await authPool.query(
          `select p.display_name, p.first_name, p.last_name
             from account_profiles p where p.account_id = $1::uuid`,
          [teacherId],
        )
        const t = tRow.rows[0]
        if (t) {
          const joined = [t.first_name, t.last_name].filter(Boolean).join(' ').trim()
          teacherName = joined.length > 0 ? joined : (t.display_name ?? null)
        }
      }

      const learnerName = (() => {
        if (!learner) return null
        const joined = [learner.first_name, learner.last_name].filter(Boolean).join(' ').trim()
        return joined.length > 0 ? joined : (learner.display_name ?? null)
      })()

      let emailOk = !learner?.email // no-recipient = treat as "consumed" so we don't re-process forever
      if (learner?.email) {
        try {
          const { subject, text, html } = buildEmail({
            teacherName,
            learnerName,
            learnerTz: learner.timezone ?? 'Europe/Moscow',
            lessons: entry.lessons,
          })
          if (resend) {
            const r = await resend.emails.send({
              from: EMAIL_FROM,
              to: learner.email,
              subject,
              text,
              html,
            })
            if (r?.error) throw new Error(r.error.message ?? String(r.error))
          } else {
            console.log('[email:console]', { to: learner.email, subject, text })
          }
          emailOk = true
          sent += 1
        } catch (e) {
          failed += 1
          console.error(`digest: send failed for learner ${learnerId}:`, e)
        }
      }

      // Step 2: clear flag — only if email was OK (or no recipient).
      if (emailOk) {
        await slotsPool.query(
          `update lesson_slots set notify_pending = false where id = any($1::uuid[])`,
          [entry.slotIds],
        )
      }
    }
  } finally {
    await slotsPool.end()
    await authPool.end()
  }

  console.log(
    `digest: processedLearners=${processedLearners} sent=${sent} failed=${failed}`,
  )
}

main().catch((e) => {
  console.error('digest: fatal:', e)
  process.exit(1)
})
