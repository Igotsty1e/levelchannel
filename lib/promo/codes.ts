/**
 * PROMO-CODES Sub-PR A — voucher redeem + admin CRUD primitives.
 *
 * Plan: docs/plans/promo-codes-tariffs-2026-06-09.md §2.3.
 *
 * Redeem flow (single TX):
 *   1. pg_advisory_xact_lock(hashtext(code_lower)) — serialize per-code
 *      so max_redemptions cap is race-safe.
 *   2. SELECT promo_codes FOR UPDATE — lock the template row.
 *   3. Gate stack: revoked, not_yet_valid, expired, exhausted,
 *      account_unavailable, email_not_verified, active_paid_subscription,
 *      already_redeemed.
 *   4. UPSERT teacher_subscriptions: insert row OR update existing one
 *      to bumped tier/period.
 *   5. INSERT promo_code_redemptions journal row with PII-truncated IP.
 *   6. UPDATE promo_codes.redemption_count += 1.
 *
 * All errors are typed (RedeemError) — UI maps each reason to a user-
 * friendly Russian copy in /teacher/subscription (Sub-PR C).
 */

import { randomUUID } from 'node:crypto'

import type { PoolClient } from 'pg'

import { truncateIp } from '@/lib/analytics/server'

export type PromoRedeemReason =
  | 'unknown_code'
  | 'revoked'
  | 'not_yet_valid'
  | 'expired'
  | 'exhausted'
  | 'account_unavailable'
  | 'email_not_verified'
  | 'active_paid_subscription'
  | 'already_redeemed'

export class PromoRedeemError extends Error {
  readonly reason: PromoRedeemReason
  readonly meta?: Record<string, unknown>
  constructor(reason: PromoRedeemReason, meta?: Record<string, unknown>) {
    super(`promo/${reason}`)
    this.reason = reason
    this.meta = meta
  }
}

export type RedeemResult = {
  promoCodeId: string
  redemptionId: string
  grantedPlanSlug: string
  grantedDays: number
  grantedUntil: Date
}

type PromoRow = {
  id: string
  code: string
  description: string | null
  grant_plan_slug: string
  grant_days: number
  max_redemptions: number | null
  redemption_count: number
  valid_from: Date
  valid_until: Date | null
  revoked_at: Date | null
  requires_email_verified: boolean
}

type AccountRow = {
  email_verified_at: Date | null
  disabled_at: Date | null
}

type SubscriptionRow = {
  plan_slug: string
  state: 'active' | 'past_due' | 'cancelled' | 'suspended'
  period_end: Date | null
  cancelled_at: Date | null
}

/**
 * Per-Q3 owner decision: reject redeem when the teacher already has an
 * ACTIVE PAID subscription. Active paid = (plan in {mid, pro}) AND state
 * in {active, past_due, cancelled} AND (period_end > now OR period_end
 * is null). The cancelled state still has remaining paid time until
 * period_end (auto-downgrade at expiry per mig 0074), so we block.
 * past_due is technically still paid (grace window), so we block.
 * suspended is operator-disabled — also blocked because the teacher
 * shouldn't be earning free time while suspended.
 */
function isActivePaidSubscription(sub: SubscriptionRow | null, now: Date): boolean {
  if (!sub) return false
  if (!['mid', 'pro'].includes(sub.plan_slug)) return false
  if (sub.state === 'suspended') return true
  if (sub.period_end !== null && sub.period_end <= now) return false
  if (sub.state === 'active') return true
  if (sub.state === 'past_due') return true
  if (sub.state === 'cancelled') return true
  return false
}

export async function redeemPromoCode(
  client: PoolClient,
  args: {
    codeRaw: string
    accountId: string
    ip: string | null
    userAgent: string | null
  },
): Promise<RedeemResult> {
  const code = String(args.codeRaw || '').trim()
  if (!code) throw new PromoRedeemError('unknown_code')

  await client.query('select pg_advisory_xact_lock(hashtext($1::text))', [
    code.toLowerCase(),
  ])

  const codeRes = await client.query<PromoRow>(
    `select id, code, description, grant_plan_slug, grant_days,
            max_redemptions, redemption_count, valid_from, valid_until,
            revoked_at, requires_email_verified
       from promo_codes
      where code = $1::citext
      for update`,
    [code],
  )
  if (codeRes.rows.length === 0) {
    throw new PromoRedeemError('unknown_code')
  }
  const promo = codeRes.rows[0]
  const now = new Date()

  if (promo.revoked_at) throw new PromoRedeemError('revoked')
  if (promo.valid_from > now) throw new PromoRedeemError('not_yet_valid')
  if (promo.valid_until && promo.valid_until <= now) throw new PromoRedeemError('expired')
  if (
    promo.max_redemptions !== null &&
    promo.redemption_count >= promo.max_redemptions
  ) {
    throw new PromoRedeemError('exhausted')
  }

  const accountRes = await client.query<AccountRow>(
    `select email_verified_at, disabled_at
       from accounts
      where id = $1::uuid
      for update`,
    [args.accountId],
  )
  if (accountRes.rows.length === 0 || accountRes.rows[0].disabled_at) {
    throw new PromoRedeemError('account_unavailable')
  }
  if (
    promo.requires_email_verified &&
    !accountRes.rows[0].email_verified_at
  ) {
    throw new PromoRedeemError('email_not_verified')
  }

  const dupRes = await client.query(
    `select 1
       from promo_code_redemptions
      where promo_code_id = $1::uuid and account_id = $2::uuid`,
    [promo.id, args.accountId],
  )
  if (dupRes.rows.length > 0) {
    throw new PromoRedeemError('already_redeemed')
  }

  const subRes = await client.query<SubscriptionRow>(
    `select plan_slug, state, period_end, cancelled_at
       from teacher_subscriptions
      where account_id = $1::uuid
      for update`,
    [args.accountId],
  )
  const currentSub = subRes.rows[0] ?? null
  if (isActivePaidSubscription(currentSub, now)) {
    throw new PromoRedeemError('active_paid_subscription', {
      currentPlan: currentSub?.plan_slug,
      currentState: currentSub?.state,
      periodEnd: currentSub?.period_end?.toISOString() ?? null,
    })
  }

  const grantedUntil = new Date(
    now.getTime() + promo.grant_days * 24 * 60 * 60 * 1000,
  )

  await client.query(
    `insert into teacher_subscriptions
       (account_id, plan_slug, state, period_start, period_end, cancelled_at)
       values ($1::uuid, $2, 'active', $3::timestamptz, $4::timestamptz, null)
       on conflict (account_id) do update
          set plan_slug = excluded.plan_slug,
              state = 'active',
              period_start = excluded.period_start,
              period_end = excluded.period_end,
              cancelled_at = null,
              updated_at = now()`,
    [
      args.accountId,
      promo.grant_plan_slug,
      now.toISOString(),
      grantedUntil.toISOString(),
    ],
  )

  const redemptionId = randomUUID()
  await client.query(
    `insert into promo_code_redemptions
       (id, promo_code_id, account_id, subscription_account_id,
        granted_plan_slug, granted_days, granted_until,
        redeemed_ip_prefix, redeemed_ua)
       values ($1::uuid, $2::uuid, $3::uuid, $3::uuid,
               $4, $5, $6::timestamptz,
               $7::inet, $8)`,
    [
      redemptionId,
      promo.id,
      args.accountId,
      promo.grant_plan_slug,
      promo.grant_days,
      grantedUntil.toISOString(),
      truncateIp(args.ip ?? null),
      args.userAgent ? args.userAgent.slice(0, 512) : null,
    ],
  )

  await client.query(
    `update promo_codes
        set redemption_count = redemption_count + 1
      where id = $1::uuid`,
    [promo.id],
  )

  return {
    promoCodeId: promo.id,
    redemptionId,
    grantedPlanSlug: promo.grant_plan_slug,
    grantedDays: promo.grant_days,
    grantedUntil,
  }
}

export type CreatePromoCodeArgs = {
  code: string
  description: string | null
  grantPlanSlug: string
  grantDays: number
  maxRedemptions: number | null
  validFrom: Date | null
  validUntil: Date | null
  requiresEmailVerified: boolean
  createdByAccountId: string | null
}

export async function createPromoCode(
  client: PoolClient,
  args: CreatePromoCodeArgs,
): Promise<{ id: string }> {
  const code = args.code.trim()
  if (!/^[A-Za-z0-9_-]{3,32}$/.test(code)) {
    throw new Error('promo/code/invalid')
  }
  if (!['free', 'mid', 'pro', 'operator-managed'].includes(args.grantPlanSlug)) {
    throw new Error('promo/grant_plan_slug/invalid')
  }
  if (!(args.grantDays >= 1 && args.grantDays <= 365)) {
    throw new Error('promo/grant_days/out_of_range')
  }
  if (args.maxRedemptions !== null && args.maxRedemptions <= 0) {
    throw new Error('promo/max_redemptions/invalid')
  }
  const res = await client.query<{ id: string }>(
    `insert into promo_codes
       (code, description, grant_plan_slug, grant_days, max_redemptions,
        valid_from, valid_until, requires_email_verified, created_by_account_id)
       values ($1::citext, $2, $3, $4, $5,
               $6::timestamptz, $7::timestamptz, $8, $9::uuid)
       returning id`,
    [
      code,
      args.description ?? null,
      args.grantPlanSlug,
      args.grantDays,
      args.maxRedemptions,
      (args.validFrom ?? new Date()).toISOString(),
      args.validUntil ? args.validUntil.toISOString() : null,
      args.requiresEmailVerified,
      args.createdByAccountId,
    ],
  )
  return { id: res.rows[0].id }
}

export async function revokePromoCode(
  client: PoolClient,
  promoCodeId: string,
  reason: string,
): Promise<void> {
  await client.query(
    `update promo_codes
        set revoked_at = now(),
            revoked_reason = $2
      where id = $1::uuid
        and revoked_at is null`,
    [promoCodeId, reason],
  )
}
