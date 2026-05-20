import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { getAuthPool } from '@/lib/auth/pool'
import { resolveOperatorSettingsForProbe } from '@/lib/admin/operator-settings'
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
  if (presented !== expectedSecret) {
    return NextResponse.json(
      { error: 'invalid_secret' },
      { status: 401, headers: NO_STORE },
    )
  }

  // 2. Master switch — channel disabled → 200 ignore (don't have TG
  // retry on operator-toggle).
  const settings = await resolveOperatorSettingsForProbe('learner-reminders')
  const masterSwitch =
    typeof settings.LEARNER_REMINDERS_TELEGRAM_ENABLED?.value === 'number'
      ? (settings.LEARNER_REMINDERS_TELEGRAM_ENABLED.value as number)
      : 0
  if (masterSwitch !== 1) {
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
    // Look up + consume atomically under account lock.
    const sel = await client.query<{ id: string; account_id: string }>(
      `select id, account_id from learner_telegram_bind_codes
        where code = $1 and consumed_at is null and expires_at > now()
        for update`,
      [code],
    )
    if (sel.rows.length === 0) {
      await client.query('rollback')
      await replySafe(chatId, 'Код не найден или истёк. Получите новый в личном кабинете LevelChannel.')
      return
    }
    const bindRow = sel.rows[0]
    const accountId = String(bindRow.account_id)

    // Account lock — serializes with cabinet unbind + scheduler reads.
    await client.query(
      `select pg_advisory_xact_lock(hashtextextended('ltbc:' || $1::text, 0))`,
      [accountId],
    )

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

    // Consume + bind.
    await client.query(
      `update learner_telegram_bind_codes
          set consumed_at = now(), consumed_chat_id = $1
        where id = $2::uuid`,
      [chatId, bindRow.id],
    )
    await client.query(
      `update accounts
          set learner_telegram_enabled = true,
              learner_telegram_chat_id = $1,
              updated_at = now()
        where id = $2::uuid`,
      [chatId, accountId],
    )
    await client.query('commit')
    logJson('info', 'tg bind succeeded', { accountId, fromId })
    await replySafe(
      chatId,
      'Готово! Теперь напоминания о занятиях LevelChannel будут приходить сюда. Чтобы отписаться, отправьте /stop.',
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
  const pool = getAuthPool()
  const r = await pool.query<{ id: string }>(
    `update accounts
        set learner_telegram_enabled = false,
            learner_telegram_chat_id = null,
            updated_at = now()
      where learner_telegram_chat_id = $1 and learner_telegram_enabled = true
      returning id`,
    [chatId],
  )
  if (r.rows.length > 0) {
    logJson('info', 'tg unbind via /stop', { accountId: r.rows[0].id })
    await replySafe(
      chatId,
      'Вы отписались от напоминаний LevelChannel. Чтобы снова подключиться — получите новый код в личном кабинете.',
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
