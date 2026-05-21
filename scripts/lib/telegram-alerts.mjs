// BCS-DEF-1-TG (2026-05-19) — Telegram alert delivery helper for the
// operator-side systemd probes.
//
// Plan: docs/plans/bcs-def-1-tg-telegram-alerts.md.
//
// Pure ESM, zero deps — Node 22+ ships native `fetch` and
// `AbortController`. Probes import this from the .mjs scripts.
//
// Threat-surface contract (plan §4.1, §2.6, §3.1b):
//
//   Node's `fetch()` puts the request URL
//   `https://api.telegram.org/bot<TOKEN>/sendMessage` into
//   `TypeError.message` on connect failure and into the abort-error
//   chain. Any string derived from such an exception MUST pass through
//   `redactTelegramSecret(text, token)` BEFORE crossing into:
//     (a) recordProbeRun({errorMessage}),
//     (b) console.warn/error log lines,
//     (c) any test-send route JSON response.
//
//   The redactor replaces (a) the full token, (b) the token's last 8
//   chars, (c) any `bot<token-shape>` substring with `[REDACTED]`. All
//   three forms are removed in the same pass so leakage cannot fall
//   through any one branch.
//
// Send semantics (plan §2.6.1 `tryTelegramChannel` internals):
//
//   - 4096-char cap on `text`; over-long returns `{ok:false,
//     error:'telegram_body_too_long'}` WITHOUT an API call.
//   - 4xx (e.g. 403 bot blocked) is non-retryable; one attempt.
//   - 5xx + network throw retries with 1s linear backoff up to
//     `retryMax`; final failure returns `{ok:false,
//     error:'telegram_5xx_after_retries' | 'telegram_network_after_retries'}`.
//   - 429 honours `parameters.retry_after` (seconds), capped at 5s, up
//     to `retryMax` attempts; final failure returns `{ok:false,
//     error:'telegram_429_after_retries', retryAfterSeconds}`.
//   - Every fetch is wrapped in an AbortController with a 5s wall-clock
//     timeout so a hung Telegram connection cannot stall the systemd
//     job indefinitely. Plan §2.6.1 documented a 10s budget; we use 5s
//     to keep the dispatch loop tight (4 retries × 5s = 20s
//     worst-case, well inside a 30-min systemd tick).
//   - `disable_web_page_preview: true` is always set so a deep-link
//     URL in the body never expands into a Telegram preview card.
//
// No `process.env` capture: token + chatId are passed in as
// arguments. The helper has no globals so unit tests can pin
// behaviour without env shimming.

// BCS-DEF-4-TG-PROXY (2026-05-21) — allow overriding the Telegram
// API base URL via env. Mandatory for VPS-locations where
// api.telegram.org is blocked (Roskomnadzor on RU hosting). Set to a
// Cloudflare-Worker reverse proxy URL such as
// `https://tg-proxy.<user>.workers.dev` — the worker forwards
// /bot<TOKEN>/<method> verbatim to api.telegram.org. The trailing
// slash, if any, is stripped at read time. Default keeps the
// direct path so existing dev / non-RU deployments are unaffected.
const TELEGRAM_API_BASE = (
  process.env.TELEGRAM_API_BASE_URL?.trim() || 'https://api.telegram.org'
).replace(/\/+$/, '')

const MAX_BODY_CHARS = 4096
const FETCH_TIMEOUT_MS = 5_000
const BACKOFF_MS = 1_000
const RETRY_AFTER_CAP_S = 5

/**
 * Redact every form of a Telegram bot token in an arbitrary string.
 *
 * Strategy:
 *   1. Replace the full token, if present.
 *   2. Replace the bot-prefixed URL form `bot<TOKEN>` (Node's fetch
 *      embeds this verbatim in TypeError.message on connect failure).
 *   3. Replace the last 8 chars of the token (covers paranoid
 *      forward-compat: any Telegram 4xx description that included a
 *      token suffix would leak otherwise).
 *
 * The substitutions run in token-first order so the long form is
 * replaced before its substrings would be. All forms collapse to
 * the literal string `[REDACTED]`.
 *
 * Empty token → pass-through (defensive: probe runs without a token
 * configured shouldn't crash the redactor).
 *
 * @param {string} text
 * @param {string} token
 * @returns {string}
 */
export function redactTelegramSecret(text, token) {
  if (typeof text !== 'string') {
    return ''
  }
  if (typeof token !== 'string' || token.length === 0) {
    return text
  }
  let out = text
  // 1. Full token.
  if (token.length > 0) {
    out = out.split(token).join('[REDACTED]')
  }
  // 2. `bot<token>` URL form. Telegram tokens look like
  //    `<digits>:<base64-ish>`; we escape the literal token for regex.
  //    After (1) the literal token is already gone, but a partial token
  //    after a `bot` prefix is still possible in pathological error
  //    strings (e.g. truncated stack traces). We catch `bot<digits>:`
  //    fragments and replace through to a non-token boundary.
  out = out.replace(/bot\d{6,}:[A-Za-z0-9_-]{0,}/g, '[REDACTED]')
  // 3. Token's last 8 chars — defensive against future 4xx descriptions
  //    that echo a token suffix. Length floor 8 keeps us from redacting
  //    benign substrings on a malformed token.
  if (token.length >= 8) {
    const tail = token.slice(-8)
    out = out.split(tail).join('[REDACTED]')
  }
  return out
}

/**
 * Stringify any throwable into a single line suitable for the
 * redactor's input contract. Captures both `message` and `cause` so
 * the AbortError chain (where the underlying TypeError carries the
 * URL) is not lost.
 *
 * @param {unknown} err
 * @returns {string}
 */
export function stringifyTelegramError(err) {
  if (err instanceof Error) {
    const cause = err.cause ? ` (cause: ${String(err.cause)})` : ''
    return `${err.name}: ${err.message}${cause}`
  }
  return String(err)
}

/**
 * Sleep helper — Promise-wrapped setTimeout. Inline so the helper
 * stays zero-dep.
 *
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/**
 * One Telegram sendMessage attempt with an AbortController wall-clock
 * timeout. Returns a discriminated union so the caller can drive the
 * retry policy without parsing exceptions.
 *
 * The fetch implementation is overridable for tests (mocked via the
 * options bag); production callers pass the global `fetch`.
 *
 * @param {{
 *   token: string,
 *   chatId: string,
 *   text: string,
 *   fetchImpl?: typeof fetch,
 *   timeoutMs?: number,
 * }} params
 * @returns {Promise<
 *   | { kind: 'ok', messageId: string }
 *   | { kind: 'client_error', status: number, description: string }
 *   | { kind: 'rate_limited', retryAfterSeconds: number, description: string }
 *   | { kind: 'server_error', status: number, description: string }
 *   | { kind: 'network_error', error: string }
 *   | { kind: 'abort', error: string }
 * >}
 */
async function sendOnce({
  token,
  chatId,
  text,
  fetchImpl = fetch,
  timeoutMs = FETCH_TIMEOUT_MS,
}) {
  const url = `${TELEGRAM_API_BASE}/bot${token}/sendMessage`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let response
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      }),
      signal: controller.signal,
    })
  } catch (err) {
    clearTimeout(timer)
    const stringified = stringifyTelegramError(err)
    const redacted = redactTelegramSecret(stringified, token)
    if (
      err instanceof Error
      && (err.name === 'AbortError' || err.name === 'TimeoutError')
    ) {
      return { kind: 'abort', error: redacted }
    }
    return { kind: 'network_error', error: redacted }
  }
  clearTimeout(timer)

  /** @type {unknown} */
  let body
  try {
    body = await response.json()
  } catch (parseErr) {
    const stringified = stringifyTelegramError(parseErr)
    const redacted = redactTelegramSecret(stringified, token)
    if (response.status >= 500) {
      return { kind: 'server_error', status: response.status, description: redacted }
    }
    if (response.status >= 400) {
      return { kind: 'client_error', status: response.status, description: redacted }
    }
    return { kind: 'server_error', status: response.status, description: redacted }
  }

  const bodyObj =
    typeof body === 'object' && body !== null ? /** @type {Record<string, unknown>} */ (body) : {}
  const description = redactTelegramSecret(
    typeof bodyObj.description === 'string' ? bodyObj.description : '',
    token,
  )

  if (response.ok && bodyObj.ok === true) {
    const result = bodyObj.result
    const messageId =
      typeof result === 'object'
      && result !== null
      && 'message_id' in result
      && (typeof (/** @type {Record<string, unknown>} */ (result)).message_id === 'number'
        || typeof (/** @type {Record<string, unknown>} */ (result)).message_id === 'string')
        ? String((/** @type {Record<string, unknown>} */ (result)).message_id)
        : ''
    return { kind: 'ok', messageId }
  }

  if (response.status === 429) {
    const params =
      typeof bodyObj.parameters === 'object' && bodyObj.parameters !== null
        ? /** @type {Record<string, unknown>} */ (bodyObj.parameters)
        : {}
    const retryAfterRaw = params.retry_after
    const retryAfterSeconds =
      typeof retryAfterRaw === 'number' && Number.isFinite(retryAfterRaw)
        ? Math.max(0, Math.floor(retryAfterRaw))
        : 1
    return { kind: 'rate_limited', retryAfterSeconds, description }
  }

  if (response.status >= 500) {
    return { kind: 'server_error', status: response.status, description }
  }
  return { kind: 'client_error', status: response.status, description }
}

/**
 * Send a Telegram message with retry policy described in the module
 * header. The return shape mirrors what `tryTelegramChannel` in each
 * probe forwards to `recordProbeRun`:
 *
 *   { ok: true, messageId }
 *   { ok: false, error: <enum>, detail?: string, retryAfterSeconds?: number }
 *
 * `error` is one of the strings documented inline; `detail` carries a
 * redacted human-readable suffix for the probe_runs.error_message
 * column.
 *
 * @param {{
 *   botToken: string,
 *   chatId: string,
 *   text: string,
 *   retryMax?: number,
 *   fetchImpl?: typeof fetch,
 *   timeoutMs?: number,
 *   backoffMs?: number,
 *   sleepImpl?: (ms: number) => Promise<void>,
 * }} params
 * @returns {Promise<
 *   | { ok: true, messageId: string }
 *   | { ok: false, error: string, detail?: string, retryAfterSeconds?: number }
 * >}
 */
export async function sendTelegramMessage({
  botToken,
  chatId,
  text,
  retryMax = 2,
  fetchImpl = fetch,
  timeoutMs = FETCH_TIMEOUT_MS,
  backoffMs = BACKOFF_MS,
  sleepImpl = sleep,
}) {
  if (typeof botToken !== 'string' || botToken.length === 0) {
    return { ok: false, error: 'telegram_missing_token' }
  }
  if (typeof chatId !== 'string' || chatId.length === 0) {
    return { ok: false, error: 'telegram_missing_chat_id' }
  }
  if (typeof text !== 'string' || text.length === 0) {
    return { ok: false, error: 'telegram_empty_body' }
  }
  if (text.length > MAX_BODY_CHARS) {
    return { ok: false, error: 'telegram_body_too_long' }
  }
  const maxAttempts = Math.max(1, Math.floor(retryMax) + 1)
  /** @type {{ ok: false, error: string, detail?: string, retryAfterSeconds?: number } | null} */
  let lastFailure = null
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const result = await sendOnce({
      token: botToken,
      chatId,
      text,
      fetchImpl,
      timeoutMs,
    })
    if (result.kind === 'ok') {
      return { ok: true, messageId: result.messageId }
    }
    if (result.kind === 'client_error') {
      // 4xx — non-retryable. Return immediately.
      return {
        ok: false,
        error: `telegram_${result.status}`,
        detail: result.description || `status_${result.status}`,
      }
    }
    if (result.kind === 'rate_limited') {
      lastFailure = {
        ok: false,
        error: 'telegram_429_after_retries',
        detail: result.description || 'rate_limited',
        retryAfterSeconds: result.retryAfterSeconds,
      }
      if (attempt < maxAttempts - 1) {
        const waitS = Math.min(result.retryAfterSeconds, RETRY_AFTER_CAP_S)
        await sleepImpl(Math.max(0, waitS) * 1000)
        continue
      }
      return lastFailure
    }
    if (result.kind === 'server_error') {
      lastFailure = {
        ok: false,
        error: 'telegram_5xx_after_retries',
        detail: result.description || `status_${result.status}`,
      }
      if (attempt < maxAttempts - 1) {
        await sleepImpl(backoffMs)
        continue
      }
      return lastFailure
    }
    if (result.kind === 'network_error' || result.kind === 'abort') {
      const errorKey =
        result.kind === 'abort'
          ? 'telegram_abort_after_retries'
          : 'telegram_network_after_retries'
      lastFailure = {
        ok: false,
        error: errorKey,
        detail: result.error,
      }
      if (attempt < maxAttempts - 1) {
        await sleepImpl(backoffMs)
        continue
      }
      return lastFailure
    }
  }
  // Defensive fallthrough — every branch above either returns or
  // assigns lastFailure + continues; this only hits if maxAttempts<1.
  return lastFailure ?? { ok: false, error: 'telegram_no_attempts' }
}
