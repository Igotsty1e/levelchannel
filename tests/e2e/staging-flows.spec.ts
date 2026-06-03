import { expect, test } from '@playwright/test'

// Staging product-flow Playwright suite.
//
// Runs against the deployed https://staging.levelchannel.ru. Same
// contract as the public-anon suite in product-flows.spec.ts, plus a
// staging-specific check that asserts /api/health.environment ==
// "staging" — surface defence against an nginx misroute that would
// otherwise serve prod content under a staging URL.
//
// Source of truth: evals/PRODUCT_FLOWS.md + URL_REDIRECT_CONTRACT.md.
//
// Not wired to the authenticated fixture (tests/e2e/seed.mjs) — that
// fixture talks to a local docker postgres. Authenticated staging
// coverage is a separate follow-up; for now this suite covers the same
// anon + role-boundary surface as PR #500 but against the real
// deployed app.

test.describe('Staging product flows', () => {
  // Block external CloudPayments CDN to keep CI gate independent of
  // third-party CDN reachability — staging /pay still loads the
  // widget src, but the script body doesn't need to resolve for the
  // page contract to be valid.
  test.beforeEach(async ({ context }) => {
    await context.route(/widget\.cloudpayments\.ru/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: '',
      })
    })
  })

  test('STAGING-HEALTH-001 /api/health returns environment=staging', async ({
    request,
  }) => {
    const response = await request.get('/api/health')
    expect(response.status()).toBe(200)
    const body = await response.json()
    expect(body.status).toBe('ok')
    expect(body.environment, 'staging must report environment=staging').toBe(
      'staging',
    )
  })

  test('STAGING-PUBLIC-HOME-001 / stays at / on staging', async ({ page }) => {
    const response = await page.goto('/')
    expect(response?.status()).toBe(200)
    expect(new URL(page.url()).pathname).toBe('/')
  })

  test('STAGING-PUBLIC-OFFER-001 /offer renders on staging', async ({
    page,
  }) => {
    const response = await page.goto('/offer')
    expect(response?.status()).toBe(200)
    expect(new URL(page.url()).pathname).toBe('/offer')
  })

  test('STAGING-PUBLIC-PRIVACY-001 /privacy renders on staging', async ({
    page,
  }) => {
    const response = await page.goto('/privacy')
    expect(response?.status()).toBe(200)
    expect(new URL(page.url()).pathname).toBe('/privacy')
  })

  test('STAGING-AUTH-LOGIN-001 /login renders form on staging', async ({
    page,
  }) => {
    const response = await page.goto('/login')
    expect(response?.status()).toBe(200)
    expect(new URL(page.url()).pathname).toBe('/login')
  })

  test('STAGING-CABINET-ANON-REDIRECT-001 anon /cabinet → /login on staging', async ({
    page,
  }) => {
    await page.goto('/cabinet')
    expect(new URL(page.url()).pathname).toBe('/login')
  })

  test('STAGING-TEACHER-ANON-REDIRECT-001 anon /teacher → /login on staging', async ({
    page,
  }) => {
    await page.goto('/teacher')
    expect(new URL(page.url()).pathname).toBe('/login')
  })

  test('STAGING-ADMIN-GATED-ANON-REDIRECT-001 anon /admin/dashboard → /admin/login on staging', async ({
    page,
  }) => {
    await page.goto('/admin/dashboard')
    expect(new URL(page.url()).pathname).toBe('/admin/login')
  })

  test('STAGING-PAY-PUBLIC-001 /pay renders on staging', async ({ page }) => {
    const response = await page.goto('/pay')
    expect(response?.status()).toBe(200)
    expect(new URL(page.url()).pathname).toBe('/pay')
  })

  test('STAGING-THANK-YOU-001 /thank-you renders on staging', async ({
    page,
  }) => {
    const response = await page.goto('/thank-you')
    expect(response?.status()).toBe(200)
    expect(new URL(page.url()).pathname).toBe('/thank-you')
  })
})
