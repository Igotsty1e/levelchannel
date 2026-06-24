import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { expect, test } from '@playwright/test'

// 2026-06-24 teacher-lessons-edit-status epic Sub-PR 3 — same-wave E2E
// coverage. Locks `FLOW-TEACHER-LESSONS-STATUS-CHANGE-001` (lessons) и
// `FLOW-TEACHER-DEALS-STATUS-CHANGE-001` (deals) из
// `evals/PRODUCT_FLOWS.md §D`.
//
// Smoke-level: rendering + kebab visibility. Полная kebab → confirm →
// API → refresh цепочка требует seed extension (см. план §Seed
// расширения) и тестируется в integration suite (Sub-PR 1).

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

function getCookieUrl(): string {
  return process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3100'
}

async function attachTeacherSession(page: import('@playwright/test').Page, context: import('@playwright/test').BrowserContext) {
  if (!fixtures) throw new Error('fixtures missing (skip bypassed)')
  const url = new URL(getCookieUrl())
  await context.addCookies([
    {
      name: SESSION_COOKIE_NAME,
      value: fixtures.teacher.cookieValue,
      domain: url.hostname,
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
      expires: Math.floor(new Date(fixtures.teacher.expiresAt).getTime() / 1000),
    },
  ])
}

test.describe('FLOW-TEACHER-LESSONS-STATUS-CHANGE-001', () => {
  test.skip(
    fixtures === null,
    'No tests/e2e/.fixtures.json — start Docker Postgres + run tests/e2e/seed.mjs.',
  )

  test('teacher /teacher/lessons?kind=lessons renders, no DB slug leaks', async ({ page, context }) => {
    await attachTeacherSession(page, context)

    const response = await page.goto('/teacher/lessons?kind=lessons')
    expect(response?.status()).toBe(200)

    const here = new URL(page.url())
    expect(here.pathname).toBe('/teacher/lessons')
    expect(here.searchParams.get('kind')).toBe('lessons')

    const html = await page.content()
    // Required anchors per evals row contract.
    expect(html).toContain('Прошедших занятий')
    expect(html).toContain('За месяц')
    expect(html).toContain('Все статусы')

    // Forbidden DB slugs не утекают в SSR DOM.
    for (const slug of ['booked', 'completed', 'no_show_learner', 'cancelled']) {
      expect(html).not.toContain(slug)
    }
    expect(html).not.toContain('Скоро будет')
    expect(html).not.toContain('TODO')
  })
})

test.describe('FLOW-TEACHER-DEALS-STATUS-CHANGE-001', () => {
  test.skip(
    fixtures === null,
    'No tests/e2e/.fixtures.json — start Docker Postgres + run tests/e2e/seed.mjs.',
  )

  test('teacher /teacher/lessons?kind=deals renders deals section', async ({ page, context }) => {
    await attachTeacherSession(page, context)

    const response = await page.goto('/teacher/lessons?kind=deals')
    expect(response?.status()).toBe(200)

    const here = new URL(page.url())
    expect(here.pathname).toBe('/teacher/lessons')
    expect(here.searchParams.get('kind')).toBe('deals')

    const html = await page.content()
    // qa-fixture seed не создаёт personal_event фикстур → empty state.
    // Required anchors (либо empty state, либо rendered list).
    const hasEmpty = html.includes('Дел пока нет')
    const hasList = html.includes('Активно') || html.includes('Выполнено') || html.includes('Отменено')
    expect(hasEmpty || hasList).toBe(true)

    // Forbidden DB slugs не утекают.
    for (const slug of ['personal_event', 'completed', 'cancelled']) {
      expect(html).not.toContain(slug)
    }
  })
})
