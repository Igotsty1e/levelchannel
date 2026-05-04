import { describe, expect, it } from 'vitest'

import {
  POST as createTariffHandler,
  GET as listTariffsHandler,
} from '@/app/api/admin/pricing/route'
import {
  PATCH as patchTariffHandler,
} from '@/app/api/admin/pricing/[id]/route'
import { POST as loginHandler } from '@/app/api/auth/login/route'
import { POST as registerHandler } from '@/app/api/auth/register/route'
import { getAccountByEmail, grantAccountRole } from '@/lib/auth/accounts'

import '../setup'
import { buildRequest, extractSessionCookie } from '../helpers'

async function adminCookie(email = 'pricing-admin@example.com') {
  const password = 'StrongPassword123'
  const reg = await registerHandler(
    buildRequest('/api/auth/register', {
      body: { email, password, personalDataConsentAccepted: true },
    }),
  )
  expect(reg.status).toBe(200)
  const created = await getAccountByEmail(email)
  expect(created).not.toBeNull()
  await grantAccountRole(created!.id, 'admin', null)
  const login = await loginHandler(
    buildRequest('/api/auth/login', { body: { email, password } }),
  )
  expect(login.status).toBe(200)
  const cookie = extractSessionCookie(login.headers.get('Set-Cookie'))
  expect(cookie).not.toBeNull()
  return cookie!
}

describe('admin pricing CRUD', () => {
  it('creates, lists, patches a tariff', async () => {
    const cookie = await adminCookie()

    const created = await createTariffHandler(
      buildRequest('/api/admin/pricing', {
        cookie,
        body: {
          slug: 'lesson-60min',
          titleRu: 'Урок 60 минут',
          amountKopecks: 350_000,
        },
      }),
    )
    expect(created.status).toBe(201)
    const createdJson = await created.json()
    expect(createdJson.tariff.slug).toBe('lesson-60min')

    const list = await listTariffsHandler(
      buildRequest('/api/admin/pricing', { cookie }),
    )
    const listJson = await list.json()
    expect(listJson.tariffs.length).toBe(1)
    expect(listJson.tariffs[0].amountKopecks).toBe(350_000)

    const patched = await patchTariffHandler(
      buildRequest(`/api/admin/pricing/${createdJson.tariff.id}`, {
        method: 'PATCH',
        cookie,
        body: { amountKopecks: 400_000, isActive: false },
      }),
      { params: Promise.resolve({ id: createdJson.tariff.id as string }) },
    )
    expect(patched.status).toBe(200)
    const patchedJson = await patched.json()
    expect(patchedJson.tariff.amountKopecks).toBe(400_000)
    expect(patchedJson.tariff.isActive).toBe(false)
  })

  it('rejects a duplicate slug with 409', async () => {
    const cookie = await adminCookie('pricing-dup@example.com')
    await createTariffHandler(
      buildRequest('/api/admin/pricing', {
        cookie,
        body: { slug: 'pkg-10', titleRu: 'Пакет 10', amountKopecks: 3_000_000 },
      }),
    )
    const second = await createTariffHandler(
      buildRequest('/api/admin/pricing', {
        cookie,
        body: { slug: 'pkg-10', titleRu: 'Дубль', amountKopecks: 1_000 },
      }),
    )
    expect(second.status).toBe(409)
  })

  it('rejects an invalid amount with 400', async () => {
    const cookie = await adminCookie('pricing-bad@example.com')
    const res = await createTariffHandler(
      buildRequest('/api/admin/pricing', {
        cookie,
        body: { slug: 'cheap', titleRu: 'Слишком дёшево', amountKopecks: 50 },
      }),
    )
    expect(res.status).toBe(400)
  })
})
