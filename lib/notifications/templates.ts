// Wave-A — render-функции для email + Telegram per LessonEventKind.
//
// Sub-PR 1 версия: каждое событие имеет минимальный шаблон (subject +
// 2-3 строки тела + CTA). Sub-PR 2/3 заполнят полноценные тексты per
// content-style guide. Логика отдельна от templates чтобы UI tests
// могли мокать только этот файл.
//
// Все user-supplied строки (reason, имена, причины) escape'ятся ниже.

import { escapeTgMarkdown } from './telegram/send'
import type { LessonEventKind } from './lesson-event-dispatch'

type RenderInput = {
  actorDisplayName: string
  recipientDisplayName: string
  slotStartAtIso?: string
  oldSlotStartAtIso?: string
  durationMinutes?: number
  reasonText?: string
  amountKopecks?: number
  cabinetUrl: string
  recipientRole: 'teacher' | 'learner'
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatRu(iso: string | undefined, includeYear = false): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'long',
    ...(includeYear ? { year: 'numeric' } : {}),
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Moscow',
  })
}

function formatRub(kopecks?: number): string {
  if (kopecks == null) return ''
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 0,
  }).format(kopecks / 100)
}

export type EmailTemplate = { subject: string; html: string; text: string }

export function renderLessonEventEmail(
  kind: LessonEventKind,
  p: RenderInput,
): EmailTemplate {
  switch (kind) {
    case 'LessonCancelledByTeacher': {
      const when = formatRu(p.slotStartAtIso)
      const reasonHtml = p.reasonText
        ? `<p>Причина: <em>${escapeHtml(p.reasonText)}</em></p>`
        : ''
      const reasonText = p.reasonText ? `\nПричина: ${p.reasonText}` : ''
      return {
        subject: `Учитель отменил занятие ${when}`,
        html:
          `<p>Здравствуйте, ${escapeHtml(p.recipientDisplayName)}.</p>` +
          `<p>${escapeHtml(p.actorDisplayName)} отменил занятие на ${when}.</p>` +
          reasonHtml +
          `<p>Хотите перенести? Откройте кабинет: <a href="${escapeHtml(p.cabinetUrl)}">${escapeHtml(p.cabinetUrl)}</a></p>` +
          `<p>— LevelChannel</p>`,
        text:
          `Здравствуйте, ${p.recipientDisplayName}.\n\n` +
          `${p.actorDisplayName} отменил занятие на ${when}.${reasonText}\n\n` +
          `Хотите перенести? ${p.cabinetUrl}\n\n— LevelChannel`,
      }
    }
    case 'LessonCancelledByLearner': {
      const when = formatRu(p.slotStartAtIso)
      const reasonHtml = p.reasonText
        ? `<p>Причина ученика: <em>${escapeHtml(p.reasonText)}</em></p>`
        : ''
      const reasonText = p.reasonText ? `\nПричина ученика: ${p.reasonText}` : ''
      return {
        subject: `${p.actorDisplayName} отменил занятие ${when}`,
        html:
          `<p>Здравствуйте.</p>` +
          `<p>Ваш ученик ${escapeHtml(p.actorDisplayName)} отменил занятие на ${when}.</p>` +
          reasonHtml +
          `<p>Календарь: <a href="${escapeHtml(p.cabinetUrl)}/calendar">${escapeHtml(p.cabinetUrl)}/calendar</a></p>` +
          `<p>— LevelChannel</p>`,
        text:
          `Ваш ученик ${p.actorDisplayName} отменил занятие на ${when}.${reasonText}\n\n` +
          `Календарь: ${p.cabinetUrl}/calendar\n\n— LevelChannel`,
      }
    }
    case 'LessonRescheduledByLearner': {
      const wasWhen = formatRu(p.oldSlotStartAtIso)
      const newWhen = formatRu(p.slotStartAtIso)
      return {
        subject: `${p.actorDisplayName} перенёс занятие на ${newWhen}`,
        html:
          `<p>Здравствуйте.</p>` +
          `<p>Ваш ученик ${escapeHtml(p.actorDisplayName)} перенёс занятие.</p>` +
          `<p>Было: ${wasWhen} → Стало: <strong>${newWhen}</strong></p>` +
          `<p>Календарь: <a href="${escapeHtml(p.cabinetUrl)}/calendar">${escapeHtml(p.cabinetUrl)}/calendar</a></p>` +
          `<p>— LevelChannel</p>`,
        text:
          `Ваш ученик ${p.actorDisplayName} перенёс занятие.\n` +
          `Было: ${wasWhen} → Стало: ${newWhen}\n\n` +
          `Календарь: ${p.cabinetUrl}/calendar\n\n— LevelChannel`,
      }
    }
    case 'LessonRescheduledByTeacher': {
      const wasWhen = formatRu(p.oldSlotStartAtIso)
      const newWhen = formatRu(p.slotStartAtIso)
      const reasonHtml = p.reasonText
        ? `<p>Что сказал учитель: <em>${escapeHtml(p.reasonText)}</em></p>`
        : ''
      const reasonText = p.reasonText ? `\nЧто сказал учитель: ${p.reasonText}` : ''
      return {
        subject: `Учитель перенёс занятие на ${newWhen}`,
        html:
          `<p>Здравствуйте, ${escapeHtml(p.recipientDisplayName)}.</p>` +
          `<p>${escapeHtml(p.actorDisplayName)} перенёс ваше занятие.</p>` +
          `<p>Было: ${wasWhen} → Стало: <strong>${newWhen}</strong></p>` +
          reasonHtml +
          `<p>Кабинет: <a href="${escapeHtml(p.cabinetUrl)}">${escapeHtml(p.cabinetUrl)}</a></p>` +
          `<p>— LevelChannel</p>`,
        text:
          `Здравствуйте, ${p.recipientDisplayName}.\n\n` +
          `${p.actorDisplayName} перенёс ваше занятие.\n` +
          `Было: ${wasWhen} → Стало: ${newWhen}${reasonText}\n\n` +
          `Кабинет: ${p.cabinetUrl}\n\n— LevelChannel`,
      }
    }
    case 'LessonMarkedPaidByTeacher': {
      const amount = formatRub(p.amountKopecks)
      return {
        subject: `Учитель подтвердил оплату ${amount}`,
        html:
          `<p>Здравствуйте, ${escapeHtml(p.recipientDisplayName)}.</p>` +
          `<p>${escapeHtml(p.actorDisplayName)} подтвердил вашу оплату <strong>${amount}</strong>.</p>` +
          `<p>История оплат: <a href="${escapeHtml(p.cabinetUrl)}/payments">${escapeHtml(p.cabinetUrl)}/payments</a></p>` +
          `<p>— LevelChannel</p>`,
        text:
          `${p.actorDisplayName} подтвердил вашу оплату ${amount}.\n\n` +
          `История оплат: ${p.cabinetUrl}/payments\n\n— LevelChannel`,
      }
    }
    case 'PaymentClaimConfirmed': {
      const amount = formatRub(p.amountKopecks)
      return {
        subject: `Учитель подтвердил вашу заявку на ${amount}`,
        html:
          `<p>Здравствуйте, ${escapeHtml(p.recipientDisplayName)}.</p>` +
          `<p>${escapeHtml(p.actorDisplayName)} подтвердил вашу заявку «Я оплатил» на <strong>${amount}</strong>.</p>` +
          `<p>Статус в кабинете: <a href="${escapeHtml(p.cabinetUrl)}/payments">${escapeHtml(p.cabinetUrl)}/payments</a></p>` +
          `<p>— LevelChannel</p>`,
        text:
          `${p.actorDisplayName} подтвердил вашу заявку «Я оплатил» на ${amount}.\n\n` +
          `Статус: ${p.cabinetUrl}/payments\n\n— LevelChannel`,
      }
    }
    case 'PaymentClaimDeclined': {
      const reasonHtml = p.reasonText
        ? `<p>Комментарий учителя: <em>${escapeHtml(p.reasonText)}</em></p>`
        : ''
      const reasonText = p.reasonText ? `\nКомментарий: ${p.reasonText}` : ''
      return {
        subject: `Учитель не подтвердил вашу заявку на оплату`,
        html:
          `<p>Здравствуйте, ${escapeHtml(p.recipientDisplayName)}.</p>` +
          `<p>${escapeHtml(p.actorDisplayName)} не подтвердил вашу заявку «Я оплатил».</p>` +
          reasonHtml +
          `<p>Свяжитесь с учителем напрямую или подайте заявку заново: <a href="${escapeHtml(p.cabinetUrl)}/payments">${escapeHtml(p.cabinetUrl)}/payments</a></p>` +
          `<p>— LevelChannel</p>`,
        text:
          `${p.actorDisplayName} не подтвердил вашу заявку «Я оплатил».${reasonText}\n\n` +
          `Свяжитесь с учителем или подайте заявку заново: ${p.cabinetUrl}/payments\n\n— LevelChannel`,
      }
    }
    case 'PaymentRefundIssued': {
      const amount = formatRub(p.amountKopecks)
      const reasonHtml = p.reasonText
        ? `<p>Причина: <em>${escapeHtml(p.reasonText)}</em></p>`
        : ''
      const reasonText = p.reasonText ? `\nПричина: ${p.reasonText}` : ''
      return {
        subject: `Учитель оформил возврат ${amount}`,
        html:
          `<p>Здравствуйте, ${escapeHtml(p.recipientDisplayName)}.</p>` +
          `<p>${escapeHtml(p.actorDisplayName)} оформил возврат <strong>${amount}</strong>.</p>` +
          reasonHtml +
          `<p>История оплат: <a href="${escapeHtml(p.cabinetUrl)}/payments">${escapeHtml(p.cabinetUrl)}/payments</a></p>` +
          `<p>— LevelChannel</p>`,
        text:
          `${p.actorDisplayName} оформил возврат ${amount}.${reasonText}\n\n` +
          `История: ${p.cabinetUrl}/payments\n\n— LevelChannel`,
      }
    }
  }
}

export function renderLessonEventTelegram(kind: LessonEventKind, p: RenderInput): string {
  // All user strings escaped for MarkdownV2.
  const actor = escapeTgMarkdown(p.actorDisplayName)
  const reason = p.reasonText ? escapeTgMarkdown(p.reasonText) : ''
  const cabinetUrl = escapeTgMarkdown(p.cabinetUrl)
  const when = escapeTgMarkdown(formatRu(p.slotStartAtIso))
  const oldWhen = escapeTgMarkdown(formatRu(p.oldSlotStartAtIso))
  const amount = escapeTgMarkdown(formatRub(p.amountKopecks))

  switch (kind) {
    case 'LessonCancelledByTeacher':
      return (
        `❌ Учитель отменил занятие на ${when}\\.\n` +
        (reason ? `Причина: _${reason}_\n` : '') +
        `Перенести: ${cabinetUrl}`
      )
    case 'LessonCancelledByLearner':
      return (
        `❌ Ученик ${actor} отменил занятие на ${when}\\.\n` +
        (reason ? `Причина: _${reason}_\n` : '') +
        `Календарь: ${cabinetUrl}/calendar`
      )
    case 'LessonRescheduledByTeacher':
      return (
        `🔁 Учитель перенёс ваше занятие\\.\n` +
        `Было: ${oldWhen}\n` +
        `Стало: *${when}*\n` +
        (reason ? `Что сказал: _${reason}_\n` : '') +
        `Кабинет: ${cabinetUrl}`
      )
    case 'LessonRescheduledByLearner':
      return (
        `🔁 Ученик ${actor} перенёс занятие\\.\n` +
        `Было: ${oldWhen}\n` +
        `Стало: *${when}*\n` +
        `Календарь: ${cabinetUrl}/calendar`
      )
    case 'LessonMarkedPaidByTeacher':
      return (
        `✅ Учитель подтвердил оплату *${amount}*\\.\n` +
        `История: ${cabinetUrl}/payments`
      )
    case 'PaymentClaimConfirmed':
      return (
        `✅ Учитель подтвердил вашу заявку «Я оплатил» на *${amount}*\\.\n` +
        `Кабинет: ${cabinetUrl}/payments`
      )
    case 'PaymentClaimDeclined':
      return (
        `⚠️ Учитель не подтвердил вашу заявку\\.\n` +
        (reason ? `Комментарий: _${reason}_\n` : '') +
        `Кабинет: ${cabinetUrl}/payments`
      )
    case 'PaymentRefundIssued':
      return (
        `💸 Учитель оформил возврат *${amount}*\\.\n` +
        (reason ? `Причина: _${reason}_\n` : '') +
        `История: ${cabinetUrl}/payments`
      )
  }
}
