import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { getAuthPool } from '@/lib/auth/pool'
import { requireLearnerArchetypeAndVerified } from '@/lib/auth/guards'
import { enforceAccountRateLimit } from '@/lib/security/account-rate-limit'
import { enforceTrustedBrowserOrigin } from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// SAAS-PIVOT Epic 7 Day 7 — learner self-unlink from a teacher.
//
// Plan: docs/plans/saas-pivot-master.md §3 Epic 7 + §5 Day 7.
//
// Soft-unlink semantics: sets `learner_teacher_links.unlinked_at = now()`
// for the (current-learner, teacherId) pair when an ACTIVE link exists.
// History stays — getActiveTeacherIdsForLearner reads
// `unlinked_at IS NULL`, so the teacher disappears from the cabinet
// view but the row remains for audit and for a future re-link.
//
// Anti-spoof: the WHERE clause hard-binds the update to
// `learner_account_id = $session.account.id`. A learner cannot pass
// somebody else's teacherId — they can only ever tear down THEIR OWN
// link. Wrong-learner attempts collapse to a 404 (no row updated).
//
// Why no advisory lock here (vs setAssignedTeacher which takes one):
// this writer is a single-row UPDATE with no inter-row consistency
// claim. The PK on (learner, teacher) means there's at most one row
// to flip; concurrent unlink + invite-redeem for the SAME teacher
// resolve at the row level (last writer wins on `unlinked_at`, and
// invite redeem's ON CONFLICT DO UPDATE re-arms it). Operator
// reassign + learner self-unlink for DIFFERENT teachers don't
// touch the same row.
//
// Rate-limit: cap at 30 unlinks per learner per hour. A learner with
// 2-3 teachers won't realistically hit this; abusive script-driven
// toggling does.

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(
  request: Request,
  context: { params: Promise<{ teacherId: string }> },
) {
  const origin = enforceTrustedBrowserOrigin(request)
  if (origin) return origin

  const auth = await requireLearnerArchetypeAndVerified(request)
  if (!auth.ok) return auth.response

  const rl = await enforceAccountRateLimit(
    auth.account.id,
    'cabinet-link-unlink',
    30,
    60 * 60_000,
  )
  if (rl) return rl

  const { teacherId } = await context.params
  if (!UUID_PATTERN.test(teacherId)) {
    return NextResponse.json(
      { error: 'not_found', message: 'Связь не найдена.' },
      { status: 404, headers: NO_STORE },
    )
  }

  const pool = getAuthPool()
  // Single-statement soft-unlink. Returning the row count lets us
  // distinguish "no active link existed" from "successfully un-armed".
  // Both are non-error 200/404; we keep the surface tight so callers
  // don't leak "did this learner ever have a link with this teacher".
  const result = await pool.query(
    `update learner_teacher_links
        set unlinked_at = now()
      where learner_account_id = $1
        and teacher_account_id = $2
        and unlinked_at is null
      returning learner_account_id`,
    [auth.account.id, teacherId],
  )
  if (result.rowCount === 0) {
    return NextResponse.json(
      { error: 'not_found', message: 'Связь не найдена.' },
      { status: 404, headers: NO_STORE },
    )
  }

  return NextResponse.json(
    { ok: true },
    { status: 200, headers: NO_STORE },
  )
}
