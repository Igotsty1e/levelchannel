import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { expect, test } from '@playwright/test'

// Authenticated product-flow Playwright suite.
//
// Skipped when `tests/e2e/.fixtures.json` is absent — local dev without
// Docker Postgres falls back to the public/anon-only suite. CI bring-up
// runs `tests/e2e/seed.mjs` to populate the fixture file before invoking
// Playwright.
//
// Source of truth: `evals/PRODUCT_FLOWS.md` rows in §G (postponed flows).
// Each test name carries the FLOW-* ID and the contract row it locks in.

// Playwright runs tests from the repo root; the fixture file is written
// by `tests/e2e/seed.mjs` at this fixed path.
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

test.describe('Authenticated product flows', () => {
  test.skip(
    fixtures === null,
    'No tests/e2e/.fixtures.json — start Docker Postgres + run tests/e2e/seed.mjs. See PRODUCT_FLOWS.md §G.',
  )

  // Suite-wide: block external CloudPayments CDN.
  test.beforeEach(async ({ context }) => {
    await context.route(/widget\.cloudpayments\.ru/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: '',
      })
    })
  })

  async function attachSession(
    context: import('@playwright/test').BrowserContext,
    role: keyof Fixtures,
  ) {
    if (!fixtures) throw new Error('fixtures missing (skip guard bypassed)')
    const url = new URL(getCookieUrl())
    await context.addCookies([
      {
        name: SESSION_COOKIE_NAME,
        value: fixtures[role].cookieValue,
        domain: url.hostname,
        path: '/',
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
        expires: Math.floor(new Date(fixtures[role].expiresAt).getTime() / 1000),
      },
    ])
  }

  test('FLOW-LEARNER-CABINET-001 learner /cabinet renders, no redirect', async ({
    page,
    context,
  }) => {
    await attachSession(context, 'learner')
    const response = await page.goto('/cabinet')
    expect(response?.status(), 'GET /cabinet status').toBe(200)
    expect(new URL(page.url()).pathname).toBe('/cabinet')
  })

  test('FLOW-LEARNER-BOOK-001 learner /cabinet/book renders, no redirect', async ({
    page,
    context,
  }) => {
    await attachSession(context, 'learner')
    const response = await page.goto('/cabinet/book')
    expect(response?.status(), 'GET /cabinet/book status').toBe(200)
    expect(new URL(page.url()).pathname).toBe('/cabinet/book')
  })

  test('FLOW-LEARNER-PACKAGES-001 learner /cabinet/packages renders, no redirect', async ({
    page,
    context,
  }) => {
    await attachSession(context, 'learner')
    const response = await page.goto('/cabinet/packages')
    expect(response?.status(), 'GET /cabinet/packages status').toBe(200)
    expect(new URL(page.url()).pathname).toBe('/cabinet/packages')
  })

  test('FLOW-TEACHER-CABINET-001 teacher /teacher renders, no redirect', async ({
    page,
    context,
  }) => {
    await attachSession(context, 'teacher')
    const response = await page.goto('/teacher')
    expect(response?.status(), 'GET /teacher status').toBe(200)
    expect(new URL(page.url()).pathname).toBe('/teacher')
  })

  test('FLOW-TEACHER-CALENDAR-SETTINGS-001 teacher /teacher/settings/calendar renders (state-aware Скоро будет permitted)', async ({
    page,
    context,
  }) => {
    await attachSession(context, 'teacher')
    const response = await page.goto('/teacher/settings/calendar')
    expect(response?.status()).toBe(200)
    expect(new URL(page.url()).pathname).toBe('/teacher/settings/calendar')
    // Note: «Скоро будет» IS allowed on this surface — state-aware
    // placeholder when GOOGLE_CALENDAR_* env vars are unset. We assert
    // only the URL contract and 200 status, not copy.
  })

  test('FLOW-ADMIN-DASHBOARD-001 admin /admin/dashboard renders, no redirect', async ({
    page,
    context,
  }) => {
    await attachSession(context, 'admin')
    const response = await page.goto('/admin/dashboard')
    expect(response?.status(), 'GET /admin/dashboard status').toBe(200)
    expect(new URL(page.url()).pathname).toBe('/admin/dashboard')
  })

  // R-AMBIG-1 contract: teacher-only role on /cabinet/settings/calendar
  // redirects to /teacher/settings/calendar (analogous surface).
  // Depends on R-AMBIG-1 fix landing on main first.
  test('R-AMBIG-1 teacher-only /cabinet/settings/calendar → /teacher/settings/calendar', async ({
    page,
    context,
  }) => {
    await attachSession(context, 'teacher')
    await page.goto('/cabinet/settings/calendar')
    expect(new URL(page.url()).pathname).toBe('/teacher/settings/calendar')
  })
})
