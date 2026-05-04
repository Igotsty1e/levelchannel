import { describe, expect, it } from 'vitest'

import { GET as listTariffsHandler } from '@/app/api/admin/pricing/route'
import { POST as loginHandler } from '@/app/api/auth/login/route'
import { POST as registerHandler } from '@/app/api/auth/register/route'
import { getAccountByEmail, grantAccountRole } from '@/lib/auth/accounts'

import '../setup'
import { buildRequest, extractSessionCookie } from '../helpers'

async function registerAndCookie(email: string) {
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

describe('admin route gate (using GET /api/admin/pricing)', () => {
  it('anonymous request → 401', async () => {
    const res = await listTariffsHandler(
      buildRequest('/api/admin/pricing'),
    )
    expect(res.status).toBe(401)
  })

  it('logged-in non-admin → 403', async () => {
    const { cookie } = await registerAndCookie('non-admin@example.com')
    const res = await listTariffsHandler(
      buildRequest('/api/admin/pricing', { cookie }),
    )
    expect(res.status).toBe(403)
  })

  it('admin → 200 with empty tariffs list', async () => {
    const { cookie, accountId } = await registerAndCookie('admin@example.com')
    await grantAccountRole(accountId, 'admin', null)
    const res = await listTariffsHandler(
      buildRequest('/api/admin/pricing', { cookie }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.tariffs)).toBe(true)
    expect(body.tariffs.length).toBe(0)
  })
})
