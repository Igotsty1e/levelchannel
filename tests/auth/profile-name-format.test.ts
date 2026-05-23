// TASK-5 (mig 0095) — profile-name helpers.
//
// Pure unit tests against lib/auth/profile-name.ts. Pinned to the
// SQL backfill in mig 0095 (split on FIRST space, trim halves).

import { describe, expect, it } from 'vitest'

import {
  computeDisplayNameForStorage,
  formatProfileNameForRender,
  splitDisplayName,
} from '@/lib/auth/profile-name'

describe('formatProfileNameForRender', () => {
  it('first + last present → "Иван Петров"', () => {
    expect(
      formatProfileNameForRender({
        firstName: 'Иван',
        lastName: 'Петров',
        displayName: null,
        fallbackEmail: 'x@example.com',
      }),
    ).toBe('Иван Петров')
  })

  it('first only', () => {
    expect(
      formatProfileNameForRender({
        firstName: 'Иван',
        lastName: null,
        displayName: null,
        fallbackEmail: 'x@example.com',
      }),
    ).toBe('Иван')
  })

  it('last only', () => {
    expect(
      formatProfileNameForRender({
        firstName: null,
        lastName: 'Петров',
        displayName: null,
        fallbackEmail: 'x@example.com',
      }),
    ).toBe('Петров')
  })

  it('both empty → falls back to displayName when present', () => {
    expect(
      formatProfileNameForRender({
        firstName: null,
        lastName: null,
        displayName: 'Legacy Name',
        fallbackEmail: 'x@example.com',
      }),
    ).toBe('Legacy Name')
  })

  it('both empty + no displayName → falls back to email', () => {
    expect(
      formatProfileNameForRender({
        firstName: null,
        lastName: null,
        displayName: null,
        fallbackEmail: 'x@example.com',
      }),
    ).toBe('x@example.com')
  })

  it('whitespace-only first/last → falls back to displayName', () => {
    expect(
      formatProfileNameForRender({
        firstName: '   ',
        lastName: '\t',
        displayName: 'Legacy',
        fallbackEmail: 'x@example.com',
      }),
    ).toBe('Legacy')
  })

  it('Cyrillic + edge: at-or-below 60-char cap on each half', () => {
    const sixty = 'А'.repeat(60)
    const sixtyFamily = 'Б'.repeat(60)
    expect(
      formatProfileNameForRender({
        firstName: sixty,
        lastName: sixtyFamily,
        displayName: null,
        fallbackEmail: '',
      }),
    ).toBe(`${sixty} ${sixtyFamily}`)
  })

  it('undefined inputs treated as null', () => {
    expect(
      formatProfileNameForRender({
        firstName: undefined,
        lastName: undefined,
        displayName: undefined,
        fallbackEmail: 'fallback@example.com',
      }),
    ).toBe('fallback@example.com')
  })
})

describe('computeDisplayNameForStorage', () => {
  it('first + last → "Иван Петров"', () => {
    expect(
      computeDisplayNameForStorage({
        firstName: 'Иван',
        lastName: 'Петров',
      }),
    ).toBe('Иван Петров')
  })

  it('first only', () => {
    expect(
      computeDisplayNameForStorage({
        firstName: 'Иван',
        lastName: null,
      }),
    ).toBe('Иван')
  })

  it('last only', () => {
    expect(
      computeDisplayNameForStorage({
        firstName: null,
        lastName: 'Петров',
      }),
    ).toBe('Петров')
  })

  it('both null → null', () => {
    expect(
      computeDisplayNameForStorage({ firstName: null, lastName: null }),
    ).toBeNull()
  })

  it('both whitespace → null', () => {
    expect(
      computeDisplayNameForStorage({ firstName: '   ', lastName: '\t' }),
    ).toBeNull()
  })

  it('NEVER falls back to email — only computes from inputs', () => {
    // computeDisplayNameForStorage takes no email; deliberate.
    const got = computeDisplayNameForStorage({ firstName: '', lastName: '' })
    expect(got).toBeNull()
  })

  it('trims leading/trailing whitespace on the halves', () => {
    expect(
      computeDisplayNameForStorage({
        firstName: '  Иван  ',
        lastName: '  Петров  ',
      }),
    ).toBe('Иван Петров')
  })
})

describe('splitDisplayName (SQL backfill twin)', () => {
  it('no space → all into firstName', () => {
    expect(splitDisplayName('Иван')).toEqual({
      firstName: 'Иван',
      lastName: null,
    })
  })

  it('one space → first / last', () => {
    expect(splitDisplayName('Иван Петров')).toEqual({
      firstName: 'Иван',
      lastName: 'Петров',
    })
  })

  it('multi-space → split on FIRST space (mig 0095 contract)', () => {
    expect(splitDisplayName('Анна-Мария Иванова')).toEqual({
      firstName: 'Анна-Мария',
      lastName: 'Иванова',
    })
  })

  it('multiple words after first space → all collapse into lastName', () => {
    expect(splitDisplayName('Анна Мария Иванова')).toEqual({
      firstName: 'Анна',
      lastName: 'Мария Иванова',
    })
  })

  it('null / undefined / empty → both null', () => {
    expect(splitDisplayName(null)).toEqual({ firstName: null, lastName: null })
    expect(splitDisplayName(undefined)).toEqual({
      firstName: null,
      lastName: null,
    })
    expect(splitDisplayName('')).toEqual({ firstName: null, lastName: null })
    expect(splitDisplayName('   ')).toEqual({
      firstName: null,
      lastName: null,
    })
  })

  it('trims whitespace around the input', () => {
    expect(splitDisplayName('  Иван Петров  ')).toEqual({
      firstName: 'Иван',
      lastName: 'Петров',
    })
  })
})
