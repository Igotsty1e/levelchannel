// TASK-5 (mig 0095) — PATCH /api/account/profile with firstName/lastName.
//
// Pins:
//   - PATCH with firstName + lastName → display_name recomputed server-side.
//   - PATCH with one half null → display_name = the other half.
//   - PATCH with both null → display_name = NULL.
//   - PATCH with legacy displayName only → still works (back-compat).

import { describe, expect, it } from 'vitest'

import {
  PATCH as patchHandler,
  GET as getHandler,
} from '@/app/api/account/profile/route'
import { POST as loginHandler } from '@/app/api/auth/login/route'
import { POST as registerHandler } from '@/app/api/auth/register/route'

import '../setup'
import { buildRequest, extractSessionCookie } from '../helpers'

async function registerAndLogin(email: string) {
  const password = 'StrongPassword123'
  const reg = await registerHandler(
    buildRequest('/api/auth/register', {
      body: { email, password, personalDataConsentAccepted: true },
    }),
  )
  expect(reg.status).toBe(200)
  const login = await loginHandler(
    buildRequest('/api/auth/login', { body: { email, password } }),
  )
  expect(login.status).toBe(200)
  const cookie = extractSessionCookie(login.headers.get('Set-Cookie'))
  expect(cookie).not.toBeNull()
  return cookie!
}

describe('TASK-5 — PATCH /api/account/profile with firstName/lastName', () => {
  it('first + last → display_name recomputed to "Иван Петров"', async () => {
    const cookie = await registerAndLogin('tcp-pp-both@example.com')
    const res = await patchHandler(
      buildRequest('/api/account/profile', {
        method: 'PATCH',
        cookie,
        body: { firstName: 'Иван', lastName: 'Петров' },
      }),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.profile.firstName).toBe('Иван')
    expect(json.profile.lastName).toBe('Петров')
    expect(json.profile.displayName).toBe('Иван Петров')
  })

  it('first only (no last) → display_name = "Анна"', async () => {
    const cookie = await registerAndLogin('tcp-pp-first@example.com')
    const res = await patchHandler(
      buildRequest('/api/account/profile', {
        method: 'PATCH',
        cookie,
        body: { firstName: 'Анна', lastName: null },
      }),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.profile.firstName).toBe('Анна')
    expect(json.profile.lastName).toBeNull()
    expect(json.profile.displayName).toBe('Анна')
  })

  it('both empty (null) → display_name = NULL', async () => {
    const cookie = await registerAndLogin('tcp-pp-empty@example.com')
    // First set a value...
    await patchHandler(
      buildRequest('/api/account/profile', {
        method: 'PATCH',
        cookie,
        body: { firstName: 'X', lastName: 'Y' },
      }),
    )
    // Then clear both.
    const res = await patchHandler(
      buildRequest('/api/account/profile', {
        method: 'PATCH',
        cookie,
        body: { firstName: null, lastName: null },
      }),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.profile.firstName).toBeNull()
    expect(json.profile.lastName).toBeNull()
    expect(json.profile.displayName).toBeNull()
  })

  it('empty string treated as null → display_name = NULL', async () => {
    const cookie = await registerAndLogin('tcp-pp-blank@example.com')
    const res = await patchHandler(
      buildRequest('/api/account/profile', {
        method: 'PATCH',
        cookie,
        body: { firstName: '', lastName: '' },
      }),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.profile.firstName).toBeNull()
    expect(json.profile.lastName).toBeNull()
    expect(json.profile.displayName).toBeNull()
  })

  it('legacy displayName-only PATCH still works (back-compat)', async () => {
    const cookie = await registerAndLogin('tcp-pp-legacy@example.com')
    const res = await patchHandler(
      buildRequest('/api/account/profile', {
        method: 'PATCH',
        cookie,
        body: { displayName: 'Старое Имя' },
      }),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.profile.displayName).toBe('Старое Имя')
    // first/last NOT touched (the legacy-only path doesn't auto-split).
    expect(json.profile.firstName).toBeNull()
    expect(json.profile.lastName).toBeNull()
  })

  it('over-long firstName (>60) → 400', async () => {
    const cookie = await registerAndLogin('tcp-pp-toolong@example.com')
    const res = await patchHandler(
      buildRequest('/api/account/profile', {
        method: 'PATCH',
        cookie,
        body: { firstName: 'А'.repeat(61) },
      }),
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('firstName')
  })

  it('re-read after PATCH returns the same values', async () => {
    const cookie = await registerAndLogin('tcp-pp-reread@example.com')
    await patchHandler(
      buildRequest('/api/account/profile', {
        method: 'PATCH',
        cookie,
        body: { firstName: 'Иван', lastName: 'Петров' },
      }),
    )
    const re = await getHandler(
      buildRequest('/api/account/profile', { cookie }),
    )
    const json = await re.json()
    expect(json.profile.firstName).toBe('Иван')
    expect(json.profile.lastName).toBe('Петров')
    expect(json.profile.displayName).toBe('Иван Петров')
  })
})
