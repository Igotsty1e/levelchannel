import { describe, expect, it } from 'vitest'

import { POST as deleteHandler } from '@/app/api/account/delete/route'
import { POST as loginHandler } from '@/app/api/auth/login/route'
import { POST as registerHandler } from '@/app/api/auth/register/route'
import {
  cancelAccountDeletion,
  getAccountByEmail,
  getAccountById,
  requestAccountDeletion,
} from '@/lib/auth/accounts'

import '../setup'
import { buildRequest, extractSessionCookie } from '../helpers'

async function register(email: string) {
  const password = 'StrongPassword123'
  const reg = await registerHandler(
    buildRequest('/api/auth/register', {
      body: { email, password, personalDataConsentAccepted: true },
    }),
  )
  expect(reg.status).toBe(200)
  const created = await getAccountByEmail(email)
  expect(created).not.toBeNull()
  const login = await loginHandler(
    buildRequest('/api/auth/login', { body: { email, password } }),
  )
  expect(login.status).toBe(200)
  const cookie = extractSessionCookie(login.headers.get('Set-Cookie'))
  expect(cookie).not.toBeNull()
  return { cookie: cookie!, accountId: created!.id }
}

describe('account deletion grace window', () => {
  it('POST /api/account/delete sets disabled_at + scheduled_purge_at', async () => {
    const { cookie, accountId } = await register('delete-me@example.com')

    const res = await deleteHandler(
      buildRequest('/api/account/delete', {
        cookie,
        body: { confirm: true },
      }),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.scheduledPurgeAt).toBeTruthy()

    const account = await getAccountById(accountId)
    expect(account?.disabledAt).not.toBeNull()
    expect(account?.scheduledPurgeAt).not.toBeNull()
    expect(account?.purgedAt).toBeNull()

    const purgeMs = new Date(account!.scheduledPurgeAt!).getTime()
    const expectedMs = Date.now() + 30 * 24 * 60 * 60 * 1000
    // Within 1 minute of expected.
    expect(Math.abs(purgeMs - expectedMs)).toBeLessThan(60_000)
  })

  it('POST /api/account/delete refuses without confirm: true', async () => {
    const { cookie } = await register('delete-no-confirm@example.com')
    const res = await deleteHandler(
      buildRequest('/api/account/delete', { cookie, body: {} }),
    )
    expect(res.status).toBe(400)
  })

  it('cancelAccountDeletion clears disabled_at and scheduled_purge_at', async () => {
    const { accountId } = await register('cancel-delete@example.com')
    await requestAccountDeletion(accountId, 30)
    let account = await getAccountById(accountId)
    expect(account?.scheduledPurgeAt).not.toBeNull()

    await cancelAccountDeletion(accountId)
    account = await getAccountById(accountId)
    expect(account?.disabledAt).toBeNull()
    expect(account?.scheduledPurgeAt).toBeNull()
    expect(account?.purgedAt).toBeNull()
  })

  it('requestAccountDeletion is idempotent — re-request advances the timer forward', async () => {
    const { accountId } = await register('idempotent-delete@example.com')
    await requestAccountDeletion(accountId, 30)
    const first = await getAccountById(accountId)
    const firstAt = new Date(first!.scheduledPurgeAt!).getTime()

    // tiny wait to ensure now() advances
    await new Promise((r) => setTimeout(r, 10))
    await requestAccountDeletion(accountId, 30)
    const second = await getAccountById(accountId)
    const secondAt = new Date(second!.scheduledPurgeAt!).getTime()

    expect(secondAt).toBeGreaterThanOrEqual(firstAt)
  })
})
