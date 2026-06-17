// teacher-payments-sbp-self-service Sub-PR A1 (2026-06-07).
//
// CRUD-операции над `teacher_payment_methods` + assignments. Источник
// правды по платежным реквизитам учителя. Все функции anti-spoof
// проверяют ownership через `teacher_account_id` каждый раз.
//
// Plan: docs/plans/teacher-payments-sbp-self-service.md §3.1, §3.2

import { getDbPool } from '@/lib/db/pool'
import { normalizePhoneRu, formatPhoneRu } from '@/lib/util/phone'

const MAX_ACTIVE_METHODS_PER_TEACHER = 10 // round-7 WN-68

export type PaymentMethod = {
  id: string
  phoneE164: string
  phoneDisplay: string
  bankLabel: string
  isDefault: boolean
  createdAt: string
  archivedAt: string | null
}

export type PaymentMethodForLearnerView = {
  // 2026-06-17 prod-fix: id нужен модалке оплаты, чтобы передать его в
  // POST /api/learner/payment-claims (сервер требует paymentMethodId
  // для SBP-канала; без него — 400 method_required_for_sbp).
  id: string
  phoneE164: string
  phoneDisplay: string
  bankLabel: string
}

function mapRow(r: {
  id: string
  phone_e164: string
  phone_display: string
  bank_label: string
  is_default: boolean
  created_at: string
  archived_at: string | null
}): PaymentMethod {
  return {
    id: r.id,
    phoneE164: r.phone_e164,
    phoneDisplay: r.phone_display,
    bankLabel: r.bank_label,
    isDefault: r.is_default,
    createdAt: r.created_at,
    archivedAt: r.archived_at,
  }
}

export async function listActivePaymentMethods(
  teacherAccountId: string,
): Promise<PaymentMethod[]> {
  const r = await getDbPool().query<{
    id: string
    phone_e164: string
    phone_display: string
    bank_label: string
    is_default: boolean
    created_at: string
    archived_at: string | null
  }>(
    `select id, phone_e164, phone_display, bank_label, is_default,
            created_at::text, archived_at::text
       from teacher_payment_methods
      where teacher_account_id = $1
        and archived_at is null
      order by is_default desc, created_at asc`,
    [teacherAccountId],
  )
  return r.rows.map(mapRow)
}

export async function countActivePaymentMethods(
  teacherAccountId: string,
): Promise<number> {
  const r = await getDbPool().query<{ n: string }>(
    `select count(*)::text as n
       from teacher_payment_methods
      where teacher_account_id = $1
        and archived_at is null`,
    [teacherAccountId],
  )
  return Number(r.rows[0]?.n ?? 0)
}

export type CreatePaymentMethodInput = {
  teacherAccountId: string
  phoneRaw: string
  bankLabel: string
  isDefault?: boolean
}

export type CreatePaymentMethodResult =
  | { ok: true; method: PaymentMethod; reused: boolean }
  | { ok: false; reason: 'invalid_phone' | 'invalid_bank' | 'limit_reached' }

export async function createPaymentMethod(
  input: CreatePaymentMethodInput,
): Promise<CreatePaymentMethodResult> {
  const phoneE164 = normalizePhoneRu(input.phoneRaw)
  if (!phoneE164) return { ok: false, reason: 'invalid_phone' }
  const phoneDisplay = formatPhoneRu(phoneE164)
  const bankLabel = input.bankLabel.trim()
  if (bankLabel.length === 0 || bankLabel.length > 80) {
    return { ok: false, reason: 'invalid_bank' }
  }

  const pool = getDbPool()
  const client = await pool.connect()
  try {
    await client.query('begin')

    // Re-add un-archive: если архивированная строка с тем же
    // (phone, bank) есть — оживить её, не создавать дубль.
    const existing = await client.query<{
      id: string
      phone_e164: string
      phone_display: string
      bank_label: string
      is_default: boolean
      created_at: string
      archived_at: string | null
    }>(
      `select id, phone_e164, phone_display, bank_label, is_default,
              created_at::text, archived_at::text
         from teacher_payment_methods
        where teacher_account_id = $1
          and phone_e164 = $2
          and bank_label = $3
        for update`,
      [input.teacherAccountId, phoneE164, bankLabel],
    )

    const activeCount = await client.query<{ n: string }>(
      `select count(*)::text as n
         from teacher_payment_methods
        where teacher_account_id = $1
          and archived_at is null`,
      [input.teacherAccountId],
    )
    const isFirstActive = Number(activeCount.rows[0]?.n ?? 0) === 0

    if (existing.rows[0]) {
      const row = existing.rows[0]
      if (row.archived_at === null) {
        // Уже active — return as-is.
        await client.query('rollback')
        return { ok: true, method: mapRow(row), reused: true }
      }
      // Un-archive.
      const shouldBeDefault = input.isDefault === true || isFirstActive
      if (shouldBeDefault) {
        await client.query(
          `update teacher_payment_methods
              set is_default = false
            where teacher_account_id = $1
              and is_default = true
              and archived_at is null`,
          [input.teacherAccountId],
        )
      }
      const updated = await client.query<{
        id: string
        phone_e164: string
        phone_display: string
        bank_label: string
        is_default: boolean
        created_at: string
        archived_at: string | null
      }>(
        `update teacher_payment_methods
            set archived_at = null,
                phone_display = $2,
                is_default = $3
          where id = $1
        returning id, phone_e164, phone_display, bank_label, is_default,
                  created_at::text, archived_at::text`,
        [row.id, phoneDisplay, shouldBeDefault],
      )
      await client.query('commit')
      return { ok: true, method: mapRow(updated.rows[0]), reused: true }
    }

    // Sanity limit.
    if (Number(activeCount.rows[0]?.n ?? 0) >= MAX_ACTIVE_METHODS_PER_TEACHER) {
      await client.query('rollback')
      return { ok: false, reason: 'limit_reached' }
    }

    const shouldBeDefault = input.isDefault === true || isFirstActive
    if (shouldBeDefault) {
      await client.query(
        `update teacher_payment_methods
            set is_default = false
          where teacher_account_id = $1
            and is_default = true
            and archived_at is null`,
        [input.teacherAccountId],
      )
    }
    const inserted = await client.query<{
      id: string
      phone_e164: string
      phone_display: string
      bank_label: string
      is_default: boolean
      created_at: string
      archived_at: string | null
    }>(
      `insert into teacher_payment_methods
         (teacher_account_id, phone_e164, phone_display, bank_label, is_default)
       values ($1, $2, $3, $4, $5)
       returning id, phone_e164, phone_display, bank_label, is_default,
                 created_at::text, archived_at::text`,
      [input.teacherAccountId, phoneE164, phoneDisplay, bankLabel, shouldBeDefault],
    )
    await client.query('commit')
    return { ok: true, method: mapRow(inserted.rows[0]), reused: false }
  } catch (e) {
    await client.query('rollback').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

export type UpdatePaymentMethodInput = {
  teacherAccountId: string
  methodId: string
  phoneRaw?: string
  bankLabel?: string
  isDefault?: boolean
  restore?: boolean // un-archive если был archived
}

export type UpdatePaymentMethodResult =
  | { ok: true; method: PaymentMethod }
  | { ok: false; reason: 'not_found' | 'invalid_phone' | 'invalid_bank' }

export async function updatePaymentMethod(
  input: UpdatePaymentMethodInput,
): Promise<UpdatePaymentMethodResult> {
  let phoneE164: string | undefined
  let phoneDisplay: string | undefined
  if (input.phoneRaw !== undefined) {
    const n = normalizePhoneRu(input.phoneRaw)
    if (!n) return { ok: false, reason: 'invalid_phone' }
    phoneE164 = n
    phoneDisplay = formatPhoneRu(n)
  }
  let bankLabel: string | undefined
  if (input.bankLabel !== undefined) {
    const b = input.bankLabel.trim()
    if (b.length === 0 || b.length > 80) {
      return { ok: false, reason: 'invalid_bank' }
    }
    bankLabel = b
  }

  const pool = getDbPool()
  const client = await pool.connect()
  try {
    await client.query('begin')

    const r = await client.query<{
      id: string
      teacher_account_id: string
      archived_at: string | null
    }>(
      `select id, teacher_account_id, archived_at::text
         from teacher_payment_methods
        where id = $1
        for update`,
      [input.methodId],
    )
    if (!r.rows[0] || r.rows[0].teacher_account_id !== input.teacherAccountId) {
      await client.query('rollback')
      return { ok: false, reason: 'not_found' }
    }

    if (input.isDefault === true) {
      await client.query(
        `update teacher_payment_methods
            set is_default = false
          where teacher_account_id = $1
            and is_default = true
            and archived_at is null
            and id <> $2`,
        [input.teacherAccountId, input.methodId],
      )
    }

    const setParts: string[] = []
    const params: unknown[] = []
    let idx = 1
    if (phoneE164) {
      setParts.push(`phone_e164 = $${idx++}`)
      params.push(phoneE164)
      setParts.push(`phone_display = $${idx++}`)
      params.push(phoneDisplay)
    }
    if (bankLabel) {
      setParts.push(`bank_label = $${idx++}`)
      params.push(bankLabel)
    }
    if (input.isDefault !== undefined) {
      setParts.push(`is_default = $${idx++}`)
      params.push(input.isDefault)
    }
    if (input.restore === true && r.rows[0].archived_at !== null) {
      setParts.push(`archived_at = null`)
    }
    if (setParts.length === 0) {
      const cur = await client.query<{
        id: string
        phone_e164: string
        phone_display: string
        bank_label: string
        is_default: boolean
        created_at: string
        archived_at: string | null
      }>(
        `select id, phone_e164, phone_display, bank_label, is_default,
                created_at::text, archived_at::text
           from teacher_payment_methods where id = $1`,
        [input.methodId],
      )
      await client.query('commit')
      return { ok: true, method: mapRow(cur.rows[0]) }
    }

    params.push(input.methodId)
    const updated = await client.query<{
      id: string
      phone_e164: string
      phone_display: string
      bank_label: string
      is_default: boolean
      created_at: string
      archived_at: string | null
    }>(
      `update teacher_payment_methods
          set ${setParts.join(', ')}
        where id = $${idx}
        returning id, phone_e164, phone_display, bank_label, is_default,
                  created_at::text, archived_at::text`,
      params,
    )
    await client.query('commit')
    return { ok: true, method: mapRow(updated.rows[0]) }
  } catch (e) {
    await client.query('rollback').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

export type ArchivePaymentMethodResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' }

export async function archivePaymentMethod(
  teacherAccountId: string,
  methodId: string,
): Promise<ArchivePaymentMethodResult> {
  const pool = getDbPool()
  const client = await pool.connect()
  try {
    await client.query('begin')

    const r = await client.query<{ id: string; is_default: boolean }>(
      `select id, is_default
         from teacher_payment_methods
        where id = $1
          and teacher_account_id = $2
          and archived_at is null
        for update`,
      [methodId, teacherAccountId],
    )
    if (!r.rows[0]) {
      await client.query('rollback')
      return { ok: false, reason: 'not_found' }
    }

    await client.query(
      `update teacher_payment_methods
          set archived_at = now(), is_default = false
        where id = $1`,
      [methodId],
    )

    // Если архивировали default — назначим default следующему active.
    if (r.rows[0].is_default) {
      await client.query(
        `update teacher_payment_methods
            set is_default = true
          where id = (
            select id from teacher_payment_methods
             where teacher_account_id = $1
               and archived_at is null
             order by created_at asc
             limit 1
          )`,
        [teacherAccountId],
      )
    }

    await client.query('commit')
    return { ok: true }
  } catch (e) {
    await client.query('rollback').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

// Resolve which method ученик увидит для пары (teacher, learner).
// Priority: assignment override (if active) → default → null.
export async function resolveMethodForLearner(
  teacherAccountId: string,
  learnerAccountId: string,
): Promise<PaymentMethodForLearnerView | null> {
  const pool = getDbPool()
  // Assignment override (только если referenced метод не archived).
  const a = await pool.query<{
    id: string
    phone_e164: string
    phone_display: string
    bank_label: string
  }>(
    `select m.id, m.phone_e164, m.phone_display, m.bank_label
       from teacher_payment_method_assignments a
       join teacher_payment_methods m on m.id = a.payment_method_id
      where a.teacher_account_id = $1
        and a.learner_account_id = $2
        and m.archived_at is null
      limit 1`,
    [teacherAccountId, learnerAccountId],
  )
  if (a.rows[0]) {
    return {
      id: a.rows[0].id,
      phoneE164: a.rows[0].phone_e164,
      phoneDisplay: a.rows[0].phone_display,
      bankLabel: a.rows[0].bank_label,
    }
  }
  const d = await pool.query<{
    id: string
    phone_e164: string
    phone_display: string
    bank_label: string
  }>(
    `select id, phone_e164, phone_display, bank_label
       from teacher_payment_methods
      where teacher_account_id = $1
        and is_default = true
        and archived_at is null
      limit 1`,
    [teacherAccountId],
  )
  if (d.rows[0]) {
    return {
      id: d.rows[0].id,
      phoneE164: d.rows[0].phone_e164,
      phoneDisplay: d.rows[0].phone_display,
      bankLabel: d.rows[0].bank_label,
    }
  }
  return null
}
