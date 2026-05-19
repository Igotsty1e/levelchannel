import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve as resolvePath } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

// BCS-DEF-1-TG (2026-05-19) — unit tests for `scripts/lib/telegram-alerts.mjs`.
// Plan: docs/plans/bcs-def-1-tg-telegram-alerts.md §3.1 + §3.1b.
//
// Dynamic import keeps vitest's TS transform from choking on the .mjs
// before runtime, same pattern as tests/admin/operator-settings.test.ts
// and tests/scripts/conflict-unresolved-alert.test.ts.

const moduleUrl = new URL(
  '../../scripts/lib/telegram-alerts.mjs',
  import.meta.url,
).href

interface TelegramHelpers {
  sendTelegramMessage: (params: {
    botToken: string
    chatId: string
    text: string
    retryMax?: number
    fetchImpl?: typeof fetch
    timeoutMs?: number
    backoffMs?: number
    sleepImpl?: (ms: number) => Promise<void>
  }) => Promise<{ ok: true; messageId: string } | {
    ok: false
    error: string
    detail?: string
    retryAfterSeconds?: number
  }>
  redactTelegramSecret: (text: string, token: string) => string
  stringifyTelegramError: (err: unknown) => string
}

async function loadModule(): Promise<TelegramHelpers> {
  return (await import(moduleUrl)) as TelegramHelpers
}

const FAKE_TOKEN = '1234567890:ABCDEFGHijklmnopQRSTuvwxyz_-XYZ123'
const FAKE_CHAT = '999000111'
const FAKE_BODY = 'hello'

// Tiny fetch stub: returns a sequence of responses keyed by attempt
// index. Each entry is either a Response-like object or a thrown error.
type StubAttempt =
  | { status: number; json: unknown }
  | { throws: Error }

function makeFetchStub(attempts: StubAttempt[]): {
  fetchImpl: typeof fetch
  calls: { url: string; init: RequestInit | undefined }[]
} {
  const calls: { url: string; init: RequestInit | undefined }[] = []
  let idx = 0
  const fetchImpl = (async (
    url: string | URL | Request,
    init?: RequestInit,
  ) => {
    calls.push({ url: String(url), init })
    const attempt = attempts[idx]
    idx += 1
    if (!attempt) {
      throw new Error(`fetch stub exhausted after ${calls.length} calls`)
    }
    if ('throws' in attempt) throw attempt.throws
    const body = JSON.stringify(attempt.json)
    return new Response(body, {
      status: attempt.status,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch
  return { fetchImpl, calls }
}

const noopSleep = async (_ms: number) => {
  // no-op so retry tests don't actually wait
}

describe('redactTelegramSecret', () => {
  it('replaces the full token verbatim', async () => {
    const { redactTelegramSecret } = await loadModule()
    const out = redactTelegramSecret(
      `network error with ${FAKE_TOKEN} embedded`,
      FAKE_TOKEN,
    )
    expect(out).not.toContain(FAKE_TOKEN)
    expect(out).toContain('[REDACTED]')
  })

  it('replaces the bot<token>: URL form left by Node fetch TypeError', async () => {
    const { redactTelegramSecret } = await loadModule()
    const raw = `TypeError: fetch failed at https://api.telegram.org/bot${FAKE_TOKEN}/sendMessage`
    const out = redactTelegramSecret(raw, FAKE_TOKEN)
    expect(out).not.toContain(FAKE_TOKEN)
    expect(out).not.toMatch(/bot1234567890/)
    expect(out).toContain('[REDACTED]')
  })

  it("replaces the token's last 8 chars (paranoid forward-compat)", async () => {
    const { redactTelegramSecret } = await loadModule()
    const tail = FAKE_TOKEN.slice(-8) // '_-XYZ123'
    const raw = `Forbidden: bot was blocked, token suffix ${tail}`
    const out = redactTelegramSecret(raw, FAKE_TOKEN)
    expect(out).not.toContain(tail)
    expect(out).toContain('[REDACTED]')
  })

  it('redacts all FOUR fixture forms in a single pass', async () => {
    const { redactTelegramSecret } = await loadModule()
    const here = dirname(fileURLToPath(import.meta.url))
    const fixturePath = resolvePath(
      here,
      'fixtures/telegram-fetch-errors.json',
    )
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf-8')) as {
      _token_used_to_capture: string
      fixtures: Record<string, string>
    }
    const token = fixture._token_used_to_capture
    const tail = token.slice(-8)
    for (const [name, raw] of Object.entries(fixture.fixtures)) {
      const redacted = redactTelegramSecret(raw, token)
      expect(redacted, `${name}: full token absent`).not.toContain(token)
      expect(redacted, `${name}: tail absent`).not.toContain(tail)
      expect(
        redacted,
        `${name}: bot1234567890 prefix absent`,
      ).not.toMatch(/bot1234567890/)
    }
  })

  it('empty / non-string token passes input through (defensive)', async () => {
    const { redactTelegramSecret } = await loadModule()
    expect(redactTelegramSecret('some error', '')).toBe('some error')
    expect(
      redactTelegramSecret('some error', undefined as unknown as string),
    ).toBe('some error')
  })

  it('non-string text returns empty string', async () => {
    const { redactTelegramSecret } = await loadModule()
    expect(redactTelegramSecret(undefined as unknown as string, FAKE_TOKEN)).toBe('')
    expect(redactTelegramSecret(null as unknown as string, FAKE_TOKEN)).toBe('')
  })
})

describe('sendTelegramMessage — input validation', () => {
  it('empty token → telegram_missing_token, no fetch call', async () => {
    const { sendTelegramMessage } = await loadModule()
    const { fetchImpl, calls } = makeFetchStub([])
    const r = await sendTelegramMessage({
      botToken: '',
      chatId: FAKE_CHAT,
      text: FAKE_BODY,
      fetchImpl,
      sleepImpl: noopSleep,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('telegram_missing_token')
    expect(calls.length).toBe(0)
  })

  it('empty chat id → telegram_missing_chat_id, no fetch call', async () => {
    const { sendTelegramMessage } = await loadModule()
    const { fetchImpl, calls } = makeFetchStub([])
    const r = await sendTelegramMessage({
      botToken: FAKE_TOKEN,
      chatId: '',
      text: FAKE_BODY,
      fetchImpl,
      sleepImpl: noopSleep,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('telegram_missing_chat_id')
    expect(calls.length).toBe(0)
  })

  it('body over 4096 chars → telegram_body_too_long, no fetch call', async () => {
    const { sendTelegramMessage } = await loadModule()
    const { fetchImpl, calls } = makeFetchStub([])
    const r = await sendTelegramMessage({
      botToken: FAKE_TOKEN,
      chatId: FAKE_CHAT,
      text: 'x'.repeat(4097),
      fetchImpl,
      sleepImpl: noopSleep,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('telegram_body_too_long')
    expect(calls.length).toBe(0)
  })
})

describe('sendTelegramMessage — happy path', () => {
  it('200 ok → returns messageId, sets disable_web_page_preview', async () => {
    const { sendTelegramMessage } = await loadModule()
    const { fetchImpl, calls } = makeFetchStub([
      { status: 200, json: { ok: true, result: { message_id: 42 } } },
    ])
    const r = await sendTelegramMessage({
      botToken: FAKE_TOKEN,
      chatId: FAKE_CHAT,
      text: FAKE_BODY,
      fetchImpl,
      sleepImpl: noopSleep,
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.messageId).toBe('42')
    expect(calls.length).toBe(1)
    const body = JSON.parse(String(calls[0].init?.body))
    expect(body.disable_web_page_preview).toBe(true)
    expect(body.chat_id).toBe(FAKE_CHAT)
    expect(body.text).toBe(FAKE_BODY)
    expect(String(calls[0].url)).toContain(`/bot${FAKE_TOKEN}/sendMessage`)
  })
})

describe('sendTelegramMessage — 4xx (non-retryable)', () => {
  it('403 bot blocked → returns immediately, no retry', async () => {
    const { sendTelegramMessage } = await loadModule()
    const { fetchImpl, calls } = makeFetchStub([
      {
        status: 403,
        json: { ok: false, description: 'Forbidden: bot was blocked' },
      },
    ])
    const r = await sendTelegramMessage({
      botToken: FAKE_TOKEN,
      chatId: FAKE_CHAT,
      text: FAKE_BODY,
      retryMax: 3,
      fetchImpl,
      sleepImpl: noopSleep,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toBe('telegram_403')
      expect(r.detail).toContain('Forbidden')
    }
    expect(calls.length).toBe(1)
  })
})

describe('sendTelegramMessage — 5xx (retryable)', () => {
  it('500 → 500 → 200 with retryMax=2 succeeds after retries', async () => {
    const { sendTelegramMessage } = await loadModule()
    const { fetchImpl, calls } = makeFetchStub([
      { status: 500, json: { ok: false, description: 'srv down' } },
      { status: 500, json: { ok: false, description: 'srv down' } },
      { status: 200, json: { ok: true, result: { message_id: 7 } } },
    ])
    const r = await sendTelegramMessage({
      botToken: FAKE_TOKEN,
      chatId: FAKE_CHAT,
      text: FAKE_BODY,
      retryMax: 2,
      fetchImpl,
      sleepImpl: noopSleep,
      backoffMs: 0,
    })
    expect(r.ok).toBe(true)
    expect(calls.length).toBe(3)
  })

  it('all attempts 5xx → telegram_5xx_after_retries', async () => {
    const { sendTelegramMessage } = await loadModule()
    const { fetchImpl, calls } = makeFetchStub([
      { status: 502, json: { ok: false, description: 'bad gateway' } },
      { status: 502, json: { ok: false, description: 'bad gateway' } },
      { status: 502, json: { ok: false, description: 'bad gateway' } },
    ])
    const r = await sendTelegramMessage({
      botToken: FAKE_TOKEN,
      chatId: FAKE_CHAT,
      text: FAKE_BODY,
      retryMax: 2,
      fetchImpl,
      sleepImpl: noopSleep,
      backoffMs: 0,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('telegram_5xx_after_retries')
    expect(calls.length).toBe(3)
  })
})

describe('sendTelegramMessage — 429 rate limit', () => {
  it('429 with retry_after → respects cap then retries', async () => {
    const { sendTelegramMessage } = await loadModule()
    const { fetchImpl, calls } = makeFetchStub([
      {
        status: 429,
        json: {
          ok: false,
          description: 'Too Many Requests',
          parameters: { retry_after: 2 },
        },
      },
      { status: 200, json: { ok: true, result: { message_id: 11 } } },
    ])
    const sleeps: number[] = []
    const r = await sendTelegramMessage({
      botToken: FAKE_TOKEN,
      chatId: FAKE_CHAT,
      text: FAKE_BODY,
      retryMax: 2,
      fetchImpl,
      sleepImpl: async (ms) => {
        sleeps.push(ms)
      },
    })
    expect(r.ok).toBe(true)
    expect(calls.length).toBe(2)
    // 2 seconds is within the 5s cap.
    expect(sleeps[0]).toBe(2_000)
  })

  it('429 over and over → telegram_429_after_retries with retryAfterSeconds', async () => {
    const { sendTelegramMessage } = await loadModule()
    const { fetchImpl } = makeFetchStub([
      {
        status: 429,
        json: { ok: false, parameters: { retry_after: 1 } },
      },
      {
        status: 429,
        json: { ok: false, parameters: { retry_after: 1 } },
      },
      {
        status: 429,
        json: { ok: false, parameters: { retry_after: 1 } },
      },
    ])
    const r = await sendTelegramMessage({
      botToken: FAKE_TOKEN,
      chatId: FAKE_CHAT,
      text: FAKE_BODY,
      retryMax: 2,
      fetchImpl,
      sleepImpl: noopSleep,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toBe('telegram_429_after_retries')
      expect(r.retryAfterSeconds).toBe(1)
    }
  })
})

describe('sendTelegramMessage — network errors / aborts', () => {
  it('TypeError network throw → retries → eventually succeeds', async () => {
    const { sendTelegramMessage } = await loadModule()
    const networkErr = new TypeError(
      `fetch failed at https://api.telegram.org/bot${FAKE_TOKEN}/sendMessage`,
    )
    const { fetchImpl, calls } = makeFetchStub([
      { throws: networkErr },
      { status: 200, json: { ok: true, result: { message_id: 99 } } },
    ])
    const r = await sendTelegramMessage({
      botToken: FAKE_TOKEN,
      chatId: FAKE_CHAT,
      text: FAKE_BODY,
      retryMax: 2,
      fetchImpl,
      sleepImpl: noopSleep,
      backoffMs: 0,
    })
    expect(r.ok).toBe(true)
    expect(calls.length).toBe(2)
  })

  it('all network throws → telegram_network_after_retries with REDACTED detail', async () => {
    const { sendTelegramMessage } = await loadModule()
    // The TypeError carries the FULL token in its message — the
    // redactor MUST scrub it before it lands in `detail`.
    const networkErr = new TypeError(
      `fetch failed at https://api.telegram.org/bot${FAKE_TOKEN}/sendMessage`,
    )
    const { fetchImpl } = makeFetchStub([
      { throws: networkErr },
      { throws: networkErr },
      { throws: networkErr },
    ])
    const r = await sendTelegramMessage({
      botToken: FAKE_TOKEN,
      chatId: FAKE_CHAT,
      text: FAKE_BODY,
      retryMax: 2,
      fetchImpl,
      sleepImpl: noopSleep,
      backoffMs: 0,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toBe('telegram_network_after_retries')
      // Critical: token MUST NOT leak into the detail string.
      expect(r.detail ?? '').not.toContain(FAKE_TOKEN)
      expect(r.detail ?? '').not.toContain(FAKE_TOKEN.slice(-8))
      expect(r.detail ?? '').toContain('[REDACTED]')
    }
  })

  it('AbortError → returns telegram_abort_after_retries with REDACTED detail', async () => {
    const { sendTelegramMessage } = await loadModule()
    const abortErr = new Error(
      `This operation was aborted at https://api.telegram.org/bot${FAKE_TOKEN}/sendMessage`,
    )
    abortErr.name = 'AbortError'
    const { fetchImpl } = makeFetchStub([
      { throws: abortErr },
      { throws: abortErr },
    ])
    const r = await sendTelegramMessage({
      botToken: FAKE_TOKEN,
      chatId: FAKE_CHAT,
      text: FAKE_BODY,
      retryMax: 1,
      fetchImpl,
      sleepImpl: noopSleep,
      backoffMs: 0,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toBe('telegram_abort_after_retries')
      expect(r.detail ?? '').not.toContain(FAKE_TOKEN)
    }
  })
})

describe('sendTelegramMessage — JSON parse failure', () => {
  it('200 with non-JSON body → server_error path, no crash', async () => {
    const { sendTelegramMessage } = await loadModule()
    let attempts = 0
    const fetchImpl = (async () => {
      attempts += 1
      // Force JSON parse to fail.
      return new Response('not json', { status: 200 })
    }) as unknown as typeof fetch
    const r = await sendTelegramMessage({
      botToken: FAKE_TOKEN,
      chatId: FAKE_CHAT,
      text: FAKE_BODY,
      retryMax: 1,
      fetchImpl,
      sleepImpl: noopSleep,
      backoffMs: 0,
    })
    // 200 + JSON parse fail is bucketed as server_error → retries.
    expect(r.ok).toBe(false)
    expect(attempts).toBeGreaterThanOrEqual(1)
  })
})

describe('AbortController timeout', () => {
  it('fetch that never resolves is aborted by the timeout', async () => {
    const { sendTelegramMessage } = await loadModule()
    // fetch that listens for the abort signal and rejects.
    const fetchImpl = (async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      return await new Promise<Response>((_resolve, reject) => {
        const sig = init?.signal
        if (sig) {
          if (sig.aborted) {
            const err = new Error('aborted')
            err.name = 'AbortError'
            reject(err)
            return
          }
          sig.addEventListener('abort', () => {
            const err = new Error('aborted')
            err.name = 'AbortError'
            reject(err)
          })
        }
        // Otherwise hang forever.
      })
    }) as unknown as typeof fetch
    const r = await sendTelegramMessage({
      botToken: FAKE_TOKEN,
      chatId: FAKE_CHAT,
      text: FAKE_BODY,
      retryMax: 0,
      fetchImpl,
      timeoutMs: 10, // very short
      sleepImpl: noopSleep,
      backoffMs: 0,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('telegram_abort_after_retries')
  })
})

// Ensure vi import isn't optimized away (some lint configs flag unused).
vi.useFakeTimers
