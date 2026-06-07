// teacher-payments-sbp-self-service Sub-PR C (2026-06-07).
//
// Журнал оплат: создание / резолюция / выборка. Anti-spoof проверки
// в каждой функции. TX-границы с advisory-locks per slot.
//
// Plan: docs/plans/teacher-payments-sbp-self-service.md §3.4, §3.5

import { getDbPool } from '@/lib/db/pool'
import { resolveMethodForLearner } from '@/lib/payments/sbp-methods'

export type ClaimStatus = 'claimed' | 'confirmed' | 'declined' | 'cancelled'
export type PaymentChannel = 'sbp' | 'other'
export type InitiatedBy = 'learner' | 'teacher'

export type PaymentClaimItemInput = {
  slotId?: string
  packagePurchaseId?: string
  expectedAmountKopecks: number
}

export type CreateLearnerClaimInput = {
  learnerAccountId: string
  teacherAccountId: string
  amountKopecks: number
  paymentChannel: PaymentChannel
  paymentMethodId?: string | null
  items: PaymentClaimItemInput[]
  note?: string
}

export type CreateClaimResult =
  | { ok: true; claimId: string }
  | { ok: false; reason: string }

async function loadDisplayName(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: { display_name: string | null; first_name: string | null; last_name: string | null; email: string }[] }> },
  accountId: string,
): Promise<string> {
  const r = await client.query(
    `select a.email,
            p.display_name,
            p.first_name,
            p.last_name
       from accounts a
       left join account_profiles p on p.account_id = a.id
      where a.id = $1
      limit 1`,
    [accountId],
  )
  const row = r.rows[0]
  if (!row) return 'unknown'
  const composed = [row.first_name, row.last_name].filter(Boolean).join(' ').trim()
  return composed || row.display_name || row.email
}

async function loadSlotSnapshot(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: { teacher_account_id: string; learner_account_id: string; start_at: string; duration_minutes: number; snapshot_amount_kopecks: number | null }[] }> },
  slotId: string,
): Promise<
  | {
      teacherAccountId: string
      learnerAccountId: string
      label: string
      expected: number
    }
  | null
> {
  const r = await client.query(
    `select teacher_account_id,
            learner_account_id,
            start_at::text as start_at,
            duration_minutes,
            snapshot_amount_kopecks
       from lesson_slots
      where id = $1
      limit 1`,
    [slotId],
  )
  const row = r.rows[0]
  if (!row) return null
  const dt = new Date(row.start_at)
  const label = `${dt.toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })} · ${row.duration_minutes} мин`
  return {
    teacherAccountId: row.teacher_account_id,
    learnerAccountId: row.learner_account_id,
    label,
    expected: row.snapshot_amount_kopecks ?? 0,
  }
}

export async function createLearnerClaim(
  input: CreateLearnerClaimInput,
): Promise<CreateClaimResult> {
  if (!Number.isInteger(input.amountKopecks) || input.amountKopecks <= 0) {
    return { ok: false, reason: 'invalid_amount' }
  }
  if (input.amountKopecks >= 100_000_000) {
    return { ok: false, reason: 'amount_too_large' }
  }
  if (!Array.isArray(input.items) || input.items.length === 0) {
    return { ok: false, reason: 'no_items' }
  }
  if (input.items.length > 20) {
    return { ok: false, reason: 'too_many_items' }
  }
  if (input.paymentChannel === 'sbp' && !input.paymentMethodId) {
    return { ok: false, reason: 'method_required_for_sbp' }
  }

  const pool = getDbPool()
  const client = await pool.connect()
  try {
    await client.query('begin')

    // Advisory lock per slot to serialize concurrent claim creation.
    for (const item of input.items) {
      if (item.slotId) {
        await client.query(
          `select pg_advisory_xact_lock(hashtext('pay-claim:' || $1::text))`,
          [item.slotId],
        )
      }
    }

    // Validate payment method ownership (if SBP).
    if (input.paymentChannel === 'sbp' && input.paymentMethodId) {
      const mr = await client.query<{ teacher_account_id: string; phone_e164: string; bank_label: string; archived_at: string | null }>(
        `select teacher_account_id, phone_e164, bank_label, archived_at::text
           from teacher_payment_methods
          where id = $1`,
        [input.paymentMethodId],
      )
      const m = mr.rows[0]
      if (!m || m.teacher_account_id !== input.teacherAccountId) {
        await client.query('rollback')
        return { ok: false, reason: 'method_not_found' }
      }
      if (m.archived_at !== null) {
        await client.query('rollback')
        return { ok: false, reason: 'method_archived' }
      }
    }

    // Validate items: ownership + no active claim already on this slot.
    const itemRecords: {
      slotId: string | null
      packagePurchaseId: string | null
      expected: number
      label: string
    }[] = []
    for (const item of input.items) {
      if (item.slotId && item.packagePurchaseId) {
        await client.query('rollback')
        return { ok: false, reason: 'item_xor_violation' }
      }
      if (!item.slotId && !item.packagePurchaseId) {
        await client.query('rollback')
        return { ok: false, reason: 'item_xor_violation' }
      }
      if (item.slotId) {
        // anti-spoof: slot has the right teacher + learner
        const snap = await loadSlotSnapshot(client, item.slotId)
        if (!snap) {
          await client.query('rollback')
          return { ok: false, reason: 'slot_not_found' }
        }
        if (
          snap.teacherAccountId !== input.teacherAccountId
          || snap.learnerAccountId !== input.learnerAccountId
        ) {
          await client.query('rollback')
          return { ok: false, reason: 'slot_not_belongs_to_pair' }
        }
        const ex = await client.query<{ id: string }>(
          `select c.id
             from payment_claim_items i
             join payment_claims c on c.id = i.claim_id
            where i.slot_id = $1
              and c.status in ('claimed', 'confirmed')
            limit 1`,
          [item.slotId],
        )
        if (ex.rows[0]) {
          await client.query('rollback')
          return { ok: false, reason: 'slot_has_active_claim' }
        }
        itemRecords.push({
          slotId: item.slotId,
          packagePurchaseId: null,
          expected: item.expectedAmountKopecks,
          label: snap.label,
        })
      } else if (item.packagePurchaseId) {
        // For MVP: validate package belongs to pair.
        const pr = await client.query<{ account_id: string; title_snapshot: string; amount_kopecks: number }>(
          `select account_id, title_snapshot, amount_kopecks
             from package_purchases
            where id = $1
            limit 1`,
          [item.packagePurchaseId],
        )
        const p = pr.rows[0]
        if (!p || p.account_id !== input.learnerAccountId) {
          await client.query('rollback')
          return { ok: false, reason: 'package_not_found' }
        }
        itemRecords.push({
          slotId: null,
          packagePurchaseId: item.packagePurchaseId,
          expected: item.expectedAmountKopecks,
          label: p.title_snapshot,
        })
      }
    }

    // Snapshot names + method.
    const learnerName = await loadDisplayName(client, input.learnerAccountId)
    const teacherName = await loadDisplayName(client, input.teacherAccountId)

    let methodPhoneSnapshot: string | null = null
    let methodBankSnapshot: string | null = null
    if (input.paymentMethodId) {
      const mr = await client.query<{ phone_display: string; bank_label: string }>(
        `select phone_display, bank_label
           from teacher_payment_methods
          where id = $1`,
        [input.paymentMethodId],
      )
      const m = mr.rows[0]
      if (m) {
        methodPhoneSnapshot = m.phone_display
        methodBankSnapshot = m.bank_label
      }
    }

    const expectedSum = itemRecords.reduce((acc, it) => acc + it.expected, 0)
    const mismatch = input.amountKopecks - expectedSum

    const claimRow = await client.query<{ id: string }>(
      `insert into payment_claims
         (learner_account_id, learner_display_name_snapshot,
          teacher_account_id, teacher_display_name_snapshot,
          amount_kopecks, payment_method_id,
          payment_method_phone_snapshot, payment_method_bank_snapshot,
          payment_channel, initiated_by, status, amount_mismatch_kopecks,
          note_learner)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'learner', 'claimed', $10, $11)
       returning id`,
      [
        input.learnerAccountId,
        learnerName,
        input.teacherAccountId,
        teacherName,
        input.amountKopecks,
        input.paymentMethodId ?? null,
        methodPhoneSnapshot,
        methodBankSnapshot,
        input.paymentChannel,
        mismatch,
        input.note ?? null,
      ],
    )
    const claimId = claimRow.rows[0].id

    for (const it of itemRecords) {
      await client.query(
        `insert into payment_claim_items
           (claim_id, slot_id, package_purchase_id,
            expected_amount_kopecks, item_label_snapshot)
         values ($1, $2, $3, $4, $5)`,
        [claimId, it.slotId, it.packagePurchaseId, it.expected, it.label],
      )
    }

    await client.query('commit')
    return { ok: true, claimId }
  } catch (e) {
    await client.query('rollback').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

export type ClaimRow = {
  id: string
  learnerAccountId: string | null
  learnerName: string
  teacherAccountId: string | null
  teacherName: string
  amountKopecks: number
  paymentChannel: PaymentChannel
  paymentMethodPhone: string | null
  paymentMethodBank: string | null
  initiatedBy: InitiatedBy
  status: ClaimStatus
  amountMismatchKopecks: number
  noteLearner: string | null
  noteTeacher: string | null
  claimedAt: string
  paidAt: string | null
  resolvedAt: string | null
  items: {
    id: string
    slotId: string | null
    packagePurchaseId: string | null
    expectedAmountKopecks: number
    label: string
  }[]
}

async function attachItems(
  rows: Omit<ClaimRow, 'items'>[],
): Promise<ClaimRow[]> {
  if (rows.length === 0) return []
  const ids = rows.map((r) => r.id)
  const r = await getDbPool().query<{
    id: string
    claim_id: string
    slot_id: string | null
    package_purchase_id: string | null
    expected_amount_kopecks: number
    item_label_snapshot: string
  }>(
    `select id, claim_id, slot_id, package_purchase_id,
            expected_amount_kopecks, item_label_snapshot
       from payment_claim_items
      where claim_id = any($1::uuid[])`,
    [ids],
  )
  const byClaim = new Map<string, ClaimRow['items']>()
  for (const it of r.rows) {
    const list = byClaim.get(it.claim_id) ?? []
    list.push({
      id: it.id,
      slotId: it.slot_id,
      packagePurchaseId: it.package_purchase_id,
      expectedAmountKopecks: it.expected_amount_kopecks,
      label: it.item_label_snapshot,
    })
    byClaim.set(it.claim_id, list)
  }
  return rows.map((row) => ({
    ...row,
    items: byClaim.get(row.id) ?? [],
  }))
}

function mapBase(row: {
  id: string
  learner_account_id: string | null
  learner_display_name_snapshot: string
  teacher_account_id: string | null
  teacher_display_name_snapshot: string
  amount_kopecks: number
  payment_channel: string
  payment_method_phone_snapshot: string | null
  payment_method_bank_snapshot: string | null
  initiated_by: string
  status: string
  amount_mismatch_kopecks: number
  note_learner: string | null
  note_teacher: string | null
  claimed_at: string
  paid_at: string | null
  resolved_at: string | null
}): Omit<ClaimRow, 'items'> {
  return {
    id: row.id,
    learnerAccountId: row.learner_account_id,
    learnerName: row.learner_display_name_snapshot,
    teacherAccountId: row.teacher_account_id,
    teacherName: row.teacher_display_name_snapshot,
    amountKopecks: row.amount_kopecks,
    paymentChannel: row.payment_channel as PaymentChannel,
    paymentMethodPhone: row.payment_method_phone_snapshot,
    paymentMethodBank: row.payment_method_bank_snapshot,
    initiatedBy: row.initiated_by as InitiatedBy,
    status: row.status as ClaimStatus,
    amountMismatchKopecks: row.amount_mismatch_kopecks,
    noteLearner: row.note_learner,
    noteTeacher: row.note_teacher,
    claimedAt: row.claimed_at,
    paidAt: row.paid_at,
    resolvedAt: row.resolved_at,
  }
}

export async function listClaimsForTeacher(
  teacherAccountId: string,
  statuses: ClaimStatus[] = ['claimed', 'confirmed', 'declined'],
  limit = 50,
): Promise<ClaimRow[]> {
  const r = await getDbPool().query<{
    id: string
    learner_account_id: string | null
    learner_display_name_snapshot: string
    teacher_account_id: string | null
    teacher_display_name_snapshot: string
    amount_kopecks: number
    payment_channel: string
    payment_method_phone_snapshot: string | null
    payment_method_bank_snapshot: string | null
    initiated_by: string
    status: string
    amount_mismatch_kopecks: number
    note_learner: string | null
    note_teacher: string | null
    claimed_at: string
    paid_at: string | null
    resolved_at: string | null
  }>(
    `select id, learner_account_id, learner_display_name_snapshot,
            teacher_account_id, teacher_display_name_snapshot,
            amount_kopecks, payment_channel,
            payment_method_phone_snapshot, payment_method_bank_snapshot,
            initiated_by, status, amount_mismatch_kopecks,
            note_learner, note_teacher,
            claimed_at::text, paid_at::text, resolved_at::text
       from payment_claims
      where teacher_account_id = $1
        and status = any($2::text[])
      order by claimed_at desc
      limit $3`,
    [teacherAccountId, statuses, limit],
  )
  return attachItems(r.rows.map(mapBase))
}

export async function listClaimsForLearner(
  learnerAccountId: string,
  limit = 50,
): Promise<ClaimRow[]> {
  const r = await getDbPool().query<{
    id: string
    learner_account_id: string | null
    learner_display_name_snapshot: string
    teacher_account_id: string | null
    teacher_display_name_snapshot: string
    amount_kopecks: number
    payment_channel: string
    payment_method_phone_snapshot: string | null
    payment_method_bank_snapshot: string | null
    initiated_by: string
    status: string
    amount_mismatch_kopecks: number
    note_learner: string | null
    note_teacher: string | null
    claimed_at: string
    paid_at: string | null
    resolved_at: string | null
  }>(
    `select id, learner_account_id, learner_display_name_snapshot,
            teacher_account_id, teacher_display_name_snapshot,
            amount_kopecks, payment_channel,
            payment_method_phone_snapshot, payment_method_bank_snapshot,
            initiated_by, status, amount_mismatch_kopecks,
            note_learner, note_teacher,
            claimed_at::text, paid_at::text, resolved_at::text
       from payment_claims
      where learner_account_id = $1
      order by claimed_at desc
      limit $2`,
    [learnerAccountId, limit],
  )
  return attachItems(r.rows.map(mapBase))
}

export type ResolveResult =
  | { ok: true; status: ClaimStatus }
  | { ok: false; reason: 'not_found' | 'already_resolved'; currentStatus?: ClaimStatus }

export async function confirmClaim(
  teacherAccountId: string,
  claimId: string,
): Promise<ResolveResult> {
  const pool = getDbPool()
  const r = await pool.query<{ status: string }>(
    `update payment_claims
        set status = 'confirmed', resolved_at = now()
      where id = $1
        and teacher_account_id = $2
        and status = 'claimed'
      returning status`,
    [claimId, teacherAccountId],
  )
  if (r.rows[0]) return { ok: true, status: 'confirmed' }
  const cur = await pool.query<{ status: string }>(
    `select status from payment_claims
      where id = $1 and teacher_account_id = $2`,
    [claimId, teacherAccountId],
  )
  if (!cur.rows[0]) return { ok: false, reason: 'not_found' }
  return {
    ok: false,
    reason: 'already_resolved',
    currentStatus: cur.rows[0].status as ClaimStatus,
  }
}

export async function declineClaim(
  teacherAccountId: string,
  claimId: string,
  note: string | null,
): Promise<ResolveResult> {
  const pool = getDbPool()
  const r = await pool.query<{ status: string }>(
    `update payment_claims
        set status = 'declined', resolved_at = now(), note_teacher = $3
      where id = $1
        and teacher_account_id = $2
        and status = 'claimed'
      returning status`,
    [claimId, teacherAccountId, note],
  )
  if (r.rows[0]) return { ok: true, status: 'declined' }
  const cur = await pool.query<{ status: string }>(
    `select status from payment_claims
      where id = $1 and teacher_account_id = $2`,
    [claimId, teacherAccountId],
  )
  if (!cur.rows[0]) return { ok: false, reason: 'not_found' }
  return {
    ok: false,
    reason: 'already_resolved',
    currentStatus: cur.rows[0].status as ClaimStatus,
  }
}

export async function cancelClaimByLearner(
  learnerAccountId: string,
  claimId: string,
): Promise<ResolveResult> {
  const pool = getDbPool()
  const r = await pool.query<{ status: string }>(
    `update payment_claims
        set status = 'cancelled', resolved_at = now()
      where id = $1
        and learner_account_id = $2
        and status = 'claimed'
        and initiated_by = 'learner'
      returning status`,
    [claimId, learnerAccountId],
  )
  if (r.rows[0]) return { ok: true, status: 'cancelled' }
  const cur = await pool.query<{ status: string }>(
    `select status from payment_claims
      where id = $1 and learner_account_id = $2`,
    [claimId, learnerAccountId],
  )
  if (!cur.rows[0]) return { ok: false, reason: 'not_found' }
  return {
    ok: false,
    reason: 'already_resolved',
    currentStatus: cur.rows[0].status as ClaimStatus,
  }
}

export async function countPendingClaimsForTeacher(
  teacherAccountId: string,
): Promise<number> {
  const r = await getDbPool().query<{ n: string }>(
    `select count(*)::text as n
       from payment_claims
      where teacher_account_id = $1
        and status = 'claimed'`,
    [teacherAccountId],
  )
  return Number(r.rows[0]?.n ?? 0)
}

// Helper for learner cabinet: returns SBP details + slot expected amount.
export async function getPayContextForSlot(
  learnerAccountId: string,
  slotId: string,
): Promise<
  | {
      ok: true
      teacherAccountId: string
      teacherName: string
      slotLabel: string
      expectedAmountKopecks: number
      paymentMethod: { phoneDisplay: string; bankLabel: string } | null
    }
  | { ok: false; reason: string }
> {
  const pool = getDbPool()
  const snap = await loadSlotSnapshot(pool, slotId)
  if (!snap) return { ok: false, reason: 'slot_not_found' }
  if (snap.learnerAccountId !== learnerAccountId) {
    return { ok: false, reason: 'not_your_slot' }
  }
  const method = await resolveMethodForLearner(
    snap.teacherAccountId,
    learnerAccountId,
  )
  const tn = await loadDisplayName(pool, snap.teacherAccountId)
  return {
    ok: true,
    teacherAccountId: snap.teacherAccountId,
    teacherName: tn,
    slotLabel: snap.label,
    expectedAmountKopecks: snap.expected,
    paymentMethod: method
      ? { phoneDisplay: method.phoneDisplay, bankLabel: method.bankLabel }
      : null,
  }
}
