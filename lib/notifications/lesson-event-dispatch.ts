// Wave-A — единая точка dispatch для всех 7 lesson-событий.
//
// Закрывает 5 BLOCKER + 3 HIGH из аудита 2026-06-15. Mutation handlers
// в `lib/scheduling/slots/*` и `lib/payments/sbp-claims.ts` вызывают
// `dispatchLessonEvent(kind, ctx)` после успешного COMMIT. Dispatch:
//
//   1. resolveRecipient → достаёт email + tgChatId + проверяет role
//   2. idempotency check → пропускает повтор по dedup_key
//   3. render email + send → notification_log row
//   4. render TG + send → notification_log row
//
// Best-effort: dispatch НЕ блокирует mutation. Если фейлит — лог +
// продолжаем. Mutation уже committed.

import { getDbPool } from '@/lib/db/pool'

import {
  RoleMismatchError,
  resolveRecipient,
  type RecipientRole,
} from './recipient-resolver'
import { sendTelegramMessage } from './telegram/send'

// Все 7 событий Wave-A. Discriminated union ниже расширит type-safe
// каждый payload.
export type LessonEventKind =
  | 'LessonCancelledByTeacher'
  | 'LessonCancelledByLearner'
  | 'LessonRescheduledByLearner'
  | 'LessonMarkedPaidByTeacher'
  | 'PaymentClaimConfirmed'
  | 'PaymentClaimDeclined'
  | 'PaymentRefundIssued'

export type LessonEventPayloadBase = {
  /** Display-имя того, КТО совершил действие (для wording в template). */
  actorDisplayName: string
  /** Display-имя counterpart-а — recipient (для адресации в template). */
  recipientDisplayName: string
  /** ISO timestamp занятия. */
  slotStartAtIso?: string
  /** Длительность для слота. */
  durationMinutes?: number
  /** Свободная причина (cancel reason etc). Свободный текст пользователя
   * — обязательно HTML/TG escape в шаблонах. */
  reasonText?: string
  /** Денежная сумма (kopecks) для mark-paid / claim / refund. */
  amountKopecks?: number
  /** Старое время slot для reschedule (ISO). */
  oldSlotStartAtIso?: string
  /** Дополнительный URL для CTA в кабинете. Если не задан — расчёт от
   * recipient.role (teacher → /teacher/calendar, learner → /cabinet). */
  cabinetUrl?: string
}

export type LessonEventCtx = {
  /** UUID slot-а (для cancel/reschedule/mark-paid). */
  slotId?: string
  /** UUID payment_claims (для confirm/decline). */
  claimId?: string
  /** UUID payment_refunds. */
  refundId?: string
  /** Получатель уведомления. */
  recipientAccountId: string
  /** Заявленная роль (server-side verified в resolveRecipient). */
  recipientRole: RecipientRole
  /** iter_seq для dedup_key — длина events array slot-а или подобное
   * число. Гарантирует уникальность dedup_key для повторных циклов
   * (cancel → uncomplete → cancel). */
  iterSeq: number
  payload: LessonEventPayloadBase
}

type Status = 'sent' | 'failed' | 'skipped'

export type DispatchResult = {
  email: Status
  telegram: Status
  emailErrorText?: string
  telegramErrorText?: string
}

// Карта render-функций per kind. Sub-PR 2/3 заполняют real templates.
// На Sub-PR 1 каждое событие имеет «stub» который генерирует subject
// + plain text. Достаточно для теста flow; UX-quality templates
// придут в следующих Sub-PR.
import { renderLessonEventEmail, renderLessonEventTelegram } from './templates'

import { sendEmail } from '@/lib/email/client'

const DEFAULT_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL?.trim() || ''

function defaultCabinetUrl(role: RecipientRole): string {
  const base = DEFAULT_SITE_URL || 'https://levelchannel.ru'
  return role === 'teacher' ? `${base}/teacher` : `${base}/cabinet`
}

function relatedId(ctx: LessonEventCtx): string {
  return ctx.slotId ?? ctx.claimId ?? ctx.refundId ?? 'unknown'
}

function dedupKey(kind: LessonEventKind, ctx: LessonEventCtx, channel: 'email' | 'telegram'): string {
  return `${kind}:${relatedId(ctx)}:${channel}:${ctx.iterSeq}`
}

/**
 * Single entry point for Wave-A lesson notifications.
 *
 * Caller is mutation handler post-commit. Caller does NOT need to wrap
 * in try/catch — dispatch internally never throws to its caller (except
 * for programmer errors like RoleMismatchError which indicate broken
 * callsite, surface as console.error and dispatch result `failed`).
 */
export async function dispatchLessonEvent(
  kind: LessonEventKind,
  ctx: LessonEventCtx,
): Promise<DispatchResult> {
  const result: DispatchResult = { email: 'skipped', telegram: 'skipped' }
  let recipient
  try {
    recipient = await resolveRecipient(ctx.recipientAccountId, ctx.recipientRole)
  } catch (err) {
    if (err instanceof RoleMismatchError) {
      console.error('[lesson-event-dispatch] role-mismatch — programmer error', err)
      result.email = 'failed'
      result.telegram = 'failed'
      result.emailErrorText = `role_mismatch: ${err.actualIsTeacher ? 'is_teacher' : 'is_learner'}`
      await persistLog(kind, ctx, 'email', 'failed', err.message, null)
      await persistLog(kind, ctx, 'telegram', 'failed', err.message, null)
      return result
    }
    console.error('[lesson-event-dispatch] recipient-resolve failed', err)
    const msg = err instanceof Error ? err.message : String(err)
    result.email = 'failed'
    result.telegram = 'failed'
    result.emailErrorText = msg
    return result
  }

  const cabinetUrl =
    ctx.payload.cabinetUrl ?? defaultCabinetUrl(recipient.role)
  const payloadForLog = {
    kind,
    recipientRole: ctx.recipientRole,
    cabinetUrl,
    ...ctx.payload,
    // never persist contact details — only display names
    actorDisplayName: ctx.payload.actorDisplayName,
    recipientDisplayName: ctx.payload.recipientDisplayName,
  }

  // ─── email ─────────────────────────────────────────────
  {
    const key = dedupKey(kind, ctx, 'email')
    const alreadySent = await isAlreadySent(key)
    if (alreadySent) {
      result.email = 'skipped'
      await persistLog(kind, ctx, 'email', 'skipped', 'dedup', payloadForLog)
    } else {
      try {
        const tpl = renderLessonEventEmail(kind, {
          ...ctx.payload,
          cabinetUrl,
          recipientRole: recipient.role,
        })
        const sendResult = await sendEmail({
          to: recipient.email,
          subject: tpl.subject,
          html: tpl.html,
          text: tpl.text,
        })
        if (sendResult.ok) {
          result.email = 'sent'
          await persistLog(kind, ctx, 'email', 'sent', null, payloadForLog)
        } else {
          result.email = 'failed'
          result.emailErrorText = sendResult.error
          await persistLog(kind, ctx, 'email', 'failed', sendResult.error, payloadForLog)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        result.email = 'failed'
        result.emailErrorText = msg
        await persistLog(kind, ctx, 'email', 'failed', msg, payloadForLog)
      }
    }
  }

  // ─── telegram ──────────────────────────────────────────
  {
    const key = dedupKey(kind, ctx, 'telegram')
    const alreadySent = await isAlreadySent(key)
    if (alreadySent) {
      result.telegram = 'skipped'
      await persistLog(kind, ctx, 'telegram', 'skipped', 'dedup', payloadForLog)
    } else {
      try {
        const text = renderLessonEventTelegram(kind, {
          ...ctx.payload,
          cabinetUrl,
          recipientRole: recipient.role,
        })
        const sendResult = await sendTelegramMessage(
          recipient.telegramChatId,
          text,
          { parseMode: 'MarkdownV2' },
        )
        if (sendResult.ok) {
          result.telegram = 'sent'
          await persistLog(kind, ctx, 'telegram', 'sent', null, payloadForLog)
        } else {
          if (sendResult.reason === 'no_token' || sendResult.reason === 'no_chat_id') {
            result.telegram = 'skipped'
            await persistLog(kind, ctx, 'telegram', 'skipped', sendResult.reason, payloadForLog)
          } else {
            result.telegram = 'failed'
            result.telegramErrorText = sendResult.errorText ?? sendResult.reason
            await persistLog(kind, ctx, 'telegram', 'failed', sendResult.errorText ?? sendResult.reason, payloadForLog)
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        result.telegram = 'failed'
        result.telegramErrorText = msg
        await persistLog(kind, ctx, 'telegram', 'failed', msg, payloadForLog)
      }
    }
  }

  return result
}

async function isAlreadySent(key: string): Promise<boolean> {
  const pool = getDbPool()
  const r = await pool.query(
    `select 1 from notification_log where dedup_key = $1 and status = 'sent' limit 1`,
    [key],
  )
  return r.rows.length > 0
}

async function persistLog(
  kind: LessonEventKind,
  ctx: LessonEventCtx,
  channel: 'email' | 'telegram',
  status: Status,
  errorText: string | null,
  payload: object | null,
): Promise<void> {
  const pool = getDbPool()
  try {
    await pool.query(
      `insert into notification_log
         (event_kind, related_slot_id, related_claim_id, related_refund_id,
          recipient_account_id, channel, status, dedup_key, error_text, payload)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
       on conflict (dedup_key) do nothing`,
      [
        kind,
        ctx.slotId ?? null,
        ctx.claimId ?? null,
        ctx.refundId ?? null,
        ctx.recipientAccountId,
        channel,
        status,
        dedupKey(kind, ctx, channel),
        errorText,
        payload ? JSON.stringify(payload) : null,
      ],
    )
  } catch (err) {
    // Last-resort log; never throw to caller.
    console.error('[lesson-event-dispatch] persistLog failed', err)
  }
}
