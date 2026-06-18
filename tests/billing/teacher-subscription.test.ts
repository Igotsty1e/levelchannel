// A2 — unit tests for the teacher-subscription tariff catalogue
// helpers. The DB-bound CRUD helpers (createOrRenewTeacherSubscription,
// cancelTeacherSubscription, expireOverdueSubscriptions,
// findSubscriptionByPaymentOrderId, getActiveTeacherSubscription) need
// a live Postgres connection; their behaviour is exercised by the
// integration suite (tests/integration). These unit tests cover the
// pure-function surface (the catalogue + the input validators) so a
// fresh dev clone catches obvious regressions without docker.

import { describe, expect, it } from 'vitest'

import {
  SAAS_SUBSCRIPTION_TARIFFS,
  createOrRenewTeacherSubscription,
  getPaidSubscriptionTariff,
  getSubscriptionTariff,
} from '@/lib/billing/teacher-subscription'

describe('SAAS_SUBSCRIPTION_TARIFFS', () => {
  // A.1 tariff reprice (2026-06-18): mid renamed Базовый→Оптимальный,
  // price 30000→39900, learner_limit 5→null (без ограничения).
  // Pro depublish из публичных UI, но строка остаётся в SoT для legacy
  // operator-managed flow.
  it('exposes mid tariff with 2026-06-18 reprice (Оптимальный 399 ₽ без лимита)', () => {
    expect(SAAS_SUBSCRIPTION_TARIFFS.mid.amountKopecks).toBe(39900)
    expect(SAAS_SUBSCRIPTION_TARIFFS.mid.titleRu).toBe('Оптимальный')
    expect(SAAS_SUBSCRIPTION_TARIFFS.mid.learnerLimit).toBeNull()
  })

  it('keeps pro tariff as legacy operator-managed entry (depublished)', () => {
    // Pro строка остаётся в SoT для legacy webhook + операторской раздачи.
    expect(SAAS_SUBSCRIPTION_TARIFFS.pro.amountKopecks).toBe(80000)
    expect(SAAS_SUBSCRIPTION_TARIFFS.pro.learnerLimit).toBe(30)
    expect(SAAS_SUBSCRIPTION_TARIFFS.pro.titleRu).toBe('Расширенный')
    // Description явно помечает архивный статус для оператора /
    // legacy active подписчиков; UI-фильтры скрывают pro из публичных
    // pick-tier surfaces (см. app/teacher/subscription/page.tsx).
    expect(SAAS_SUBSCRIPTION_TARIFFS.pro.description).toContain('архивный')
  })

  it('descriptions include the tier name and 30-day period (mid)', () => {
    expect(SAAS_SUBSCRIPTION_TARIFFS.mid.description).toContain('Оптимальный')
    expect(SAAS_SUBSCRIPTION_TARIFFS.mid.description).toContain('30 дней')
  })

  it('exposes UI feature-bullets for the subscription page', () => {
    expect(SAAS_SUBSCRIPTION_TARIFFS.mid.features.length).toBeGreaterThanOrEqual(3)
    expect(SAAS_SUBSCRIPTION_TARIFFS.pro.features.length).toBeGreaterThanOrEqual(3)
    // Оптимальный card references «Стартового» as the smaller tier.
    expect(
      SAAS_SUBSCRIPTION_TARIFFS.mid.features.some((b) =>
        /Стартов(ый|ого)/.test(b),
      ),
    ).toBe(true)
  })

  // A.1 tariff reprice (2026-06-18): free learner_limit 1 → 3.
  it('exposes free tier (Стартовый) — amountKopecks=0, learnerLimit=3', () => {
    expect(SAAS_SUBSCRIPTION_TARIFFS.free.titleRu).toBe('Стартовый')
    expect(SAAS_SUBSCRIPTION_TARIFFS.free.amountKopecks).toBe(0)
    expect(SAAS_SUBSCRIPTION_TARIFFS.free.learnerLimit).toBe(3)
    expect(SAAS_SUBSCRIPTION_TARIFFS.free.features.length).toBeGreaterThanOrEqual(3)
  })
})

describe('getSubscriptionTariff', () => {
  it('returns the mid tariff for tier="mid"', () => {
    const t = getSubscriptionTariff('mid')
    expect(t).not.toBeNull()
    expect(t?.tier).toBe('mid')
    expect(t?.amountKopecks).toBe(39900)
  })

  it('returns the pro tariff for tier="pro" (legacy operator-managed)', () => {
    const t = getSubscriptionTariff('pro')
    expect(t).not.toBeNull()
    expect(t?.tier).toBe('pro')
    expect(t?.amountKopecks).toBe(80000)
  })

  // A.1 tariff reprice (2026-06-18): free learnerLimit 1 → 3.
  it('returns the free tariff for tier="free"', () => {
    const t = getSubscriptionTariff('free')
    expect(t).not.toBeNull()
    expect(t?.tier).toBe('free')
    expect(t?.amountKopecks).toBe(0)
    expect(t?.titleRu).toBe('Стартовый')
    expect(t?.learnerLimit).toBe(3)
  })

  it('returns null for unknown / disallowed tiers (operator-managed is NOT a catalog tier)', () => {
    expect(getSubscriptionTariff('operator-managed')).toBeNull()
    expect(getSubscriptionTariff('enterprise')).toBeNull()
    expect(getSubscriptionTariff('')).toBeNull()
    expect(getSubscriptionTariff('MID')).toBeNull() // case-sensitive by design
  })
})

// free-tier-saas-card-and-subscription-row plan §0b-3 + §0c-3:
// getPaidSubscriptionTariff narrows to mid|pro and NEVER returns 'free'.
// Used by the CloudPayments webhook so an untrusted productKind slug
// cannot accidentally feed a 0₽ "paid" row into createOrRenewTeacherSubscription.
describe('getPaidSubscriptionTariff (paid-only narrowing helper)', () => {
  it('returns mid for tier="mid"', () => {
    const t = getPaidSubscriptionTariff('mid')
    expect(t?.tier).toBe('mid')
  })
  it('returns pro for tier="pro"', () => {
    const t = getPaidSubscriptionTariff('pro')
    expect(t?.tier).toBe('pro')
  })
  it('returns null for tier="free" (anti-spoof against 0₽ paid row)', () => {
    expect(getPaidSubscriptionTariff('free')).toBeNull()
  })
  it('returns null for operator-managed / unknown slugs', () => {
    expect(getPaidSubscriptionTariff('operator-managed')).toBeNull()
    expect(getPaidSubscriptionTariff('enterprise')).toBeNull()
    expect(getPaidSubscriptionTariff('')).toBeNull()
  })
})

describe('createOrRenewTeacherSubscription input validation', () => {
  // These call into the DB on a happy path. We only check the input
  // validation branches that throw BEFORE the SQL fires — those don't
  // need a pool. The DB-bound success/conflict branches live in the
  // integration suite.
  const baseInput = {
    accountId: '00000000-0000-0000-0000-000000000001',
    tier: 'mid' as const,
    amountKopecks: 39900,
    paymentOrderId: 'lc_sub_test',
  }

  it('rejects non-integer amountKopecks', async () => {
    await expect(
      createOrRenewTeacherSubscription({ ...baseInput, amountKopecks: 100.5 }),
    ).rejects.toThrow(/positive integer/)
  })

  it('rejects zero or negative amountKopecks', async () => {
    await expect(
      createOrRenewTeacherSubscription({ ...baseInput, amountKopecks: 0 }),
    ).rejects.toThrow(/positive integer/)
    await expect(
      createOrRenewTeacherSubscription({ ...baseInput, amountKopecks: -1 }),
    ).rejects.toThrow(/positive integer/)
  })

  it('rejects periodDays out of (0, 366]', async () => {
    await expect(
      createOrRenewTeacherSubscription({ ...baseInput, periodDays: 0 }),
    ).rejects.toThrow(/periodDays/)
    await expect(
      createOrRenewTeacherSubscription({ ...baseInput, periodDays: 400 }),
    ).rejects.toThrow(/periodDays/)
    await expect(
      createOrRenewTeacherSubscription({ ...baseInput, periodDays: -1 }),
    ).rejects.toThrow(/periodDays/)
  })
})
