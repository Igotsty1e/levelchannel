import { describe, expect, it } from 'vitest'

import { POST as loginHandler } from '@/app/api/auth/login/route'
import { POST as registerHandler } from '@/app/api/auth/register/route'
import {
  getAccountByEmail,
  grantAccountRole,
  markAccountVerified,
} from '@/lib/auth/accounts'
import { requireTeacherAndVerified } from '@/lib/auth/guards'
import { getDbPool } from '@/lib/db/pool'

import '../setup'
import { buildRequest, extractSessionCookie } from '../helpers'

// Wave A PR4 — teacher gate. Mirrors the SSR layout at app/teacher/
// (the layout uses cookies()+lookupSession+listAccountRoles inline;
// this guard wraps the same logic in API form so /api/* endpoints can
// reuse it). Pins:
//   - anonymous            → 401
//   - unverified           → 403 email_not_verified
//   - learner              → 403 wrong_role
//   - admin (hybrid/pure)  → 403 admin_precedence
//   - verified teacher     → ok=true

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

describe('requireTeacherAndVerified — auth matrix', () => {
  it('anonymous → 401', async () => {
    const r = await requireTeacherAndVerified(
      buildRequest('/teacher'),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.response.status).toBe(401)
  })

  it('unverified teacher → 403 email_not_verified', async () => {
    const teacher = await reg('teacher-guard-unv@example.com', {
      verifyEmail: false,
      role: 'teacher',
    })
    const r = await requireTeacherAndVerified(
      buildRequest('/teacher', { cookie: teacher.cookie }),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.response.status).toBe(403)
      const body = await r.response.json()
      expect(body.error).toBe('email_not_verified')
    }
  })

  it('learner (no role) → 403 wrong_role', async () => {
    const learner = await reg('teacher-guard-learner@example.com', {
      verifyEmail: true,
    })
    const r = await requireTeacherAndVerified(
      buildRequest('/teacher', { cookie: learner.cookie }),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.response.status).toBe(403)
      const body = await r.response.json()
      expect(body.error).toBe('wrong_role')
    }
  })

  it('student role → 403 wrong_role', async () => {
    const student = await reg('teacher-guard-student@example.com', {
      verifyEmail: true,
      role: 'student',
    })
    const r = await requireTeacherAndVerified(
      buildRequest('/teacher', { cookie: student.cookie }),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.response.status).toBe(403)
  })

  it('pure admin → 403 admin_precedence', async () => {
    const admin = await reg('teacher-guard-admin@example.com', {
      verifyEmail: true,
      role: 'admin',
    })
    const r = await requireTeacherAndVerified(
      buildRequest('/teacher', { cookie: admin.cookie }),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.response.status).toBe(403)
      const body = await r.response.json()
      expect(body.error).toBe('admin_precedence')
    }
  })

  it('hybrid admin+teacher → 403 admin_precedence', async () => {
    const hybrid = await reg('teacher-guard-hybrid@example.com', {
      verifyEmail: true,
      role: 'admin',
    })
    // Force-add 'teacher' role bypassing grantAccountRole's exclusivity.
    await getDbPool().query(
      `insert into account_roles (account_id, role, granted_by_account_id)
       values ($1, 'teacher', null)
       on conflict (account_id, role) do nothing`,
      [hybrid.accountId],
    )
    const r = await requireTeacherAndVerified(
      buildRequest('/teacher', { cookie: hybrid.cookie }),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.response.status).toBe(403)
      const body = await r.response.json()
      expect(body.error).toBe('admin_precedence')
    }
  })

  it('verified teacher → ok=true with account+session', async () => {
    const teacher = await reg('teacher-guard-ok@example.com', {
      verifyEmail: true,
      role: 'teacher',
    })
    const r = await requireTeacherAndVerified(
      buildRequest('/teacher', { cookie: teacher.cookie }),
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.account.id).toBe(teacher.accountId)
      expect(r.session).toBeDefined()
    }
  })

  it('hybrid teacher+student → ok=true (student role does not block)', async () => {
    const hybrid = await reg('teacher-guard-tch-student@example.com', {
      verifyEmail: true,
      role: 'teacher',
    })
    await getDbPool().query(
      `insert into account_roles (account_id, role, granted_by_account_id)
       values ($1, 'student', null)
       on conflict (account_id, role) do nothing`,
      [hybrid.accountId],
    )
    const r = await requireTeacherAndVerified(
      buildRequest('/teacher', { cookie: hybrid.cookie }),
    )
    expect(r.ok).toBe(true)
  })

  it('response carries no-store cache header on rejection', async () => {
    const learner = await reg('teacher-guard-cache@example.com', {
      verifyEmail: true,
    })
    const r = await requireTeacherAndVerified(
      buildRequest('/teacher', { cookie: learner.cookie }),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.response.headers.get('Cache-Control')).toContain('no-store')
    }
  })
})
