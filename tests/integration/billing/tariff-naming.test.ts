import { describe, expect, it } from 'vitest'

import { getDbPool } from '@/lib/db/pool'

import '../setup'

// A.1 tariff reprice (2026-06-18) — pin the post-mig-0134 Russian title_ru
// + price + learner_limit on teacher_subscription_plans.
//
// History:
//   - bug-4 Sub-PR A (2026-06-02, mig 0103): English → Русский titles.
//   - A.1 reprice (mig 0134, 2026-06-18): free учеников 1→3,
//     mid 'Базовый'/300/5 → 'Оптимальный'/399/null, pro оставлен как
//     legacy operator-managed.

describe('A.1 reprice — teacher_subscription_plans post-mig-0134', () => {
  it('exposes Стартовый (3 ученика) + Оптимальный (399 ₽ без лимита) + Pro legacy', async () => {
    const result = await getDbPool().query<{
      slug: string
      title_ru: string
      price_kopecks_monthly: number
      learner_limit: number | null
    }>(
      `select slug, title_ru, price_kopecks_monthly, learner_limit
         from teacher_subscription_plans
        where slug in ('free', 'mid', 'pro')
        order by slug`,
    )
    const map = new Map(
      result.rows.map((r) => [
        r.slug,
        {
          title: r.title_ru,
          price: r.price_kopecks_monthly,
          limit: r.learner_limit,
        },
      ]),
    )
    expect(map.get('free')).toEqual({ title: 'Стартовый', price: 0, limit: 3 })
    expect(map.get('mid')).toEqual({
      title: 'Оптимальный',
      price: 39900,
      limit: null,
    })
    // Pro DB row unchanged — legacy operator-managed flow.
    expect(map.get('pro')).toEqual({
      title: 'Расширенный',
      price: 80000,
      limit: 30,
    })
  })

  it('leaves the operator-managed admin-only label unchanged', async () => {
    const result = await getDbPool().query<{ title_ru: string }>(
      `select title_ru
         from teacher_subscription_plans
        where slug = 'operator-managed'`,
    )
    expect(result.rowCount).toBe(1)
    expect(result.rows[0]?.title_ru).toBe('Operator-managed')
  })

  it('does NOT leak the old English titles on any plan slug', async () => {
    const result = await getDbPool().query<{ title_ru: string }>(
      `select title_ru
         from teacher_subscription_plans
        where slug in ('free', 'mid', 'pro')`,
    )
    const titles = result.rows.map((r) => r.title_ru)
    expect(titles).not.toContain('Free')
    expect(titles).not.toContain('Mid')
    expect(titles).not.toContain('Pro')
  })

  it('mig 0134 is idempotent — re-running the UPDATE leaves the same state', async () => {
    const pool = getDbPool()
    // Inline-run mig 0134 logic (conditional UPDATE).
    await pool.query(
      `update teacher_subscription_plans
          set learner_limit = 3
        where slug = 'free'
          and learner_limit = 1`,
    )
    await pool.query(
      `update teacher_subscription_plans
          set title_ru = 'Оптимальный',
              price_kopecks_monthly = 39900,
              learner_limit = null
        where slug = 'mid'
          and title_ru = 'Mid'
          and price_kopecks_monthly = 30000
          and learner_limit = 5`,
    )
    const result = await pool.query<{
      slug: string
      title_ru: string
      price_kopecks_monthly: number
      learner_limit: number | null
    }>(
      `select slug, title_ru, price_kopecks_monthly, learner_limit
         from teacher_subscription_plans
        where slug in ('free', 'mid')
        order by slug`,
    )
    const map = new Map(
      result.rows.map((r) => [
        r.slug,
        {
          title: r.title_ru,
          price: r.price_kopecks_monthly,
          limit: r.learner_limit,
        },
      ]),
    )
    expect(map.get('free')).toEqual({ title: 'Стартовый', price: 0, limit: 3 })
    expect(map.get('mid')).toEqual({
      title: 'Оптимальный',
      price: 39900,
      limit: null,
    })
  })
})
