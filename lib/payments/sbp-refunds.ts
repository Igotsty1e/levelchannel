// teacher-payments-sbp-self-service Sub-PR E (2026-06-07).
//
// Возвраты: учитель фиксирует факт возврата ученику.
// Деньги уходят через ЕГО банк — платформа только пишет в журнал.
//
// Plan: docs/plans/teacher-payments-sbp-self-service.md §2.6, §3.6

import { getDbPool } from '@/lib/db/pool'
import { MAX_AMOUNT_KOPECKS } from '@/lib/payments/sbp-claims'

export type RefundReason =
  | 'slot_cancelled'
  | 'overpaid'
  | 'goodwill'
  | 'duplicate'
  | 'other'

export type RefundRow = {
  id: string
  claimId: string
  amountKopecks: number
  reason: RefundReason
  note: string | null
  refundedAt: string
}

export type CreateRefundResult =
  | { ok: true; refundId: string }
  | { ok: false; reason: string }

export async function createRefund(
  teacherAccountId: string,
  claimId: string,
  amountKopecks: number,
  reason: RefundReason,
  note: string | null,
): Promise<CreateRefundResult> {
  if (!Number.isInteger(amountKopecks) || amountKopecks <= 0) {
    return { ok: false, reason: 'invalid_amount' }
  }
  if (amountKopecks >= MAX_AMOUNT_KOPECKS) {
    return { ok: false, reason: 'amount_too_large' }
  }
  const pool = getDbPool()
  const client = await pool.connect()
  try {
    await client.query('begin')
    const claim = await client.query<{
      teacher_account_id: string | null
      amount_kopecks: number
      status: string
    }>(
      `select teacher_account_id, amount_kopecks, status
         from payment_claims
        where id = $1
        for update`,
      [claimId],
    )
    const c = claim.rows[0]
    if (!c) {
      await client.query('rollback')
      return { ok: false, reason: 'claim_not_found' }
    }
    if (c.teacher_account_id !== teacherAccountId) {
      await client.query('rollback')
      return { ok: false, reason: 'not_owner' }
    }
    if (c.status !== 'confirmed') {
      await client.query('rollback')
      return { ok: false, reason: 'claim_not_confirmed' }
    }
    const sumRow = await client.query<{ sum_existing: string }>(
      `select coalesce(sum(amount_kopecks), 0)::text as sum_existing
         from payment_refunds where claim_id = $1`,
      [claimId],
    )
    const existing = Number(sumRow.rows[0]?.sum_existing ?? 0)
    if (existing + amountKopecks > c.amount_kopecks) {
      await client.query('rollback')
      return { ok: false, reason: 'refund_exceeds_claim' }
    }
    const inserted = await client.query<{ id: string }>(
      `insert into payment_refunds (claim_id, amount_kopecks, reason, note)
       values ($1, $2, $3, $4)
       returning id`,
      [claimId, amountKopecks, reason, note],
    )
    await client.query('commit')
    return { ok: true, refundId: inserted.rows[0].id }
  } catch (e) {
    await client.query('rollback').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

export async function listRefundsForTeacher(
  teacherAccountId: string,
  limit = 50,
): Promise<RefundRow[]> {
  const r = await getDbPool().query<{
    id: string
    claim_id: string
    amount_kopecks: number
    reason: string
    note: string | null
    refunded_at: string
  }>(
    `select r.id, r.claim_id, r.amount_kopecks, r.reason, r.note,
            r.refunded_at::text
       from payment_refunds r
       join payment_claims c on c.id = r.claim_id
      where c.teacher_account_id = $1
      order by r.refunded_at desc
      limit $2`,
    [teacherAccountId, limit],
  )
  return r.rows.map((row) => ({
    id: row.id,
    claimId: row.claim_id,
    amountKopecks: row.amount_kopecks,
    reason: row.reason as RefundReason,
    note: row.note,
    refundedAt: row.refunded_at,
  }))
}

export async function listRefundsForClaim(claimId: string): Promise<RefundRow[]> {
  const r = await getDbPool().query<{
    id: string
    claim_id: string
    amount_kopecks: number
    reason: string
    note: string | null
    refunded_at: string
  }>(
    `select id, claim_id, amount_kopecks, reason, note, refunded_at::text
       from payment_refunds
      where claim_id = $1
      order by refunded_at desc`,
    [claimId],
  )
  return r.rows.map((row) => ({
    id: row.id,
    claimId: row.claim_id,
    amountKopecks: row.amount_kopecks,
    reason: row.reason as RefundReason,
    note: row.note,
    refundedAt: row.refunded_at,
  }))
}
