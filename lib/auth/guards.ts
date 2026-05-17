import { NextResponse } from 'next/server'

import { type Account, listAccountRoles } from '@/lib/auth/accounts'
import { isLearnerArchetypeCandidate } from '@/lib/auth/learner-archetype'
import { type Session, getCurrentSession } from '@/lib/auth/sessions'

export type GuardResult =
  | { ok: true; account: Account; session: Session }
  | { ok: false; response: NextResponse }

// One-stop session guard for cabinet API routes. Returns the resolved
// account + session, or a NextResponse the caller should immediately
// `return` (401 with no-store headers, no cookie clear — the cabinet's
// /api/auth/me does the clear; chained 401 from a different surface
// should not double-stamp the cookie).
export async function requireAuthenticated(
  request: Request,
): Promise<GuardResult> {
  const current = await getCurrentSession(request)
  if (!current) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Not authenticated.' },
        { status: 401, headers: { 'Cache-Control': 'no-store, max-age=0' } },
      ),
    }
  }
  return { ok: true, account: current.account, session: current.session }
}

// Admin-only gate for /api/admin/* and the /admin SSR pages. Reuses
// requireAuthenticated, then checks the role list. 401 is returned to
// anonymous; 403 is returned to a logged-in non-admin so the UI can
// distinguish "your session is gone" from "you can't be here".
export async function requireAdminRole(request: Request): Promise<GuardResult> {
  const auth = await requireAuthenticated(request)
  if (!auth.ok) return auth
  const roles = await listAccountRoles(auth.account.id)
  if (!roles.includes('admin')) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Forbidden.' },
        { status: 403, headers: { 'Cache-Control': 'no-store, max-age=0' } },
      ),
    }
  }
  return { ok: true, account: auth.account, session: auth.session }
}

// Phase 4 booking gate: authenticated AND email-verified. Slot
// booking creates a real-world commitment; we require the learner to
// have proved they own the e-mail before they can occupy a teacher's
// time. Returns 403 with a structured `error: 'email_not_verified'`
// so the UI can surface a "подтвердите e-mail" hint instead of a
// generic forbidden.
export async function requireAuthenticatedAndVerified(
  request: Request,
): Promise<GuardResult> {
  const auth = await requireAuthenticated(request)
  if (!auth.ok) return auth
  if (!auth.account.emailVerifiedAt) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'email_not_verified' },
        { status: 403, headers: { 'Cache-Control': 'no-store, max-age=0' } },
      ),
    }
  }
  return { ok: true, account: auth.account, session: auth.session }
}

// Wave 1 (security) — learner-archetype gate.
//
// "Learner archetype" = an account that is allowed to book / cancel /
// list lessons as a student. Two archetypes today fall under this:
//   - accounts with no role at all (the default after registration);
//   - accounts with the explicit `student` role (assigned by an
//     operator for accounting / reporting; semantically identical
//     to "no role" at the gate level).
//
// Accounts with `admin` or `teacher` roles are NOT learners. Per
// migration 0023, those roles are mutually exclusive with `student`,
// so we don't need to special-case "admin who is also student" —
// that combination is rejected at role-grant time.
//
// Why deny-list (admin/teacher) instead of allow-list (student):
// historical accounts pre-dating the role system have no role row.
// An allow-list would lock those accounts out of their own bookings
// after a deploy. A deny-list reads "block elevated roles, anyone
// else passes" and keeps the existing user base unbroken.
//
// Use these for any /api/slots/* endpoint a learner reaches; they
// preserve the existing 401 (no session) and 403 (verified-required)
// shape AND add a `wrong_role` 403 with a translatable message so
// the UI can render an explanation instead of a bare forbidden.
function rejectElevated(): GuardResult {
  return {
    ok: false,
    response: NextResponse.json(
      {
        error: 'wrong_role',
        message: 'Эта операция доступна только ученикам.',
      },
      { status: 403, headers: { 'Cache-Control': 'no-store, max-age=0' } },
    ),
  }
}

export async function requireLearnerArchetype(
  request: Request,
): Promise<GuardResult> {
  const auth = await requireAuthenticated(request)
  if (!auth.ok) return auth
  const roles = await listAccountRoles(auth.account.id)
  if (roles.includes('admin') || roles.includes('teacher')) {
    return rejectElevated()
  }
  return { ok: true, account: auth.account, session: auth.session }
}

export async function requireLearnerArchetypeAndVerified(
  request: Request,
): Promise<GuardResult> {
  const auth = await requireAuthenticatedAndVerified(request)
  if (!auth.ok) return auth
  const roles = await listAccountRoles(auth.account.id)
  if (roles.includes('admin') || roles.includes('teacher')) {
    return rejectElevated()
  }
  // AUDIT-SEC-3 (2026-05-17) — align with the canonical predicate so
  // accounts inside deletion-grace (scheduled_purge_at set) or
  // already-purged or disabled can NOT hit downstream learner write
  // endpoints (/api/slots/[id]/book, /api/checkout/package/[slug],
  // etc.). Role check above is necessary but not sufficient: a learner
  // who tapped /account/delete still has their session valid until
  // grace expires + the anonymizer fires; without this gate they
  // could continue booking slots during the grace window. The
  // canonical predicate also re-asserts email-verified (already
  // enforced by requireAuthenticatedAndVerified — defense-in-depth).
  const stillEligible = await isLearnerArchetypeCandidate(auth.account.id)
  if (!stillEligible) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'learner_target_unavailable',
          message:
            'Аккаунт не может выполнять ученическую операцию (в графике удаления, выключен или роль изменилась).',
        },
        { status: 403, headers: { 'Cache-Control': 'no-store, max-age=0' } },
      ),
    }
  }
  return { ok: true, account: auth.account, session: auth.session }
}

// Wave A (calendar) — teacher gate. Allowed roles: only `teacher`,
// not `admin+teacher` (admin precedence redirects them to /admin/slots
// per `pickActiveCalendarRole` rule + Codex round 3 #2). Verified
// email required (same as learner).
export async function requireTeacherAndVerified(
  request: Request,
): Promise<GuardResult> {
  const auth = await requireAuthenticatedAndVerified(request)
  if (!auth.ok) return auth
  const roles = await listAccountRoles(auth.account.id)
  // Admin precedence: hybrid admin+teacher accounts get bounced to
  // /admin/slots by the route-level redirect; this guard rejects
  // them at API level so they don't accidentally accept teacher
  // surface writes (defense-in-depth, Wave 7 #3 lesson).
  if (roles.includes('admin')) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'admin_precedence',
          message: 'Hybrid admin+teacher accounts use /admin/slots.',
        },
        { status: 403, headers: { 'Cache-Control': 'no-store, max-age=0' } },
      ),
    }
  }
  if (!roles.includes('teacher')) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'wrong_role', message: 'Доступно только учителям.' },
        { status: 403, headers: { 'Cache-Control': 'no-store, max-age=0' } },
      ),
    }
  }
  return { ok: true, account: auth.account, session: auth.session }
}
