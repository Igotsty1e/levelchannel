import { describe, expect, it } from 'vitest'

import { POST as bookHandler } from '@/app/api/slots/[id]/book/route'
import { POST as cancelHandler } from '@/app/api/slots/[id]/cancel/route'
import { GET as availableHandler } from '@/app/api/slots/available/route'
import { GET as mineHandler } from '@/app/api/slots/mine/route'
import { POST as adminBookAsOpHandler } from '@/app/api/admin/slots/[id]/book-as-operator/route'
import { POST as adminCancelHandler } from '@/app/api/admin/slots/[id]/cancel/route'
import {
  POST as adminCreateHandler,
  GET as adminListHandler,
} from '@/app/api/admin/slots/route'
import { POST as loginHandler } from '@/app/api/auth/login/route'
import { POST as registerHandler } from '@/app/api/auth/register/route'
import {
  getAccountByEmail,
  grantAccountRole,
  markAccountVerified,
} from '@/lib/auth/accounts'

import '../setup'
import { buildRequest, extractSessionCookie } from '../helpers'

async function registerAndCookie(
  email: string,
  opts: { verifyEmail?: boolean; role?: 'admin' | 'teacher' } = {},
): Promise<{ cookie: string; accountId: string }> {
  const password = 'StrongPassword123'
  const reg = await registerHandler(
    buildRequest('/api/auth/register', {
      body: { email, password, personalDataConsentAccepted: true },
    }),
  )
  expect(reg.status).toBe(200)
  const created = await getAccountByEmail(email)
  expect(created).not.toBeNull()
  if (opts.verifyEmail) {
    await markAccountVerified(created!.id)
  }
  if (opts.role) {
    await grantAccountRole(created!.id, opts.role, null)
  }
  const login = await loginHandler(
    buildRequest('/api/auth/login', { body: { email, password } }),
  )
  expect(login.status).toBe(200)
  const cookie = extractSessionCookie(login.headers.get('Set-Cookie'))
  expect(cookie).not.toBeNull()
  return { cookie: cookie!, accountId: created!.id }
}

function futureIsoMinutes(min: number): string {
  return new Date(Date.now() + min * 60_000).toISOString()
}

describe('Phase 4 slot flow', () => {
  it('admin creates an open slot, learner sees it in /available', async () => {
    const teacher = await registerAndCookie('teacher-a@example.com', {
      verifyEmail: true,
      role: 'teacher',
    })
    const admin = await registerAndCookie('admin-a@example.com', {
      verifyEmail: true,
      role: 'admin',
    })

    const startAt = futureIsoMinutes(60)
    const created = await adminCreateHandler(
      buildRequest('/api/admin/slots', {
        cookie: admin.cookie,
        body: {
          teacherAccountId: teacher.accountId,
          startAt,
          durationMinutes: 60,
        },
      }),
    )
    expect(created.status).toBe(201)

    const list = await availableHandler(buildRequest('/api/slots/available'))
    expect(list.status).toBe(200)
    const json = await list.json()
    expect(json.slots.length).toBe(1)
    expect(json.slots[0].status).toBe('open')
  })

  it('learner with verified email books an open slot', async () => {
    const teacher = await registerAndCookie('teacher-b@example.com', {
      verifyEmail: true,
      role: 'teacher',
    })
    const admin = await registerAndCookie('admin-b@example.com', {
      verifyEmail: true,
      role: 'admin',
    })
    const learner = await registerAndCookie('learner-b@example.com', {
      verifyEmail: true,
    })

    const created = await adminCreateHandler(
      buildRequest('/api/admin/slots', {
        cookie: admin.cookie,
        body: {
          teacherAccountId: teacher.accountId,
          startAt: futureIsoMinutes(60),
          durationMinutes: 60,
        },
      }),
    )
    const createdJson = await created.json()
    const slotId = createdJson.slot.id as string

    const book = await bookHandler(
      buildRequest(`/api/slots/${slotId}/book`, {
        cookie: learner.cookie,
        body: {},
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    expect(book.status).toBe(200)
    const bookJson = await book.json()
    expect(bookJson.slot.status).toBe('booked')
    expect(bookJson.slot.learnerAccountId).toBe(learner.accountId)
  })

  it('booking refused for unverified email (403 email_not_verified)', async () => {
    const teacher = await registerAndCookie('teacher-c@example.com', {
      verifyEmail: true,
      role: 'teacher',
    })
    const admin = await registerAndCookie('admin-c@example.com', {
      verifyEmail: true,
      role: 'admin',
    })
    const learner = await registerAndCookie('learner-c@example.com', {
      verifyEmail: false,
    })

    const created = await adminCreateHandler(
      buildRequest('/api/admin/slots', {
        cookie: admin.cookie,
        body: {
          teacherAccountId: teacher.accountId,
          startAt: futureIsoMinutes(60),
          durationMinutes: 60,
        },
      }),
    )
    const slotId = (await created.json()).slot.id as string

    const book = await bookHandler(
      buildRequest(`/api/slots/${slotId}/book`, {
        cookie: learner.cookie,
        body: {},
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    expect(book.status).toBe(403)
    const json = await book.json()
    expect(json.error).toBe('email_not_verified')
  })

  it('two concurrent bookings: first wins, second gets 409', async () => {
    const teacher = await registerAndCookie('teacher-d@example.com', {
      verifyEmail: true,
      role: 'teacher',
    })
    const admin = await registerAndCookie('admin-d@example.com', {
      verifyEmail: true,
      role: 'admin',
    })
    const learner1 = await registerAndCookie('learner-d1@example.com', {
      verifyEmail: true,
    })
    const learner2 = await registerAndCookie('learner-d2@example.com', {
      verifyEmail: true,
    })

    const created = await adminCreateHandler(
      buildRequest('/api/admin/slots', {
        cookie: admin.cookie,
        body: {
          teacherAccountId: teacher.accountId,
          startAt: futureIsoMinutes(60),
          durationMinutes: 60,
        },
      }),
    )
    const slotId = (await created.json()).slot.id as string

    // Fire both bookings as concurrently as JS allows.
    const [r1, r2] = await Promise.all([
      bookHandler(
        buildRequest(`/api/slots/${slotId}/book`, {
          cookie: learner1.cookie,
          body: {},
        }),
        { params: Promise.resolve({ id: slotId }) },
      ),
      bookHandler(
        buildRequest(`/api/slots/${slotId}/book`, {
          cookie: learner2.cookie,
          body: {},
        }),
        { params: Promise.resolve({ id: slotId }) },
      ),
    ])
    const statuses = [r1.status, r2.status].sort()
    expect(statuses).toEqual([200, 409])
  })

  it('learner cancels their own booking (>24h ahead)', async () => {
    const teacher = await registerAndCookie('teacher-e@example.com', {
      verifyEmail: true,
      role: 'teacher',
    })
    const admin = await registerAndCookie('admin-e@example.com', {
      verifyEmail: true,
      role: 'admin',
    })
    const learner = await registerAndCookie('learner-e@example.com', {
      verifyEmail: true,
    })

    const created = await adminCreateHandler(
      buildRequest('/api/admin/slots', {
        cookie: admin.cookie,
        body: {
          teacherAccountId: teacher.accountId,
          // Phase 5 24h rule: must be ≥24h ahead for the learner cancel.
          startAt: futureIsoMinutes(48 * 60),
          durationMinutes: 60,
        },
      }),
    )
    const slotId = (await created.json()).slot.id as string

    await bookHandler(
      buildRequest(`/api/slots/${slotId}/book`, {
        cookie: learner.cookie,
        body: {},
      }),
      { params: Promise.resolve({ id: slotId }) },
    )

    const cancel = await cancelHandler(
      buildRequest(`/api/slots/${slotId}/cancel`, {
        cookie: learner.cookie,
        body: { reason: 'busy' },
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    expect(cancel.status).toBe(200)
    const json = await cancel.json()
    expect(json.slot.status).toBe('cancelled')
    expect(json.slot.cancellationReason).toBe('busy')
  })

  it('learner cannot cancel someone else\u2019s booking', async () => {
    const teacher = await registerAndCookie('teacher-f@example.com', {
      verifyEmail: true,
      role: 'teacher',
    })
    const admin = await registerAndCookie('admin-f@example.com', {
      verifyEmail: true,
      role: 'admin',
    })
    const learner = await registerAndCookie('learner-f@example.com', {
      verifyEmail: true,
    })
    const stranger = await registerAndCookie('stranger-f@example.com', {
      verifyEmail: true,
    })

    const created = await adminCreateHandler(
      buildRequest('/api/admin/slots', {
        cookie: admin.cookie,
        body: {
          teacherAccountId: teacher.accountId,
          startAt: futureIsoMinutes(60),
          durationMinutes: 60,
        },
      }),
    )
    const slotId = (await created.json()).slot.id as string
    await bookHandler(
      buildRequest(`/api/slots/${slotId}/book`, {
        cookie: learner.cookie,
        body: {},
      }),
      { params: Promise.resolve({ id: slotId }) },
    )

    const cancel = await cancelHandler(
      buildRequest(`/api/slots/${slotId}/cancel`, {
        cookie: stranger.cookie,
        body: {},
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    expect(cancel.status).toBe(403)
  })

  it('admin gates: anon → 401, non-admin → 403', async () => {
    const anon = await adminListHandler(
      buildRequest('/api/admin/slots'),
    )
    expect(anon.status).toBe(401)

    const nonAdmin = await registerAndCookie('non-admin-g@example.com', {
      verifyEmail: true,
    })
    const res = await adminListHandler(
      buildRequest('/api/admin/slots', { cookie: nonAdmin.cookie }),
    )
    expect(res.status).toBe(403)
  })

  it('admin books-as-operator on a learner\u2019s behalf', async () => {
    const teacher = await registerAndCookie('teacher-h@example.com', {
      verifyEmail: true,
      role: 'teacher',
    })
    const admin = await registerAndCookie('admin-h@example.com', {
      verifyEmail: true,
      role: 'admin',
    })
    const learner = await registerAndCookie('learner-h@example.com', {
      verifyEmail: true,
    })

    const created = await adminCreateHandler(
      buildRequest('/api/admin/slots', {
        cookie: admin.cookie,
        body: {
          teacherAccountId: teacher.accountId,
          startAt: futureIsoMinutes(60),
          durationMinutes: 60,
        },
      }),
    )
    const slotId = (await created.json()).slot.id as string

    const book = await adminBookAsOpHandler(
      buildRequest(`/api/admin/slots/${slotId}/book-as-operator`, {
        cookie: admin.cookie,
        body: { learnerEmail: 'learner-h@example.com' },
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    expect(book.status).toBe(200)
    const json = await book.json()
    expect(json.slot.status).toBe('booked')
    expect(json.slot.learnerAccountId).toBe(learner.accountId)
  })

  it('book-as-operator refused for unverified-email learner', async () => {
    const teacher = await registerAndCookie('teacher-i@example.com', {
      verifyEmail: true,
      role: 'teacher',
    })
    const admin = await registerAndCookie('admin-i@example.com', {
      verifyEmail: true,
      role: 'admin',
    })
    await registerAndCookie('learner-i@example.com', {
      verifyEmail: false,
    })

    const created = await adminCreateHandler(
      buildRequest('/api/admin/slots', {
        cookie: admin.cookie,
        body: {
          teacherAccountId: teacher.accountId,
          startAt: futureIsoMinutes(60),
          durationMinutes: 60,
        },
      }),
    )
    const slotId = (await created.json()).slot.id as string

    const book = await adminBookAsOpHandler(
      buildRequest(`/api/admin/slots/${slotId}/book-as-operator`, {
        cookie: admin.cookie,
        body: { learnerEmail: 'learner-i@example.com' },
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    expect(book.status).toBe(400)
  })

  it('admin cancels a booked slot', async () => {
    const teacher = await registerAndCookie('teacher-j@example.com', {
      verifyEmail: true,
      role: 'teacher',
    })
    const admin = await registerAndCookie('admin-j@example.com', {
      verifyEmail: true,
      role: 'admin',
    })
    const learner = await registerAndCookie('learner-j@example.com', {
      verifyEmail: true,
    })

    const created = await adminCreateHandler(
      buildRequest('/api/admin/slots', {
        cookie: admin.cookie,
        body: {
          teacherAccountId: teacher.accountId,
          startAt: futureIsoMinutes(60),
          durationMinutes: 60,
        },
      }),
    )
    const slotId = (await created.json()).slot.id as string
    await bookHandler(
      buildRequest(`/api/slots/${slotId}/book`, {
        cookie: learner.cookie,
        body: {},
      }),
      { params: Promise.resolve({ id: slotId }) },
    )

    const cancel = await adminCancelHandler(
      buildRequest(`/api/admin/slots/${slotId}/cancel`, {
        cookie: admin.cookie,
        body: { reason: 'teacher sick' },
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    expect(cancel.status).toBe(200)
  })

  it('GET /api/slots/mine returns the learner\u2019s own bookings', async () => {
    const teacher = await registerAndCookie('teacher-k@example.com', {
      verifyEmail: true,
      role: 'teacher',
    })
    const admin = await registerAndCookie('admin-k@example.com', {
      verifyEmail: true,
      role: 'admin',
    })
    const learner = await registerAndCookie('learner-k@example.com', {
      verifyEmail: true,
    })

    const created = await adminCreateHandler(
      buildRequest('/api/admin/slots', {
        cookie: admin.cookie,
        body: {
          teacherAccountId: teacher.accountId,
          startAt: futureIsoMinutes(60),
          durationMinutes: 60,
        },
      }),
    )
    const slotId = (await created.json()).slot.id as string
    await bookHandler(
      buildRequest(`/api/slots/${slotId}/book`, {
        cookie: learner.cookie,
        body: {},
      }),
      { params: Promise.resolve({ id: slotId }) },
    )

    const mine = await mineHandler(
      buildRequest('/api/slots/mine', { cookie: learner.cookie }),
    )
    expect(mine.status).toBe(200)
    const json = await mine.json()
    expect(json.slots.length).toBe(1)
    expect(json.slots[0].learnerAccountId).toBe(learner.accountId)
  })
})
