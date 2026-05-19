// BCS-DEF-2 — POST /api/admin/slots/[id]/dismiss-conflict.
//
// Plan: docs/plans/conflict-feed.md §3.3 (round-3 SIGN-OFF, 2026-05-19).
//
// Mirrors the teacher-side dismiss-conflict endpoint
// (app/api/teacher/slots/[id]/dismiss-conflict/route.ts) but for the
// operator: requires admin role, writes a secondary audit row into
// `slot_admin_actions`, and emits a `slot.conflict_dismissed` event
// into the slot's `lesson_slots.events` jsonb history (canonical
// audit — independent of the secondary table).
//
// Atomic UPDATE WHERE external_conflict_at IS NOT NULL RETURNING
// gates the actual mutation; two operators racing each get their own
// idempotency-cache row, but only one UPDATE matches a non-null
// stamp — the loser sees 0 rows and 404s.
//
// 42P01 (slot_admin_actions missing during deploy-before-migrate)
// is recovered VIA SAVEPOINT — the only way to keep the TX live so
// the slot UPDATE can still commit (Postgres marks the TX aborted
// on any failed statement; only `ROLLBACK TO SAVEPOINT` undoes the
// failure while keeping the TX usable). Round-1 BLOCKER#1 closure.

import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { requireAdminRole } from '@/lib/auth/guards'
import { isUndefinedTableError } from '@/lib/db/errors'
import { getDbPool } from '@/lib/db/pool'
import { withIdempotency } from '@/lib/security/idempotency'

// Mirror of `appendEventSql` from `lib/scheduling/slots/internal` —
// the internal module is sibling-only per the module-boundaries
// guardrail, so this admin route reconstructs the event shape inline
// (~6 lines). The shape MUST stay aligned with the canonical helper
// since `lesson_slots.events` is read by `/admin/slots/[id]` history.
function buildSlotEventJson(
  eventType: string,
  actor: string | null,
  payload?: Record<string, unknown>,
): string {
  const event = {
    type: eventType,
    at: new Date().toISOString(),
    actor,
    ...(payload ? { payload } : {}),
  }
  return JSON.stringify([event])
}
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const MIN_REASON_LEN = 3
const MAX_REASON_LEN = 500

type RouteParams = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params

  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(
    request,
    'admin:slots:dismiss-conflict:ip',
    30,
    60_000,
  )
  if (rl) return rl

  const guard = await requireAdminRole(request)
  if (!guard.ok) return guard.response

  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json(
      { error: 'not_found_or_no_conflict' },
      { status: 404, headers: NO_STORE },
    )
  }

  // Parse body once — withIdempotency needs the raw body to compute
  // the request hash. Strict JSON: a malformed body is a 400 (mirrors
  // the cancel route's posture).
  const raw = await request.text().catch(() => '')
  let body: unknown = {}
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

  const reasonRaw =
    typeof body === 'object'
    && body !== null
    && typeof (body as Record<string, unknown>).reason === 'string'
      ? ((body as Record<string, unknown>).reason as string).trim()
      : ''
  if (reasonRaw.length < MIN_REASON_LEN) {
    return NextResponse.json(
      {
        error: 'reason_required',
        message: `Укажите причину (минимум ${MIN_REASON_LEN} символа).`,
      },
      { status: 400, headers: NO_STORE },
    )
  }
  if (reasonRaw.length > MAX_REASON_LEN) {
    return NextResponse.json(
      { error: 'reason_too_long' },
      { status: 400, headers: NO_STORE },
    )
  }

  const operatorAccountId = guard.account.id
  const scope = `admin:slots:dismiss-conflict:${id}:${operatorAccountId}`

  return withIdempotency(request, scope, raw, async () => {
    return runDismissConflict({
      slotId: id,
      operatorAccountId,
      reason: reasonRaw,
    })
  })
}

async function runDismissConflict(opts: {
  slotId: string
  operatorAccountId: string
  reason: string
}): Promise<{ status: number; body: unknown }> {
  const pool = getDbPool()
  const client = await pool.connect()
  try {
    await client.query('begin')

    // Snapshot pre-state under FOR UPDATE so concurrent dismiss /
    // cancel attempts on the same slot serialize through this lock.
    const snapshot = await client.query(
      `select external_conflict_at,
              external_conflict_kind,
              conflict_source_calendar_id,
              conflict_source_event_id
         from lesson_slots
        where id = $1
        for update`,
      [opts.slotId],
    )
    if (
      snapshot.rows.length === 0
      || snapshot.rows[0].external_conflict_at === null
    ) {
      await client.query('rollback')
      return {
        status: 404,
        body: { error: 'not_found_or_no_conflict' },
      }
    }
    const pre = snapshot.rows[0]

    // Atomic UPDATE — the WHERE is the security boundary. Two
    // operators racing each see their own idempotency-cache row,
    // but only ONE UPDATE matches the non-null stamp.
    const event = buildSlotEventJson('slot.conflict_dismissed', 'admin', {
      operatorAccountId: opts.operatorAccountId,
      reason: opts.reason,
    })
    const update = await client.query(
      `update lesson_slots
          set external_conflict_at = null,
              external_conflict_kind = null,
              conflict_source_calendar_id = null,
              conflict_source_event_id = null,
              updated_at = now(),
              events = $2::jsonb || events
        where id = $1
          and external_conflict_at is not null
        returning id`,
      [opts.slotId, event],
    )
    if (update.rows.length === 0) {
      // Concurrent dismiss won the race between our SELECT FOR UPDATE
      // releasing and our UPDATE evaluating its WHERE. Very rare but
      // valid; 404 keeps the contract honest.
      await client.query('rollback')
      return {
        status: 404,
        body: { error: 'not_found_or_no_conflict' },
      }
    }

    // Audit INSERT — wrapped in SAVEPOINT so 42P01 doesn't abort the
    // whole TX. Round-1 BLOCKER#1 closure.
    const payload = {
      pre_conflict_at: pre.external_conflict_at
        ? new Date(String(pre.external_conflict_at)).toISOString()
        : null,
      pre_conflict_kind: pre.external_conflict_kind
        ? String(pre.external_conflict_kind)
        : null,
      pre_cal_id: pre.conflict_source_calendar_id
        ? String(pre.conflict_source_calendar_id)
        : null,
      pre_event_id: pre.conflict_source_event_id
        ? String(pre.conflict_source_event_id)
        : null,
    }
    try {
      await client.query('savepoint before_audit')
      await client.query(
        `insert into slot_admin_actions
           (slot_id, operator_account_id, action, reason, payload)
         values ($1, $2, 'dismiss-conflict', $3, $4::jsonb)`,
        [
          opts.slotId,
          opts.operatorAccountId,
          opts.reason,
          JSON.stringify(payload),
        ],
      )
      await client.query('release savepoint before_audit')
    } catch (auditErr) {
      if (isUndefinedTableError(auditErr)) {
        await client
          .query('rollback to savepoint before_audit')
          .catch(() => {})
        console.warn(
          '[admin.dismiss-conflict] migration 0062 pending — audit row skipped',
          { slotId: opts.slotId },
        )
      } else {
        throw auditErr
      }
    }

    await client.query('commit')
    return {
      status: 200,
      body: { ok: true, slotId: opts.slotId },
    }
  } catch (err) {
    await client.query('rollback').catch(() => {})
    console.warn('[admin.dismiss-conflict] unexpected error', {
      slotId: opts.slotId,
      err: err instanceof Error ? err.message : String(err),
    })
    return {
      status: 500,
      body: { error: 'internal_error' },
    }
  } finally {
    client.release()
  }
}
