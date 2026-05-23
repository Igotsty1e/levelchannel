// TASK-5 (mig 0095) — register with firstName/lastName roundtrip.
//
// Pins:
//   1. Register with firstName + lastName → account_profiles row has
//      first_name, last_name, and recomputed display_name.
//   2. Register without first/last → no profile row (or NULL fields)
//      — the cabinet creates one lazily on first PATCH.
//
// NO same-TX assertion (the register is non-transactional per the
// round-2 closure). Test asserts the row eventually appears via the
// best-effort post-create UPSERT.

import { describe, expect, it } from 'vitest'

import { POST as registerHandler } from '@/app/api/auth/register/route'
import { getAccountByEmail } from '@/lib/auth/accounts'
import { getAccountProfile } from '@/lib/auth/profiles'

import '../setup'
import { buildRequest } from '../helpers'

describe('TASK-5 — register firstName/lastName roundtrip', () => {
  it('register with first + last → profile row has all 3 fields', async () => {
    const email = 'tcp-reg-name@example.com'
    const res = await registerHandler(
      buildRequest('/api/auth/register', {
        body: {
          email,
          password: 'StrongPassword123',
          personalDataConsentAccepted: true,
          firstName: 'Иван',
          lastName: 'Петров',
        },
      }),
    )
    expect(res.status).toBe(200)

    const account = await getAccountByEmail(email)
    expect(account).not.toBeNull()
    const profile = await getAccountProfile(account!.id)
    expect(profile).not.toBeNull()
    expect(profile!.firstName).toBe('Иван')
    expect(profile!.lastName).toBe('Петров')
    expect(profile!.displayName).toBe('Иван Петров')
  })

  it('register with only firstName → display_name = "Анна"', async () => {
    const email = 'tcp-reg-first-only@example.com'
    const res = await registerHandler(
      buildRequest('/api/auth/register', {
        body: {
          email,
          password: 'StrongPassword123',
          personalDataConsentAccepted: true,
          firstName: 'Анна',
        },
      }),
    )
    expect(res.status).toBe(200)
    const account = await getAccountByEmail(email)
    const profile = await getAccountProfile(account!.id)
    expect(profile).not.toBeNull()
    expect(profile!.firstName).toBe('Анна')
    expect(profile!.lastName).toBeNull()
    expect(profile!.displayName).toBe('Анна')
  })

  it('non-Latin Cyrillic name roundtrips byte-perfect', async () => {
    const email = 'tcp-reg-cyr@example.com'
    const res = await registerHandler(
      buildRequest('/api/auth/register', {
        body: {
          email,
          password: 'StrongPassword123',
          personalDataConsentAccepted: true,
          firstName: 'Александра',
          lastName: 'Петровна',
        },
      }),
    )
    expect(res.status).toBe(200)
    const account = await getAccountByEmail(email)
    const profile = await getAccountProfile(account!.id)
    expect(profile!.firstName).toBe('Александра')
    expect(profile!.lastName).toBe('Петровна')
    expect(profile!.displayName).toBe('Александра Петровна')
  })

  it('register without firstName/lastName → no profile row (lazy create on first PATCH)', async () => {
    const email = 'tcp-reg-noname@example.com'
    const res = await registerHandler(
      buildRequest('/api/auth/register', {
        body: {
          email,
          password: 'StrongPassword123',
          personalDataConsentAccepted: true,
          // no first/last
        },
      }),
    )
    expect(res.status).toBe(200)
    const account = await getAccountByEmail(email)
    const profile = await getAccountProfile(account!.id)
    // No best-effort UPSERT happened → no profile row.
    expect(profile).toBeNull()
  })

  it('register with empty-string first/last → no profile row (treated as no name)', async () => {
    const email = 'tcp-reg-empty@example.com'
    const res = await registerHandler(
      buildRequest('/api/auth/register', {
        body: {
          email,
          password: 'StrongPassword123',
          personalDataConsentAccepted: true,
          firstName: '   ',
          lastName: '\t',
        },
      }),
    )
    expect(res.status).toBe(200)
    const account = await getAccountByEmail(email)
    const profile = await getAccountProfile(account!.id)
    // Empty/whitespace-only treated as "no name" — UPSERT skipped.
    expect(profile).toBeNull()
  })
})
