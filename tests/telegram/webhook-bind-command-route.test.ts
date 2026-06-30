import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolveOperatorSettingsForProbeMock = vi.fn()
const evaluateSaasOfferGateMock = vi.fn()
const takeRateLimitMock = vi.fn()
const sendTelegramMessageMock = vi.fn()
const clientQueryMock = vi.fn()
const clientReleaseMock = vi.fn()

vi.mock('@/lib/admin/operator-settings', () => ({
  resolveOperatorSettingsForProbe: (...args: unknown[]) =>
    resolveOperatorSettingsForProbeMock(...args),
}))

vi.mock('@/lib/auth/guards', () => ({
  evaluateSaasOfferGate: (...args: unknown[]) =>
    evaluateSaasOfferGateMock(...args),
}))

vi.mock('@/lib/security/constant-time', () => ({
  constantTimeEqual: vi.fn((a: string, b: string) => a === b),
}))

vi.mock('@/lib/security/rate-limit', () => ({
  takeRateLimit: (...args: unknown[]) => takeRateLimitMock(...args),
}))

vi.mock('@/lib/auth/pool', () => ({
  getAuthPool: () => ({
    connect: async () => ({
      query: (...args: unknown[]) => clientQueryMock(...args),
      release: clientReleaseMock,
    }),
  }),
}))

vi.mock('@/scripts/lib/telegram-alerts.mjs', () => ({
  redactTelegramSecret: vi.fn((text: string) => text),
  stringifyTelegramError: vi.fn((err: unknown) =>
    err instanceof Error ? err.message : String(err),
  ),
  sendTelegramMessage: (...args: unknown[]) => sendTelegramMessageMock(...args),
}))

import { POST } from '@/app/api/telegram/webhook/route'

describe('POST /api/telegram/webhook — raw bind-code alias', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.TELEGRAM_WEBHOOK_SECRET_TOKEN = 'secret'
    process.env.TELEGRAM_BOT_TOKEN = 'bot-token'

    resolveOperatorSettingsForProbeMock.mockImplementation(
      async (scope: string) => {
        if (scope === 'learner-reminders') {
          return { LEARNER_REMINDERS_TELEGRAM_ENABLED: { value: 0 } }
        }
        if (scope === 'teacher-daily-digest') {
          return { TEACHER_DIGEST_TELEGRAM_ENABLED: { value: 1 } }
        }
        return {}
      },
    )
    evaluateSaasOfferGateMock.mockResolvedValue({ kind: 'ok' })
    takeRateLimitMock.mockResolvedValue({ allowed: true })
    sendTelegramMessageMock.mockResolvedValue({ ok: true, messageId: '1' })

    clientQueryMock.mockImplementation(async (query: unknown) => {
      const text = typeof query === 'string' ? query : String(query)
      if (text === 'begin' || text === 'commit') return { rows: [] }
      if (text.includes('union all')) {
        return {
          rows: [{ kind: 'teacher', id: 'bind-1', account_id: 'account-1' }],
        }
      }
      if (text.includes('pg_advisory_xact_lock')) return { rows: [] }
      if (text.includes('select id from teacher_telegram_bind_codes')) {
        return { rows: [{ id: 'bind-1' }] }
      }
      if (text.includes('select scheduled_purge_at from accounts')) {
        return { rows: [{ scheduled_purge_at: null }] }
      }
      if (
        text.includes('update teacher_telegram_bind_codes')
        || text.includes('update accounts')
      ) {
        return { rows: [] }
      }
      throw new Error(`Unexpected query: ${text}`)
    })
  })

  it('treats a raw 8-char code like /start <code>', async () => {
    const req = new Request('https://levelchannel.ru/api/telegram/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-telegram-bot-api-secret-token': 'secret',
      },
      body: JSON.stringify({
        message: {
          chat: { id: 101, type: 'private' },
          from: { id: 202 },
          text: 'ZLNLZJFV',
        },
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(sendTelegramMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: '101',
        text: expect.stringContaining('Утренний дайджест занятий'),
      }),
    )
  })
})
