import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

// SAAS-3+4 TINV.3+4 — structural assertions on the invite-flow
// wiring. Component / integration coverage (full POST + redeem + DB
// state) lands with TINV.8 in the integration suite.

const ROOT = path.resolve(__dirname, '..', '..')

function read(p: string): string {
  return readFileSync(path.join(ROOT, p), 'utf-8')
}

describe('SAAS-4 lib/auth/teacher-invites.ts DB primitives', () => {
  it('exports createInviteForTeacher', () => {
    const src = read('lib/auth/teacher-invites.ts')
    expect(src).toMatch(/export async function createInviteForTeacher/)
    expect(src).toMatch(/insert into teacher_invites/)
  })

  it('exports listInvitesForTeacher', () => {
    const src = read('lib/auth/teacher-invites.ts')
    expect(src).toMatch(/export async function listInvitesForTeacher/)
    expect(src).toMatch(/from teacher_invites/)
  })

  it('exports revokeInvite with ownership-in-WHERE', () => {
    const src = read('lib/auth/teacher-invites.ts')
    expect(src).toMatch(/export async function revokeInvite/)
    // Must have teacher_account_id in the WHERE clause (anti-spoof).
    expect(src).toMatch(
      /update teacher_invites[\s\S]*?where id = \$1[\s\S]*?and teacher_account_id = \$2/,
    )
  })

  it('exports redeemInviteAndBindLearnerAtomic with single-CTE shape', () => {
    const src = read('lib/auth/teacher-invites.ts')
    expect(src).toMatch(/export async function redeemInviteAndBindLearnerAtomic/)
    // Must use writable CTE + EXISTS role-check (round-3 BLOCKER#1
    // closure: prove inviter still has teacher role at moment of redeem).
    expect(src).toMatch(/with verified_invite as \(/)
    expect(src).toMatch(/exists \(\s*select 1 from account_roles/)
    expect(src).toMatch(/and r\.role = 'teacher'/)
    // SAAS-PIVOT Day 2 (2026-05-22) — the writable CTE now also inserts
    // into learner_teacher_links (canonical n:m table) and dual-writes
    // accounts.assigned_teacher_id from the CTE. Both writes derive
    // the teacher id from the verified_invite CTE (anti-spoof). The
    // CTE alias is `vi` after the rewrite.
    expect(src).toMatch(/insert into learner_teacher_links/)
    expect(src).toMatch(
      /update accounts\s+set assigned_teacher_id = vi\.teacher_account_id/,
    )
  })

  it('rejects invalid uuids without hitting the DB', () => {
    const src = read('lib/auth/teacher-invites.ts')
    // Defensive uuid check before the pool.query.
    expect(src).toMatch(/UUID_RE\.test\(inviteId\)/)
    expect(src).toMatch(/UUID_RE\.test\(learnerAccountId\)/)
  })
})

describe('SAAS-4 /api/teacher/invites endpoints', () => {
  it('POST route gated by requireTeacherAndVerified + origin check', () => {
    const src = read('app/api/teacher/invites/route.ts')
    expect(src).toMatch(/requireTeacherAndVerified/)
    expect(src).toMatch(/enforceTrustedBrowserOrigin/)
  })

  it('POST emits auth.invite.created audit', () => {
    const src = read('app/api/teacher/invites/route.ts')
    expect(src).toMatch(/eventType:\s*['"]auth\.invite\.created['"]/)
  })

  it('GET returns the list shape with status field', () => {
    const src = read('app/api/teacher/invites/route.ts')
    expect(src).toMatch(/listInvitesForTeacher/)
    expect(src).toMatch(/status:\s*r\.status/)
  })

  it('revoke route 404-normalises miss + emits audit', () => {
    const src = read('app/api/teacher/invites/[id]/revoke/route.ts')
    expect(src).toMatch(/revokeInvite/)
    expect(src).toMatch(/status:\s*404/)
    expect(src).toMatch(/eventType:\s*['"]auth\.invite\.revoked['"]/)
  })
})

describe('SAAS-4 /api/auth/register invite-redeem branch', () => {
  it('accepts inviteToken in body schema', () => {
    const src = read('app/api/auth/register/route.ts')
    expect(src).toMatch(/inviteToken\?:\s*string/)
  })

  it('verifies token + forces role to student on valid invite', () => {
    const src = read('app/api/auth/register/route.ts')
    expect(src).toMatch(/verifyInviteToken\(body\.inviteToken\)/)
    expect(src).toMatch(/requestedRole = ['"]student['"]/)
  })

  it('atomic redeem-and-bind via single-statement CTE helper', () => {
    const src = read('app/api/auth/register/route.ts')
    expect(src).toMatch(/redeemInviteAndBindLearnerAtomic/)
  })

  it('fails closed on redeem failure (409 invite_already_used_or_expired)', () => {
    const src = read('app/api/auth/register/route.ts')
    expect(src).toMatch(/invite_already_used_or_expired/)
    expect(src).toMatch(/status:\s*409/)
  })

  it('emits auth.invite.redeemed audit on success', () => {
    const src = read('app/api/auth/register/route.ts')
    expect(src).toMatch(/eventType:\s*['"]auth\.invite\.redeemed['"]/)
  })

  it('emits auth.teacher.self_registered audit for new-email teacher', () => {
    const src = read('app/api/auth/register/route.ts')
    expect(src).toMatch(/eventType:\s*['"]auth\.teacher\.self_registered['"]/)
  })
})

describe('SAAS-4 /register page accepts invite token', () => {
  it('reads invite from useSearchParams', () => {
    const src = read('app/register/page.tsx')
    expect(src).toMatch(/useSearchParams/)
    expect(src).toMatch(/searchParams\.get\(['"]invite['"]\)/)
  })

  it('sends inviteToken in POST body when present', () => {
    const src = read('app/register/page.tsx')
    expect(src).toMatch(/inviteToken[\s\S]*?inviteToken/)
  })

  it('hides role radio when invite token present (auto-locked to student)', () => {
    const src = read('app/register/page.tsx')
    expect(src).toMatch(/inviteToken \? \(/)
    expect(src).toMatch(/Вы регистрируетесь по приглашению учителя/)
  })
})

describe('SAAS-4 cabinet TeacherInviteSection', () => {
  it('renders disabled placeholder when !isVerified', () => {
    const src = read('app/cabinet/teacher-invite-section.tsx')
    expect(src).toMatch(/if \(!isVerified\) \{/)
    expect(src).toMatch(/подтвердите свой e-mail/i)
  })

  it('mounted in /cabinet for teacher role with isVerified prop', () => {
    const src = read('app/cabinet/page.tsx')
    expect(src).toMatch(/<TeacherInviteSection isVerified=\{isVerified\}/)
  })

  it('POSTs to /api/teacher/invites for generation', () => {
    const src = read('app/cabinet/teacher-invite-section.tsx')
    expect(src).toMatch(/postAuthJson\(['"]\/api\/teacher\/invites['"]/)
  })

  it('revoke action posts to /api/teacher/invites/<id>/revoke', () => {
    const src = read('app/cabinet/teacher-invite-section.tsx')
    expect(src).toMatch(
      /postAuthJson\(`\/api\/teacher\/invites\/\$\{encodeURIComponent\(id\)\}\/revoke`/,
    )
  })
})
