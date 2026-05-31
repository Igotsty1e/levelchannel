'use server'

// BCS-DEF-5-TG (2026-05-21) — Server Actions for the teacher Telegram
// bind handshake (cabinet UI → bind code → /start <code> webhook).
//
// Plan: docs/plans/bcs-def-5-tg-teacher-telegram-reminders.md §2.6.
//
// Mirror of lib/learner-telegram-bind/actions.ts. Differences:
//   - master switch lives under scope 'teacher-daily-digest'
//     (TEACHER_DIGEST_TELEGRAM_ENABLED), not 'learner-reminders'.
//   - role gate re-checks `listAccountRoles(account.id).includes('teacher')`
//     before issuing — the layout already blocks non-teachers but the
//     Server Action runs server-side without that layout, so re-check.
//   - advisory-lock prefix is `ttbc:` (matches webhook + helper).

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { listAccountRoles } from '@/lib/auth/accounts'
import { evaluateSaasOfferGate } from '@/lib/auth/guards'
import { getAuthPool } from '@/lib/auth/pool'
import { lookupSession, SESSION_COOKIE_NAME } from '@/lib/auth/sessions'
import { resolveOperatorSettingsForProbe } from '@/lib/admin/operator-settings'
import { enforceAccountRateLimit } from '@/lib/security/account-rate-limit'
import {
  redactTelegramSecret,
  sendTelegramMessage,
  stringifyTelegramError,
} from '@/scripts/lib/telegram-alerts.mjs'

import { issueTeacherBindCode } from './store'

export type TeacherIssueBindResult =
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
      error: 'account_unavailable' | 'channel_disabled' | 'not_teacher'
    }

export async function requestTeacherTelegramBindCode(): Promise<TeacherIssueBindResult> {
  const cookieStore = await cookies()
  const cookieValue = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null
  if (!cookieValue) redirect('/login')
  const session = await lookupSession(cookieValue)
  if (!session) redirect('/login')

  const accountId = session.account.id

  // Defense-in-depth — the layout blocks non-teachers, but the action
  // itself is reachable server-side. Reject anyone without the teacher
  // grant.
  const roles = await listAccountRoles(accountId)
  if (!roles.includes('teacher')) {
    return { ok: false, error: 'not_teacher' }
  }

  // A1.1 round-1 BLOCKER#2 closure (2026-05-31) — saas_offer consent
  // gate inline check на teacher action. Issuance side: non-consenting
  // teacher не должен получать bind code. Webhook consume side gates
  // отдельно (см. app/api/telegram/webhook/route.ts), но issuance
  // блокирует раньше — user не получит код в кабинете без consent.
  const saasVerdict = await evaluateSaasOfferGate(accountId)
  if (saasVerdict.kind !== 'ok') {
    return { ok: false, error: 'not_teacher' }
  }

  const rl = await enforceAccountRateLimit(
    accountId,
    'teacher-tg-bind-code',
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

  // Master switch — TEACHER_DIGEST_TELEGRAM_ENABLED lives under scope
  // 'teacher-daily-digest' (per lib/admin/operator-settings.ts §2.3).
  const settings = await resolveOperatorSettingsForProbe('teacher-daily-digest')
  const masterSwitch =
    typeof settings.TEACHER_DIGEST_TELEGRAM_ENABLED?.value === 'number'
      ? (settings.TEACHER_DIGEST_TELEGRAM_ENABLED.value as number)
      : 0
  if (masterSwitch !== 1) {
    return { ok: false, error: 'channel_disabled' }
  }

  const row = await issueTeacherBindCode(accountId)
  const botUsername = process.env.TELEGRAM_BOT_USERNAME?.trim() || null
  return {
    ok: true,
    code: row.code,
    expiresAt: row.expiresAt,
    botUsername,
  }
}

export type TeacherUnbindResult =
  | { ok: true; courtesyDmSent: boolean }
  | { ok: false; error: 'rate_limited'; retryAfterSeconds: number }
  | { ok: false; error: 'not_bound' | 'not_teacher' }

export async function unbindTeacherTelegram(): Promise<TeacherUnbindResult> {
  const cookieStore = await cookies()
  const cookieValue = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null
  if (!cookieValue) redirect('/login')
  const session = await lookupSession(cookieValue)
  if (!session) redirect('/login')

  const accountId = session.account.id

  const roles = await listAccountRoles(accountId)
  if (!roles.includes('teacher')) {
    return { ok: false, error: 'not_teacher' }
  }

  const rl = await enforceAccountRateLimit(
    accountId,
    'teacher-tg-unbind',
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
    await client.query(
      `select pg_advisory_xact_lock(hashtextextended('ttbc:' || $1::text, 0))`,
      [accountId],
    )
    const sel = await client.query<{ chat_id: string | null }>(
      `select teacher_telegram_chat_id as chat_id
         from accounts
        where id = $1::uuid
          and teacher_telegram_enabled = true
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
          set teacher_telegram_enabled = false,
              teacher_telegram_chat_id = null,
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

  let courtesyDmSent = false
  if (priorChatId) {
    const token = process.env.TELEGRAM_BOT_TOKEN?.trim() || ''
    if (token) {
      try {
        const result = await sendTelegramMessage({
          botToken: token,
          chatId: priorChatId,
          text:
            'Вы отписались от утреннего дайджеста LevelChannel в Telegram. ' +
            'Если передумаете — получите новый код в личном кабинете.',
          retryMax: 1,
        })
        courtesyDmSent = result.ok === true
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          '[unbindTeacherTelegram] courtesy DM threw',
          redactTelegramSecret(stringifyTelegramError(err), token),
        )
      }
    }
  }

  return { ok: true, courtesyDmSent }
}
