import { describe, expect, it } from 'vitest'

import {
  getLearnerCancelThresholdMs,
  getLearnerCancelWindowHours,
} from '@/lib/scheduling/policy'

// POLICY-KNOBS (2026-05-17) — env-tunable learner cancel window.
// All cases pin the strict-regex parser + clamp + no-memoization
// contract from docs/plans/policy-knobs.md §3.1.

describe('getLearnerCancelWindowHours', () => {
  it('default 24h when env unset', () => {
    expect(getLearnerCancelWindowHours({} as unknown as NodeJS.ProcessEnv)).toBe(24)
  })

  it('default 24h when env is empty string', () => {
    expect(
      getLearnerCancelWindowHours({
        LEARNER_CANCEL_WINDOW_HOURS: '',
      } as unknown as NodeJS.ProcessEnv),
    ).toBe(24)
  })

  it('custom 6h', () => {
    expect(
      getLearnerCancelWindowHours({
        LEARNER_CANCEL_WINDOW_HOURS: '6',
      } as unknown as NodeJS.ProcessEnv),
    ).toBe(6)
  })

  it('no-gate 0h is accepted', () => {
    expect(
      getLearnerCancelWindowHours({
        LEARNER_CANCEL_WINDOW_HOURS: '0',
      } as unknown as NodeJS.ProcessEnv),
    ).toBe(0)
  })

  it('max 720h is accepted', () => {
    expect(
      getLearnerCancelWindowHours({
        LEARNER_CANCEL_WINDOW_HOURS: '720',
      } as unknown as NodeJS.ProcessEnv),
    ).toBe(720)
  })

  // Round-1 BLOCKER #2 + Round-2 BLOCKER #1 closure — strict regex
  // rejects ANY value that isn't a pure ASCII digit string. NO trim
  // (operator must supply a clean integer).
  const STRICT_REJECT_CASES = [
    '0.5',
    '6h',
    '24abc',
    '+24',
    ' 24',
    '24 ',
    ' 24 ',
    '24.0',
    '-1',
    'NaN',
    'Infinity',
    '721',  // out of range high
    '1000', // out of range high
    'abc',
    '0x10',
    '1e2',
    '\t24',
    '24\n',
  ]
  for (const raw of STRICT_REJECT_CASES) {
    it(`rejects malformed/out-of-range value ${JSON.stringify(raw)} → default 24`, () => {
      expect(
        getLearnerCancelWindowHours({
          LEARNER_CANCEL_WINDOW_HOURS: raw,
        } as unknown as NodeJS.ProcessEnv),
      ).toBe(24)
    })
  }

  it('no memoization — different env passed on each call returns the new value', () => {
    expect(
      getLearnerCancelWindowHours({
        LEARNER_CANCEL_WINDOW_HOURS: '12',
      } as unknown as NodeJS.ProcessEnv),
    ).toBe(12)
    expect(
      getLearnerCancelWindowHours({
        LEARNER_CANCEL_WINDOW_HOURS: '48',
      } as unknown as NodeJS.ProcessEnv),
    ).toBe(48)
    expect(
      getLearnerCancelWindowHours({} as unknown as NodeJS.ProcessEnv),
    ).toBe(24)
  })
})

describe('getLearnerCancelThresholdMs', () => {
  it('returns hours * 3_600_000', () => {
    expect(
      getLearnerCancelThresholdMs({
        LEARNER_CANCEL_WINDOW_HOURS: '6',
      } as unknown as NodeJS.ProcessEnv),
    ).toBe(6 * 60 * 60 * 1000)
    expect(
      getLearnerCancelThresholdMs({
        LEARNER_CANCEL_WINDOW_HOURS: '0',
      } as unknown as NodeJS.ProcessEnv),
    ).toBe(0)
    expect(
      getLearnerCancelThresholdMs({} as unknown as NodeJS.ProcessEnv),
    ).toBe(24 * 60 * 60 * 1000)
  })
})
