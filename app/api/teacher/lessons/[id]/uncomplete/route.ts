import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { requireTeacherWithCurrentSaasOfferConsent } from '@/lib/auth/guards'
import { getDbPool } from '@/lib/db/pool'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// SAAS-PIVOT Epic 5A Day 5A — teacher un-mark route.
//
// Plan: docs/plans/saas-pivot-master.md §2.6 + §5 Day 5A.
//
// Deletes the lesson_completions row. The BEFORE DELETE trigger
// (mig 0092) enforces the 4-condition gate at the DB layer:
//   1. immutable_at IS NOT NULL → 48h window passed.
//   2. lesson_settlement_completions row exists → settlement covered.
//   3. teacher_earnings.related_completion_id row exists → accrued.
// The reverse trigger flips lesson_slots.status back to 'booked'.
//
// The route layer adds a friendly-error pre-check (gate (a) teacher
// ownership; (b) 48h window; (c) settlement; (d) earnings) so the UI
// gets a structured 409 reason instead of a raw Postgres exception.
// The trigger remains the defense-in-depth: any caller that bypasses
// this route (direct SQL, future routes) still hits the gate.

type RouteParams = { params: Promise<{ id: string }> }

const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000

export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params

  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(
    request,
    'teacher:lessons:uncomplete:ip',
    30,
    60_000,
  )
  if (rl) return rl

  const guard = await requireTeacherWithCurrentSaasOfferConsent(request)
  if (!guard.ok) return guard.response

  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json(
      { error: 'not_found' },
      { status: 404, headers: NO_STORE },
    )
  }

  const pool = getDbPool()
  const client = await pool.connect()
  try {
    await client.query('begin')
    // Lock the completion row + classify in one statement.
    const sniff = await client.query(
      `select id, teacher_id, immutable_at, created_at
         from lesson_completions
        where id = $1
        for update`,
      [id],
    )
    if (sniff.rows.length === 0) {
      await client.query('rollback')
      return NextResponse.json(
        { error: 'not_found', message: 'Отметка не найдена.' },
        { status: 404, headers: NO_STORE },
      )
    }
    const row = sniff.rows[0]
    if (String(row.teacher_id) !== guard.account.id) {
      await client.query('rollback')
      return NextResponse.json(
        {
          error: 'not_owner',
          message: 'Эта отметка не принадлежит вашему аккаунту.',
        },
        { status: 403, headers: NO_STORE },
      )
    }

    // Gate 1: 48h immutability. The retention sweep stamps
    // `immutable_at` after the window passes; we also evaluate the
    // window dynamically here for the case where the sweep hasn't
    // run yet but created_at + 48h is already in the past.
    const createdMs = new Date(String(row.created_at)).getTime()
    const elapsedMs = Date.now() - createdMs
    if (row.immutable_at != null || elapsedMs >= FORTY_EIGHT_HOURS_MS) {
      await client.query('rollback')
      return NextResponse.json(
        {
          error: 'immutable',
          message: '48 часов прошло — отметку нельзя снять.',
        },
        { status: 409, headers: NO_STORE },
      )
    }

    // Gate 2: settlement coverage.
    const settlementCheck = await client.query(
      `select 1 from lesson_settlement_completions where completion_id = $1 limit 1`,
      [id],
    )
    if (settlementCheck.rows.length > 0) {
      await client.query('rollback')
      return NextResponse.json(
        {
          error: 'settled',
          message: 'Урок уже учтён в платежах — отметку нельзя снять.',
        },
        { status: 409, headers: NO_STORE },
      )
    }

    // Gate 3: accrued earnings.
    const earningsCheck = await client.query(
      `select 1 from teacher_earnings where related_completion_id = $1 limit 1`,
      [id],
    )
    if (earningsCheck.rows.length > 0) {
      await client.query('rollback')
      return NextResponse.json(
        {
          error: 'accrued',
          message:
            'По уроку уже начислена выплата — отметку нельзя снять.',
        },
        { status: 409, headers: NO_STORE },
      )
    }

    // All gates pass. DELETE; the BEFORE DELETE trigger is the safety
    // net. The reverse trigger flips slot status back to 'booked'.
    await client.query(`delete from lesson_completions where id = $1`, [id])
    await client.query('commit')
    return NextResponse.json(
      { ok: true, completionId: id },
      { status: 200, headers: NO_STORE },
    )
  } catch (e) {
    await client.query('rollback').catch(() => {})
    const msg = e instanceof Error ? e.message : 'unknown'
    // Trigger-raised exceptions arrive here. Match the SQLSTATEs from
    // the BEFORE DELETE guard and surface a structured 409. (The
    // app-side gates above should catch these first; this is the
    // defense-in-depth path for race conditions or direct SQL.)
    if (msg.includes('lesson_completions: immutability passed')) {
      return NextResponse.json(
        { error: 'immutable', message: '48 часов прошло — отметку нельзя снять.' },
        { status: 409, headers: NO_STORE },
      )
    }
    if (msg.includes('lesson_completions: settlement exists')) {
      return NextResponse.json(
        { error: 'settled', message: 'Урок уже учтён в платежах.' },
        { status: 409, headers: NO_STORE },
      )
    }
    if (msg.includes('lesson_completions: earnings accrued')) {
      return NextResponse.json(
        { error: 'accrued', message: 'По уроку уже начислена выплата.' },
        { status: 409, headers: NO_STORE },
      )
    }
    console.warn('[teacher.lessons.uncomplete] unexpected error', {
      completionId: id,
      error: msg,
    })
    return NextResponse.json(
      { error: 'internal_error' },
      { status: 500, headers: NO_STORE },
    )
  } finally {
    client.release()
  }
}
