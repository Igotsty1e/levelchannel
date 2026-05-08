import { describe, expect, it } from 'vitest'

import { GET as calendarHandler } from '@/app/api/slots/calendar/route'
import { POST as loginHandler } from '@/app/api/auth/login/route'
import { POST as registerHandler } from '@/app/api/auth/register/route'
import {
  getAccountByEmail,
  grantAccountRole,
  markAccountVerified,
  setAssignedTeacher,
} from '@/lib/auth/accounts'
import { getDbPool } from '@/lib/db/pool'

import '../setup'
import { buildRequest, extractSessionCookie } from '../helpers'

async function registerAndCookie(
  email: string,
  opts: { role?: 'admin' | 'teacher' | 'student'; verify?: boolean } = {},
): Promise<{ cookie: string; accountId: string }> {
  const password = 'StrongPassword123'
  await registerHandler(
    buildRequest('/api/auth/register', {
      body: { email, password, personalDataConsentAccepted: true },
    }),
  )
  const acc = (await getAccountByEmail(email))!
  if (opts.verify !== false) await markAccountVerified(acc.id)
  if (opts.role) await grantAccountRole(acc.id, opts.role, null)
  const login = await loginHandler(
    buildRequest('/api/auth/login', { body: { email, password } }),
  )
  return {
    cookie: extractSessionCookie(login.headers.get('Set-Cookie'))!,
    accountId: acc.id,
  }
}

function callCalendar(cookie: string, teacherId: string) {
  return calendarHandler(
    buildRequest(
      `/api/slots/calendar?from=2026-05-10&to=2026-05-17&teacherId=${teacherId}`,
      { method: 'GET', cookie },
    ),
  )
}

describe('GET /api/slots/calendar — auth matrix', () => {
  it('admin can request any teacherId (happy path)', async () => {
    const teacher = await registerAndCookie('cal-auth-t1@example.com', { role: 'teacher' })
    const admin = await registerAndCookie('cal-auth-admin1@example.com', { role: 'admin' })
    const r = await callCalendar(admin.cookie, teacher.accountId)
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.teacherId).toBe(teacher.accountId)
  })

  it('teacher can request their own teacherId (happy path)', async () => {
    const teacher = await registerAndCookie('cal-auth-t2@example.com', { role: 'teacher' })
    const r = await callCalendar(teacher.cookie, teacher.accountId)
    expect(r.status).toBe(200)
  })

  it('teacher requesting another teacher\'s calendar gets 403 teacher_id_mismatch', async () => {
    const t1 = await registerAndCookie('cal-auth-t3@example.com', { role: 'teacher' })
    const t2 = await registerAndCookie('cal-auth-t4@example.com', { role: 'teacher' })
    const r = await callCalendar(t1.cookie, t2.accountId)
    expect(r.status).toBe(403)
    const body = await r.json()
    expect(body.error).toBe('teacher_id_mismatch')
    expect(body).not.toHaveProperty('slots')
  })

  it('learner with assignedTeacher=A requesting teacher=B gets 403', async () => {
    const teacherA = await registerAndCookie('cal-auth-tA@example.com', { role: 'teacher' })
    const teacherB = await registerAndCookie('cal-auth-tB@example.com', { role: 'teacher' })
    const learner = await registerAndCookie('cal-auth-l1@example.com')
    await setAssignedTeacher(learner.accountId, teacherA.accountId)
    const r = await callCalendar(learner.cookie, teacherB.accountId)
    expect(r.status).toBe(403)
    expect((await r.json()).error).toBe('teacher_id_mismatch')
  })

  it('learner with no assigned teacher gets 403 even when requesting random teacher', async () => {
    const teacher = await registerAndCookie('cal-auth-tx@example.com', { role: 'teacher' })
    const learner = await registerAndCookie('cal-auth-l2@example.com')
    const r = await callCalendar(learner.cookie, teacher.accountId)
    expect(r.status).toBe(403)
  })

  it('learner can request their assigned teacher (happy path)', async () => {
    const teacher = await registerAndCookie('cal-auth-ty@example.com', { role: 'teacher' })
    const learner = await registerAndCookie('cal-auth-l3@example.com')
    await setAssignedTeacher(learner.accountId, teacher.accountId)
    const r = await callCalendar(learner.cookie, teacher.accountId)
    expect(r.status).toBe(200)
  })

  it('anonymous → 401, not 403', async () => {
    const r = await callCalendar(
      '',
      '11111111-2222-3333-4444-555555555555',
    )
    expect(r.status).toBe(401)
  })

  // Hybrid role tests — direct DB insert bypasses grantAccountRole's
  // exclusivity check (Codex round 3 #2).
  it('hybrid admin+teacher: admin precedence wins for calendar — can request any teacherId', async () => {
    const hybrid = await registerAndCookie('cal-auth-hybrid1@example.com', { role: 'admin' })
    // Force-add 'teacher' role bypassing grantAccountRole's exclusivity.
    await getDbPool().query(
      `insert into account_roles (account_id, role, granted_by_account_id)
       values ($1, 'teacher', null)
       on conflict (account_id, role) do nothing`,
      [hybrid.accountId],
    )
    const otherTeacher = await registerAndCookie('cal-auth-other-t@example.com', { role: 'teacher' })
    const r = await callCalendar(hybrid.cookie, otherTeacher.accountId)
    expect(r.status).toBe(200) // admin precedence
  })

  it('hybrid teacher+student: teacher precedence wins; can request own teacherId only', async () => {
    const hybrid = await registerAndCookie('cal-auth-hybrid2@example.com', { role: 'teacher' })
    await getDbPool().query(
      `insert into account_roles (account_id, role, granted_by_account_id)
       values ($1, 'student', null)
       on conflict (account_id, role) do nothing`,
      [hybrid.accountId],
    )
    // own → 200
    const own = await callCalendar(hybrid.cookie, hybrid.accountId)
    expect(own.status).toBe(200)
    // other → 403 (teacher precedence binds to session.account.id)
    const other = await registerAndCookie('cal-auth-other-t2@example.com', { role: 'teacher' })
    const cross = await callCalendar(hybrid.cookie, other.accountId)
    expect(cross.status).toBe(403)
  })
})
