#!/usr/bin/env node
// scripts/landing-v3-screenshots.mjs
//
// Снимает product-скриншоты для landing-v3 через Playwright (headless).
// Логинится qa-fixture-teacher, проходит по surfaces, складывает PNG в
// public/assets/landing-v3/screens/.
//
// Usage (dev server должен быть на :3010, fixtures засидены):
//   node scripts/landing-v3-screenshots.mjs
//
// Конвертация в AVIF — отдельным шагом через sharp, если нужно.

import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT_DIR = path.resolve(__dirname, '../public/assets/landing-v3/screens')
const BASE = process.env.SS_BASE_URL ?? 'http://localhost:3010'
const EMAIL = 'qa-fixture-teacher@levelchannel.test'
const PASSWORD = 'QaFix!2026'

const DESKTOP_VIEWPORT = { width: 1440, height: 900 }
const MOBILE_VIEWPORT = { width: 390, height: 844 }

const TARGETS = [
  { name: 'teacher-dashboard', url: '/teacher', viewport: DESKTOP_VIEWPORT, waitFor: 'h1' },
  { name: 'feature-schedule', url: '/teacher/calendar', viewport: DESKTOP_VIEWPORT, waitFor: 'h1' },
  { name: 'feature-learner', url: '/teacher/learners', viewport: DESKTOP_VIEWPORT, waitFor: 'h1' },
  { name: 'feature-balance', url: '/teacher/payments', viewport: DESKTOP_VIEWPORT, waitFor: 'h1' },
  { name: 'feature-settings', url: '/teacher/settings', viewport: DESKTOP_VIEWPORT, waitFor: 'h1' },
  { name: 'feature-methods', url: '/teacher/settings/payment-methods', viewport: DESKTOP_VIEWPORT, waitFor: 'h1' },
  { name: 'teacher-mobile-dashboard', url: '/teacher', viewport: MOBILE_VIEWPORT, waitFor: 'h1' },
  { name: 'teacher-mobile-payments', url: '/teacher/payments', viewport: MOBILE_VIEWPORT, waitFor: 'h1' },
]

async function login(context) {
  const page = await context.newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.waitForSelector('input[type="email"]', { timeout: 30_000 })
  await page.fill('input[type="email"]', EMAIL)
  await page.fill('input[type="password"]', PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 30_000 })
  await page.waitForLoadState('domcontentloaded', { timeout: 60_000 })
  let attempts = 0
  while (page.url().includes('/saas-offer-accept') && attempts < 3) {
    attempts += 1
    await page.waitForSelector('input[type="checkbox"]', { timeout: 30_000 })
    const checkboxes = await page.$$('input[type="checkbox"]')
    for (const cb of checkboxes) await cb.check().catch(() => {})
    await page
      .click('button:has-text("Подтвердить"), button:has-text("Согласен")')
      .catch(() => {})
    await page.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => {})
    await page.waitForTimeout(800)
  }
  await page.goto(`${BASE}/teacher`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.waitForTimeout(1500)
  console.log(`  · login OK, ended on ${page.url()}`)
  await page.close()
}

async function shoot(context, target) {
  const page = await context.newPage()
  await page.setViewportSize(target.viewport)
  await page.goto(`${BASE}${target.url}`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  if (target.waitFor) {
    await page.waitForSelector(target.waitFor, { timeout: 30_000 }).catch(() => {})
  }
  // Hide dev tools overlay / Sentry / Next.js dev panel
  await page.evaluate(() => {
    const ids = [
      '[data-nextjs-toast]',
      '[data-nextjs-dev-tools-button]',
      '#__next-build-watcher',
      '.vercel-toolbar',
      '[data-nextjs-dialog-overlay]',
      'nextjs-portal',
    ]
    for (const sel of ids) {
      for (const el of document.querySelectorAll(sel)) {
        ;(el).style.display = 'none'
      }
    }
    // Dismiss any onboarding hint overlays that might cover dashboard
    for (const btn of document.querySelectorAll('button')) {
      const t = btn.textContent || ''
      if (t.includes('Понятно') || t.includes('Скрыть')) {
        try { btn.click() } catch {}
      }
    }
  })
  await page.waitForTimeout(1500)
  const outPath = path.join(OUT_DIR, `${target.name}.png`)
  await page.screenshot({ path: outPath, fullPage: false })
  console.log(`✓ ${target.name} → ${outPath}`)
  await page.close()
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  const browser = await chromium.launch()
  const context = await browser.newContext({
    viewport: DESKTOP_VIEWPORT,
    deviceScaleFactor: 2,
    colorScheme: 'dark',
  })

  try {
    await login(context)
    for (const t of TARGETS) {
      await shoot(context, t)
    }
  } finally {
    await context.close()
    await browser.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
