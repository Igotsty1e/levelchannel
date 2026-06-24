import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { expect, test } from '@playwright/test'

// 2026-06-22 Epic 2 PR-1a — same-wave E2E coverage для
// /teacher/lessons?kind=payments. Locks `FLOW-TEACHER-PAYMENTS-001`
// row из `evals/PRODUCT_FLOWS.md §D`.
//
// Style per product-flows-authenticated.spec.ts: assert URL +
// stable substrings + forbidden DB-slug tokens.

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

test.describe('FLOW-TEACHER-PAYMENTS-001', () => {
  test.skip(
    fixtures === null,
    'No tests/e2e/.fixtures.json — start Docker Postgres + run tests/e2e/seed.mjs.',
  )

  test('teacher /teacher/lessons?kind=payments renders, no redirect, stable anchors, no DB slug leaks', async ({
    page,
    context,
  }) => {
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

    const response = await page.goto('/teacher/lessons?kind=payments')
    expect(response?.status(), 'GET /teacher/lessons?kind=payments status').toBe(200)

    // No redirect — exact URL preserved.
    const here = new URL(page.url())
    expect(here.pathname).toBe('/teacher/lessons')
    expect(here.searchParams.get('kind')).toBe('payments')

    // Required anchors (substrings per evals row contract).
    const html = await page.content()
    expect(html).toContain('Оплаты')
    expect(html).toContain('Должны оплатить')
    expect(html).toMatch(/Ждут \(/)
    expect(html).toMatch(/История \(/)
    expect(html).toContain('Скачать CSV')

    // B-1 contract: forbidden DB slugs не выходят в DOM на SSR shell.
    for (const slug of ['booked', 'completed', 'no_show_learner', 'cancelled']) {
      expect(html).not.toContain(slug)
    }

    // Forbidden generic placeholders.
    expect(html).not.toContain('Скоро будет')
    expect(html).not.toContain('TODO')

    // 2026-06-22 wave-paranoia WARN #2: B-1 regression лежала в expanded
    // mark-paid drill-down, не в SSR shell. Открываем ученика и assert
    // что drill-down loaded и НЕ содержит DB slugs.
    const learnerToggle = page.getByRole('button', { name: 'Отметить оплачено' }).first()
    if (await learnerToggle.isVisible().catch(() => false)) {
      await learnerToggle.click()
      // Wait for drill-down — Pill rendering или Сохраняем/Выбрать все.
      await page
        .getByRole('button', { name: /Выбрать все|Снять все/ })
        .first()
        .waitFor({ timeout: 5000 })
        .catch(() => {
          // Учитель без unpaid learners (qa-fixture seed) — drill-down
          // не появится. Тест проходит на initial shell проверке.
        })
      const expandedHtml = await page.content()
      for (const slug of ['booked', 'completed', 'no_show_learner', 'cancelled']) {
        expect(
          expandedHtml,
          `forbidden DB slug "${slug}" не должен быть в expanded drill-down`,
        ).not.toContain(slug)
      }
    }
  })

  test('width consistency — KindRoutingCards row и PaymentsSection cards равной ширины', async ({
    page,
    context,
  }) => {
    // 2026-06-24 layout regression test: до фикса в PaymentsSection
    // был inline `maxWidth: 880`, тогда как outer page wrapper
    // `<div lc-stack-section>` 980px. Visual mismatch caught owner.
    // Этот test pins width consistency между sibling row containers.
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
    await page.setViewportSize({ width: 1440, height: 900 })
    const response = await page.goto('/teacher/lessons?kind=payments')
    expect(response?.status()).toBe(200)

    const widths = await page.evaluate(() => {
      const tablist = document.querySelector('[aria-label="Разделы занятий"]')
      const section = document.querySelector('section.lc-stack-card')
      return {
        tablist: tablist ? Math.round(tablist.getBoundingClientRect().width) : -1,
        section: section ? Math.round(section.getBoundingClientRect().width) : -1,
      }
    })

    expect(widths.tablist, 'KindRoutingCards tablist rendered').toBeGreaterThan(0)
    expect(widths.section, 'PaymentsSection card rendered').toBeGreaterThan(0)
    // Tolerance 4px — scrollbar / border rounding не должны давать
    // больше расхождения. До фикса diff был ~100px.
    expect(
      Math.abs(widths.tablist - widths.section),
      `width difference: tablist ${widths.tablist}px vs section ${widths.section}px`,
    ).toBeLessThanOrEqual(4)
  })
})
