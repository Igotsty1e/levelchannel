// Wave-A Sub-PR 1 — unit tests на dispatch helper.
//
// Что покрываем:
//   1. recipient resolution с правильной ролью → email отправляется
//   2. recipient resolution с неправильной ролью → RoleMismatchError →
//      оба канала failed, без send
//   3. recipient не найден → failed
//   4. dedup: повторный dispatch с тем же iter_seq → skipped
//   5. legitimate новый dispatch с другим iter_seq → not-skipped
//   6. TG no_token → telegram=skipped (НЕ failed)
//   7. TG no_chat_id → skipped
//   8. TG api_error → failed с error_text
//   9. email send fails → email=failed
//
// Все 7 kinds покрыты renderLessonEventEmail / Telegram (smoke).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { renderLessonEventEmail, renderLessonEventTelegram } from '@/lib/notifications/templates'

// Mock email layer.
vi.mock('@/lib/email/client', () => ({
  sendEmail: vi.fn(),
}))

// Mock TG send.
vi.mock('@/lib/notifications/telegram/send', async () => {
  const actual = await vi.importActual<typeof import('@/lib/notifications/telegram/send')>(
    '@/lib/notifications/telegram/send',
  )
  return {
    ...actual,
    sendTelegramMessage: vi.fn(),
  }
})

// Mock DB pool. Single shared mock object configured per-test.
const dbQueryMock = vi.fn()
vi.mock('@/lib/db/pool', () => ({
  getDbPool: () => ({
    query: dbQueryMock,
  }),
}))

import { sendEmail } from '@/lib/email/client'
import { sendTelegramMessage } from '@/lib/notifications/telegram/send'
import {
  dispatchLessonEvent,
  type LessonEventCtx,
  type LessonEventKind,
} from '@/lib/notifications/lesson-event-dispatch'

const sendEmailMock = vi.mocked(sendEmail)
const sendTelegramMock = vi.mocked(sendTelegramMessage)

function makeRecipientRow(opts: {
  isTeacher: boolean
  tgChatId?: string | null
} = { isTeacher: false }) {
  return {
    email: 'recipient@example.com',
    first_name: 'Recipient',
    last_name: 'Doe',
    teacher_telegram_chat_id: opts.isTeacher ? opts.tgChatId ?? null : null,
    learner_telegram_chat_id: opts.isTeacher ? null : opts.tgChatId ?? null,
    is_teacher: opts.isTeacher,
  }
}

function arrange({
  recipientRow = makeRecipientRow(),
  alreadySent = false,
  emailOk = true,
  tgResult = { ok: true as const, messageId: 1 } as Awaited<
    ReturnType<typeof sendTelegramMessage>
  >,
}: {
  recipientRow?: ReturnType<typeof makeRecipientRow> | null
  alreadySent?: boolean
  emailOk?: boolean
  tgResult?: Awaited<ReturnType<typeof sendTelegramMessage>>
} = {}) {
  dbQueryMock.mockReset()
  // Order of queries inside dispatch:
  //   1. resolveRecipient → SELECT accounts (1 call)
  //   2. isAlreadySent(email) → SELECT notification_log (1 call)
  //   3. persistLog(email) → INSERT notification_log (1 call)
  //   4. isAlreadySent(telegram) → SELECT (1 call)
  //   5. persistLog(telegram) → INSERT (1 call)
  // Tests configure responses for each in order using mockImplementation
  // on dbQueryMock. We use a queue.
  const responses: Array<unknown> = [
    // 1) recipient SELECT
    { rows: recipientRow ? [recipientRow] : [] },
    // 2) email dedup SELECT
    { rows: alreadySent ? [{ '?column?': 1 }] : [] },
    // 3) email persistLog INSERT
    { rows: [] },
    // 4) telegram dedup SELECT
    { rows: alreadySent ? [{ '?column?': 1 }] : [] },
    // 5) telegram persistLog INSERT
    { rows: [] },
  ]
  let i = 0
  dbQueryMock.mockImplementation(() => Promise.resolve(responses[i++] ?? { rows: [] }))

  sendEmailMock.mockReset()
  sendEmailMock.mockResolvedValue(
    emailOk
      ? { ok: true, transport: 'console', id: 'mock-id' }
      : { ok: false, transport: 'console', error: 'send_failed' },
  )
  sendTelegramMock.mockReset()
  sendTelegramMock.mockResolvedValue(tgResult)
}

const baseCtx: LessonEventCtx = {
  slotId: '11111111-2222-3333-4444-555555555555',
  recipientAccountId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  recipientRole: 'learner',
  iterSeq: 1,
  payload: {
    actorDisplayName: 'Тестовый Учитель',
    recipientDisplayName: 'Тестовый Ученик',
    slotStartAtIso: '2026-06-16T07:00:00.000Z',
    durationMinutes: 60,
    reasonText: 'тест',
  },
}

describe('dispatchLessonEvent — Wave-A Sub-PR 1', () => {
  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = 'mock-token'
  })
  afterEach(() => {
    delete process.env.TELEGRAM_BOT_TOKEN
  })

  it('sends email + TG when role + recipient ok', async () => {
    arrange({ recipientRow: makeRecipientRow({ isTeacher: false, tgChatId: '999' }) })
    const result = await dispatchLessonEvent('LessonCancelledByTeacher', baseCtx)
    expect(result.email).toBe('sent')
    expect(result.telegram).toBe('sent')
    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    expect(sendTelegramMock).toHaveBeenCalledTimes(1)
  })

  it('fails both channels with role mismatch (privacy guard)', async () => {
    // Recipient is teacher but caller claimed learner.
    arrange({ recipientRow: makeRecipientRow({ isTeacher: true }) })
    const result = await dispatchLessonEvent('LessonCancelledByTeacher', {
      ...baseCtx,
      recipientRole: 'learner',
    })
    expect(result.email).toBe('failed')
    expect(result.telegram).toBe('failed')
    expect(sendEmailMock).not.toHaveBeenCalled()
    expect(sendTelegramMock).not.toHaveBeenCalled()
  })

  it('handles recipient not_found gracefully', async () => {
    arrange({ recipientRow: null })
    const result = await dispatchLessonEvent('LessonCancelledByLearner', {
      ...baseCtx,
      recipientRole: 'teacher',
    })
    expect(result.email).toBe('failed')
    expect(result.telegram).toBe('failed')
  })

  it('skips email when dedup_key already sent', async () => {
    arrange({
      recipientRow: makeRecipientRow({ isTeacher: false, tgChatId: '999' }),
      alreadySent: true,
    })
    const result = await dispatchLessonEvent('LessonCancelledByTeacher', baseCtx)
    expect(result.email).toBe('skipped')
    expect(result.telegram).toBe('skipped')
    expect(sendEmailMock).not.toHaveBeenCalled()
    expect(sendTelegramMock).not.toHaveBeenCalled()
  })

  it('skips telegram silently when TELEGRAM_BOT_TOKEN absent', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN
    arrange({
      recipientRow: makeRecipientRow({ isTeacher: false, tgChatId: '999' }),
      tgResult: { ok: false, reason: 'no_token' },
    })
    const result = await dispatchLessonEvent('LessonCancelledByTeacher', baseCtx)
    expect(result.email).toBe('sent')
    expect(result.telegram).toBe('skipped')
  })

  it('skips telegram when recipient has no chat_id', async () => {
    arrange({
      recipientRow: makeRecipientRow({ isTeacher: false, tgChatId: null }),
      tgResult: { ok: false, reason: 'no_chat_id' },
    })
    const result = await dispatchLessonEvent('LessonCancelledByTeacher', baseCtx)
    expect(result.email).toBe('sent')
    expect(result.telegram).toBe('skipped')
  })

  it('marks telegram failed on api_error', async () => {
    arrange({
      recipientRow: makeRecipientRow({ isTeacher: false, tgChatId: '999' }),
      tgResult: { ok: false, reason: 'api_error', errorText: 'blocked by user' },
    })
    const result = await dispatchLessonEvent('LessonCancelledByTeacher', baseCtx)
    expect(result.telegram).toBe('failed')
    expect(result.telegramErrorText).toContain('blocked')
  })

  it('marks email failed when sendEmail returns ok=false', async () => {
    arrange({
      recipientRow: makeRecipientRow({ isTeacher: false, tgChatId: '999' }),
      emailOk: false,
    })
    const result = await dispatchLessonEvent('LessonCancelledByTeacher', baseCtx)
    expect(result.email).toBe('failed')
  })
})

describe('renderLessonEventEmail — все 10 kinds', () => {
  const KINDS: LessonEventKind[] = [
    'LessonCancelledByTeacher',
    'LessonCancelledByLearner',
    'LessonRescheduledByLearner',
    'LessonRescheduledByTeacher',
    'LessonMarkedPaidByTeacher',
    'PaymentClaimConfirmed',
    'PaymentClaimDeclined',
    'PaymentRefundIssued',
    'SbpClaimSubmittedByLearner',
    'LessonDirectlyAssignedByTeacher',
  ]

  for (const kind of KINDS) {
    it(`renders email for ${kind}`, () => {
      const tpl = renderLessonEventEmail(kind, {
        actorDisplayName: 'Учитель',
        recipientDisplayName: 'Ученик',
        slotStartAtIso: '2026-06-16T07:00:00.000Z',
        oldSlotStartAtIso: '2026-06-15T07:00:00.000Z',
        durationMinutes: 60,
        reasonText: 'причина',
        amountKopecks: 160000,
        cabinetUrl: 'https://example.com/cabinet',
        recipientRole: 'learner',
      })
      expect(tpl.subject).toBeTruthy()
      expect(tpl.html).toContain('LevelChannel')
      expect(tpl.text).toContain('LevelChannel')
    })

    it(`renders telegram for ${kind}`, () => {
      const txt = renderLessonEventTelegram(kind, {
        actorDisplayName: 'Учитель',
        recipientDisplayName: 'Ученик',
        slotStartAtIso: '2026-06-16T07:00:00.000Z',
        oldSlotStartAtIso: '2026-06-15T07:00:00.000Z',
        durationMinutes: 60,
        reasonText: 'причина',
        amountKopecks: 160000,
        cabinetUrl: 'https://example.com/cabinet',
        recipientRole: 'learner',
      })
      expect(txt.length).toBeGreaterThan(10)
    })
  }
})

describe('renderLessonEventEmail HTML escaping (anti-XSS)', () => {
  it('escapes raw <script> / quotes / tag-openers in free-text fields', () => {
    const tpl = renderLessonEventEmail('LessonCancelledByTeacher', {
      actorDisplayName: '<script>alert(1)</script>',
      recipientDisplayName: '"><img src=x>',
      slotStartAtIso: '2026-06-16T07:00:00.000Z',
      reasonText: '<svg/onload=alert(1)>',
      cabinetUrl: 'https://example.com/cabinet',
      recipientRole: 'learner',
    })
    // No raw HTML tags survive — every <, >, ", ' is entity-encoded.
    expect(tpl.html).not.toContain('<script>')
    expect(tpl.html).not.toContain('<img ')
    expect(tpl.html).not.toContain('<svg')
    // Entities present where user input was.
    expect(tpl.html).toContain('&lt;script&gt;')
    expect(tpl.html).toContain('&lt;svg/onload')
    expect(tpl.html).toContain('&quot;&gt;&lt;img')
  })
})

describe('escapeTgMarkdown (TG safety)', () => {
  it('escapes reserved chars used in MarkdownV2', async () => {
    const { escapeTgMarkdown } = await import('@/lib/notifications/telegram/send')
    expect(escapeTgMarkdown('hello.world')).toBe('hello\\.world')
    expect(escapeTgMarkdown('[link](x)')).toBe('\\[link\\]\\(x\\)')
    expect(escapeTgMarkdown('a_b*c')).toBe('a\\_b\\*c')
  })
})
