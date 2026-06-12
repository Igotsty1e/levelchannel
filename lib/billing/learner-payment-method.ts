// Per-learner payment method helper.
// Plan: docs/plans/per-learner-payment-method.md
//
// Хранилище — `learner_billing_preferences` table (mig 0101). API:
//   getPaymentMethodForPair(teacherId, learnerId)
//     Возвращает 'postpaid' | 'none'. Default 'none' если row отсутствует.
//   setPaymentMethodForPair({ teacherId, learnerId, method, byAccountId })
//     UPSERT + audit row в auth_audit_events.

import type { PoolClient } from 'pg'

import { getDbPool } from '@/lib/db/pool'

// epic-b Sub-PR B.1 (2026-06-11): dropped 'prepaid_packages'. Mix
// (package consume → postpaid fallback) is always allowed when method
// is 'postpaid'. 'none' still blocks booking until teacher chooses.
export type PaymentMethod = 'postpaid' | 'none'

const ALL_METHODS: ReadonlyArray<PaymentMethod> = ['postpaid', 'none']

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
 * UPSERT (teacher, learner, method) and emit audit row.
 */
export async function setPaymentMethodForPair(input: {
  teacherId: string
  learnerId: string
  method: PaymentMethod
  byAccountId: string
}): Promise<{ previousMethod: PaymentMethod; method: PaymentMethod }> {
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
    return { previousMethod, method: input.method }
  } catch (err) {
    await client.query('rollback').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}
