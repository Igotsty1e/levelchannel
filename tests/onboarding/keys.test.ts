// ONBOARDING wave Sub-PR A — unit test для whitelist module.
//
// Защищает контракт `ONBOARDING_HINT_KEYS` (порядок и состав 11 ключей
// из spec'а) + type guard `isOnboardingHintKey`.

import { describe, expect, it } from 'vitest'

import {
  ONBOARDING_HINT_KEYS,
  isOnboardingHintKey,
  type OnboardingHintKey,
} from '@/lib/onboarding/keys'

describe('ONBOARDING_HINT_KEYS', () => {
  it('contains the must-have hints listed in the spec', () => {
    expect(ONBOARDING_HINT_KEYS).toEqual([
      'teacher_setup_checklist',
      'tariff_first_create_hint',
      'packages_vs_tariffs_explainer',
      'tz_hint',
      'first_learner_celebrated',
      'first_mark_completed_hint',
      'learner_cabinet_tour',
      'learner_reminder_hint',
      'first_completed_celebrated',
      'postpaid_explained',
      'pwa_install',
      // Sub-PR C CT1 (2026-06-06):
      'verify_email_reminder',
      // teacher-payments-sbp-self-service epic (2026-06-07):
      'teacher_payments_explainer',
    ])
  })

  it('has no duplicates', () => {
    expect(new Set(ONBOARDING_HINT_KEYS).size).toBe(ONBOARDING_HINT_KEYS.length)
  })
})

describe('isOnboardingHintKey', () => {
  it('accepts every whitelisted key', () => {
    for (const k of ONBOARDING_HINT_KEYS) {
      expect(isOnboardingHintKey(k)).toBe(true)
    }
  })

  it('rejects arbitrary strings', () => {
    expect(isOnboardingHintKey('')).toBe(false)
    expect(isOnboardingHintKey('teacher_setup_checklist ')).toBe(false) // trailing space
    expect(isOnboardingHintKey('TEACHER_SETUP_CHECKLIST')).toBe(false) // wrong case
    expect(isOnboardingHintKey('random_key_invented_by_attacker')).toBe(false)
  })

  it('narrows the type when true', () => {
    const value: string = 'pwa_install'
    if (isOnboardingHintKey(value)) {
      const _typed: OnboardingHintKey = value
      void _typed
    }
  })
})
