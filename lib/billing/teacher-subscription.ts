// A2 — Mid/Pro paid-subscription MVP helpers.
//
// Plan: docs/plans/saas-offer-and-landing-redesign.md A2 +
// v2 SaaS-оферта §4.2 (PAYG-only mode; recurrent deferred).
//
// One row per teacher in `teacher_subscriptions` (1:1 with accounts;
// PK=account_id). This helper extends the existing state machine (mig
// 0074) with the paid-period lifecycle (mig 0098):
//
//   - getActiveTeacherSubscription(accountId)
//       Reads the row + computes `isPaidActive` (state='active',
//       plan in {mid,pro}, period_end > now()).
//
//   - createOrRenewTeacherSubscription({...})
//       UPSERT after a successful CloudPayments webhook for a
//       saas_subscription_* order. Sets plan_slug + state='active' +
//       period_start=now() + period_end=now()+30d + amount_kopecks.
//       Idempotent on (account_id, payment_order_id).
//
//   - cancelTeacherSubscription(accountId)
//       Marks cancelled_at=now(); does NOT downgrade until period_end
//       (per oферта §4.2 — paid through the end of the current period).
//
//   - expireOverdueSubscriptions()
//       Cron-ready: flips paid Mid/Pro rows with period_end < now() to
//       plan_slug='free', clears the paid columns. NOT scheduled in
//       MVP — operator runs it manually if needed; future cron wires up.

import { getDbPool } from '@/lib/db/pool'

export type TeacherSubscriptionTier = 'mid' | 'pro'
export type TeacherSubscriptionState =
  | 'active'
  | 'past_due'
  | 'cancelled'
  | 'suspended'

export type TeacherSubscriptionRow = {
  accountId: string
  planSlug: string
  state: TeacherSubscriptionState
  renewalAt: string | null
  periodStart: string | null
  periodEnd: string | null
  amountKopecks: number | null
  paymentOrderId: string | null
  cpToken: string | null
  cancelledAt: string | null
  createdAt: string
  updatedAt: string
}

export type ActiveTeacherSubscription = TeacherSubscriptionRow & {
  /** True if this row represents a live paid Mid/Pro period (or operator-managed/free). */
  isPaidActive: boolean
}

const COLS =
  'account_id, plan_slug, state, renewal_at, period_start, period_end, ' +
  'amount_kopecks, payment_order_id, cp_token, cancelled_at, created_at, updated_at'

function rowToSubscription(
  row: Record<string, unknown>,
): TeacherSubscriptionRow {
  return {
    accountId: String(row.account_id),
    planSlug: String(row.plan_slug),
    state: String(row.state) as TeacherSubscriptionState,
    renewalAt: row.renewal_at
      ? new Date(String(row.renewal_at)).toISOString()
      : null,
    periodStart: row.period_start
      ? new Date(String(row.period_start)).toISOString()
      : null,
    periodEnd: row.period_end
      ? new Date(String(row.period_end)).toISOString()
      : null,
    amountKopecks:
      row.amount_kopecks == null ? null : Number(row.amount_kopecks),
    paymentOrderId:
      row.payment_order_id == null ? null : String(row.payment_order_id),
    cpToken: row.cp_token == null ? null : String(row.cp_token),
    cancelledAt: row.cancelled_at
      ? new Date(String(row.cancelled_at)).toISOString()
      : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  }
}

/**
 * Returns the subscription row for a teacher (1:1 with accounts), or
 * null if no row exists. Adds `isPaidActive` semantics: true if the
 * row is in `active` state AND (operator-managed/free OR period_end
 * is still in the future).
 *
 * `isPaidActive` is the canonical "can this teacher use the cabinet
 * at the current tier" check — it does NOT auto-expire Mid/Pro rows
 * whose period_end has passed (the cron job handles that), but it
 * does treat them as effectively-expired for UI purposes.
 */
export async function getActiveTeacherSubscription(
  accountId: string,
): Promise<ActiveTeacherSubscription | null> {
  const pool = getDbPool()
  const result = await pool.query(
    `select ${COLS}
       from teacher_subscriptions
      where account_id = $1::uuid
      limit 1`,
    [accountId],
  )
  if (result.rows.length === 0) return null
  const row = rowToSubscription(result.rows[0])
  const now = Date.now()
  const isPaidTier = row.planSlug === 'mid' || row.planSlug === 'pro'
  let isPaidActive: boolean
  if (row.state !== 'active') {
    isPaidActive = false
  } else if (!isPaidTier) {
    // free / operator-managed are always active when state='active'.
    isPaidActive = true
  } else if (!row.periodEnd) {
    // Mid/Pro with no period_end is in a weird state (admin-flipped
    // without a paid period). Treat as inactive so the UI re-prompts.
    isPaidActive = false
  } else {
    isPaidActive = new Date(row.periodEnd).getTime() > now
  }
  return { ...row, isPaidActive }
}

/**
 * UPSERT a teacher_subscriptions row to activate or renew a paid Mid/
 * Pro period. Called from the CloudPayments webhook after a
 * saas_subscription_* order pays.
 *
 * - New row: INSERT with plan/state/period_start=now/period_end=now+30d.
 * - Existing row (any plan): UPDATE plan_slug, state='active',
 *   period_start, period_end, amount_kopecks, payment_order_id.
 *   `cancelled_at` is cleared so a renewal undoes a prior cancel.
 *
 * Idempotency: callers should check that the order hasn't already been
 * applied (via `findSubscriptionByPaymentOrderId`) before calling — the
 * webhook does this. The DB itself does not enforce idempotency since
 * the same teacher legitimately renews monthly with new invoice ids.
 */
export async function createOrRenewTeacherSubscription(input: {
  accountId: string
  tier: TeacherSubscriptionTier
  amountKopecks: number
  paymentOrderId: string
  periodDays?: number
  cpToken?: string | null
}): Promise<TeacherSubscriptionRow> {
  if (!Number.isInteger(input.amountKopecks) || input.amountKopecks <= 0) {
    throw new Error('amountKopecks must be a positive integer')
  }
  const periodDays = input.periodDays ?? 30
  if (!Number.isInteger(periodDays) || periodDays <= 0 || periodDays > 366) {
    throw new Error('periodDays must be in (0, 366]')
  }
  const pool = getDbPool()
  const result = await pool.query(
    `insert into teacher_subscriptions
       (account_id, plan_slug, state, period_start, period_end,
        amount_kopecks, payment_order_id, cp_token, cancelled_at,
        created_at, updated_at)
     values
       ($1::uuid, $2, 'active', now(), now() + ($3::text || ' days')::interval,
        $4, $5, $6, null,
        now(), now())
     on conflict (account_id) do update
       set plan_slug = excluded.plan_slug,
           state = 'active',
           period_start = excluded.period_start,
           period_end = excluded.period_end,
           amount_kopecks = excluded.amount_kopecks,
           payment_order_id = excluded.payment_order_id,
           cp_token = coalesce(excluded.cp_token, teacher_subscriptions.cp_token),
           cancelled_at = null,
           updated_at = now()
     returning ${COLS}`,
    [
      input.accountId,
      input.tier,
      String(periodDays),
      input.amountKopecks,
      input.paymentOrderId,
      input.cpToken ?? null,
    ],
  )
  return rowToSubscription(result.rows[0])
}

/**
 * Mark the teacher's subscription as cancelled. The state stays
 * `active` and the row continues to grant cabinet access until
 * `period_end`; the cron job then auto-downgrades to Free.
 *
 * If the row is already cancelled, this is a no-op (cancelled_at
 * is NOT updated to a fresh timestamp — first-cancel time is the
 * canonical record).
 *
 * Returns the post-update row, or null if no row existed.
 */
export async function cancelTeacherSubscription(
  accountId: string,
): Promise<TeacherSubscriptionRow | null> {
  const pool = getDbPool()
  const result = await pool.query(
    `update teacher_subscriptions
        set cancelled_at = coalesce(cancelled_at, now()),
            updated_at = now()
      where account_id = $1::uuid
        and plan_slug in ('mid', 'pro')
      returning ${COLS}`,
    [accountId],
  )
  if (result.rows.length === 0) return null
  return rowToSubscription(result.rows[0])
}

/**
 * Cron-ready helper: downgrades paid Mid/Pro rows whose period_end
 * has passed to Free. Clears the paid period columns; preserves
 * `cancelled_at` so operators can grep the audit trail.
 *
 * NOT scheduled in MVP — operator runs it manually post-launch.
 * Returns the count of rows downgraded.
 */
export async function expireOverdueSubscriptions(): Promise<number> {
  const pool = getDbPool()
  const result = await pool.query(
    `update teacher_subscriptions
        set plan_slug = 'free',
            state = 'active',
            period_start = null,
            period_end = null,
            amount_kopecks = null,
            payment_order_id = null,
            cp_token = null,
            updated_at = now()
      where plan_slug in ('mid', 'pro')
        and period_end is not null
        and period_end < now()`,
  )
  return result.rowCount ?? 0
}

/**
 * Idempotency probe used by the webhook: was this payment_order_id
 * already applied to a teacher_subscriptions row? If yes, the webhook
 * skips the second-write to avoid double-extending the period.
 */
export async function findSubscriptionByPaymentOrderId(
  paymentOrderId: string,
): Promise<TeacherSubscriptionRow | null> {
  const pool = getDbPool()
  const result = await pool.query(
    `select ${COLS}
       from teacher_subscriptions
      where payment_order_id = $1
      limit 1`,
    [paymentOrderId],
  )
  if (result.rows.length === 0) return null
  return rowToSubscription(result.rows[0])
}

/**
 * Catalogue lookup for A2 tariffs. Single source of truth for app-side
 * UI / checkout intent: the rows mirror `teacher_subscription_plans`
 * (mig 0073 + rename mig 0103) but additionally carry UI bullets that
 * the subscription page uses to render the "what's included" block.
 *
 * bug-4 Sub-PR A (2026-06-02): renamed public Russian titles from
 * Mid/Pro to Базовый/Расширенный per owner request. DB slugs unchanged.
 */
export type SubscriptionTariff = {
  tier: TeacherSubscriptionTier
  titleRu: string
  amountKopecks: number
  learnerLimit: number | null
  description: string
  /** UI bullets shown on /teacher/subscription cards + active-state "что входит" block. */
  features: ReadonlyArray<string>
}

export const SAAS_SUBSCRIPTION_TARIFFS: Readonly<Record<TeacherSubscriptionTier, SubscriptionTariff>> = {
  mid: {
    tier: 'mid',
    titleRu: 'Базовый',
    amountKopecks: 30000,
    learnerLimit: 5,
    description:
      'Подписка LevelChannel «Базовый» — кабинет учителя, расписание, до 5 учеников. Период 30 дней.',
    features: [
      'Расписание и слоты',
      'До 5 активных учеников',
      'Пакеты и абонементы',
      'Балансы и долги',
      'Родительский доступ',
    ],
  },
  pro: {
    tier: 'pro',
    titleRu: 'Расширенный',
    amountKopecks: 80000,
    learnerLimit: 30,
    description:
      'Подписка LevelChannel «Расширенный» — кабинет учителя, расписание, до 30 учеников. Период 30 дней.',
    features: [
      'Всё из «Базового»',
      'До 30 активных учеников',
      'Расширенные отчёты',
      'Приоритетная поддержка',
      'Прямые ответы оператора',
    ],
  },
}

export function getSubscriptionTariff(
  tier: string,
): SubscriptionTariff | null {
  if (tier === 'mid' || tier === 'pro') {
    return SAAS_SUBSCRIPTION_TARIFFS[tier]
  }
  return null
}
