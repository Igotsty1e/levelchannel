import { expect, test } from '@playwright/test'

// Block the external CloudPayments CDN load. `/pay` renders an inline
// reference to `https://widget.cloudpayments.ru/bundles/cloudpayments.js`;
// we don't want CI gate flakiness to depend on third-party CDN
// availability. This intercept is suite-wide (registered on every test
// via test.beforeEach) and returns a tiny empty payload so the page's
// `load` event still resolves.
test.beforeEach(async ({ context }) => {
  await context.route(/widget\.cloudpayments\.ru/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: '',
    })
  })
})

// Product-flow Playwright suite.
//
// Source of truth: `evals/PRODUCT_FLOWS.md` and
// `evals/URL_REDIRECT_CONTRACT.md`. Each test name carries the FLOW-* ID
// from the registry. If you change a redirect/route, update the registry
// in the same PR.
//
// Scope intentionally limited to anon + role-boundary redirects. The
// authenticated-cabinet flows (FLOW-LEARNER-CABINET-001 etc.) require a
// session-cookie fixture against a seeded Postgres — out of scope for v1.

const FORBIDDEN_PLACEHOLDERS = [
  'Coming soon',
  'placeholder text',
  'Реконсилиация',
  'paid_not_granted',
  'Эндпоинт',
  'Internal error',
  'Internal server error',
]

// Surfaces that must NEVER carry "Скоро будет". Excluded:
// `/teacher/settings/calendar` — state-aware placeholder when GOOGLE_*
// env vars are missing (see FLOW-TEACHER-CALENDAR-SETTINGS-001 notes).
const SHIPPED_SURFACES_NO_COMING_SOON = [
  '/',
  '/offer',
  '/privacy',
  '/login',
  '/register',
  '/forgot',
  '/pay',
  '/thank-you',
  '/admin/login',
]

async function assertNoForbiddenPlaceholders(html: string) {
  for (const term of FORBIDDEN_PLACEHOLDERS) {
    expect(html, `forbidden placeholder "${term}" found in HTML`).not.toContain(
      term,
    )
  }
}

// -------- Public / legal --------

test('FLOW-PUBLIC-HOME-001 / stays at / (no auth redirect; regression-guards 648868b)', async ({
  page,
}) => {
  const response = await page.goto('/')
  expect(response?.status(), 'GET / status').toBe(200)
  expect(new URL(page.url()).pathname).toBe('/')
})

test('FLOW-PUBLIC-OFFER-001 /offer renders without redirect', async ({
  page,
}) => {
  const response = await page.goto('/offer')
  expect(response?.status(), 'GET /offer status').toBe(200)
  expect(new URL(page.url()).pathname).toBe('/offer')
})

test('FLOW-PUBLIC-PRIVACY-001 /privacy renders without redirect', async ({
  page,
}) => {
  const response = await page.goto('/privacy')
  expect(response?.status(), 'GET /privacy status').toBe(200)
  expect(new URL(page.url()).pathname).toBe('/privacy')
})

// -------- Auth --------

test('FLOW-AUTH-LOGIN-001 /login renders form, no redirect for anon', async ({
  page,
}) => {
  const response = await page.goto('/login')
  expect(response?.status()).toBe(200)
  expect(new URL(page.url()).pathname).toBe('/login')
  // Heading "Вход" appears as h1 / button. Stable substring "Вход".
  await expect(page.locator('body')).toContainText(/Вход/)
})

test('FLOW-AUTH-REGISTER-001 /register renders form, no redirect for anon', async ({
  page,
}) => {
  const response = await page.goto('/register')
  expect(response?.status()).toBe(200)
  expect(new URL(page.url()).pathname).toBe('/register')
  await expect(page.locator('body')).toContainText(/Регистрация/)
})

// -------- Auth-boundary redirects --------

test('FLOW-CABINET-ANON-REDIRECT-001 anon /cabinet → /login', async ({
  page,
}) => {
  await page.goto('/cabinet')
  expect(new URL(page.url()).pathname).toBe('/login')
})

test('FLOW-TEACHER-ANON-REDIRECT-001 anon /teacher → /login', async ({
  page,
}) => {
  await page.goto('/teacher')
  expect(new URL(page.url()).pathname).toBe('/login')
})

test('FLOW-ADMIN-GATED-ANON-REDIRECT-001 anon /admin/dashboard → /admin/login', async ({
  page,
}) => {
  await page.goto('/admin/dashboard')
  expect(new URL(page.url()).pathname).toBe('/admin/login')
})

test('FLOW-ADMIN-LOGIN-001 /admin/login renders, anon stays here', async ({
  page,
}) => {
  const response = await page.goto('/admin/login')
  expect(response?.status()).toBe(200)
  expect(new URL(page.url()).pathname).toBe('/admin/login')
})

// -------- Payment / return --------

test('FLOW-PAY-PUBLIC-001 /pay renders for anon', async ({ page }) => {
  const response = await page.goto('/pay')
  expect(response?.status()).toBe(200)
  expect(new URL(page.url()).pathname).toBe('/pay')
})

test('FLOW-THANK-YOU-001 /thank-you renders, no auth redirect', async ({
  page,
}) => {
  const response = await page.goto('/thank-you')
  expect(response?.status()).toBe(200)
  expect(new URL(page.url()).pathname).toBe('/thank-you')
})

// -------- Forbidden-redirect contract (Table 1 / URL_REDIRECT_CONTRACT.md) --------

test('Public surfaces never redirect to authenticated routes', async ({
  page,
}) => {
  const publicSurfaces = ['/', '/offer', '/privacy', '/login', '/register']
  const forbidden = ['/cabinet', '/admin', '/teacher']
  for (const path of publicSurfaces) {
    await page.goto(path)
    const finalPath = new URL(page.url()).pathname
    for (const bad of forbidden) {
      expect(
        finalPath.startsWith(bad),
        `public ${path} unexpectedly landed inside ${bad}`,
      ).toBe(false)
    }
    expect(finalPath, `public ${path} should stay at itself`).toBe(path)
  }
})

// -------- Shipped-placeholder guard (Phase 6) --------

test('Shipped public surfaces do not render "Скоро будет"', async ({
  page,
}) => {
  for (const path of SHIPPED_SURFACES_NO_COMING_SOON) {
    const response = await page.goto(path)
    expect(response?.status(), `${path} status`).toBe(200)
    const html = await page.content()
    expect(html, `${path} unexpectedly contains "Скоро будет"`).not.toContain(
      'Скоро будет',
    )
    await assertNoForbiddenPlaceholders(html)
  }
})
