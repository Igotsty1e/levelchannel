import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { runCancelFromConflictCleanup } from '@/lib/admin/conflict-feed'
import { requireAdminRole } from '@/lib/auth/guards'
import { cancelSlot } from '@/lib/scheduling/slots'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// BCS-DEF-2 (2026-05-19) — admin cancel route extended for the
// /admin/slots/conflicts dashboard. When the body carries
// `fromConflict: true`, the route:
//
//   1. Requires a non-empty `reason` (≥3 chars after trim). The
//      audit chain depends on a recorded rationale (round-3 WARN#3
//      closure). Old callers that don't pass `fromConflict` retain
//      the prior contract — `reason` stays optional.
//
//   2. After `cancelSlot()` returns a non-null slot, AWAITS
//      `runCancelFromConflictCleanup()` — a separate cleanup TX
//      that clears the 4 conflict columns and inserts the secondary
//      `slot_admin_actions` audit row. Errors swallowed inside the
//      helper; the cancel response status is driven by `cancelSlot()`
//      outcome only (the cancel itself already committed).
//
// Plan: docs/plans/conflict-feed.md §3.4 + §4.4 (round-3 SIGN-OFF).

type RouteParams = { params: Promise<{ id: string }> }

const MIN_FROM_CONFLICT_REASON_LEN = 3

export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params

  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(request, 'admin:slots:ip', 30, 60_000)
  if (rl) return rl

  const guard = await requireAdminRole(request)
  if (!guard.ok) return guard.response

  // Codex Wave 13 Pass 2 #14. Match the teacher-cancel rule: empty
  // body is OK (no reason supplied), but a MALFORMED body indicates a
  // broken caller and must 400 — otherwise a corrupt body silently
  // cancels the slot without the operator's reason payload reaching
  // the audit trail.
  let body: unknown = {}
  const raw = await request.text().catch(() => '')
  if (raw.length > 0) {
    try {
      body = JSON.parse(raw)
    } catch {
      return NextResponse.json(
        { error: 'invalid_json_body', message: 'Invalid JSON body.' },
        { status: 400, headers: NO_STORE },
      )
    }
  }
  const reason =
    typeof body === 'object' &&
    body !== null &&
    typeof (body as Record<string, unknown>).reason === 'string'
      ? ((body as Record<string, unknown>).reason as string)
      : null
  // BCS-DEF-2 — opt-in flag from the /admin/slots/conflicts cell.
  // Defaults to false so old callers see zero behavior change.
  const fromConflict =
    typeof body === 'object' &&
    body !== null &&
    (body as Record<string, unknown>).fromConflict === true

  // Round-3 WARN#3 closure — the audit chain depends on a recorded
  // rationale for cancel-from-conflict. Enforce non-empty reason
  // BEFORE `cancelSlot()` runs (so a missing reason doesn't
  // accidentally cancel the slot and then 400 on audit).
  if (fromConflict) {
    const trimmed = (reason ?? '').trim()
    if (trimmed.length < MIN_FROM_CONFLICT_REASON_LEN) {
      return NextResponse.json(
        {
          error: 'reason_required',
          message: `Укажите причину (минимум ${MIN_FROM_CONFLICT_REASON_LEN} символа).`,
        },
        { status: 400, headers: NO_STORE },
      )
    }
  }

  try {
    const cancelled = await cancelSlot(id, guard.account.id, reason, 'admin')
    if (!cancelled) {
      return NextResponse.json(
        {
          error: 'slot_not_cancellable',
          message: 'Слот уже отменён или не найден.',
        },
        { status: 404, headers: NO_STORE },
      )
    }

    // BCS-DEF-2 cleanup branch — only taken when the dashboard caller
    // opts in. Errors are logged + swallowed inside the helper; we
    // still return 200 because the cancel itself already committed.
    if (fromConflict) {
      const payload = {
        pre_conflict_at: cancelled.externalConflictAt ?? null,
        pre_conflict_kind: cancelled.externalConflictKind ?? null,
        pre_cal_id: cancelled.conflictSourceCalendarId ?? null,
        pre_event_id: cancelled.conflictSourceEventId ?? null,
      }
      await runCancelFromConflictCleanup({
        slotId: cancelled.id,
        operatorAccountId: guard.account.id,
        reason: (reason ?? '').trim(),
        payload,
      })
    }

    return NextResponse.json({ slot: cancelled }, { status: 200, headers: NO_STORE })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    // cancelSlot throws `slot/cancellationReason/too_long` on bad input.
    if (msg.startsWith('slot/')) {
      return NextResponse.json(
        { error: msg },
        { status: 400, headers: NO_STORE },
      )
    }
    console.warn('[admin.slots.cancel] unexpected error', {
      slotId: id,
      error: msg,
    })
    return NextResponse.json(
      { error: 'internal_error' },
      { status: 500, headers: NO_STORE },
    )
  }
}
