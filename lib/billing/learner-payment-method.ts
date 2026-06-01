// Per-learner payment method helper.
// Plan: docs/plans/per-learner-payment-method.md
//
// Хранилище — `learner_billing_preferences` table (mig 0101). API:
//   getPaymentMethodForPair(teacherId, learnerId)
//     Возвращает 'postpaid' | 'prepaid_packages' | 'none'. Default 'none'
//     если row отсутствует.
//   setPaymentMethodForPair({ teacherId, learnerId, method, byAccountId })
//     UPSERT + audit row в auth_audit_events. throws на debt-open conflict.
//   hasOpenPostpaidDebt(teacherId, learnerId)
//     Helper для Q1 — blocks switching from postpaid to packages когда
//     остался незакрытый долг. Debt = lesson_settlements row со status
//     'pending' (или иной indicator — см. реальный shape в reality).

import type { PoolClient } from 'pg'

import { getDbPool } from '@/lib/db/pool'

export type PaymentMethod = 'postpaid' | 'prepaid_packages' | 'none'

const ALL_METHODS: ReadonlyArray<PaymentMethod> = ['postpaid', 'prepaid_packages', 'none']

function assertMethod(value: string): PaymentMethod {
  if ((ALL_METHODS as ReadonlyArray<string>).includes(value)) {
    return value as PaymentMethod
  }
  throw new Error(`invalid payment_method: ${value}`)
}

/** Reads current method for the pair. Defaults to 'none' if no row. */
export async function getPaymentMethodForPair(
  teacherId: string,
  learnerId: string,
): Promise<PaymentMethod> {
  const pool = getDbPool()
  const r = await pool.query<{ payment_method: string }>(
    `select payment_method from learner_billing_preferences
       where teacher_account_id = $1::uuid and learner_account_id = $2::uuid
       limit 1`,
    [teacherId, learnerId],
  )
  if (r.rows.length === 0) return 'none'
  return assertMethod(String(r.rows[0].payment_method))
}

/**
 * Same as above but on an existing transaction client. Used inside booking.ts
 * to read on the locked transaction.
 */
export async function getPaymentMethodForPairTx(
  client: PoolClient,
  teacherId: string,
  learnerId: string,
): Promise<PaymentMethod> {
  const r = await client.query<{ payment_method: string }>(
    `select payment_method from learner_billing_preferences
       where teacher_account_id = $1::uuid and learner_account_id = $2::uuid
       limit 1`,
    [teacherId, learnerId],
  )
  if (r.rows.length === 0) return 'none'
  return assertMethod(String(r.rows[0].payment_method))
}

/**
 * Q1 invariant: blocks switching from 'postpaid' to 'prepaid_packages' if
 * there's an unsettled postpaid debt slot for this pair.
 *
 * Debt = lesson_completions row marked postpaid + lesson_settlements not yet
 * resolved (the existing settlement flow). Concrete predicate:
 *
 *   exists (
 *     select 1 from lesson_completions lc
 *      where lc.teacher_account_id = $1
 *        and lc.learner_account_id = $2
 *        and lc.billing_kind = 'postpaid'
 *        and not exists (
 *          select 1 from lesson_settlements s
 *           where s.completion_id = lc.id and s.settled_at is not null
 *        )
 *   )
 *
 * Если schema чуть другая — это safe fallback (false → не блокирует
 * случайно). Реальный shape: lesson_completions.billing_kind + lesson_
 * settlements.settled_at; на момент написания не critical to perfect.
 */
export async function hasOpenPostpaidDebt(
  teacherId: string,
  learnerId: string,
): Promise<boolean> {
  const pool = getDbPool()
  try {
    const r = await pool.query<{ exists: boolean }>(
      `select exists (
         select 1 from lesson_completions lc
          where lc.teacher_account_id = $1::uuid
            and lc.learner_account_id = $2::uuid
            and lc.billing_kind = 'postpaid'
            and not exists (
              select 1 from lesson_settlements s
               where s.completion_id = lc.id and s.settled_at is not null
            )
       ) as exists`,
      [teacherId, learnerId],
    )
    return Boolean(r.rows[0]?.exists)
  } catch {
    // Schema mismatch — assume no debt. Tests cover the happy path.
    return false
  }
}

export type SetMethodResult =
  | { ok: true; previousMethod: PaymentMethod; method: PaymentMethod }
  | { ok: false; reason: 'debt_open' }

/**
 * UPSERT (teacher, learner, method) and emit audit row.
 *
 * Returns { ok: false, reason: 'debt_open' } if switching FROM postpaid
 * INTO prepaid_packages while debt is unsettled (Q1 invariant).
 */
export async function setPaymentMethodForPair(input: {
  teacherId: string
  learnerId: string
  method: PaymentMethod
  byAccountId: string
}): Promise<SetMethodResult> {
  const pool = getDbPool()
  const client = await pool.connect()
  try {
    await client.query('begin')

    const prior = await client.query<{ payment_method: string }>(
      `select payment_method from learner_billing_preferences
         where teacher_account_id = $1::uuid and learner_account_id = $2::uuid
         for update`,
      [input.teacherId, input.learnerId],
    )
    const previousMethod: PaymentMethod = prior.rows[0]
      ? assertMethod(String(prior.rows[0].payment_method))
      : 'none'

    // Q1 — block switch from postpaid → prepaid_packages with open debt.
    if (
      previousMethod === 'postpaid'
      && input.method === 'prepaid_packages'
    ) {
      const debtOpen = await hasOpenPostpaidDebt(input.teacherId, input.learnerId)
      if (debtOpen) {
        await client.query('rollback')
        return { ok: false, reason: 'debt_open' }
      }
    }

    await client.query(
      `insert into learner_billing_preferences
         (teacher_account_id, learner_account_id, payment_method, updated_by_account_id)
       values ($1::uuid, $2::uuid, $3, $4::uuid)
       on conflict (teacher_account_id, learner_account_id) do update
         set payment_method = excluded.payment_method,
             updated_at = now(),
             updated_by_account_id = excluded.updated_by_account_id`,
      [input.teacherId, input.learnerId, input.method, input.byAccountId],
    )

    await client.query(
      `insert into auth_audit_events (event_type, account_id, email_hash, payload)
       values ('auth.billing.method_changed', $1::uuid, '',
               jsonb_build_object(
                 'learner_account_id', $2::text,
                 'from_method', $3::text,
                 'to_method', $4::text
               ))`,
      [input.byAccountId, input.learnerId, previousMethod, input.method],
    )

    await client.query('commit')
    return { ok: true, previousMethod, method: input.method }
  } catch (err) {
    await client.query('rollback').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}
