'use server'

// BCS-DEF-4-TG (2026-05-20) — Server Actions for the learner Telegram
// bind handshake (cabinet UI → bind code → /start <code> webhook).
//
// Plan: docs/plans/bcs-def-4-tg-telegram-reminders.md §3.3.
//
// Auth pattern: cookies() → lookupSession() → redirect('/login') — mirrors
// app/cabinet/profile/page.tsx:33-43.
//
// Rate-limit pattern: enforceAccountRateLimit() returns NextResponse|null;
// Server Actions don't return responses, so we read the Retry-After
// header and surface a data-shape error.

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { getAuthPool } from '@/lib/auth/pool'
import { lookupSession, SESSION_COOKIE_NAME } from '@/lib/auth/sessions'
import { resolveOperatorSettingsForProbe } from '@/lib/admin/operator-settings'
import { enforceAccountRateLimit } from '@/lib/security/account-rate-limit'
import {
  redactTelegramSecret,
  sendTelegramMessage,
  stringifyTelegramError,
} from '@/scripts/lib/telegram-alerts.mjs'

import { issueBindCode } from './store'

export type IssueBindResult =
  | {
      ok: true
      code: string
      expiresAt: string
      botUsername: string | null
    }
  | {
      ok: false
      error: 'rate_limited'
      retryAfterSeconds: number
    }
  | {
      ok: false
      error: 'account_unavailable' | 'channel_disabled'
    }

// Issue a fresh bind code for the authenticated learner. Caller is
// the cabinet UI "Получить код" button.
//
// Gates (in order):
//  1. session auth (redirect to /login if absent)
//  2. account-scoped rate-limit 5/hour
//  3. account not pending purge
//  4. operator master switch LEARNER_REMINDERS_TELEGRAM_ENABLED=1
export async function requestLearnerTelegramBindCode(): Promise<IssueBindResult> {
  const cookieStore = await cookies()
  const cookieValue = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null
  if (!cookieValue) redirect('/login')
  const session = await lookupSession(cookieValue)
  if (!session) redirect('/login')

  const accountId = session.account.id

  // Rate-limit: 5/hour/account. Helper returns NextResponse|null; the
  // retry-after lives in the `Retry-After` HEADER (lib/security/
  // account-rate-limit.ts:37-46), NOT in the JSON body.
  const rl = await enforceAccountRateLimit(
    accountId,
    'cabinet-tg-bind-code',
    5,
    3_600_000,
  )
  if (rl) {
    const retryAfterSeconds = Number(rl.headers.get('Retry-After')) || 3600
    return { ok: false, error: 'rate_limited', retryAfterSeconds }
  }

  if (session.account.scheduledPurgeAt) {
    return { ok: false, error: 'account_unavailable' }
  }

  // Master switch gate — LEARNER_REMINDERS_TELEGRAM_ENABLED lives under
  // scope 'learner-reminders' (it's a learner-channel feature flag,
  // not a Telegram-channel-wide knob — those are scope 'telegram' for
  // operator alerts). Use the per-probe resolver.
  const settings = await resolveOperatorSettingsForProbe('learner-reminders')
  const masterSwitch =
    typeof settings.LEARNER_REMINDERS_TELEGRAM_ENABLED?.value === 'number'
      ? (settings.LEARNER_REMINDERS_TELEGRAM_ENABLED.value as number)
      : 0
  if (masterSwitch !== 1) {
    return { ok: false, error: 'channel_disabled' }
  }

  const row = await issueBindCode(accountId)
  const botUsername = process.env.TELEGRAM_BOT_USERNAME?.trim() || null
  return {
    ok: true,
    code: row.code,
    expiresAt: row.expiresAt,
    botUsername,
  }
}

export type UnbindResult =
  | { ok: true; courtesyDmSent: boolean }
  | { ok: false; error: 'rate_limited'; retryAfterSeconds: number }
  | { ok: false; error: 'not_bound' }

// Unbind: flips accounts.learner_telegram_{enabled,chat_id} → false/null.
// Captures the prior chat_id via SELECT FOR UPDATE BEFORE the UPDATE
// (RETURNING would give NULL post-update) so we can fire a courtesy
// "Вы отписаны" DM.
export async function unbindLearnerTelegram(): Promise<UnbindResult> {
  const cookieStore = await cookies()
  const cookieValue = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null
  if (!cookieValue) redirect('/login')
  const session = await lookupSession(cookieValue)
  if (!session) redirect('/login')

  const accountId = session.account.id

  const rl = await enforceAccountRateLimit(
    accountId,
    'cabinet-tg-unbind',
    5,
    3_600_000,
  )
  if (rl) {
    const retryAfterSeconds = Number(rl.headers.get('Retry-After')) || 3600
    return { ok: false, error: 'rate_limited', retryAfterSeconds }
  }

  const pool = getAuthPool()
  const client = await pool.connect()
  let priorChatId: string | null = null
  try {
    await client.query('begin')
    // Account-scoped advisory lock — serializes with webhook's bind
    // and any other unbind. Hash function matches scripts/learner-
    // reminder-dispatch.mjs precedent.
    await client.query(
      `select pg_advisory_xact_lock(hashtextextended('ltbc:' || $1::text, 0))`,
      [accountId],
    )
    const sel = await client.query<{ chat_id: string | null }>(
      `select learner_telegram_chat_id as chat_id
         from accounts
        where id = $1::uuid
          and learner_telegram_enabled = true
        for update`,
      [accountId],
    )
    if (sel.rows.length === 0) {
      await client.query('rollback')
      return { ok: false, error: 'not_bound' }
    }
    priorChatId = sel.rows[0].chat_id ?? null
    await client.query(
      `update accounts
          set learner_telegram_enabled = false,
              learner_telegram_chat_id = null,
              updated_at = now()
        where id = $1::uuid`,
      [accountId],
    )
    await client.query('commit')
  } catch (err) {
    await client.query('rollback').catch(() => {})
    throw err
  } finally {
    client.release()
  }

  // Fire-and-forget courtesy DM. Helper redacts; we also re-redact at
  // the boundary defensively.
  let courtesyDmSent = false
  if (priorChatId) {
    const token = process.env.TELEGRAM_BOT_TOKEN?.trim() || ''
    if (token) {
      try {
        const result = await sendTelegramMessage({
          botToken: token,
          chatId: priorChatId,
          text:
            'Вы отписались от напоминаний LevelChannel. Если передумаете — ' +
            'получите новый код в личном кабинете на levelchannel.ru.',
          retryMax: 1,
        })
        courtesyDmSent = result.ok === true
      } catch (err) {
        // Swallow + redact for log hygiene.
        // eslint-disable-next-line no-console
        console.warn(
          '[unbindLearnerTelegram] courtesy DM threw',
          redactTelegramSecret(stringifyTelegramError(err), token),
        )
      }
    }
  }

  return { ok: true, courtesyDmSent }
}
