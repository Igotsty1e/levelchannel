import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { requireLearnerArchetype } from '@/lib/auth/guards'
import { cancelLearnerSlot } from '@/lib/scheduling/slots'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'


type RouteParams = { params: Promise<{ id: string }> }

// POST /api/slots/[id]/cancel — learner cancels their own booking.
//
// Codex 2026-05-07 #3 — the previous implementation read the slot,
// evaluated the 24h rule in JS, then issued a wide UPDATE that
// allowed any status except 'cancelled' to flip. That left two TOCTOU
// windows AND let a `completed` / `no_show_*` row be retroactively
// rewritten as `cancelled`. The new flow folds ownership + booked-state
// + 24h cutoff into a single atomic UPDATE — `cancelLearnerSlot` is
// the security boundary; this route just maps the disambiguation to
// HTTP statuses.
//
// Operator-side cancel goes through /api/admin/slots/[id]/cancel and
// bypasses the 24h gate by design (admin override).

export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params

  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(request, 'slots:cancel:ip', 30, 60_000)
  if (rl) return rl

  const auth = await requireLearnerArchetype(request)
  if (!auth.ok) return auth.response

  // Codex Wave 13 Pass 2 #14. Match the teacher-cancel rule: empty
  // body is OK (no reason supplied), but a MALFORMED body indicates a
  // broken caller and must 400 — otherwise a corrupt body silently
  // cancels the slot without the learner's reason payload reaching
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

  try {
    const result = await cancelLearnerSlot(id, auth.account.id, reason)
    if (result.ok) {
      // BCS-E.worker — record durable post-cancel intent. The
      // intent worker (drainIntents) picks it up and enqueues the
      // delete push job. Plan §4.6 F6″ splits the slot UPDATE and
      // the push enqueue into two TX to keep lock-order clean; we
      // do that here at the route boundary. F9″ reconcile sweep
      // catches the rare orphan if this insert fails between TX1
      // and TX2.
      try {
        const { insertPostCancelIntent } = await import(
          '@/lib/calendar/intent-worker'
        )
        const { getDbPool } = await import('@/lib/db/pool')
        await insertPostCancelIntent(getDbPool(), id)
      } catch (e) {
        console.warn(
          '[calendar/cancel] post-cancel intent insert failed:',
          e,
        )
      }
      return NextResponse.json(
        { slot: result.slot },
        { status: 200, headers: NO_STORE },
      )
    }

    if (result.reason === 'not_found') {
      return NextResponse.json(
        { error: 'Slot not found.' },
        { status: 404, headers: NO_STORE },
      )
    }
    if (result.reason === 'not_owner') {
      return NextResponse.json(
        { error: 'Можно отменить только своё бронирование.' },
        { status: 403, headers: NO_STORE },
      )
    }
    if (result.reason === 'already_terminal') {
      return NextResponse.json(
        { error: 'already_terminal' },
        { status: 409, headers: NO_STORE },
      )
    }
    // SAAS-PIVOT Day 5A — slot is in a billable terminal state.
    if (result.reason === 'after_completion') {
      return NextResponse.json(
        {
          error: 'after_completion',
          message:
            'Урок уже отмечен как проведённый. Свяжитесь с преподавателем, чтобы снять отметку.',
        },
        { status: 409, headers: NO_STORE },
      )
    }
    // too_late_to_cancel
    return NextResponse.json(
      {
        error: 'too_late_to_cancel',
        minutesUntilStart: result.minutesUntilStart,
      },
      { status: 403, headers: NO_STORE },
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    // cancelLearnerSlot throws `slot/cancellationReason/too_long`.
    if (msg.startsWith('slot/')) {
      return NextResponse.json(
        { error: msg },
        { status: 400, headers: NO_STORE },
      )
    }
    console.warn('[slots.cancel] unexpected error', { error: msg })
    return NextResponse.json(
      { error: 'internal_error' },
      { status: 500, headers: NO_STORE },
    )
  }
}
