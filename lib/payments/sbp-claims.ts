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

export type CreateTeacherMarkPaidInput = {
  teacherAccountId: string
  learnerAccountId: string
  amountKopecks: number
  paymentChannel: PaymentChannel
  paymentMethodId?: string | null
  items: PaymentClaimItemInput[]
  paidAt?: string | null
  note?: string
}

export async function createTeacherMarkPaid(
  input: CreateTeacherMarkPaidInput,
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
  if (input.paidAt) {
    const paidDate = new Date(input.paidAt)
    if (!Number.isFinite(paidDate.getTime())) {
      return { ok: false, reason: 'invalid_paid_at' }
    }
    if (paidDate.getTime() > Date.now() + 86_400_000) {
      return { ok: false, reason: 'paid_at_in_future' }
    }
  }

  const pool = getDbPool()
  const client = await pool.connect()
  try {
    await client.query('begin')

    for (const item of input.items) {
      if (item.slotId) {
        await client.query(
          `select pg_advisory_xact_lock(hashtext('pay-claim:' || $1::text))`,
          [item.slotId],
        )
      }
    }

    if (input.paymentChannel === 'sbp' && input.paymentMethodId) {
      const mr = await client.query<{
        teacher_account_id: string
        phone_display: string
        bank_label: string
        archived_at: string | null
      }>(
        `select teacher_account_id, phone_display, bank_label, archived_at::text
           from teacher_payment_methods
          where id = $1`,
        [input.paymentMethodId],
      )
      const m = mr.rows[0]
      if (!m || m.teacher_account_id !== input.teacherAccountId) {
        await client.query('rollback')
        return { ok: false, reason: 'method_not_found' }
      }
    }

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
        // Codex round-1 BL-1: reject if slot already paid by ANY channel
        // (SBP claim, package consumption, legacy CloudPayments).
        const ex = await client.query<{ src: string }>(
          `select 'sbp' as src
             from payment_claim_items i
             join payment_claims c on c.id = i.claim_id
            where i.slot_id = $1 and c.status in ('claimed', 'confirmed')
            union all
           select 'package' as src
             from package_consumptions
            where slot_id = $1 and restored_at is null
            union all
           select 'cp' as src
             from payment_allocations pa
             join payment_orders po on po.invoice_id = pa.payment_order_id
            where pa.kind = 'lesson_slot'
              and pa.target_id = $1::text
              and po.status = 'paid'
            limit 1`,
          [item.slotId],
        )
        if (ex.rows[0]) {
          await client.query('rollback')
          return { ok: false, reason: 'slot_already_paid' }
        }
        // Codex round-1 WN-4: server snapshot for expected (anti-spoof).
        itemRecords.push({
          slotId: item.slotId,
          packagePurchaseId: null,
          expected: snap.expected,
          label: snap.label,
        })
      } else if (item.packagePurchaseId) {
        const pr = await client.query<{
          account_id: string
          teacher_id: string | null
          title_snapshot: string
          amount_kopecks: number
        }>(
          `select account_id, teacher_id, title_snapshot, amount_kopecks
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
        // Anti-spoof: package must belong to the teacher initiating
        // the claim (защита от teacher-A mark-paid пакет teacher-B).
        if (p.teacher_id !== null && p.teacher_id !== input.teacherAccountId) {
          await client.query('rollback')
          return { ok: false, reason: 'package_not_belongs_to_pair' }
        }
        // Codex round-1 WN-4: server snapshot for expected.
        itemRecords.push({
          slotId: null,
          packagePurchaseId: item.packagePurchaseId,
          expected: Number(p.amount_kopecks),
          label: p.title_snapshot,
        })
      }
    }

    const learnerName = await loadDisplayName(client, input.learnerAccountId)
    const teacherName = await loadDisplayName(client, input.teacherAccountId)

    let methodPhoneSnapshot: string | null = null
    let methodBankSnapshot: string | null = null
    if (input.paymentMethodId) {
      const mr = await client.query<{
        phone_display: string
        bank_label: string
      }>(
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
          note_teacher, paid_at, resolved_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'teacher', 'confirmed', $10, $11, $12, now())
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
        input.paidAt ?? null,
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

// Helper for teacher mark-paid UI: list unpaid booked/completed slots
// for a given learner (no active claim attached).
export async function listUnpaidSlotsForPair(
  teacherAccountId: string,
  learnerAccountId: string,
): Promise<{ id: string; label: string; expectedKopecks: number; startAt: string; status: string }[]> {
  // Codex round-1 BL-2 fix: добавили cancelled, чтобы учитель мог
  // вручную закрыть late-cancel долг.
  // Codex round-1 BL-1 fix: исключаем package-paid и legacy CP-paid.
  const r = await getDbPool().query<{
    id: string
    start_at: string
    duration_minutes: number
    status: string
    snapshot_amount_kopecks: number | null
  }>(
    `select s.id,
            s.start_at::text as start_at,
            s.duration_minutes,
            s.status,
            s.snapshot_amount_kopecks
       from lesson_slots s
      where s.teacher_account_id = $1
        and s.learner_account_id = $2
        and s.status in ('booked', 'completed', 'no_show_learner', 'cancelled')
        and not exists (
          select 1 from payment_claim_items i
           join payment_claims c on c.id = i.claim_id
          where i.slot_id = s.id
            and c.status in ('claimed', 'confirmed')
        )
        and not exists (
          select 1 from package_consumptions pc
           where pc.slot_id = s.id
             and pc.restored_at is null
        )
        and not exists (
          select 1 from payment_allocations pa
           join payment_orders po on po.invoice_id = pa.payment_order_id
          where pa.kind = 'lesson_slot'
            and pa.target_id = s.id::text
            and po.status = 'paid'
        )
      order by s.start_at desc
      limit 50`,
    [teacherAccountId, learnerAccountId],
  )
  return r.rows.map((row) => {
    const dt = new Date(row.start_at)
    const label = `${dt.toLocaleString('ru-RU', {
      timeZone: 'Europe/Moscow',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })} · ${row.duration_minutes} мин · ${row.status}`
    return {
      id: row.id,
      label,
      expectedKopecks: row.snapshot_amount_kopecks ?? 0,
      startAt: row.start_at,
      status: row.status,
    }
  })
}

export async function listLearnersWithUnpaidSlots(
  teacherAccountId: string,
): Promise<{ learnerId: string; learnerName: string; unpaidCount: number; unpaidAmount: number }[]> {
  // round-2 BL-10: учительская policy charge_on_no_show / charge_on_late_cancel
  // фильтрует, какие slot.status включать в долг.
  // Codex round-1 BL-1 fix: исключаем package-paid и legacy CP-paid слоты.
  // Codex round-1 BL-2 fix: 'cancelled' только если cancelled_at < start_at - 24h
  // (late-cancel window). Cancel-window default 24ч; см. cancel-policy в slot.
  const r = await getDbPool().query<{
    learner_id: string
    display_name: string | null
    first_name: string | null
    last_name: string | null
    email: string
    unpaid_count: string
    unpaid_amount: string
  }>(
    `with policy as (
       select teacher_charge_on_no_show, teacher_charge_on_late_cancel
         from accounts where id = $1
     )
     select la.id as learner_id,
            la.email,
            ap.display_name,
            ap.first_name,
            ap.last_name,
            count(*)::text as unpaid_count,
            coalesce(sum(s.snapshot_amount_kopecks), 0)::text as unpaid_amount
       from lesson_slots s
       join accounts la on la.id = s.learner_account_id
       left join account_profiles ap on ap.account_id = la.id
       cross join policy p
      where s.teacher_account_id = $1
        and coalesce(s.snapshot_amount_kopecks, 0) > 0
        and (
          s.status = 'completed'
          or (s.status = 'booked' and s.start_at <= now())
          or (s.status = 'no_show_learner' and p.teacher_charge_on_no_show)
          or (
            s.status = 'cancelled'
            and p.teacher_charge_on_late_cancel
            and s.cancelled_at is not null
            and s.start_at - s.cancelled_at < interval '24 hours'
          )
        )
        -- exclude slots paid via SBP claim (active or confirmed)
        and not exists (
          select 1 from payment_claim_items i
           join payment_claims c on c.id = i.claim_id
          where i.slot_id = s.id
            and c.status in ('claimed', 'confirmed')
        )
        -- exclude slots paid via package consumption (round-1 BL-1)
        and not exists (
          select 1 from package_consumptions pc
           where pc.slot_id = s.id
             and pc.restored_at is null
        )
        -- exclude slots paid via legacy CloudPayments allocation
        and not exists (
          select 1 from payment_allocations pa
           join payment_orders po on po.invoice_id = pa.payment_order_id
          where pa.kind = 'lesson_slot'
            and pa.target_id = s.id::text
            and po.status = 'paid'
        )
      group by la.id, la.email, ap.display_name, ap.first_name, ap.last_name
      order by sum(s.snapshot_amount_kopecks) desc nulls last
      limit 30`,
    [teacherAccountId],
  )
  return r.rows.map((row) => {
    const composed = [row.first_name, row.last_name].filter(Boolean).join(' ').trim()
    return {
      learnerId: row.learner_id,
      learnerName: composed || row.display_name || row.email,
      unpaidCount: Number(row.unpaid_count),
      unpaidAmount: Number(row.unpaid_amount),
    }
  })
}

export async function listExpiringPackagesForTeacher(
  teacherAccountId: string,
): Promise<
  {
    purchaseId: string
    learnerName: string
    learnerId: string
    title: string
    countRemaining: number
    countInitial: number
    expiresAt: string
    reason: 'low_remaining' | 'expiring_soon'
  }[]
> {
  // package_purchases имеет teacher_account_id (mig 0076c).
  const r = await getDbPool().query<{
    purchase_id: string
    learner_id: string
    display_name: string | null
    first_name: string | null
    last_name: string | null
    email: string
    title_snapshot: string
    count_initial: number
    count_remaining: string
    expires_at: string
  }>(
    `select pp.id as purchase_id,
            la.id as learner_id,
            la.email,
            ap.display_name,
            ap.first_name,
            ap.last_name,
            pp.title_snapshot,
            pp.count_initial,
            (pp.count_initial - coalesce((
              select count(*) from package_consumptions pc
               where pc.package_purchase_id = pp.id
                 and pc.restored_at is null
            ), 0))::text as count_remaining,
            pp.expires_at::text as expires_at
       from package_purchases pp
       join accounts la on la.id = pp.account_id
       left join account_profiles ap on ap.account_id = la.id
      where pp.teacher_id = $1
        and pp.voided_at is null
        and pp.expires_at > now()
      order by pp.expires_at asc`,
    [teacherAccountId],
  )

  const now = Date.now()
  const cutoff14d = now + 14 * 86_400_000

  return r.rows
    .map((row) => {
      const remaining = Number(row.count_remaining)
      const expiresMs = new Date(row.expires_at).getTime()
      const composed = [row.first_name, row.last_name]
        .filter(Boolean)
        .join(' ')
        .trim()
      const lowRemaining = remaining > 0 && remaining <= 2
      const expiringSoon = expiresMs <= cutoff14d
      if (!lowRemaining && !expiringSoon) return null
      return {
        purchaseId: row.purchase_id,
        learnerId: row.learner_id,
        learnerName: composed || row.display_name || row.email,
        title: row.title_snapshot,
        countRemaining: remaining,
        countInitial: row.count_initial,
        expiresAt: row.expires_at,
        reason: lowRemaining ? ('low_remaining' as const) : ('expiring_soon' as const),
      }
    })
    .filter(
      (
        x,
      ): x is {
        purchaseId: string
        learnerId: string
        learnerName: string
        title: string
        countRemaining: number
        countInitial: number
        expiresAt: string
        reason: 'low_remaining' | 'expiring_soon'
      } => x !== null,
    )
}

export async function getTeacherPaymentPolicy(
  teacherAccountId: string,
): Promise<{ chargeOnNoShow: boolean; chargeOnLateCancel: boolean }> {
  const r = await getDbPool().query<{
    teacher_charge_on_no_show: boolean
    teacher_charge_on_late_cancel: boolean
  }>(
    `select teacher_charge_on_no_show, teacher_charge_on_late_cancel
       from accounts where id = $1`,
    [teacherAccountId],
  )
  return {
    chargeOnNoShow: r.rows[0]?.teacher_charge_on_no_show ?? false,
    chargeOnLateCancel: r.rows[0]?.teacher_charge_on_late_cancel ?? false,
  }
}

export async function setTeacherPaymentPolicy(
  teacherAccountId: string,
  policy: { chargeOnNoShow?: boolean; chargeOnLateCancel?: boolean },
): Promise<void> {
  const parts: string[] = []
  const params: unknown[] = []
  let idx = 1
  if (policy.chargeOnNoShow !== undefined) {
    parts.push(`teacher_charge_on_no_show = $${idx++}`)
    params.push(policy.chargeOnNoShow)
  }
  if (policy.chargeOnLateCancel !== undefined) {
    parts.push(`teacher_charge_on_late_cancel = $${idx++}`)
    params.push(policy.chargeOnLateCancel)
  }
  if (parts.length === 0) return
  params.push(teacherAccountId)
  await getDbPool().query(
    `update accounts set ${parts.join(', ')} where id = $${idx}`,
    params,
  )
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
        // Codex round-1 BL-1: reject if slot already paid by ANY channel
        // (SBP claim, package consumption, legacy CloudPayments).
        const ex = await client.query<{ src: string }>(
          `select 'sbp' as src
             from payment_claim_items i
             join payment_claims c on c.id = i.claim_id
            where i.slot_id = $1 and c.status in ('claimed', 'confirmed')
            union all
           select 'package' as src
             from package_consumptions
            where slot_id = $1 and restored_at is null
            union all
           select 'cp' as src
             from payment_allocations pa
             join payment_orders po on po.invoice_id = pa.payment_order_id
            where pa.kind = 'lesson_slot'
              and pa.target_id = $1::text
              and po.status = 'paid'
            limit 1`,
          [item.slotId],
        )
        if (ex.rows[0]) {
          await client.query('rollback')
          return { ok: false, reason: 'slot_already_paid' }
        }
        // Codex round-1 WN-4: server snapshot for expected (anti-spoof).
        itemRecords.push({
          slotId: item.slotId,
          packagePurchaseId: null,
          expected: snap.expected,
          label: snap.label,
        })
      } else if (item.packagePurchaseId) {
        const pr = await client.query<{
          account_id: string
          teacher_id: string | null
          title_snapshot: string
          amount_kopecks: number
        }>(
          `select account_id, teacher_id, title_snapshot, amount_kopecks
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
        if (p.teacher_id !== null && p.teacher_id !== input.teacherAccountId) {
          await client.query('rollback')
          return { ok: false, reason: 'package_not_belongs_to_pair' }
        }
        // Codex round-1 WN-4: server snapshot for expected.
        itemRecords.push({
          slotId: null,
          packagePurchaseId: item.packagePurchaseId,
          expected: Number(p.amount_kopecks),
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

    // Fire-and-forget email уведомление учителю. Errors не должны
    // ломать создание claim (TX уже committed).
    void notifyTeacherAboutNewClaim({
      teacherAccountId: input.teacherAccountId,
      learnerName,
      teacherName,
      amountKopecks: input.amountKopecks,
      paymentChannel: input.paymentChannel,
      itemsSummary: itemRecords.map((r) => r.label).join('; '),
    }).catch(() => {})

    return { ok: true, claimId }
  } catch (e) {
    await client.query('rollback').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

async function notifyTeacherAboutNewClaim(args: {
  teacherAccountId: string
  learnerName: string
  teacherName: string
  amountKopecks: number
  paymentChannel: PaymentChannel
  itemsSummary: string
}): Promise<void> {
  try {
    const { sendSbpClaimNotificationToTeacher } = await import(
      '@/lib/email/dispatch'
    )
    const pool = getDbPool()
    const r = await pool.query<{ email: string }>(
      `select email from accounts where id = $1 limit 1`,
      [args.teacherAccountId],
    )
    const to = r.rows[0]?.email
    if (!to) return
    const amountRub = new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: 'RUB',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(args.amountKopecks / 100)
    await sendSbpClaimNotificationToTeacher(to, {
      teacherName: args.teacherName,
      learnerName: args.learnerName,
      amountRub,
      itemsSummary: args.itemsSummary,
      paymentChannel: args.paymentChannel,
    })
  } catch {
    // swallow — email errors must not propagate
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
// Codex round-1 BL-1 fix: rejects already-paid slots (package, CP, SBP).
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
  // Reject if already paid by ANY channel.
  const paidCheck = await pool.query<{ src: string }>(
    `select 'sbp' as src
       from payment_claim_items i
       join payment_claims c on c.id = i.claim_id
      where i.slot_id = $1 and c.status in ('claimed', 'confirmed')
      union all
     select 'package' as src
       from package_consumptions
      where slot_id = $1 and restored_at is null
      union all
     select 'cp' as src
       from payment_allocations pa
       join payment_orders po on po.invoice_id = pa.payment_order_id
      where pa.kind = 'lesson_slot'
        and pa.target_id = $1::text
        and po.status = 'paid'
      limit 1`,
    [slotId],
  )
  if (paidCheck.rows.length > 0) {
    return { ok: false, reason: 'already_paid' }
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
