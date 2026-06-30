import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { evaluateSaasOfferGate } from '@/lib/auth/guards'
import { getAuthPool } from '@/lib/auth/pool'
import { resolveOperatorSettingsForProbe } from '@/lib/admin/operator-settings'
import { constantTimeEqual } from '@/lib/security/constant-time'
import { takeRateLimit } from '@/lib/security/rate-limit'
import {
  redactTelegramSecret,
  sendTelegramMessage,
  stringifyTelegramError,
} from '@/scripts/lib/telegram-alerts.mjs'

// BCS-DEF-4-TG (2026-05-20) — POST /api/telegram/webhook
//
// Plan: docs/plans/bcs-def-4-tg-telegram-reminders.md §2.4.
//
// Receives Telegram bot updates (registered via setWebhook). Two
// command paths: `/start <code>` (bind) and `/stop` (unbind). All other
// updates are 200-ignored.
//
// Always returns 200 (or 401 on missing secret) — Telegram retries on
// non-2xx, so we MUST NOT signal failure for parse errors, rate limits,
// or unknown command shapes.
//
// Rate-limit: per-`from.id` 20/min via takeRateLimit primitive (NOT
// enforceRateLimit which keys by IP — Telegram's IP would bucket
// everyone together).

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BOT_TOKEN = () => process.env.TELEGRAM_BOT_TOKEN?.trim() || ''
const WEBHOOK_SECRET = () =>
  process.env.TELEGRAM_WEBHOOK_SECRET_TOKEN?.trim() || ''

function logJson(level: 'info' | 'warn', msg: string, extra?: Record<string, unknown>) {
  // eslint-disable-next-line no-console
  console[level === 'info' ? 'log' : 'warn'](
    JSON.stringify({ level, msg, ...extra }),
  )
}

export async function POST(request: Request) {
  // 1. Auth — secret-token header MUST match. Telegram sends
  // `X-Telegram-Bot-Api-Secret-Token` on every update when setWebhook
  // was called with `secret_token`.
  const expectedSecret = WEBHOOK_SECRET()
  if (!expectedSecret) {
    // Operator misconfiguration: master switch on but secret missing.
    // Per plan §2.4 step 1 — return 401 (Telegram doesn't retry 4xx).
    logJson('warn', 'telegram webhook: secret unset; rejecting')
    return NextResponse.json(
      { error: 'webhook_secret_unset' },
      { status: 401, headers: NO_STORE },
    )
  }
  const presented = request.headers.get('x-telegram-bot-api-secret-token') ?? ''
  // 2026-06-02 (security-audit Sub-PR 2, F2 closure): constant-time
  // compare. `!==` short-circuits at first byte mismatch which is a
  // wall-clock side-channel — real exploitability against Telegram is
  // bounded but the project standard is constant-time (cron-auth.ts:80).
  if (!constantTimeEqual(presented, expectedSecret)) {
    return NextResponse.json(
      { error: 'invalid_secret' },
      { status: 401, headers: NO_STORE },
    )
  }

  // 2. Master switch — channel disabled → 200 ignore. Either the
  // learner channel (BCS-DEF-4-TG) OR the teacher digest channel
  // (BCS-DEF-5-TG) being on is enough to accept the webhook. Per-
  // role gating happens inside handleStart via the table the code
  // resolves against.
  const learnerSettings = await resolveOperatorSettingsForProbe(
    'learner-reminders',
  )
  const learnerSwitch =
    typeof learnerSettings.LEARNER_REMINDERS_TELEGRAM_ENABLED?.value === 'number'
      ? (learnerSettings.LEARNER_REMINDERS_TELEGRAM_ENABLED.value as number)
      : 0
  const teacherSettings = await resolveOperatorSettingsForProbe(
    'teacher-daily-digest',
  )
  const teacherSwitch =
    typeof teacherSettings.TEACHER_DIGEST_TELEGRAM_ENABLED?.value === 'number'
      ? (teacherSettings.TEACHER_DIGEST_TELEGRAM_ENABLED.value as number)
      : 0
  if (learnerSwitch !== 1 && teacherSwitch !== 1) {
    return NextResponse.json({ ok: true, ignored: 'channel_disabled' }, { headers: NO_STORE })
  }

  // 3. Body parse.
  let body: unknown
  try {
    body = await request.json()
  } catch {
    logJson('warn', 'telegram webhook: invalid body')
    return NextResponse.json({ ok: true, ignored: 'invalid_body' }, { headers: NO_STORE })
  }
  const update = body as {
    message?: {
      chat?: { id?: number; type?: string }
      from?: { id?: number }
      text?: string
    }
  }
  const message = update?.message
  if (!message) {
    return NextResponse.json({ ok: true, ignored: 'no_message' }, { headers: NO_STORE })
  }

  // 4. Private chat gate.
  if (message.chat?.type !== 'private') {
    // Best-effort polite reject DM to the user — fire-and-forget.
    if (message.chat?.id && BOT_TOKEN()) {
      sendTelegramMessage({
        botToken: BOT_TOKEN(),
        chatId: String(message.chat.id),
        text: 'Привязка работает только в личном чате с ботом.',
        retryMax: 0,
      }).catch(() => {})
    }
    return NextResponse.json({ ok: true, ignored: 'non_private_chat' }, { headers: NO_STORE })
  }

  const fromId = message.from?.id
  const chatId = message.chat?.id
  if (!fromId || !chatId) {
    return NextResponse.json({ ok: true, ignored: 'missing_ids' }, { headers: NO_STORE })
  }

  // 5. Rate-limit: per-from.id 20/min.
  const rl = await takeRateLimit(`tg-webhook:${fromId}`, 20, 60_000)
  if (!rl.allowed) {
    logJson('warn', 'telegram webhook: rate-limited', { fromId })
    return NextResponse.json({ ok: true, ignored: 'rate_limited' }, { headers: NO_STORE })
  }

  // 6. Command dispatch.
  const text = String(message.text || '').trim()
  if (text.startsWith('/start ')) {
    const code = text.slice('/start '.length).trim().toUpperCase()
    await handleStart(code, String(chatId), String(fromId))
  } else if (/^[A-Z0-9]{8}$/i.test(text)) {
    await handleStart(text.toUpperCase(), String(chatId), String(fromId))
  } else if (text === '/start') {
    await replySafe(
      String(chatId),
      'Отправьте /start <код> — код можно получить в личном кабинете LevelChannel.',
    )
  } else if (text === '/stop') {
    await handleStop(String(chatId))
  } else {
    // Unknown command — ignore (don't echo back; reduces noise).
  }

  return NextResponse.json({ ok: true }, { headers: NO_STORE })
}

type BindKind = 'learner' | 'teacher'

async function handleStart(
  code: string,
  chatId: string,
  fromId: string,
): Promise<void> {
  if (!/^[A-Z0-9]{8}$/.test(code)) {
    await replySafe(chatId, 'Код должен быть из 8 символов (буквы и цифры). Получите новый в личном кабинете.')
    return
  }

  const pool = getAuthPool()
  const client = await pool.connect()
  try {
    await client.query('begin')
    // BCS-DEF-5-TG §2.5 — UNION-resolve across both bind-code tables.
    // Code-collision across tables is ~32^8 ≈ 10^12 probability per
    // pair; defensive: if the UNION returns >1 row we bail with an
    // internal-error reply.
    const sel = await client.query<{
      kind: BindKind
      id: string
      account_id: string
    }>(
      `select 'learner'::text as kind, id, account_id
         from learner_telegram_bind_codes
        where code = $1 and consumed_at is null and expires_at > now()
       union all
       select 'teacher'::text as kind, id, account_id
         from teacher_telegram_bind_codes
        where code = $1 and consumed_at is null and expires_at > now()`,
      [code],
    )
    if (sel.rows.length === 0) {
      await client.query('rollback')
      await replySafe(chatId, 'Код не найден или истёк. Получите новый в личном кабинете LevelChannel.')
      return
    }
    if (sel.rows.length > 1) {
      await client.query('rollback')
      logJson('warn', 'tg bind: cross-table code collision', { code, fromId })
      await replySafe(chatId, 'Внутренняя ошибка. Получите новый код в личном кабинете.')
      return
    }
    const { kind, account_id: rawAccountId } = sel.rows[0]
    // BCS-DEF-5-TG-WAVE-PARANOIA round-1 WARN 4 closure: re-check
    // the role-specific master switch HERE. Top-level gate accepts
    // the webhook update if EITHER switch is on (so both channels
    // share one webhook). If a code was issued before its channel's
    // switch was flipped off, the consume must NOT bind silently.
    const scopeName = kind === 'teacher' ? 'teacher-daily-digest' : 'learner-reminders'
    const switchKey = kind === 'teacher'
      ? 'TEACHER_DIGEST_TELEGRAM_ENABLED'
      : 'LEARNER_REMINDERS_TELEGRAM_ENABLED'
    const roleSettings = await resolveOperatorSettingsForProbe(scopeName)
    const roleSwitch =
      typeof roleSettings[switchKey]?.value === 'number'
        ? (roleSettings[switchKey].value as number)
        : 0
    if (roleSwitch !== 1) {
      await client.query('rollback')
      logJson('warn', 'tg bind: per-role switch off after resolve', {
        kind,
        scopeName,
        code,
        fromId,
      })
      await replySafe(
        chatId,
        kind === 'teacher'
          ? 'Канал «дайджест учителя» сейчас выключен оператором. Попробуйте позже.'
          : 'Канал «напоминания учащимся» сейчас выключен оператором. Попробуйте позже.',
      )
      return
    }
    const accountId = String(rawAccountId)

    // Account-scoped advisory lock. Key prefix matches issuance side
    // (ltbc:<accountId> for learner, ttbc:<accountId> for teacher) so
    // issue + consume + auto-unbind on the same account serialise.
    const lockPrefix = kind === 'teacher' ? 'ttbc:' : 'ltbc:'
    await client.query(
      `select pg_advisory_xact_lock(hashtextextended($1 || $2::text, 0))`,
      [lockPrefix, accountId],
    )

    // Re-SELECT FOR UPDATE inside the lock — race-loser bail.
    const reSel = await client.query<{ id: string }>(
      kind === 'teacher'
        ? `select id from teacher_telegram_bind_codes
            where code = $1 and consumed_at is null and expires_at > now()
            for update`
        : `select id from learner_telegram_bind_codes
            where code = $1 and consumed_at is null and expires_at > now()
            for update`,
      [code],
    )
    if (reSel.rows.length === 0) {
      await client.query('rollback')
      await replySafe(chatId, 'Код просрочен или уже использован.')
      return
    }
    const bindRowId = reSel.rows[0].id

    // Account purge gate.
    const acc = await client.query<{ scheduled_purge_at: string | null }>(
      `select scheduled_purge_at from accounts where id = $1::uuid`,
      [accountId],
    )
    if (acc.rows[0]?.scheduled_purge_at) {
      await client.query('rollback')
      await replySafe(chatId, 'Аккаунт недоступен.')
      return
    }

    // A1.1 round-1 BLOCKER#2 closure (2026-05-31) — saas_offer consent
    // gate inline check на teacher-branch. Этот path mutates
    // accounts.teacher_telegram_enabled/chat_id, что является
    // teacher-state mutation — должна попадать в gate perimeter.
    // Учитель без current consent не должен биндить Telegram, даже
    // если у него есть валидный bind code.
    if (kind === 'teacher') {
      const verdict = await evaluateSaasOfferGate(accountId)
      if (verdict.kind !== 'ok') {
        await client.query('rollback')
        await replySafe(
          chatId,
          'Завершите подтверждение SaaS-оферты в кабинете LevelChannel перед привязкой Telegram.',
        )
        return
      }
    }

    // Consume + bind. Branch on kind for the correct table + columns.
    if (kind === 'teacher') {
      await client.query(
        `update teacher_telegram_bind_codes
            set consumed_at = now(), consumed_chat_id = $1
          where id = $2::uuid`,
        [chatId, bindRowId],
      )
      await client.query(
        `update accounts
            set teacher_telegram_enabled = true,
                teacher_telegram_chat_id = $1,
                updated_at = now()
          where id = $2::uuid`,
        [chatId, accountId],
      )
    } else {
      await client.query(
        `update learner_telegram_bind_codes
            set consumed_at = now(), consumed_chat_id = $1
          where id = $2::uuid`,
        [chatId, bindRowId],
      )
      await client.query(
        `update accounts
            set learner_telegram_enabled = true,
                learner_telegram_chat_id = $1,
                updated_at = now()
          where id = $2::uuid`,
        [chatId, accountId],
      )
    }
    await client.query('commit')
    logJson('info', 'tg bind succeeded', { kind, accountId, fromId })
    await replySafe(
      chatId,
      kind === 'teacher'
        ? 'Готово! Утренний дайджест занятий LevelChannel будет приходить сюда в 08:00 по вашему часовому поясу. Чтобы отписаться, отправьте /stop.'
        : 'Готово! Теперь напоминания о занятиях LevelChannel будут приходить сюда. Чтобы отписаться, отправьте /stop.',
    )
  } catch (err) {
    await client.query('rollback').catch(() => {})
    const token = BOT_TOKEN()
    logJson('warn', 'tg bind failed', {
      err: redactTelegramSecret(stringifyTelegramError(err), token),
    })
    await replySafe(chatId, 'Не удалось привязать. Попробуйте позже.')
  } finally {
    client.release()
  }
}

async function handleStop(chatId: string): Promise<void> {
  // BCS-DEF-5-TG §2.5 — /stop unbinds whichever role(s) this chat is
  // bound under. A single Telegram chat can theoretically be bound to
  // both a learner and a teacher account (same person); we unbind any
  // matching row in each column.
  const pool = getAuthPool()
  const learnerR = await pool.query<{ id: string }>(
    `update accounts
        set learner_telegram_enabled = false,
            learner_telegram_chat_id = null,
            updated_at = now()
      where learner_telegram_chat_id = $1 and learner_telegram_enabled = true
      returning id`,
    [chatId],
  )
  const teacherR = await pool.query<{ id: string }>(
    `update accounts
        set teacher_telegram_enabled = false,
            teacher_telegram_chat_id = null,
            updated_at = now()
      where teacher_telegram_chat_id = $1 and teacher_telegram_enabled = true
      returning id`,
    [chatId],
  )
  const unbindCount = learnerR.rows.length + teacherR.rows.length
  if (unbindCount > 0) {
    logJson('info', 'tg unbind via /stop', {
      learnerAccountIds: learnerR.rows.map((row) => row.id),
      teacherAccountIds: teacherR.rows.map((row) => row.id),
    })
    await replySafe(
      chatId,
      'Вы отписались от уведомлений LevelChannel. Чтобы снова подключиться — получите новый код в личном кабинете.',
    )
  } else {
    await replySafe(chatId, 'Подписка не найдена.')
  }
}

async function replySafe(chatId: string, text: string): Promise<void> {
  const token = BOT_TOKEN()
  if (!token) return
  try {
    await sendTelegramMessage({
      botToken: token,
      chatId,
      text,
      retryMax: 1,
    })
  } catch (err) {
    logJson('warn', 'tg reply failed', {
      err: redactTelegramSecret(stringifyTelegramError(err), token),
    })
  }
}
