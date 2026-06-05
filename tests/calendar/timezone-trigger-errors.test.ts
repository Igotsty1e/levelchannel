import { describe, expect, it } from 'vitest'

import {
  isAccountProfilesClearTimezoneError,
  isCalendarRequireTimezoneError,
} from '@/lib/calendar/timezone-trigger-errors'

describe('isAccountProfilesClearTimezoneError', () => {
  it('matches the PATCH trigger prefix', () => {
    expect(
      isAccountProfilesClearTimezoneError({
        code: '23514',
        message:
          'account_profiles: cannot clear timezone while teacher_calendar_integrations is active (account_id=...)',
      }),
    ).toBe(true)
  })

  it('matches INSERT/DELETE variants of the same trigger', () => {
    expect(
      isAccountProfilesClearTimezoneError({
        code: '23514',
        message: 'account_profiles: cannot create row with NULL timezone ...',
      }),
    ).toBe(true)
    expect(
      isAccountProfilesClearTimezoneError({
        code: '23514',
        message: 'account_profiles: cannot remove (which orphans ...) timezone ...',
      }),
    ).toBe(true)
  })

  it('rejects unrelated 23514 from mig 0069 IANA CHECK', () => {
    expect(
      isAccountProfilesClearTimezoneError({
        code: '23514',
        message: 'new row violates check constraint "account_profiles_timezone_iana_check"',
      }),
    ).toBe(false)
  })

  it('rejects the sibling calendar trigger', () => {
    expect(
      isAccountProfilesClearTimezoneError({
        code: '23514',
        message: 'teacher_calendar_integrations: timezone must be set ...',
      }),
    ).toBe(false)
  })

  it('rejects non-23514 errors', () => {
    expect(
      isAccountProfilesClearTimezoneError({
        code: '23505',
        message: 'duplicate key',
      }),
    ).toBe(false)
  })

  it('rejects malformed errors', () => {
    expect(isAccountProfilesClearTimezoneError(null)).toBe(false)
    expect(isAccountProfilesClearTimezoneError(undefined)).toBe(false)
    expect(isAccountProfilesClearTimezoneError({})).toBe(false)
    expect(isAccountProfilesClearTimezoneError('string')).toBe(false)
  })
})

describe('isCalendarRequireTimezoneError', () => {
  it('matches the callback trigger prefix', () => {
    expect(
      isCalendarRequireTimezoneError({
        code: '23514',
        message:
          'teacher_calendar_integrations: timezone must be set before activating Google Calendar (account_id=...)',
      }),
    ).toBe(true)
  })

  it('rejects the sibling profile trigger', () => {
    expect(
      isCalendarRequireTimezoneError({
        code: '23514',
        message: 'account_profiles: cannot clear timezone ...',
      }),
    ).toBe(false)
  })

  it('rejects unrelated 23514', () => {
    expect(
      isCalendarRequireTimezoneError({
        code: '23514',
        message: 'new row violates check constraint "tci_status_check"',
      }),
    ).toBe(false)
  })

  it('rejects non-23514 errors', () => {
    expect(
      isCalendarRequireTimezoneError({
        code: '23505',
        message: 'duplicate key',
      }),
    ).toBe(false)
  })
})
