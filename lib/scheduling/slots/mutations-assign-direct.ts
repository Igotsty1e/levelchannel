// teacher-direct-assign (Задача 2.2, 2026-06-11).
//
// Teacher creates an already-booked slot for a specific learner with a
// tariff. Mirrors bookSlot's billing pipeline EXACTLY (advisory lock +
// package consumption + postpaid fallback + payment-method gate) but the
// slot is INSERTED in state='booked' instead of going through open→booked
// UPDATE. This is the foundation for Task 2.1 (global "without slots"
// mode); for Task 2.2 it lives as an alternate flow alongside the
// learner-pick-up flow.
//
// Critical-path: full billing race protection + atomic INSERT against
// partial UNIQUE index `lesson_slots_teacher_start_unique`. The same
// 23505 path that protects open-slot bulk-create also protects this
// path against (teacher, start_at) collisions.
//
// What we DO NOT do here (vs bookSlot):
//   - learner-specific privacy fall-through for `not_found` shape — the
//     teacher is the actor + owns the surface, no enumeration risk.
//   - private-tariff visibility gate (learner_tariff_access) — the
//     teacher already owns the tariff and is granting access by virtue
//     of assigning; no enumeration risk either.
//   - "external_conflict" gate inside the atomic statement — we check
//     it inside the TX with FOR SHARE on the freshness predicate; can't
//     atomic-EXISTS on INSERT VALUES, so we accept a tiny TOCTOU window
//     that is covered by post-pull conflict-detector (existing flow).

import { ACTIVE_INTEGRATION_GATE_SQL } from '@/lib/calendar/freshness-sql'
import { getDbPool } from '@/lib/db/pool'

import {
  SLOT_COLUMNS,
  UUID_PATTERN,
  appendEventSql,
  rowToSlot,
} from './internal'
import {
  MSK_BUSINESS_HOUR_MAX,
  MSK_BUSINESS_HOUR_MIN,
  SLOT_GRID_MINUTES,
  type AssignSlotDirectInput,
  type AssignSlotDirectResult,
} from './types'

const NOTES_MAX = 500

export async function assignSlotDirect(
  input: AssignSlotDirectInput,
): Promise<AssignSlotDirectResult> {
  // Input validation (cheap, before TX).
  if (!UUID_PATTERN.test(input.teacherAccountId)) {
    return { ok: false, reason: 'tariff_not_owned' }
  }
  if (!UUID_PATTERN.test(input.learnerAccountId)) {
    return { ok: false, reason: 'learner_not_assigned' }
  }
  if (!UUID_PATTERN.test(input.tariffId)) {
    return { ok: false, reason: 'tariff_not_active' }
  }
  if (input.teacherAccountId === input.learnerAccountId) {
    return { ok: false, reason: 'self_booking_blocked' }
  }
  if (!Number.isInteger(input.durationMinutes) || input.durationMinutes < 30) {
    return { ok: false, reason: 'tariff_duration_mismatch' }
  }
  if (input.notes !== undefined && input.notes !== null) {
    if (typeof input.notes !== 'string' || input.notes.length > NOTES_MAX) {
      return { ok: false, reason: 'tariff_duration_mismatch' }
    }
  }
  const startAtMs = Date.parse(input.startAt)
  if (Number.isNaN(startAtMs)) {
    return { ok: false, reason: 'in_past' }
  }
  if (startAtMs <= Date.now()) {
    return { ok: false, reason: 'in_past' }
  }
  // MSK business band + 30-min grid mirror DB CHECK (migration 0031).
  // Both checks are also enforced by the DB, but failing fast here lets
  // us return a typed reason instead of catching a 23514.
  const startAtDate = new Date(startAtMs)
  const mskHourFloat = computeMskHour(startAtDate)
  if (mskHourFloat < MSK_BUSINESS_HOUR_MIN || mskHourFloat >= MSK_BUSINESS_HOUR_MAX) {
    return { ok: false, reason: 'start_out_of_band' }
  }
  // minute-start epic (2026-06-11): 30-min grid check dropped. Sanity
  // seconds=0 invariant enforced by DB CHECK (migration 0125).

  // Lazy imports — keep billing modules out of bundles that don't touch
  // direct-assign (mirrors bookSlot import discipline).
  const { consumePackageUnit } = await import('@/lib/billing/consumption')
  const {
    accountHasPendingPackageGrantForDuration,
    listActivePackagesByDuration,
  } = await import('@/lib/billing/packages')
  const { getPaymentMethodForPairTx } = await import(
    '@/lib/billing/learner-payment-method'
  )

  const pool = getDbPool()
  const client = await pool.connect()
  try {
    await client.query('begin')

    // Step 1: per-learner advisory lock for FIFO + serialized package
    // consumption (SAME key as bookSlot — both writers serialize through
    // the same lock so package units are not double-consumed across a
    // simultaneous learner pickup and teacher direct-assign).
    await client.query(
      `select pg_advisory_xact_lock(hashtext('pkg_consume:' || $1::text))`,
      [input.learnerAccountId],
    )

    // Step 2: teacher-owns-learner gate. learner_teacher_links is the
    // canonical source-of-truth post-SAAS-PIVOT (Day 2). FOR SHARE locks
    // the link row so an unlink that races our INSERT either
    // serializes-before (we observe unlinked → 403) or serializes-after
    // (their unlink waits; our INSERT proceeds with a still-valid link).
    const linkRow = await client.query(
      `select 1 from learner_teacher_links
        where teacher_account_id = $1::uuid
          and learner_account_id = $2::uuid
          and unlinked_at is null
        for share`,
      [input.teacherAccountId, input.learnerAccountId],
    )
    if (linkRow.rows.length === 0) {
      await client.query('rollback')
      return { ok: false, reason: 'learner_not_assigned' }
    }

    // Step 3: tariff gates — active + owned + duration matches.
    // Note: pricing_tariffs.teacher_id (not teacher_account_id) per
    // migration 0088. is_active=false OR deleted_at IS NOT NULL → not
    // active (we treat both as same "tariff_not_active" surface).
    const tariffRow = await client.query<{
      duration_minutes: number
      teacher_id: string | null
      is_active: boolean
      deleted_at: string | null
      amount_kopecks: number
      currency: string
    }>(
      `select duration_minutes, teacher_id, is_active, deleted_at,
              amount_kopecks, currency
         from pricing_tariffs where id = $1::uuid`,
      [input.tariffId],
    )
    const tariff = tariffRow.rows[0]
    if (!tariff || tariff.deleted_at !== null || tariff.is_active === false) {
      await client.query('rollback')
      return { ok: false, reason: 'tariff_not_active' }
    }
    if (
      tariff.teacher_id === null
      || String(tariff.teacher_id) !== input.teacherAccountId
    ) {
      await client.query('rollback')
      return { ok: false, reason: 'tariff_not_owned' }
    }
    if (Number(tariff.duration_minutes) !== input.durationMinutes) {
      await client.query('rollback')
      return { ok: false, reason: 'tariff_duration_mismatch' }
    }

    // Step 4: per-pair payment_method (default 'none' blocks booking).
    const method = await getPaymentMethodForPairTx(
      client,
      input.teacherAccountId,
      input.learnerAccountId,
    )
    if (method === 'none') {
      await client.query('rollback')
      return { ok: false, reason: 'payment_method_not_set' }
    }

    // Step 5: busy-cache pre-check (advisory). Same freshness contract
    // as bookSlot's BUSY_OVERLAP_GATE_SQL. F3: only enforce when
    // integration is active AND last_pulled_at fresh. degraded or stale
    // → skip cache, rely on post-pull conflict-detector.
    const overlap = await client.query(
      `select 1
         from teacher_external_busy_intervals b
         join teacher_calendar_integrations tci
           on tci.account_id = b.teacher_account_id
          and ${ACTIVE_INTEGRATION_GATE_SQL}
        where b.teacher_account_id = $1::uuid
          and b.is_own_event = false
          and tstzrange(b.start_at, b.end_at, '[)')
              && tstzrange(
                $2::timestamptz,
                $2::timestamptz + ($3 || ' minutes')::interval,
                '[)'
              )
        limit 1`,
      [input.teacherAccountId, input.startAt, input.durationMinutes],
    )
    if (overlap.rows.length > 0) {
      await client.query('rollback')
      return { ok: false, reason: 'external_conflict' }
    }

    // Step 6: atomic INSERT booked. The partial UNIQUE index
    // `lesson_slots_teacher_start_unique` (migration 0035, WHERE status
    // <> 'cancelled') catches concurrent inserts on the same (teacher,
    // start_at) — second writer gets 23505, we map to slot_collision.
    let insertResult
    try {
      insertResult = await client.query(
        `insert into lesson_slots (
           teacher_account_id, learner_account_id, start_at, duration_minutes,
           status, booked_at, tariff_id, notes, source, events
         ) values (
           $1::uuid, $2::uuid, $3::timestamptz, $4::int,
           'booked', now(), $5::uuid, $6, 'direct_assign', $7::jsonb
         )
         returning ${SLOT_COLUMNS}`,
        [
          input.teacherAccountId,
          input.learnerAccountId,
          input.startAt,
          input.durationMinutes,
          input.tariffId,
          input.notes ?? null,
          appendEventSql('slot.direct_assigned', 'teacher', {
            learnerAccountId: input.learnerAccountId,
            tariffId: input.tariffId,
          }),
        ],
      )
    } catch (e) {
      await client.query('rollback')
      const code = (e as { code?: string }).code
      if (code === '23505') {
        return { ok: false, reason: 'slot_collision' }
      }
      throw e
    }
    const slot = rowToSlot(insertResult.rows[0])

    // epic-b Sub-PR B.2 (2026-06-11): explicit billingChoice from the
    // teacher modal. 'auto' (default) = legacy mix; 'package' = require
    // package consume (with optional pinned purchase id); 'postpaid' =
    // skip the package attempt entirely.
    const billingChoice: 'auto' | 'package' | 'postpaid'
      = input.billingChoice ?? 'auto'

    // Step 7: package consumption path. 'postpaid' skips this branch.
    if (billingChoice !== 'postpaid') {
      // 7a: if teacher pinned a specific packagePurchaseId, validate
      // ownership + invariants and INSERT consumption with that exact
      // purchase. FOR UPDATE row-locks against a concurrent restore /
      // void on the same purchase.
      if (input.packagePurchaseId) {
        const pinned = await client.query<{
          id: string
          teacher_id: string
          duration_minutes: number
          count_remaining: string | number
          expires_at: string
        }>(
          `select pp.id,
                  pp.teacher_id,
                  pp.duration_minutes,
                  pp.count_initial - (
                    select count(*) from package_consumptions pc
                     where pc.package_purchase_id = pp.id
                       and pc.restored_at is null
                  ) as count_remaining,
                  pp.expires_at
             from package_purchases pp
            where pp.id = $1::uuid
              and pp.account_id = $2::uuid
              and pp.expires_at > now()
              and pp.voided_at is null
            for update`,
          [input.packagePurchaseId, input.learnerAccountId],
        )
        const row = pinned.rows[0]
        const remainingOk
          = row && Number(row.count_remaining) > 0
        const teacherOk
          = row && String(row.teacher_id) === input.teacherAccountId
        const durationOk
          = row && Number(row.duration_minutes) === input.durationMinutes
        if (!row || !remainingOk || !teacherOk || !durationOk) {
          await client.query('rollback')
          return { ok: false, reason: 'no_eligible_package' }
        }
        const consumed = await client.query<{ package_purchase_id: string }>(
          `insert into package_consumptions
             (slot_id, package_purchase_id, consumed_by_actor)
           values ($1, $2, 'teacher')
           on conflict (slot_id) do nothing
           returning package_purchase_id`,
          [slot.id, input.packagePurchaseId],
        )
        if (consumed.rows.length === 0) {
          // Re-INSERT on same slot_id (shouldn't happen — slot was just
          // INSERTed booked above) — surface as no_eligible_package vs
          // crashing on the unique constraint.
          await client.query('rollback')
          return { ok: false, reason: 'no_eligible_package' }
        }
        await client.query('commit')
        return {
          ok: true,
          slot,
          billing: {
            kind: 'prepaid',
            packagePurchaseId: input.packagePurchaseId,
            countRemainingAfter: Math.max(0, Number(row.count_remaining) - 1),
            expiresAt: new Date(String(row.expires_at)).toISOString(),
          },
          emailSkipped: false,
        }
      }

      // 7b: auto-pick / unpinned package path. Identical to bookSlot:
      // earliest-expiring eligible package wins.
      const consume = await consumePackageUnit(client, {
        accountId: input.learnerAccountId,
        slotId: slot.id,
        durationMinutes: input.durationMinutes,
        actor: 'teacher',
        expectedTeacherId: input.teacherAccountId,
      })
      if (consume.ok) {
        const remaining = await client.query(
          `select pp.count_initial - (
                    select count(*) from package_consumptions pc
                     where pc.package_purchase_id = pp.id
                       and pc.restored_at is null
                  ) as count_remaining,
                  pp.expires_at
             from package_purchases pp where pp.id = $1`,
          [consume.packagePurchaseId],
        )
        await client.query('commit')
        return {
          ok: true,
          slot,
          billing: {
            kind: 'prepaid',
            packagePurchaseId: consume.packagePurchaseId,
            countRemainingAfter: Number(
              remaining.rows[0]?.count_remaining ?? 0,
            ),
            expiresAt: new Date(
              String(remaining.rows[0]?.expires_at),
            ).toISOString(),
          },
          emailSkipped: false,
        }
      }
      // 7c: billingChoice='package' without a pinned id but no eligible
      // package matched — surface the explicit no_eligible_package
      // (don't silently fall through to postpaid as 'auto' does).
      if (billingChoice === 'package') {
        await client.query('rollback')
        return { ok: false, reason: 'no_eligible_package' }
      }
    }

    // Step 8: pending-package gate — same as bookSlot. Only applies to
    // the 'auto' fallback path (postpaid choice short-circuits gates,
    // teacher made the explicit pick).
    if (billingChoice === 'auto') {
      const hasPending = await accountHasPendingPackageGrantForDuration(
        input.learnerAccountId,
        input.durationMinutes,
        input.teacherAccountId,
      )
      if (hasPending) {
        await client.query('rollback')
        return { ok: false, reason: 'pending_package_grant' }
      }
    }

    // Step 9: postpaid path — slot booked, debt accrues at completion.
    void listActivePackagesByDuration

    await client.query('commit')
    return {
      ok: true,
      slot,
      billing: {
        kind: 'postpaid',
        tariffId: input.tariffId,
        amountKopecks: Number(tariff.amount_kopecks ?? 0),
        currency: String(tariff.currency ?? 'RUB'),
      },
      emailSkipped: false,
    }
  } catch (e) {
    await client.query('rollback').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

function computeMskHour(date: Date): number {
  // MSK is UTC+3 fixed (no DST since 2014). Same formula admin uses in
  // mutations-write.ts validateSlotInput → produced ISO timestamp +
  // hours / minutes in MSK.
  const utcMs = date.getTime()
  const mskMs = utcMs + 3 * 60 * 60 * 1000
  const m = new Date(mskMs)
  return m.getUTCHours() + m.getUTCMinutes() / 60
}
