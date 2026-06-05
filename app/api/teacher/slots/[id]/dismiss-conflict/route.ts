import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import {
  MutationGateAbort,
  requireTeacherAndVerified,
  runInSaasOfferMutationGate,
} from '@/lib/auth/guards'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/teacher/slots/[id]/dismiss-conflict
//
// Action a) "Я разрулю сам" — clears the external_conflict_at stamp
// on the slot. INTENTIONALLY OPTIMISTIC: if the same foreign event
// still overlaps on the next pull, the conflict detector will re-stamp
// it (lib/calendar/conflict-detector.ts).
//
// 2026-06-04 — saas-offer-mutation-wrapper-poc: migrated from the
// single-step `requireTeacherWithCurrentSaasOfferConsent` guard to
// the race-safe 2-step pattern. Plan:
// docs/plans/saas-offer-mutation-wrapper-rollout-poc.md.
//
// Perimeter ordering (per-route): origin → IP-RL → auth → gate.
//
// §0b-5 + §0c gate-first invariant: UUID validation moves INSIDE the
// wrapper callback so a gate-rejected teacher sees 403/503 (not 404)
// even on a malformed id. The wrapper opens a TX even for malformed
// inputs (small connection-acquisition cost), but the gate verdict
// reaches the user BEFORE any resource-shape information surfaces.

type RouteParams = { params: Promise<{ id: string }> }

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: Request, { params }: RouteParams) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(
    request,
    'teacher:slot:dismiss-conflict:ip',
    30,
    60_000,
  )
  if (rl) return rl

  const auth = await requireTeacherAndVerified(request)
  if (!auth.ok) return auth.response

  const { id } = await params

  const result = await runInSaasOfferMutationGate(auth.account.id, async (client) => {
    if (!UUID_PATTERN.test(id)) {
      throw MutationGateAbort.fromJson(
        { error: 'not_found_or_no_conflict' },
        { status: 404, headers: NO_STORE },
      )
    }
    const r = await client.query(
      `update lesson_slots
          set external_conflict_at = null,
              external_conflict_kind = null,
              conflict_source_calendar_id = null,
              conflict_source_event_id = null,
              updated_at = now()
        where id = $1
          and teacher_account_id = $2
          and external_conflict_at is not null
        returning id`,
      [id, auth.account.id],
    )
    if (r.rows.length === 0) {
      throw MutationGateAbort.fromJson(
        { error: 'not_found_or_no_conflict' },
        { status: 404, headers: NO_STORE },
      )
    }
    return { dismissed: id }
  })
  if (result instanceof NextResponse) return result
  return NextResponse.json(
    { ok: true, ...result },
    { status: 200, headers: NO_STORE },
  )
}
