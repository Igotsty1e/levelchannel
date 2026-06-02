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

  it('returns null for unknown / disallowed tiers', () => {
    expect(getSubscriptionTariff('free')).toBeNull()
    expect(getSubscriptionTariff('operator-managed')).toBeNull()
    expect(getSubscriptionTariff('enterprise')).toBeNull()
    expect(getSubscriptionTariff('')).toBeNull()
    expect(getSubscriptionTariff('MID')).toBeNull() // case-sensitive by design
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
