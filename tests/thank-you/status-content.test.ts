import { describe, expect, it } from 'vitest'

import { getStatusContent } from '@/app/thank-you/thank-you-content'

// BUG-2026-05-13-1 regression pin. The /thank-you page used to point
// every CTA at the public landing (`/` for paid, `/#teacher` for
// failure / cancelled / pending). Authenticated learners arriving
// post-payment expected to land back in /cabinet, not on the marketing
// page. After the fix, the primary CTA branches on `hasSession`:
// session-bearing buyers go to /cabinet, anonymous buyers stay with the
// landing affordances.
//
// Contract pinned here so a future refactor of either branch can't
// silently regress without a test breaking.

describe('getStatusContent — hasSession=false (anonymous buyer)', () => {
  it('paid → landing root', () => {
    const c = getStatusContent('paid', false)
    expect(c.primaryHref).toBe('/')
    expect(c.primaryLabel).toBe('Вернуться на главную')
    expect(c.showTelegram).toBe(true)
  })

  it('failed → landing pricing anchor', () => {
    const c = getStatusContent('failed', false)
    expect(c.primaryHref).toBe('/#teacher')
    expect(c.primaryLabel).toBe('Попробовать ещё раз')
    expect(c.showTelegram).toBe(false)
  })

  it('cancelled → landing pricing anchor with "back to pay" copy', () => {
    const c = getStatusContent('cancelled', false)
    expect(c.primaryHref).toBe('/#teacher')
    expect(c.primaryLabel).toBe('Вернуться к оплате')
    expect(c.showTelegram).toBe(false)
  })

  it('pending → landing pricing anchor with "back to pay form" copy', () => {
    const c = getStatusContent('pending', false)
    expect(c.primaryHref).toBe('/#teacher')
    expect(c.primaryLabel).toBe('Вернуться к форме оплаты')
    expect(c.showTelegram).toBe(true)
  })
})

describe('getStatusContent — hasSession=true (authenticated learner)', () => {
  it('paid → /cabinet with friendly label', () => {
    const c = getStatusContent('paid', true)
    expect(c.primaryHref).toBe('/cabinet')
    expect(c.primaryLabel).toBe('Вернуться в кабинет')
    expect(c.showTelegram).toBe(true)
  })

  it('failed → /cabinet (retry from learner surface)', () => {
    const c = getStatusContent('failed', true)
    expect(c.primaryHref).toBe('/cabinet')
    expect(c.primaryLabel).toBe('Вернуться в кабинет')
    expect(c.showTelegram).toBe(false)
  })

  it('cancelled → /cabinet (no landing dump)', () => {
    const c = getStatusContent('cancelled', true)
    expect(c.primaryHref).toBe('/cabinet')
    expect(c.primaryLabel).toBe('Вернуться в кабинет')
    expect(c.showTelegram).toBe(false)
  })

  it('pending → /cabinet (no landing dump)', () => {
    const c = getStatusContent('pending', true)
    expect(c.primaryHref).toBe('/cabinet')
    expect(c.primaryLabel).toBe('Вернуться в кабинет')
    expect(c.showTelegram).toBe(true)
  })
})

describe('getStatusContent — invariants across both branches', () => {
  const statuses = ['paid', 'failed', 'cancelled', 'pending'] as const

  it('title + description are non-empty for every status / session combo', () => {
    for (const s of statuses) {
      for (const hasSession of [false, true]) {
        const c = getStatusContent(s, hasSession)
        expect(c.title.length).toBeGreaterThan(0)
        expect(c.description.length).toBeGreaterThan(0)
        expect(c.primaryHref.length).toBeGreaterThan(0)
        expect(c.primaryLabel.length).toBeGreaterThan(0)
      }
    }
  })

  it('authenticated buyer never sees a landing-page CTA on any status', () => {
    for (const s of statuses) {
      const c = getStatusContent(s, true)
      expect(c.primaryHref.startsWith('/cabinet')).toBe(true)
      expect(c.primaryHref.startsWith('/#')).toBe(false)
    }
  })

  it('anonymous buyer always sees a landing-shaped CTA (/ or /#…)', () => {
    for (const s of statuses) {
      const c = getStatusContent(s, false)
      const onLanding = c.primaryHref === '/' || c.primaryHref.startsWith('/#')
      expect(onLanding).toBe(true)
    }
  })
})
