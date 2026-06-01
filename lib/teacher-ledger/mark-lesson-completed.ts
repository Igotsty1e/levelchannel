// SAAS-PIVOT Epic 5A Day 5A — markLessonCompleted helper.
//
// Plan: docs/plans/saas-pivot-master.md §2.6.
//
// Single 3-step TX-bound helper for inserting a lesson_completions row.
// All three billable-event writers (teacher self-mark UI, admin
// /api/admin/slots/[id]/mark dispatch, auto-cron if/when re-enabled)
// go through this one helper. After Day 5A, no caller sets
// lesson_slots.status='completed' or 'no_show_learner' directly — only
// the forward trigger does, via this helper.
//
// Steps (round-26 BLOCKER #2 closure):
//   1. SELECT ... FOR UPDATE on the lesson_slots row (anti-race vs
//      concurrent cancel).
//   2. Eligibility gate (anti-spoof teacherId, status='booked',
//      end_at <= now()). Throws LessonCompletionEligibilityError on
//      fail.
//   3. INSERT ... ON CONFLICT (slot_id) DO NOTHING RETURNING id.
//      Idempotent: a second call for the same slot returns
//      `created=false` and the existing row's id (looked up after
//      the conflict).

import type { PoolClient } from 'pg'

export type MarkLessonCompletedParams = {
  slotId: string
  teacherId: string
  wasNoShow: boolean
  markedByAccountId: string | null
}

export type MarkLessonCompletedResult = {
  completionId: string
  created: boolean
}

export type LessonCompletionEligibilityReason =
  | 'slot_not_found'
  | 'wrong_teacher'
  | 'not_booked'
  | 'not_yet_ended'

export class LessonCompletionEligibilityError extends Error {
  public readonly reason: LessonCompletionEligibilityReason
  public readonly slotId: string

  constructor(reason: LessonCompletionEligibilityReason, slotId: string) {
    super(`lesson_completions/eligibility/${reason}`)
    this.name = 'LessonCompletionEligibilityError'
    this.reason = reason
    this.slotId = slotId
  }
}

export async function markLessonCompleted(
  client: PoolClient,
  params: MarkLessonCompletedParams,
): Promise<MarkLessonCompletedResult> {
  // Step 1: FOR UPDATE row lock on lesson_slots. Anti-race vs cancel
  // /move / a concurrent mark for the same slot. The tariff_id JOIN
  // is read in the same statement so the eligibility gate + amount
  // snapshot evaluate atomically against the locked row.
  // T3 Sub-PR B (2026-06-01) — settlement amount comes from
  // s.snapshot_amount_kopecks (frozen at booking time, mig 0102 §d),
  // NOT live pricing_tariffs.amount_kopecks. Falls back to the live
  // tariff price ONLY for legacy slots that pre-date mig 0102 backfill
  // (which itself only filled status ∈ {booked, completed, cancelled,
  // no_show_*} — open slots get snapshot via the BEFORE trigger).
  const slotResult = await client.query(
    `select s.id,
            s.teacher_account_id,
            s.status,
            s.start_at,
            s.duration_minutes,
            s.tariff_id,
            s.snapshot_amount_kopecks,
            t.amount_kopecks as tariff_amount_kopecks
       from lesson_slots s
       left join pricing_tariffs t on t.id = s.tariff_id
      where s.id = $1
      for update of s`,
    [params.slotId],
  )

  if (slotResult.rows.length === 0) {
    throw new LessonCompletionEligibilityError('slot_not_found', params.slotId)
  }
  const slot = slotResult.rows[0]

  // Step 2: eligibility gate.
  if (String(slot.teacher_account_id) !== params.teacherId) {
    throw new LessonCompletionEligibilityError('wrong_teacher', params.slotId)
  }
  // Round-1 paranoia BLOCKER #1 closure: the duplicate-mark race causes
  // the second writer to observe status ∈ ('completed','no_show_learner')
  // because the first writer's forward trigger flipped it. In that case
  // we must NOT throw — instead, short-circuit to a created=false return
  // from the existing completion row. The §2.6 ON CONFLICT contract is
  // preserved this way; the FOR UPDATE row lock serialises the two
  // writers and the second one detects the idempotent re-entry.
  const slotStatus = String(slot.status)
  if (slotStatus === 'completed' || slotStatus === 'no_show_learner') {
    const existing = await client.query(
      `select id from lesson_completions where slot_id = $1`,
      [params.slotId],
    )
    if (existing.rows.length === 1) {
      return { completionId: String(existing.rows[0].id), created: false }
    }
    // Status flipped but no completion row: impossible under the
    // contract (the trigger ONLY fires on insert). Surface as eligibility
    // error so a corrupted state is loud.
    throw new LessonCompletionEligibilityError('not_booked', params.slotId)
  }
  if (slotStatus !== 'booked') {
    // open / cancelled / no_show_teacher — genuinely not eligible.
    throw new LessonCompletionEligibilityError('not_booked', params.slotId)
  }
  const startMs = new Date(String(slot.start_at)).getTime()
  const durationMin = Number(slot.duration_minutes)
  const endMs = startMs + durationMin * 60_000
  if (!(endMs <= Date.now())) {
    throw new LessonCompletionEligibilityError('not_yet_ended', params.slotId)
  }

  // T3 Sub-PR B: read the snapshot first (frozen at booking time).
  // The trigger guarantees NOT NULL for any row that ever entered the
  // booked state, so for an eligible 'booked' slot this is always set.
  //
  // R1-WARN#3: the COALESCE fallback to live tariff is a TEMPORARY
  // legacy crutch — plan §"Downstream paths" says settlement reads
  // should treat NULL as a bug signal once the backfill has fully
  // landed in prod. TODO follow-up after one prod wave of observation:
  // drop the COALESCE, raise on NULL, and let any unexpected NULL
  // surface as a hard error instead of silently using live tariff.
  const amountKopecks =
    slot.snapshot_amount_kopecks != null
      ? Number(slot.snapshot_amount_kopecks)
      : slot.tariff_amount_kopecks != null
        ? Number(slot.tariff_amount_kopecks)
        : 0
  const completedAt = new Date(endMs).toISOString()

  // Step 3: INSERT ... ON CONFLICT (slot_id) DO NOTHING RETURNING id.
  const inserted = await client.query(
    `insert into lesson_completions
       (slot_id, teacher_id, was_no_show, amount_kopecks,
        completed_at, marked_by_account_id)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (slot_id) do nothing
     returning id`,
    [
      params.slotId,
      params.teacherId,
      params.wasNoShow,
      amountKopecks,
      completedAt,
      params.markedByAccountId,
    ],
  )

  if (inserted.rows.length === 1) {
    return { completionId: String(inserted.rows[0].id), created: true }
  }

  // Conflict — look up the existing row. The forward trigger has
  // already flipped slot status (or was a no-op if the prior insert
  // landed before the slot was 'booked', which the eligibility gate
  // above precludes for fresh calls).
  const existing = await client.query(
    `select id from lesson_completions where slot_id = $1`,
    [params.slotId],
  )
  if (existing.rows.length === 0) {
    // Should never happen — conflict implies row exists. Defensive.
    throw new LessonCompletionEligibilityError('slot_not_found', params.slotId)
  }
  return { completionId: String(existing.rows[0].id), created: false }
}
