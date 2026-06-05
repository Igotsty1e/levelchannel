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
  it('exposes mid + pro tiers with the prices set in v2 SaaS-оферта', () => {
    expect(SAAS_SUBSCRIPTION_TARIFFS.mid.amountKopecks).toBe(30000)
    expect(SAAS_SUBSCRIPTION_TARIFFS.pro.amountKopecks).toBe(80000)
  })

  it('learner limits match the catalogue (mig 0073)', () => {
    expect(SAAS_SUBSCRIPTION_TARIFFS.mid.learnerLimit).toBe(5)
    expect(SAAS_SUBSCRIPTION_TARIFFS.pro.learnerLimit).toBe(30)
  })

  it('titles match the public SaaS landing copy (Russian names per bug-4 Sub-PR A)', () => {
    expect(SAAS_SUBSCRIPTION_TARIFFS.mid.titleRu).toBe('Базовый')
    expect(SAAS_SUBSCRIPTION_TARIFFS.pro.titleRu).toBe('Расширенный')
  })

  it('descriptions include the tier name and 30-day period', () => {
    expect(SAAS_SUBSCRIPTION_TARIFFS.mid.description).toContain('Базовый')
    expect(SAAS_SUBSCRIPTION_TARIFFS.mid.description).toContain('30 дней')
    expect(SAAS_SUBSCRIPTION_TARIFFS.pro.description).toContain('Расширенный')
    expect(SAAS_SUBSCRIPTION_TARIFFS.pro.description).toContain('30 дней')
  })

  it('exposes UI feature-bullets for the subscription page (bug-4 Sub-PR A)', () => {
    expect(SAAS_SUBSCRIPTION_TARIFFS.mid.features.length).toBeGreaterThanOrEqual(3)
    expect(SAAS_SUBSCRIPTION_TARIFFS.pro.features.length).toBeGreaterThanOrEqual(3)
    // Pro card should reference the smaller tier in its first bullet
    // («Базового», genitive of «Базовый»).
    expect(
      SAAS_SUBSCRIPTION_TARIFFS.pro.features.some((b) =>
        /Базов(ый|ого)/.test(b),
      ),
    ).toBe(true)
  })

  // free-tier-saas-card-and-subscription-row plan §0a-7 closure (2026-06-05):
  // 'free' (Стартовый) is now a catalog entry alongside mid+pro.
  it('exposes free tier (Стартовый) — amountKopecks=0, learnerLimit=1', () => {
    expect(SAAS_SUBSCRIPTION_TARIFFS.free.titleRu).toBe('Стартовый')
    expect(SAAS_SUBSCRIPTION_TARIFFS.free.amountKopecks).toBe(0)
    expect(SAAS_SUBSCRIPTION_TARIFFS.free.learnerLimit).toBe(1)
    expect(SAAS_SUBSCRIPTION_TARIFFS.free.features.length).toBeGreaterThanOrEqual(3)
  })
})

describe('getSubscriptionTariff', () => {
  it('returns the mid tariff for tier="mid"', () => {
    const t = getSubscriptionTariff('mid')
    expect(t).not.toBeNull()
    expect(t?.tier).toBe('mid')
    expect(t?.amountKopecks).toBe(30000)
  })

  it('returns the pro tariff for tier="pro"', () => {
    const t = getSubscriptionTariff('pro')
    expect(t).not.toBeNull()
    expect(t?.tier).toBe('pro')
    expect(t?.amountKopecks).toBe(80000)
  })

  // free-tier-saas-card-and-subscription-row plan §0a-7 closure (2026-06-05):
  // 'free' is now a valid catalog entry. Returns the Стартовый tariff.
  it('returns the free tariff for tier="free"', () => {
    const t = getSubscriptionTariff('free')
    expect(t).not.toBeNull()
    expect(t?.tier).toBe('free')
    expect(t?.amountKopecks).toBe(0)
    expect(t?.titleRu).toBe('Стартовый')
    expect(t?.learnerLimit).toBe(1)
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
    amountKopecks: 30000,
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
