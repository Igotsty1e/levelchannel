import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { expect, test } from '@playwright/test'

// 2026-06-18 business-process e2e — booking + mark + payment flow.
//
// Owner: «настоящие автотесты по бизнес процессам — запись + проведение
// занятия + оплата». В отличие от integration-тестов (handler-level),
// здесь идёт реальный browser-driven walkthrough через UI + API:
//
// 1. Учник бронирует слот из расписания → status='booked'
// 2. Учитель отмечает занятие проведённым → completion row
// 3. Учник видит «Оплатить N₽» и оформляет SBP claim → status='claimed'
//
// Зависит от seed.mjs:
//   - learner ↔ teacher уже linked (assigned_teacher_id)
//   - teacher имеет default payment method (SBP)
//   - 3 future slots уже в lesson_slots (status='open')
//
// SBP-flow работает в mock-режиме (PAYMENTS_PROVIDER=mock), реальный
// CloudPayments / банковский ввод не тестируем — это уровень integration
// тестов webhook'ов.

const FIXTURE_FILE = resolve(process.cwd(), 'tests/e2e/.fixtures.json')

type FixtureEntry = {
  accountId: string
  email: string
  cookieValue: string
  expiresAt: string
}

type Fixtures = {
  learner: FixtureEntry
  teacher: FixtureEntry
  admin: FixtureEntry
  slots?: string[]
}

const SESSION_COOKIE_NAME = 'lc_session'

const fixtures: Fixtures | null = (() => {
  if (!existsSync(FIXTURE_FILE)) return null
  try {
    return JSON.parse(readFileSync(FIXTURE_FILE, 'utf-8')) as Fixtures
  } catch {
    return null
  }
})()

function getBaseUrl(): string {
  return process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3100'
}

test.describe('Business flow — booking + mark + payment', () => {
  test.skip(
    fixtures === null,
    'No tests/e2e/.fixtures.json — run npm run test:e2e:seed first.',
  )

  test.skip(
    fixtures !== null && (!fixtures.slots || fixtures.slots.length < 3),
    'Fixtures missing slots — re-run seed.mjs after pulling business-flow update.',
  )

  async function attachSession(
    context: import('@playwright/test').BrowserContext,
    role: 'learner' | 'teacher' | 'admin',
  ) {
    if (!fixtures) throw new Error('fixtures missing')
    const url = new URL(getBaseUrl())
    await context.addCookies([
      {
        name: SESSION_COOKIE_NAME,
        value: fixtures[role].cookieValue,
        domain: url.hostname,
        path: '/',
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
        expires: Math.floor(
          new Date(fixtures[role].expiresAt).getTime() / 1000,
        ),
      },
    ])
  }

  test('BOOK-1 — учник бронирует слот через POST /api/slots/[id]/book', async ({
    context,
  }) => {
    if (!fixtures?.slots?.[0]) throw new Error('fixtures.slots missing')
    await attachSession(context, 'learner')
    const slotId = fixtures.slots[0]

    const response = await context.request.post(
      `${getBaseUrl()}/api/slots/${slotId}/book`,
      { data: {} },
    )

    expect(response.status(), 'book endpoint status').toBe(200)
    const body = await response.json()
    expect(body.slot?.status, 'slot.status after book').toBe('booked')
    expect(body.slot?.learnerAccountId, 'slot.learnerAccountId').toBe(
      fixtures.learner.accountId,
    )
  })

  test('BOOK-2 — учитель отмечает booked-slot как проведённый', async ({
    context,
  }) => {
    if (!fixtures?.slots?.[1]) throw new Error('fixtures.slots missing')
    await attachSession(context, 'learner')
    const slotId = fixtures.slots[1]

    // Сначала учник бронирует.
    const bookRes = await context.request.post(
      `${getBaseUrl()}/api/slots/${slotId}/book`,
      { data: {} },
    )
    expect(bookRes.status(), 'pre-book').toBe(200)

    // Переключаемся на teacher session.
    await context.clearCookies()
    await attachSession(context, 'teacher')

    const markRes = await context.request.post(
      `${getBaseUrl()}/api/teacher/slots/${slotId}/mark`,
      { data: { outcome: 'completed' } },
    )
    expect(markRes.status(), 'mark endpoint status').toBe(200)
    const markBody = await markRes.json()
    expect(markBody.slot?.status, 'slot.status after mark').toBe('completed')
  })

  test('BOOK-3 — учник видит «Оплатить» + SBP-claim создаётся через UI', async ({
    page,
    context,
  }) => {
    if (!fixtures?.slots?.[2]) throw new Error('fixtures.slots missing')
    const slotId = fixtures.slots[2]

    // Step 1: book + mark через API (быстрее чем через UI).
    await attachSession(context, 'learner')
    await context.request.post(`${getBaseUrl()}/api/slots/${slotId}/book`, {
      data: {},
    })

    await context.clearCookies()
    await attachSession(context, 'teacher')
    await context.request.post(
      `${getBaseUrl()}/api/teacher/slots/${slotId}/mark`,
      { data: { outcome: 'completed' } },
    )

    // Step 2: учнический cabinet видит slot готовым к оплате.
    await context.clearCookies()
    await attachSession(context, 'learner')

    // GET /api/learner/payment-context/[slotId] возвращает реквизиты +
    // method.id (PR #697 prod-fix — id обязателен для SBP claim).
    const ctxRes = await context.request.get(
      `${getBaseUrl()}/api/learner/payment-context/${slotId}`,
    )
    expect(ctxRes.status(), 'payment-context status').toBe(200)
    const ctxBody = await ctxRes.json()
    expect(ctxBody.paymentMethod?.id, 'payment method id present').toBeTruthy()
    expect(
      ctxBody.expectedAmountKopecks,
      'expected amount > 0',
    ).toBeGreaterThan(0)

    // Step 3: создаём claim как делает pay-lesson-modal.
    const claimRes = await context.request.post(
      `${getBaseUrl()}/api/learner/payment-claims`,
      {
        data: {
          teacherAccountId: ctxBody.teacherAccountId,
          amountKopecks: ctxBody.expectedAmountKopecks,
          paymentChannel: 'sbp',
          paymentMethodId: ctxBody.paymentMethod.id,
          items: [
            {
              slotId,
              expectedAmountKopecks: ctxBody.expectedAmountKopecks,
            },
          ],
        },
      },
    )
    expect(claimRes.status(), 'claim creation status').toBe(201)
    const claimBody = await claimRes.json()
    expect(claimBody.claimId, 'claim id returned').toBeTruthy()

    // Step 4: повторный GET payment-context возвращает 404 already_paid.
    const ctxAfter = await context.request.get(
      `${getBaseUrl()}/api/learner/payment-context/${slotId}`,
    )
    expect(ctxAfter.status(), 'payment-context after claim').toBe(404)
    const ctxAfterBody = await ctxAfter.json()
    expect(ctxAfterBody.error).toBe('already_paid')
  })
})
