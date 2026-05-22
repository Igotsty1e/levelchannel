import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { requireTeacherAndVerified } from '@/lib/auth/guards'
import { getDbPool } from '@/lib/db/pool'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'
import {
  SettleLessonsError,
  settleLessons,
} from '@/lib/teacher-ledger/settle-lessons'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// SAAS-PIVOT Epic 5B Day 5B — teacher settle route.
//
// Plan: docs/plans/saas-pivot-master.md §5 Day 5B + §2.6 + Epic 5.
//
// Accepts either:
//   - JSON body { amountKopecks: number, completionIds?: string[] }, OR
//   - form-encoded body (so the settle page can POST without JS): an
//     `amountKopecks` field (rubles or kopecks string) + zero-or-more
//     `completionId` fields (multi-checkbox).
//
// On success the route either returns 200 JSON for fetch callers or
// 303 redirects form callers back to `/teacher/learners/[id]` so the
// browser shows the new balance.
//
// Anti-spoof: the teacher's account.id comes from the session guard;
// the body's teacher field (if any) is ignored. `settleLessons`
// further restricts candidates to (teacher_id = $session, learner_account_id =
// $params.id), so even a body-supplied completionId for another
// teacher's row will be rejected with `completion_not_eligible`.
//
// Pre-check: route layer additionally verifies the learner is in the
// teacher's active links OR has any historical slot with this teacher
// (matching the `/teacher/learners/[id]` page guard). Defense in
// depth — settleLessons does NOT enforce link membership on its own.

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type RouteParams = { params: Promise<{ id: string }> }

type ParsedBody =
  | {
      ok: true
      amountKopecks: number
      completionIds: string[] | undefined
      wantsRedirect: boolean
    }
  | { ok: false; response: NextResponse }

async function parseBody(
  request: Request,
  learnerId: string,
): Promise<ParsedBody> {
  const contentType = request.headers.get('content-type') ?? ''
  // Form posts from the SSR /settle page.
  if (
    contentType.includes('application/x-www-form-urlencoded') ||
    contentType.includes('multipart/form-data')
  ) {
    const form = await request.formData()
    const amountRaw = form.get('amountKopecks')
    if (typeof amountRaw !== 'string') {
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'amountKopecks/required' },
          { status: 400, headers: NO_STORE },
        ),
      }
    }
    const amountKopecks = Number(amountRaw)
    if (
      !Number.isFinite(amountKopecks) ||
      !Number.isInteger(amountKopecks) ||
      amountKopecks <= 0
    ) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'amountKopecks/invalid' },
          { status: 400, headers: NO_STORE },
        ),
      }
    }
    const completionIds = form
      .getAll('completionId')
      .filter((v): v is string => typeof v === 'string')
    for (const id of completionIds) {
      if (!UUID_PATTERN.test(id)) {
        return {
          ok: false,
          response: NextResponse.json(
            { error: 'completionId/invalid' },
            { status: 400, headers: NO_STORE },
          ),
        }
      }
    }
    return {
      ok: true,
      amountKopecks,
      completionIds: completionIds.length > 0 ? completionIds : undefined,
      wantsRedirect: true,
    }
  }
  // JSON body for fetch/JSON callers.
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'body/invalid_json' },
        { status: 400, headers: NO_STORE },
      ),
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'body/not_object' },
        { status: 400, headers: NO_STORE },
      ),
    }
  }
  const obj = raw as Record<string, unknown>
  const amountKopecks =
    typeof obj.amountKopecks === 'number' ? obj.amountKopecks : null
  if (
    amountKopecks === null ||
    !Number.isFinite(amountKopecks) ||
    !Number.isInteger(amountKopecks) ||
    amountKopecks <= 0
  ) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'amountKopecks/invalid' },
        { status: 400, headers: NO_STORE },
      ),
    }
  }
  let completionIds: string[] | undefined
  if (obj.completionIds !== undefined) {
    if (!Array.isArray(obj.completionIds)) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'completionIds/not_array' },
          { status: 400, headers: NO_STORE },
        ),
      }
    }
    completionIds = []
    for (const id of obj.completionIds) {
      if (typeof id !== 'string' || !UUID_PATTERN.test(id)) {
        return {
          ok: false,
          response: NextResponse.json(
            { error: 'completionId/invalid' },
            { status: 400, headers: NO_STORE },
          ),
        }
      }
      completionIds.push(id)
    }
    if (completionIds.length === 0) completionIds = undefined
  }
  // Touch `learnerId` so the function signature carries it explicitly;
  // also keeps a future log line easy to add. No behaviour change.
  void learnerId
  return { ok: true, amountKopecks, completionIds, wantsRedirect: false }
}

export async function POST(request: Request, { params }: RouteParams) {
  const { id: learnerId } = await params

  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(
    request,
    'teacher:learners:settle:ip',
    20,
    60_000,
  )
  if (rl) return rl

  const guard = await requireTeacherAndVerified(request)
  if (!guard.ok) return guard.response

  if (!UUID_PATTERN.test(learnerId)) {
    return NextResponse.json(
      { error: 'learnerId/invalid' },
      { status: 404, headers: NO_STORE },
    )
  }

  // Anti-spoof: re-verify the learner is in the teacher's active links
  // (or has any historical slot with this teacher). Without this gate
  // a teacher could POST a settle for a learner not in their roster
  // and have settleLessons return an empty allocation but still record
  // a lesson_settlements row with the teacher as `teacher_id`.
  const pool = getDbPool()
  const linkGuard = await pool.query<{ in_link: boolean; has_slot: boolean }>(
    `select
       exists (
         select 1 from learner_teacher_links
          where learner_account_id = $1
            and teacher_account_id = $2
            and unlinked_at is null
       ) as in_link,
       exists (
         select 1 from lesson_slots
          where teacher_account_id = $2
            and learner_account_id = $1
       ) as has_slot`,
    [learnerId, guard.account.id],
  )
  const linkOk =
    linkGuard.rows[0]?.in_link === true || linkGuard.rows[0]?.has_slot === true
  if (!linkOk) {
    return NextResponse.json(
      { error: 'not_in_roster', message: 'Ученик не в вашем списке.' },
      { status: 404, headers: NO_STORE },
    )
  }

  const parsed = await parseBody(request, learnerId)
  if (!parsed.ok) return parsed.response

  // Audit HIGH closure: dedup transport-retry duplicates via short-window
  // fingerprint guard (idempotency-key from client headers is preferred
  // for fetch callers but the form page doesn't emit one). A second
  // identical POST within 60s for the same (teacher, learner, amount)
  // collapses to a 409 idempotent_replay. Combined with the advisory
  // lock inside settleLessonsInTx, this prevents both concurrent-race
  // double-settles and network-retry double-settles.
  const dedupKey = (await import('crypto')).createHash('sha256')
    .update(`${guard.account.id}:${learnerId}:${parsed.amountKopecks}:${(parsed.completionIds ?? []).sort().join(',')}`)
    .digest('hex')
  const recent = await pool.query<{ created_at: string }>(
    `select created_at from lesson_settlements
      where teacher_id = $1
        and learner_account_id = $2
        and amount_kopecks = $3
        and created_at > now() - interval '60 seconds'
      order by created_at desc limit 1`,
    [guard.account.id, learnerId, parsed.amountKopecks],
  )
  if (recent.rows.length > 0) {
    return NextResponse.json(
      {
        error: 'idempotent_replay',
        message: 'Аналогичный платёж был сейчас зарегистрирован. Подождите минуту перед повтором.',
        dedupKey,
      },
      { status: 409, headers: NO_STORE },
    )
  }

  try {
    const result = await settleLessons({
      learnerId,
      teacherId: guard.account.id, // anti-spoof: from session, NOT body
      amountKopecks: parsed.amountKopecks,
      completionIds: parsed.completionIds,
      markedByAccountId: guard.account.id,
    })
    if (parsed.wantsRedirect) {
      // 303: switch POST → GET so the browser doesn't re-submit on
      // back/refresh. Land on /teacher/learners/[id] so the operator
      // sees the updated balance immediately.
      return NextResponse.redirect(
        new URL(`/teacher/learners/${learnerId}`, request.url),
        { status: 303, headers: NO_STORE },
      )
    }
    return NextResponse.json(
      {
        ok: true,
        settlementId: result.settlementId,
        coveredCompletionIds: result.coveredCompletionIds,
        allocatedKopecks: result.allocatedKopecks,
        unallocatedKopecks: result.unallocatedKopecks,
      },
      { status: 200, headers: NO_STORE },
    )
  } catch (err) {
    if (err instanceof SettleLessonsError) {
      const status = err.reason === 'invalid_amount' ? 400 : 409
      return NextResponse.json(
        { error: err.reason, message: err.message },
        { status, headers: NO_STORE },
      )
    }
    console.error('[teacher.learners.settle] unexpected error', {
      learnerId,
      teacherId: guard.account.id,
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json(
      { error: 'internal_error' },
      { status: 500, headers: NO_STORE },
    )
  }
}
