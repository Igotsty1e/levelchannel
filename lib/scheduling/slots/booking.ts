// Wave 39: bookSlot + private classifyBookSlotFailure helper.
// Dynamic billing imports preserved verbatim — the legacy fast path
// when BILLING_WAVE_ACTIVE !== 'true' must NOT load billing modules.

import { ACTIVE_INTEGRATION_GATE_SQL } from '@/lib/calendar/freshness-sql'
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

// BCS-D.5 — atomic overlap-vs-busy-cache check inside the booking
// UPDATE. Inlined SQL fragment used in both the legacy and the
// billing-path queries so the gate is evaluated as part of the
// re-asserted WHERE, not as a separate read.
//
// F3 freshness contract (plan §4.2 + §4.4): busy-cache blocks a
// booking ONLY when the teacher's integration is currently
// 'active' AND `last_pulled_at` is within the TTL (10 minutes).
// On `degraded` or stale `last_pulled_at`, the cache is IGNORED —
// we'd rather risk a 10-min overbook window than block real
// bookings on stale data. The teacher sees the degraded banner
// (plan §4.4) and the pull worker repairs the freshness.
//
// `is_own_event = false` excludes the busy rows that represent OUR
// own pushed events. Otherwise a slot's mirror-back from Google
// would block a re-book of the same slot (and itself isn't a
// foreign conflict).
//
// The gate is silent on slots whose teacher has no integration row
// at all — `EXISTS` returns false → no busy rows considered → the
// atomic UPDATE behaves identically to the pre-BCS-D path.
// Predicate (`tci.sync_state='active' AND last_pulled_at >= now() - 10min`)
// is the shared read-side gate constant in
// `lib/calendar/freshness-sql.ts`. Do not inline a copy here.
const BUSY_OVERLAP_GATE_SQL = `
  and not exists (
    select 1
      from teacher_external_busy_intervals b
      join teacher_calendar_integrations tci
        on tci.account_id = b.teacher_account_id
       and ${ACTIVE_INTEGRATION_GATE_SQL}
     where b.teacher_account_id = lesson_slots.teacher_account_id
       and b.is_own_event = false
       and tstzrange(b.start_at, b.end_at, '[)')
           && tstzrange(
             lesson_slots.start_at,
             lesson_slots.start_at
               + (lesson_slots.duration_minutes || ' minutes')::interval,
             '[)'
           )
  )
`

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
          ${BUSY_OVERLAP_GATE_SQL}
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

  // New billing path. Per-pair payment_method (mig 0101).
  // accounts.postpaid_allowed дропнут — выбор делает учитель в
  // learner_billing_preferences. See docs/plans/per-learner-payment-method.md.
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

    // Step 1: per-account advisory lock for strict FIFO + serialized
    // consumption. Cross-learner concurrency is unaffected.
    await client.query(
      `select pg_advisory_xact_lock(hashtext('pkg_consume:' || $1::text))`,
      [learnerAccountId],
    )

    // Step 2: atomic slot reservation (existing pattern, sticky client).
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
          ${BUSY_OVERLAP_GATE_SQL}
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

    // T3 epic-end R1-BLOCKER#2 closure (2026-06-02): private-tariff
    // visibility gate. If the slot is bound to a tariff with
    // visibility='private', the learner must have an active
    // learner_tariff_access row. Without it, fall through to the
    // same not_found shape so private tariffs don't enumerate via
    // booking probes.
    if (slot.tariffId) {
      const tariffGate = await client.query<{ private_no_access: boolean }>(
        `select (
           t.visibility = 'private'
           and not exists (
             select 1 from learner_tariff_access lta
              where lta.tariff_id = t.id
                and lta.learner_account_id = $2::uuid
                and lta.revoked_at is null
           )
         ) as private_no_access
           from pricing_tariffs t where t.id = $1::uuid`,
        [slot.tariffId, learnerAccountId],
      )
      if (tariffGate.rows[0]?.private_no_access) {
        await client.query('rollback')
        return { ok: false, reason: 'not_found' }
      }
    }

    // Step 3: read per-pair payment_method. Default 'none' = booking blocked.
    const method = await getPaymentMethodForPairTx(
      client,
      slot.teacherAccountId,
      learnerAccountId,
    )
    if (method === 'none') {
      await client.query('rollback')
      return { ok: false, reason: 'payment_method_not_set' }
    }

    // Step 4: try package consumption (same code path regardless of method).
    // PKG-TEACHER-SCOPE (2026-06-01): pass slot.teacherAccountId so a
    // learner's package from teacher A doesn't get consumed against
    // teacher B's slot.
    const consume = await consumePackageUnit(client, {
      accountId: learnerAccountId,
      slotId: slot.id,
      durationMinutes: slot.durationMinutes,
      actor,
      expectedTeacherId: slot.teacherAccountId,
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
          countRemainingAfter: Number(remaining.rows[0]?.count_remaining ?? 0),
          expiresAt: new Date(String(remaining.rows[0]?.expires_at)).toISOString(),
        },
      }
    }

    // Step 5: pending-package gate. Refuse postpaid fallback if the learner
    // has a recent pending package order matching this slot's
    // (duration, teacher) pair. PKG-TEACHER-SCOPE: per-pair gate.
    const hasPending = await accountHasPendingPackageGrantForDuration(
      learnerAccountId,
      slot.durationMinutes,
      slot.teacherAccountId,
    )
    if (hasPending) {
      await client.query('rollback')
      return { ok: false, reason: 'pending_package_grant' }
    }

    // Step 6: method === 'postpaid' (epic-b dropped 'prepaid_packages') —
    // slot booked, debt surfaces at completion. Mix позволяет package
    // consume first → postpaid fallback (already handled выше в Step 4).
    void listActivePackagesByDuration

    if (!slot.tariffId) {
      await client.query('rollback')
      return { ok: false, reason: 'tariff_required' }
    }
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
    `select status, start_at, teacher_account_id, duration_minutes
       from lesson_slots where id = $1`,
    [slotId],
  )
  if (sniff.rows.length === 0) return { ok: false, reason: 'not_found' }
  const row = sniff.rows[0]
  // BCS-B.frontend Codex #1: when caller pins expectedTeacherId, a
  // teacher mismatch must collapse to the same not_found outcome.
  // Do not disclose status (`not_open`, `in_past`) for foreign slots.
  if (
    expectedTeacherId
    && String(row.teacher_account_id ?? '') !== expectedTeacherId
  ) {
    return { ok: false, reason: 'not_found' }
  }
  if (String(row.teacher_account_id ?? '') === learnerAccountId) {
    return { ok: false, reason: 'self_booking_blocked' }
  }
  const startAt = new Date(String(row.start_at)).getTime()
  if (startAt <= Date.now()) return { ok: false, reason: 'in_past' }

  // BCS-D.5 — disambiguate "open + future" failures: either another
  // booker won the race (not_open), or the F3 busy-cache gate
  // rejected because a foreign busy interval covers this slot's time
  // window. The latter surfaces as `external_conflict` so the learner
  // UI can show a specific message instead of the generic 409.
  if (String(row.status) === 'open') {
    // Read-side freshness gate is the shared constant from
    // `lib/calendar/freshness-sql.ts`.
    const overlap = await pool.query(
      `select 1
         from teacher_external_busy_intervals b
         join teacher_calendar_integrations tci
           on tci.account_id = b.teacher_account_id
          and ${ACTIVE_INTEGRATION_GATE_SQL}
        where b.teacher_account_id = $1
          and b.is_own_event = false
          and tstzrange(b.start_at, b.end_at, '[)')
              && tstzrange(
                $2::timestamptz,
                $2::timestamptz + ($3 || ' minutes')::interval,
                '[)'
              )
        limit 1`,
      [
        String(row.teacher_account_id),
        new Date(String(row.start_at)).toISOString(),
        Number(row.duration_minutes),
      ],
    )
    if (overlap.rows.length > 0) {
      return { ok: false, reason: 'external_conflict' }
    }
  }
  return { ok: false, reason: 'not_open' }
}
