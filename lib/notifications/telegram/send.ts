// Wave-A — thin wrapper for Telegram Bot API sendMessage.
//
// Reuses lessons from scripts/lib/telegram-alerts.mjs but stays inside
// the @/ alias surface so app routes + tests can mock it via
// `vi.mock('@/lib/notifications/telegram/send')`.
//
// Self-review BLOCKER #3 fix: AbortController 5s timeout. Без него
// зависшее TG API hang'ит весь dispatch который вызывается в hot
// post-mutation path.
//
// Self-review WARN fix: BOT_TOKEN отсутствует → return
// { ok: false, reason: 'no_token' } — caller отметит as 'skipped' в
// notification_log, без error.

export type TelegramSendResult =
  | { ok: true; messageId: number }
  | { ok: false; reason: 'no_token' | 'no_chat_id' | 'timeout' | 'api_error'; errorText?: string }

const TELEGRAM_TIMEOUT_MS = 5_000

// Reuses TELEGRAM_API_BASE_URL — same env-contract used by the rest of
// the codebase (see .env.example).
const TELEGRAM_API_BASE =
  process.env.TELEGRAM_API_BASE_URL?.trim() || 'https://api.telegram.org'

export async function sendTelegramMessage(
  chatId: string | null,
  text: string,
  options: { parseMode?: 'MarkdownV2' | 'HTML' } = {},
): Promise<TelegramSendResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim()
  if (!token) return { ok: false, reason: 'no_token' }
  if (!chatId) return { ok: false, reason: 'no_chat_id' }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TELEGRAM_TIMEOUT_MS)
  try {
    const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        ...(options.parseMode ? { parse_mode: options.parseMode } : {}),
        disable_web_page_preview: true,
      }),
      signal: controller.signal,
    })
    const body = (await response.json().catch(() => ({}))) as {
      ok?: boolean
      description?: string
      result?: { message_id?: number }
    }
    if (!response.ok || !body.ok) {
      return {
        ok: false,
        reason: 'api_error',
        errorText: body.description || `HTTP ${response.status}`,
      }
    }
    return { ok: true, messageId: body.result?.message_id ?? 0 }
  } catch (err) {
    if ((err as { name?: string }).name === 'AbortError') {
      return { ok: false, reason: 'timeout' }
    }
    return {
      ok: false,
      reason: 'api_error',
      errorText: err instanceof Error ? err.message : String(err),
    }
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Escape MarkdownV2 reserved characters per
 * https://core.telegram.org/bots/api#markdownv2-style
 * Use in templates around any user-provided string before composing the
 * full message.
 */
export function escapeTgMarkdown(input: string): string {
  return input.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1')
}
