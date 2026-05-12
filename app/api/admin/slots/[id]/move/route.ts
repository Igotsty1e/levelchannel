import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { requireAdminRole } from '@/lib/auth/guards'
import { moveOpenSlot, validateSlotStartMsk } from '@/lib/scheduling/slots'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'


type RouteParams = { params: Promise<{ id: string }> }

// Wave A — calendar drag-to-move. Open-only at the data layer (booked
// / completed / cancelled slots immovable). Atomic UPDATE WHERE
// status='open' mirrors `cancelLearnerSlot` precedent.
//
// Body: { newStartAt: string (ISO UTC) }
//
// 200 — slot moved
// 400 — bad body / new time outside business hours / not 30-min aligned / cross-midnight
// 404 — slot not found
// 409 — slot is not open (booked/completed/cancelled) OR collision with existing slot
//
// Domain validations live here (mirror DB CHECKs from migration 0031).
// CHECK constraints are last line of defence.

const ISO_INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/

export async function PATCH(request: Request, { params }: RouteParams) {
  const { id } = await params

  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(request, 'admin:slots:move:ip', 60, 60_000)
  if (rl) return rl

  const guard = await requireAdminRole(request)
  if (!guard.ok) return guard.response

  let body: unknown = null
  try {
    body = await request.json()
  } catch {
    body = {}
  }
  const newStartAt =
    typeof body === 'object' &&
    body !== null &&
    typeof (body as Record<string, unknown>).newStartAt === 'string'
      ? ((body as Record<string, unknown>).newStartAt as string)
      : null

  if (!newStartAt || !ISO_INSTANT_PATTERN.test(newStartAt)) {
    return NextResponse.json(
      { error: 'bad_new_start_at', message: 'newStartAt must be an ISO instant.' },
      { status: 400, headers: NO_STORE },
    )
  }

  // Mirror the DB invariants in JS so we return 400 with a structured
  // reason BEFORE the constraint kicks in. The DB CHECKs are the last
  // line; we want UX-meaningful errors from the route.
  const startMs = Date.parse(newStartAt)
  if (Number.isNaN(startMs)) {
    return NextResponse.json(
      { error: 'bad_new_start_at' },
      { status: 400, headers: NO_STORE },
    )
  }
  const startError = validateSlotStartMsk(startMs)
  if (startError) {
    return NextResponse.json(
      { error: startError.code, message: startError.message },
      { status: 400, headers: NO_STORE },
    )
  }

  try {
    const result = await moveOpenSlot(id, newStartAt, guard.account.id)
    if (result.ok) {
      return NextResponse.json({ slot: result.slot }, { status: 200, headers: NO_STORE })
    }
    if (result.reason === 'not_found') {
      return NextResponse.json(
        { error: 'not_found' },
        { status: 404, headers: NO_STORE },
      )
    }
    if (result.reason === 'slot_collision') {
      return NextResponse.json(
        {
          error: 'slot_collision',
          message: 'У преподавателя уже есть слот на это время.',
        },
        { status: 409, headers: NO_STORE },
      )
    }
    // not_open
    return NextResponse.json(
      {
        error: 'not_open',
        message: 'Перемещать можно только открытые слоты.',
      },
      { status: 409, headers: NO_STORE },
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    // CHECK violation from migration 0031 — should be unreachable
    // because we mirror the invariants above, but defensive.
    if (msg.includes('lesson_slots_within_msk_day')) {
      return NextResponse.json(
        { error: 'slot/cross_midnight' },
        { status: 400, headers: NO_STORE },
      )
    }
    if (msg.includes('lesson_slots_start_in_business_hours')) {
      return NextResponse.json(
        { error: 'slot/start_out_of_band' },
        { status: 400, headers: NO_STORE },
      )
    }
    if (msg.includes('lesson_slots_start_30min_aligned')) {
      return NextResponse.json(
        { error: 'slot/start_not_30min_aligned' },
        { status: 400, headers: NO_STORE },
      )
    }
    // moveSlot throws `slot/<field>/<reason>` for known bad-input
    // (e.g. slot/newStartAt/invalid). Pass through as 400.
    if (msg.startsWith('slot/')) {
      return NextResponse.json(
        { error: msg },
        { status: 400, headers: NO_STORE },
      )
    }
    // Unknown failure mode — treat as a server fault, not a client
    // error. Returning 400 with the raw message would leak internals
    // (provider/DB chatter, stack-trace fragments) to the operator
    // UI and obscure real 500s in observability.
    console.warn('[admin.slots.move] unexpected error', {
      error: msg,
    })
    return NextResponse.json(
      { error: 'internal_error' },
      { status: 500, headers: NO_STORE },
    )
  }
}
