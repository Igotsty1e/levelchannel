// Wave 39: bookSlot + private classifyBookSlotFailure helper.
// Dynamic billing imports preserved verbatim — the legacy fast path
// when BILLING_WAVE_ACTIVE !== 'true' must NOT load billing modules.

import { getDbPool } from '@/lib/db/pool'

import {
  MAX_AGENDA_LEN,
  SLOT_COLUMNS,
  UUID_PATTERN,
  appendEventSql,
  rowToSlot,
} from './internal'
import type { BookSlotResult } from './types'

// BCS-B.1 — sanitize learner-supplied agenda before persisting. Trim
// whitespace, refuse over the cap, normalise empty string → null. The
// caller (route) handles the surface for "too long" — here we just
// short-circuit to null to keep the booking atomic SQL deterministic.
function sanitizeAgenda(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null
  const trimmed = String(input).trim()
  if (trimmed.length === 0) return null
  if (trimmed.length > MAX_AGENDA_LEN) return null
  return trimmed
}

export type BookSlotOptions = {
  // Free-form learner comment from Calendly confirm screen. Stored on
  // lesson_slots.agenda. Null = not provided / blank / over cap.
  agenda?: string | null
  // BCS-B.frontend Codex #1: when set, atomic UPDATE re-asserts the
  // slot belongs to this teacher. Used by the learner POST route to
  // pin the booking to the learner's assigned teacher — a verified
  // learner who knows a foreign teacher's open slot id cannot book it.
  // Admin operator path leaves this unset (operators can book any
  // teacher's slot on a learner's behalf).
  expectedTeacherId?: string | null
}

// Atomic book-the-slot. Re-asserts status='open' in the WHERE so two
// concurrent POSTs don't both win.
//
// Codex 2026-05-07 #5 — also re-asserts `teacher_account_id <> $learner`
// so a learner can never book a slot where they are listed as the
// teacher.
//
// Billing wave PR 1 — when `BILLING_WAVE_ACTIVE=true`, the booking
// flow ALSO runs through the package/postpaid pipeline:
//   1. SELECT FOR SHARE on accounts to read postpaid_allowed
//      consistently inside the txn.
//   2. Per-account advisory lock for FIFO + serialized consumption.
//   3. The atomic slot UPDATE (existing pattern).
//   4. Try package consumption (lib/billing/consumption.ts).
//   5. Pending-package gate (Codex round 2 HIGH 2): if a package
//      order matching this slot's duration is in flight, refuse
//      postpaid fallback.
//   6. Postpaid eligibility — slot stays booked with no consumption,
//      enters postpaid debt at completion. Requires postpaid_allowed
//      AND tariff_id on the slot.
// On any failure path the slot UPDATE is rolled back via tx.
//
// When `BILLING_WAVE_ACTIVE` is not 'true', behaviour is exactly
// the legacy single-statement atomic booking (no billing checks,
// no consumption). This lets existing tests continue to exercise
// the booking path without per-test billing setup.
export async function bookSlot(
  slotId: string,
  learnerAccountId: string,
  actor: 'learner' | 'admin' = 'learner',
  options: BookSlotOptions = {},
): Promise<BookSlotResult> {
  if (!UUID_PATTERN.test(slotId)) return { ok: false, reason: 'not_found' }
  const billingActive = process.env.BILLING_WAVE_ACTIVE === 'true'
  // BCS-B.1: agenda is set ONLY on learner-initiated booking. Admin
  // book-as-operator path passes nothing → null. Operator typing on
  // behalf of the learner is out of scope; the cabinet UI captures it.
  const agenda = actor === 'learner' ? sanitizeAgenda(options.agenda) : null
  // BCS-B.frontend Codex #1: expectedTeacherId pin (cross-teacher gate).
  // When provided (and shaped as a UUID), the atomic UPDATE adds
  // `teacher_account_id = $expected`. A mismatch collapses to the same
  // not_found classification as a missing slot — no enumeration of
  // foreign teachers' open slots.
  const expectedTeacherId =
    options.expectedTeacherId
    && UUID_PATTERN.test(options.expectedTeacherId)
      ? options.expectedTeacherId
      : null

  // Legacy fast path — preserved bit-for-bit when the wave is off.
  if (!billingActive) {
    const pool = getDbPool()
    const result = await pool.query(
      `update lesson_slots
          set status = 'booked',
              learner_account_id = $2,
              booked_at = now(),
              agenda = $4,
              updated_at = now(),
              events = $3::jsonb || events
        where id = $1
          and status = 'open'
          and start_at > now()
          and teacher_account_id <> $2
          and ($5::uuid is null or teacher_account_id = $5::uuid)
        returning ${SLOT_COLUMNS}`,
      [
        slotId,
        learnerAccountId,
        appendEventSql('slot.booked', actor, { learnerAccountId }),
        agenda,
        expectedTeacherId,
      ],
    )
    if (result.rows[0]) {
      return { ok: true, slot: rowToSlot(result.rows[0]), billing: { kind: 'legacy' } }
    }
    return classifyBookSlotFailure(slotId, learnerAccountId, expectedTeacherId)
  }

  // New billing path. One transaction, six steps.
  const { consumePackageUnit } = await import('@/lib/billing/consumption')
  const {
    accountHasPendingPackageGrantForDuration,
    listActivePackagesByDuration,
  } = await import('@/lib/billing/packages')

  const pool = getDbPool()
  const client = await pool.connect()
  try {
    await client.query('begin')

    // Step 1: lock the account row to read postpaid_allowed live.
    const accountRow = await client.query(
      `select postpaid_allowed from accounts where id = $1 for share`,
      [learnerAccountId],
    )
    const postpaidAllowed = Boolean(accountRow.rows[0]?.postpaid_allowed)

    // Step 2: per-account advisory lock for strict FIFO + serialized
    // consumption. Cross-learner concurrency is unaffected.
    await client.query(
      `select pg_advisory_xact_lock(hashtext('pkg_consume:' || $1::text))`,
      [learnerAccountId],
    )

    // Step 3: atomic slot reservation (existing pattern, sticky client).
    const slotResult = await client.query(
      `update lesson_slots
          set status = 'booked',
              learner_account_id = $2,
              booked_at = now(),
              agenda = $4,
              updated_at = now(),
              events = $3::jsonb || events
        where id = $1
          and status = 'open'
          and start_at > now()
          and teacher_account_id <> $2
          and ($5::uuid is null or teacher_account_id = $5::uuid)
        returning ${SLOT_COLUMNS}`,
      [
        slotId,
        learnerAccountId,
        appendEventSql('slot.booked', actor, { learnerAccountId }),
        agenda,
        expectedTeacherId,
      ],
    )
    if (slotResult.rows.length === 0) {
      await client.query('rollback')
      return classifyBookSlotFailure(slotId, learnerAccountId, expectedTeacherId)
    }
    const slot = rowToSlot(slotResult.rows[0])

    // Step 4: try package consumption.
    const consume = await consumePackageUnit(client, {
      accountId: learnerAccountId,
      slotId: slot.id,
      durationMinutes: slot.durationMinutes,
      actor,
    })
    if (consume.ok) {
      // Read derived count_remaining inside the txn so the response
      // reflects the post-consumption state authoritatively.
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
          countRemainingAfter: Number(remaining.rows[0]?.count_remaining ?? 0),
          expiresAt: new Date(String(remaining.rows[0]?.expires_at)).toISOString(),
        },
      }
    }

    // Step 5: pending-package gate. Refuse postpaid fallback if the
    // learner has a recent pending package order matching this slot's
    // duration. Avoids the race where they pay for a package, book
    // a slot before the webhook fires, and the slot enters postpaid
    // debt while the paid grant materializes moments later.
    const hasPending = await accountHasPendingPackageGrantForDuration(
      learnerAccountId,
      slot.durationMinutes,
    )
    if (hasPending) {
      await client.query('rollback')
      return { ok: false, reason: 'pending_package_grant' }
    }

    // Step 6: postpaid eligibility.
    if (!postpaidAllowed) {
      const matching = await listActivePackagesByDuration(slot.durationMinutes, 3)
      await client.query('rollback')
      return {
        ok: false,
        reason: 'package_required',
        availablePackages: matching.map((p) => ({
          slug: p.slug,
          titleRu: p.titleRu,
          amountKopecks: p.amountKopecks,
          durationMinutes: p.durationMinutes,
        })),
      }
    }
    if (!slot.tariffId) {
      await client.query('rollback')
      return { ok: false, reason: 'tariff_required' }
    }

    // Postpaid path — slot stays booked with no consumption, debt
    // surfaces at completion.
    const tariff = await client.query(
      `select amount_kopecks, currency from pricing_tariffs where id = $1`,
      [slot.tariffId],
    )
    await client.query('commit')
    return {
      ok: true,
      slot,
      billing: {
        kind: 'postpaid',
        tariffId: slot.tariffId,
        amountKopecks: Number(tariff.rows[0]?.amount_kopecks ?? 0),
        currency: String(tariff.rows[0]?.currency ?? 'RUB'),
      },
    }
  } catch (e) {
    await client.query('rollback').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

async function classifyBookSlotFailure(
  slotId: string,
  learnerAccountId: string,
  expectedTeacherId: string | null = null,
): Promise<BookSlotResult> {
  const pool = getDbPool()
  const sniff = await pool.query(
    `select status, start_at, teacher_account_id from lesson_slots where id = $1`,
    [slotId],
  )
  if (sniff.rows.length === 0) return { ok: false, reason: 'not_found' }
  // BCS-B.frontend Codex #1: when caller pins expectedTeacherId, a
  // teacher mismatch must collapse to the same not_found outcome.
  // Do not disclose status (`not_open`, `in_past`) for foreign slots.
  if (
    expectedTeacherId
    && String(sniff.rows[0].teacher_account_id ?? '') !== expectedTeacherId
  ) {
    return { ok: false, reason: 'not_found' }
  }
  if (String(sniff.rows[0].teacher_account_id ?? '') === learnerAccountId) {
    return { ok: false, reason: 'self_booking_blocked' }
  }
  const startAt = new Date(String(sniff.rows[0].start_at)).getTime()
  if (startAt <= Date.now()) return { ok: false, reason: 'in_past' }
  return { ok: false, reason: 'not_open' }
}
