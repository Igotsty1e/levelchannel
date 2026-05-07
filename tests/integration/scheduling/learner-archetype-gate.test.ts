import { describe, expect, it } from 'vitest'

import { POST as adminCreateHandler } from '@/app/api/admin/slots/route'
import { POST as loginHandler } from '@/app/api/auth/login/route'
import { POST as registerHandler } from '@/app/api/auth/register/route'
import { POST as bookHandler } from '@/app/api/slots/[id]/book/route'
import { POST as cancelHandler } from '@/app/api/slots/[id]/cancel/route'
import { GET as availableHandler } from '@/app/api/slots/available/route'
import { GET as mineHandler } from '@/app/api/slots/mine/route'
import {
  getAccountByEmail,
  grantAccountRole,
  markAccountVerified,
} from '@/lib/auth/accounts'

import '../setup'
import { buildRequest, extractSessionCookie } from '../helpers'

// Wave 1 (security) — learner-archetype gate on /api/slots/*.
// Pins: admin and teacher roles are blocked from booking, cancelling,
// and listing learner-side slot endpoints. Anonymous users keep the
// existing loose access on /api/slots/available; everywhere else
// stays 401-on-unauthenticated.

async function reg(
  email: string,
  opts: { verifyEmail?: boolean; role?: 'admin' | 'teacher' | 'student' } = {},
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

describe('Wave 1 — learner-archetype gate on /api/slots/*', () => {
  describe('teacher role is blocked', () => {
    it('GET /api/slots/mine → 403 wrong_role', async () => {
      const teacher = await reg('arch-mine-teacher@example.com', {
        verifyEmail: true,
        role: 'teacher',
      })
      const res = await mineHandler(
        buildRequest('/api/slots/mine', { cookie: teacher.cookie }),
      )
      expect(res.status).toBe(403)
      const body = await res.json()
      expect(body.error).toBe('wrong_role')
    })

    it('GET /api/slots/available → 403 wrong_role', async () => {
      const teacher = await reg('arch-avail-teacher@example.com', {
        verifyEmail: true,
        role: 'teacher',
      })
      const res = await availableHandler(
        buildRequest('/api/slots/available', { cookie: teacher.cookie }),
      )
      expect(res.status).toBe(403)
      const body = await res.json()
      expect(body.error).toBe('wrong_role')
    })

    it('POST /api/slots/[id]/book → 403 wrong_role even for own teaching slot', async () => {
      const teacher = await reg('arch-book-teacher@example.com', {
        verifyEmail: true,
        role: 'teacher',
      })
      const admin = await reg('arch-book-admin@example.com', {
        verifyEmail: true,
        role: 'admin',
      })
      const slotRes = await adminCreateHandler(
        buildRequest('/api/admin/slots', {
          cookie: admin.cookie,
          body: {
            teacherAccountId: teacher.accountId,
            startAt: futureMin(60),
            durationMinutes: 60,
          },
        }),
      )
      const slotJson = await slotRes.json()
      const slotId = slotJson.slot.id

      const res = await bookHandler(
        buildRequest(`/api/slots/${slotId}/book`, {
          method: 'POST',
          cookie: teacher.cookie,
        }),
        { params: Promise.resolve({ id: slotId }) },
      )
      expect(res.status).toBe(403)
      const body = await res.json()
      expect(body.error).toBe('wrong_role')
    })

    it('POST /api/slots/[id]/cancel → 403 wrong_role', async () => {
      const teacher = await reg('arch-cancel-teacher@example.com', {
        verifyEmail: true,
        role: 'teacher',
      })
      // Slot id can be a fake uuid — the gate fires before the lookup.
      const res = await cancelHandler(
        buildRequest('/api/slots/00000000-0000-0000-0000-000000000000/cancel', {
          method: 'POST',
          cookie: teacher.cookie,
          body: {},
        }),
        {
          params: Promise.resolve({
            id: '00000000-0000-0000-0000-000000000000',
          }),
        },
      )
      expect(res.status).toBe(403)
      const body = await res.json()
      expect(body.error).toBe('wrong_role')
    })
  })

  describe('admin role is blocked from learner endpoints', () => {
    it('GET /api/slots/mine → 403 (admin is operator, not learner)', async () => {
      const admin = await reg('arch-mine-admin@example.com', {
        verifyEmail: true,
        role: 'admin',
      })
      const res = await mineHandler(
        buildRequest('/api/slots/mine', { cookie: admin.cookie }),
      )
      expect(res.status).toBe(403)
      const body = await res.json()
      expect(body.error).toBe('wrong_role')
    })

    it('GET /api/slots/available → 403', async () => {
      const admin = await reg('arch-avail-admin@example.com', {
        verifyEmail: true,
        role: 'admin',
      })
      const res = await availableHandler(
        buildRequest('/api/slots/available', { cookie: admin.cookie }),
      )
      expect(res.status).toBe(403)
    })

    it('POST /api/slots/[id]/book → 403', async () => {
      const admin = await reg('arch-book-admin-only@example.com', {
        verifyEmail: true,
        role: 'admin',
      })
      const res = await bookHandler(
        buildRequest('/api/slots/00000000-0000-0000-0000-000000000000/book', {
          method: 'POST',
          cookie: admin.cookie,
        }),
        {
          params: Promise.resolve({
            id: '00000000-0000-0000-0000-000000000000',
          }),
        },
      )
      expect(res.status).toBe(403)
    })
  })

  describe('learner archetypes pass through', () => {
    it('no-role learner can list /api/slots/mine', async () => {
      const learner = await reg('arch-mine-norole@example.com', {
        verifyEmail: true,
      })
      const res = await mineHandler(
        buildRequest('/api/slots/mine', { cookie: learner.cookie }),
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(Array.isArray(body.slots)).toBe(true)
    })

    it('explicit-student-role learner passes the gate', async () => {
      const learner = await reg('arch-mine-student@example.com', {
        verifyEmail: true,
        role: 'student',
      })
      const res = await mineHandler(
        buildRequest('/api/slots/mine', { cookie: learner.cookie }),
      )
      expect(res.status).toBe(200)
    })

    it('anonymous request to /api/slots/available stays open (loose contract)', async () => {
      const res = await availableHandler(buildRequest('/api/slots/available'))
      expect(res.status).toBe(200)
    })
  })
})
