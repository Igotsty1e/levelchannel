// POST /api/teacher/slots/bulk-assign-direct
//
// epic-b Sub-PR B.3 (2026-06-11, epic-close). Teacher назначает
// несколько занятий конкретному ученику в одном проходе. Зеркалит
// /api/teacher/slots/bulk-create для shape, но каждая итерация уходит
// через `assignSlotDirect` — те же billing-gates что в /assign-direct
// + 23505-сейф INSERT booked.
//
// Body: {
//   learnerAccountId: UUID,
//   durationMinutes: int,
//   tariffId: UUID,
//   notes?: string|null,
//   billingChoice?: 'auto'|'package'|'postpaid',
//   slots: { startAt: ISO }[]
// }
//
// Response (200):
//   {
//     created: LessonSlot[],
//     skippedConflicts: string[],
//     skippedReasons: { startAt: string; reason: string }[],
//     emailSkipped: boolean,  // any iteration that hit per-learner cap
//   }
//
// Wire safety:
//   - teacher_account_id BOUND from session, NEVER body
//   - origin gate + rate-limit 10/min IP (same budget as bulk-create)
//   - cap slots.length at 50 (lower than bulk-create 200 — direct-assign
//     fires an email per slot, even with the per-learner digest fallback
//     bulk runs that scale are abuse-shaped, not UX-shaped)

import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { readJsonObjectOr400 } from '@/lib/api/json-body'
import { requireTeacherWithCurrentSaasOfferConsent } from '@/lib/auth/guards'
import {
  type AssignSlotDirectInput,
  assignSlotDirect,
} from '@/lib/scheduling/slots'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_SLOTS_PER_REQUEST = 50

export async function POST(request: Request) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(
    request,
    'teacher:bulk-assign-direct:ip',
    10,
    60_000,
  )
  if (rl) return rl

  const guard = await requireTeacherWithCurrentSaasOfferConsent(request)
  if (!guard.ok) return guard.response

  const parsed = await readJsonObjectOr400(request, { coded: true })
  if (!parsed.ok) return parsed.response
  const raw = parsed.body

  if (typeof raw.learnerAccountId !== 'string') {
    return badRequest('learnerAccountId/missing')
  }
  if (typeof raw.durationMinutes !== 'number') {
    return badRequest('durationMinutes/missing')
  }
  if (typeof raw.tariffId !== 'string') {
    return badRequest('tariffId/missing')
  }
  if (!Array.isArray(raw.slots) || raw.slots.length === 0) {
    return badRequest('slots/missing')
  }
  if (raw.slots.length > MAX_SLOTS_PER_REQUEST) {
    return NextResponse.json(
      {
        error: 'too_many_slots',
        max: MAX_SLOTS_PER_REQUEST,
      },
      { status: 422, headers: NO_STORE },
    )
  }
  const slots = raw.slots
    .filter(
      (s): s is { startAt: string } =>
        typeof s === 'object'
        && s !== null
        && typeof (s as Record<string, unknown>).startAt === 'string',
    )
    .map((s) => ({ startAt: s.startAt }))

  if (slots.length === 0) {
    return badRequest('slots/empty')
  }

  const notes
    = raw.notes === null
      ? null
      : typeof raw.notes === 'string'
        ? raw.notes
        : undefined

  const billingChoiceRaw = raw.billingChoice
  const billingChoice: AssignSlotDirectInput['billingChoice']
    = billingChoiceRaw === 'package'
      || billingChoiceRaw === 'postpaid'
      || billingChoiceRaw === 'auto'
      ? billingChoiceRaw
      : undefined

  const created: unknown[] = []
  const skippedConflicts: string[] = []
  const skippedReasons: Array<{ startAt: string; reason: string }> = []
  let anyEmailSkipped = false

  // Sequential dispatch — each iteration runs its own TX inside
  // `assignSlotDirect`, including the per-learner advisory lock. Running
  // in parallel would have all iterations queue on the SAME advisory
  // lock anyway, so sequential is simpler + identical throughput. A
  // single 23505/external_conflict on one slot doesn't poison the rest.
  for (const s of slots) {
    const input: AssignSlotDirectInput = {
      teacherAccountId: guard.account.id,
      learnerAccountId: raw.learnerAccountId,
      startAt: s.startAt,
      durationMinutes: raw.durationMinutes,
      tariffId: raw.tariffId,
      notes,
      billingChoice,
      // bulk path never pins packagePurchaseId — `consumePackageUnit`
      // auto-picks earliest-expiring matching package on each iteration.
      // Avoids the "all 10 slots consume the same purchase" race where
      // a pinned id would overshoot countRemaining.
    }
    try {
      const result = await assignSlotDirect(input)
      if (result.ok) {
        created.push(result.slot)
        if (result.emailSkipped) anyEmailSkipped = true
      } else if (result.reason === 'slot_collision') {
        skippedConflicts.push(s.startAt)
      } else {
        skippedReasons.push({ startAt: s.startAt, reason: result.reason })
      }
    } catch (err) {
      skippedReasons.push({
        startAt: s.startAt,
        reason: err instanceof Error ? err.name : 'internal_error',
      })
    }
  }

  // 200 — partial success is the normal shape (mirrors bulk-create).
  // Caller surfaces per-slot reasons in the UI.
  return NextResponse.json(
    {
      created,
      skippedConflicts,
      skippedReasons,
      emailSkipped: anyEmailSkipped,
    },
    { status: 200, headers: NO_STORE },
  )
}

function badRequest(code: string) {
  return NextResponse.json(
    { error: code },
    { status: 400, headers: NO_STORE },
  )
}
