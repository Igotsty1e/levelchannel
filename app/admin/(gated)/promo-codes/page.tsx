import { getDbPool } from '@/lib/db/pool'

import { PromoCodesEditor } from './promo-codes-editor'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type PromoCodeRow = {
  id: string
  code: string
  description: string | null
  grant_plan_slug: string
  grant_days: number
  max_redemptions: number | null
  redemption_count: number
  valid_from: Date
  valid_until: Date | null
  created_at: Date
  revoked_at: Date | null
}

export default async function AdminPromoCodesPage() {
  const pool = getDbPool()
  const result = await pool.query<PromoCodeRow>(
    `select id, code, description, grant_plan_slug, grant_days,
            max_redemptions, redemption_count,
            valid_from, valid_until, created_at, revoked_at
       from promo_codes
      order by created_at desc
      limit 200`,
  )
  return (
    <>
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 8 }}>Промокоды</h1>
      <p style={{ color: 'var(--secondary)', fontSize: 13, marginBottom: 20, lineHeight: 1.6 }}>
        Вауч-коды для запуска LAUNCH3 и партнёрских кампаний. Активация даёт учителю N дней
        выбранного тарифа. Один аккаунт = одно использование одного кода.
        Активная платная подписка блокирует редем — учитель получит понятную ошибку.
      </p>
      <PromoCodesEditor
        initial={result.rows.map((r) => ({
          id: r.id,
          code: r.code,
          description: r.description,
          grantPlanSlug: r.grant_plan_slug,
          grantDays: r.grant_days,
          maxRedemptions: r.max_redemptions,
          redemptionCount: r.redemption_count,
          validFrom: r.valid_from.toISOString(),
          validUntil: r.valid_until ? r.valid_until.toISOString() : null,
          createdAt: r.created_at.toISOString(),
          revokedAt: r.revoked_at ? r.revoked_at.toISOString() : null,
        }))}
      />
    </>
  )
}
