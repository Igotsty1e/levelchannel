import { describe, expect, it } from 'vitest'

import { GET as availableHandler } from '@/app/api/slots/available/route'
import { POST as bookHandler } from '@/app/api/slots/[id]/book/route'
import { POST as adminCreateHandler } from '@/app/api/admin/slots/route'
import { POST as adminTeacherHandler } from '@/app/api/admin/accounts/[id]/teacher/route'
import { POST as loginHandler } from '@/app/api/auth/login/route'
import { POST as registerHandler } from '@/app/api/auth/register/route'
import {
  getAccountByEmail,
  grantAccountRole,
  markAccountVerified,
} from '@/lib/auth/accounts'

import '../setup'
import { buildRequest, extractSessionCookie } from '../helpers'

async function reg(
  email: string,
  opts: { verifyEmail?: boolean; role?: 'admin' | 'teacher' } = {},
) {
  const password = 'StrongPassword123'
  await registerHandler(
    buildRequest('/api/auth/register', {
      body: { email, password, personalDataConsentAccepted: true },
    }),
  )
  const created = await getAccountByEmail(email)
  expect(created).not.toBeNull()
  if (opts.verifyEmail) await markAccountVerified(created!.id)
  if (opts.role) await grantAccountRole(created!.id, opts.role, null)
  const login = await loginHandler(
    buildRequest('/api/auth/login', { body: { email, password } }),
  )
  const cookie = extractSessionCookie(login.headers.get('Set-Cookie'))!
  return { cookie, accountId: created!.id }
}

function futureMin(n: number): string {
  return new Date(Date.now() + n * 60_000).toISOString()
}

describe('Phase 6+ teacher binding filters /api/slots/available', () => {
  it('unassigned learner sees an empty list (cabinet hint takes over)', async () => {
    const teacher = await reg('tb-teacher-1@example.com', {
      verifyEmail: true,
      role: 'teacher',
    })
    const admin = await reg('tb-admin-1@example.com', {
      verifyEmail: true,
      role: 'admin',
    })
    const learner = await reg('tb-learner-1@example.com', {
      verifyEmail: true,
    })

    // Operator creates an open slot — learner has no teacher assigned.
    await adminCreateHandler(
      buildRequest('/api/admin/slots', {
        cookie: admin.cookie,
        body: {
          teacherAccountId: teacher.accountId,
          startAt: futureMin(60),
          durationMinutes: 60,
        },
      }),
    )

    const res = await availableHandler(
      buildRequest('/api/slots/available', { cookie: learner.cookie }),
    )
    const json = await res.json()
    expect(json.slots.length).toBe(0)
  })

  it('assigned learner sees only their teacher\u2019s slots', async () => {
    const teacherA = await reg('tb-teacherA-2@example.com', {
      verifyEmail: true,
      role: 'teacher',
    })
    const teacherB = await reg('tb-teacherB-2@example.com', {
      verifyEmail: true,
      role: 'teacher',
    })
    const admin = await reg('tb-admin-2@example.com', {
      verifyEmail: true,
      role: 'admin',
    })
    const learner = await reg('tb-learner-2@example.com', {
      verifyEmail: true,
    })

    await adminCreateHandler(
      buildRequest('/api/admin/slots', {
        cookie: admin.cookie,
        body: {
          teacherAccountId: teacherA.accountId,
          startAt: futureMin(60),
          durationMinutes: 60,
        },
      }),
    )
    await adminCreateHandler(
      buildRequest('/api/admin/slots', {
        cookie: admin.cookie,
        body: {
          teacherAccountId: teacherB.accountId,
          startAt: futureMin(120),
          durationMinutes: 60,
        },
      }),
    )

    // Assign learner → teacherA.
    const assign = await adminTeacherHandler(
      buildRequest(`/api/admin/accounts/${learner.accountId}/teacher`, {
        cookie: admin.cookie,
        body: { teacherAccountId: teacherA.accountId },
      }),
      { params: Promise.resolve({ id: learner.accountId }) },
    )
    expect(assign.status).toBe(200)

    const res = await availableHandler(
      buildRequest('/api/slots/available', { cookie: learner.cookie }),
    )
    const json = await res.json()
    expect(json.slots.length).toBe(1)
    // Codex 2026-05-08 (MEDIUM) — authenticated learner now receives
    // the public slot DTO, which omits teacherAccountId. Assert on
    // public-shape fields instead.
    expect(json.slots[0].id).toBeTruthy()
    expect(json.slots[0].status).toBe('open')
    expect(json.slots[0]).not.toHaveProperty('teacherAccountId')
    expect(json.slots[0]).not.toHaveProperty('teacherEmail')
  })

  it('admin can unassign by passing teacherAccountId: null', async () => {
    const teacher = await reg('tb-teacher-3@example.com', {
      verifyEmail: true,
      role: 'teacher',
    })
    const admin = await reg('tb-admin-3@example.com', {
      verifyEmail: true,
      role: 'admin',
    })
    const learner = await reg('tb-learner-3@example.com', {
      verifyEmail: true,
    })

    await adminTeacherHandler(
      buildRequest(`/api/admin/accounts/${learner.accountId}/teacher`, {
        cookie: admin.cookie,
        body: { teacherAccountId: teacher.accountId },
      }),
      { params: Promise.resolve({ id: learner.accountId }) },
    )
    const unassign = await adminTeacherHandler(
      buildRequest(`/api/admin/accounts/${learner.accountId}/teacher`, {
        cookie: admin.cookie,
        body: { teacherAccountId: null },
      }),
      { params: Promise.resolve({ id: learner.accountId }) },
    )
    expect(unassign.status).toBe(200)

    // After unassign, available list is empty again.
    await adminCreateHandler(
      buildRequest('/api/admin/slots', {
        cookie: admin.cookie,
        body: {
          teacherAccountId: teacher.accountId,
          startAt: futureMin(60),
          durationMinutes: 60,
        },
      }),
    )
    const res = await availableHandler(
      buildRequest('/api/slots/available', { cookie: learner.cookie }),
    )
    const json = await res.json()
    expect(json.slots.length).toBe(0)
  })

  it('Codex 2026-05-08: explicit ?teacher= is IGNORED for authenticated learner (filter override closed)', async () => {
    const teacherA = await reg('tb-teacherA-4@example.com', {
      verifyEmail: true,
      role: 'teacher',
    })
    const teacherB = await reg('tb-teacherB-4@example.com', {
      verifyEmail: true,
      role: 'teacher',
    })
    const admin = await reg('tb-admin-4@example.com', {
      verifyEmail: true,
      role: 'admin',
    })
    const learner = await reg('tb-learner-4@example.com', {
      verifyEmail: true,
    })

    // learner is bound to teacherA. Slot exists for teacherB.
    // Pre-fix: ?teacher=teacherB would override the session and the
    // learner would see teacherB's slots. Post-fix: the query param
    // is IGNORED; learner sees only teacherA's slots (zero, since
    // we only created one for teacherB).
    await adminTeacherHandler(
      buildRequest(`/api/admin/accounts/${learner.accountId}/teacher`, {
        cookie: admin.cookie,
        body: { teacherAccountId: teacherA.accountId },
      }),
      { params: Promise.resolve({ id: learner.accountId }) },
    )
    await adminCreateHandler(
      buildRequest('/api/admin/slots', {
        cookie: admin.cookie,
        body: {
          teacherAccountId: teacherB.accountId,
          startAt: futureMin(60),
          durationMinutes: 60,
        },
      }),
    )
    const res = await availableHandler(
      buildRequest(
        `/api/slots/available?teacher=${teacherB.accountId}`,
        { cookie: learner.cookie },
      ),
    )
    const json = await res.json()
    // Filter is forced to learner's assigned teacher (teacherA), so
    // the slot belonging to teacherB is invisible. Empty list.
    expect(json.slots.length).toBe(0)
  })
})
