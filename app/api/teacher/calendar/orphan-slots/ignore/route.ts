import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { readJsonObjectOr400 } from '@/lib/api/json-body'
import {
  MutationGateAbort,
  requireTeacherAndVerified,
  runInSaasOfferMutationGate,
} from '@/lib/auth/guards'
import {
  ignoreAllOrphanSelfSlotsForTeacher,
  ignoreOrphanSelfSlot,
} from '@/lib/calendar/orphan-cleanup'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

// BCS-G.4 — POST /api/teacher/calendar/orphan-slots/ignore
//
// Bulk action — null the stale binding on either a single slot id
// (body: { slotId: '<uuid>' }) or all orphan-self rows for the
// session teacher (body: { all: true }). NULL-s
// external_calendar_id, external_event_id, integration_epoch.
//
// 2026-06-04 — saas-offer-mutation-wrapper-poc: migrated to the
// race-safe 2-step pattern. Plan:
// docs/plans/saas-offer-mutation-wrapper-rollout-poc.md.
//
// Perimeter ordering (per-route): origin → IP-RL → auth → gate.
//
// Gate-first invariant (wave-paranoia R1 BLOCKER #1 closure):
// readJsonObjectOr400() ALSO runs INSIDE the wrapper callback. Without
// this, a consent_required teacher with malformed JSON would see 400
// invalid_json_body before the gate returned 403 — that's observable
// resource-shape leakage. Moving the parse inside the wrapper means
// the gate verdict always precedes any body-shape error.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(
    request,
    'teacher:orphan-slots-ignore:ip',
    20,
    60_000,
  )
  if (rl) return rl

  const auth = await requireTeacherAndVerified(request)
  if (!auth.ok) return auth.response

  const result = await runInSaasOfferMutationGate(auth.account.id, async (client) => {
    const parsed = await readJsonObjectOr400(request, { coded: true })
    if (!parsed.ok) {
      // Wrap the 400 response in the abort sentinel so wrapper rolls
      // back AND returns the parsed.response unchanged. Gate-first
      // invariant preserved because parse runs AFTER gate verdict.
      throw new MutationGateAbort(parsed.response)
    }
    const body = parsed.body
    if (body.all === true) {
      return await ignoreAllOrphanSelfSlotsForTeacher(auth.account.id, { client })
    }
    if (typeof body.slotId !== 'string') {
      throw MutationGateAbort.fromJson(
        {
          error: 'invalid_body',
          message: 'Provide either `all: true` or `slotId: <uuid>`.',
        },
        { status: 400, headers: NO_STORE },
      )
    }
    const r = await ignoreOrphanSelfSlot({
      teacherAccountId: auth.account.id,
      slotId: body.slotId,
      client,
    })
    if (!r.ok) {
      throw MutationGateAbort.fromJson(
        { error: 'not_found', message: 'No orphan-self slot matched.' },
        { status: 404, headers: NO_STORE },
      )
    }
    return r
  })
  if (result instanceof NextResponse) return result
  return NextResponse.json({ ignored: result.ignored }, { headers: NO_STORE })
}
