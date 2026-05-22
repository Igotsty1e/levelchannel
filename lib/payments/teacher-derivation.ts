// SAAS-PIVOT Epic 6 Day 6 (2026-05-22) — derive the owning teacher
// account for a payment_orders row at write time.
//
// Plan: docs/plans/saas-pivot-master.md §2.8 writer table + §5 Day 6.
//
// After mig 0094 (`payment_orders.teacher_account_id` NOT NULL flip),
// every writer must thread a value at INSERT. The derivation order
// mirrors Day-1 backfill bucket order (mig 0085):
//   (a) slotId        → lesson_slots.teacher_account_id
//   (b) packageId     → lesson_packages.teacher_id
//   (c) packageSlug   → lesson_packages.teacher_id by slug
//   (d) teacherSlug   → account_profiles.teacher_public_slug
//   (e) explicit teacherAccountId pass-through
//   (f) fallback      → bootstrap teacher (mig 0083 marker)
//
// On `null` from every path the caller surfaces a 500 — every writer
// MUST converge on a non-null value (the bootstrap fallback is the
// ultimate safety net). Tests pin this in
// `epic6-admin-and-pay.test.ts`.

import { getBootstrapTeacherId } from '@/lib/auth/bootstrap-teacher'
import { getDbPool } from '@/lib/db/pool'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type TeacherDerivationInput = {
  slotId?: string | null
  packageId?: string | null
  packageSlug?: string | null
  teacherSlug?: string | null
  explicitTeacherAccountId?: string | null
}

/**
 * Resolve the owning teacher account id for a new payment_orders row.
 *
 * Always returns a UUID string (or null if even the bootstrap fallback
 * is missing — only happens on a fresh DB with no mig 0083 row).
 * Caller surfaces 500 / 422 on a null result depending on context.
 */
export async function deriveTeacherAccountIdForOrder(
  input: TeacherDerivationInput,
): Promise<string | null> {
  if (
    input.explicitTeacherAccountId &&
    UUID_PATTERN.test(input.explicitTeacherAccountId)
  ) {
    return input.explicitTeacherAccountId
  }

  const pool = getDbPool()

  if (input.slotId && UUID_PATTERN.test(input.slotId)) {
    const result = await pool.query<{ teacher_account_id: string | null }>(
      `select teacher_account_id from lesson_slots where id = $1::uuid limit 1`,
      [input.slotId],
    )
    const tid = result.rows[0]?.teacher_account_id
    if (tid) return String(tid)
  }

  if (input.packageId && UUID_PATTERN.test(input.packageId)) {
    const result = await pool.query<{ teacher_id: string | null }>(
      `select teacher_id from lesson_packages where id = $1::uuid limit 1`,
      [input.packageId],
    )
    const tid = result.rows[0]?.teacher_id
    if (tid) return String(tid)
  }

  if (input.packageSlug && typeof input.packageSlug === 'string') {
    const result = await pool.query<{ teacher_id: string | null }>(
      `select teacher_id from lesson_packages where slug = $1 limit 1`,
      [input.packageSlug],
    )
    const tid = result.rows[0]?.teacher_id
    if (tid) return String(tid)
  }

  if (input.teacherSlug && typeof input.teacherSlug === 'string') {
    const result = await pool.query<{ account_id: string }>(
      `select p.account_id
         from account_profiles p
        where p.teacher_public_slug = $1
        limit 1`,
      [input.teacherSlug],
    )
    const tid = result.rows[0]?.account_id
    if (tid) return String(tid)
  }

  // Final fallback — bootstrap teacher. Helper caches for 30s.
  return getBootstrapTeacherId()
}

/**
 * Validate that the resolved teacher is on the operator-managed
 * (plan-4) subscription. Returns true if and only if there is an
 * `active` teacher_subscriptions row with `plan_slug='operator-managed'`.
 *
 * Used by `/api/payments` and `/t/<slug>/pay` to reject orders
 * pointed at non-plan-4 teachers (those teachers don't run money
 * through the platform — they'd never see the funds).
 */
export async function isOperatorManagedTeacher(
  teacherAccountId: string,
): Promise<boolean> {
  if (!UUID_PATTERN.test(teacherAccountId)) return false
  const pool = getDbPool()
  const result = await pool.query<{ plan_slug: string; state: string }>(
    `select plan_slug, state
       from teacher_subscriptions
      where account_id = $1::uuid
      limit 1`,
    [teacherAccountId],
  )
  const row = result.rows[0]
  if (!row) return false
  return row.plan_slug === 'operator-managed' && row.state === 'active'
}
