import { describe, expect, it } from 'vitest'

import { getDbPool } from '@/lib/db/pool'

import '../setup'

// bug-4 Sub-PR A (2026-06-02) — pin the post-mig-0103 Russian title_ru
// on teacher_subscription_plans.
//
// Slugs stay canonical (free / mid / pro / operator-managed); only the
// public Russian title_ru changed:
//   free  → 'Стартовый'   (was 'Free')
//   mid   → 'Базовый'     (was 'Mid')
//   pro   → 'Расширенный' (was 'Pro')
//   operator-managed     — UNCHANGED ('Operator-managed')
//
// The integration setup re-seeds these rows on every test (TRUNCATE
// CASCADE + INSERT … ON CONFLICT DO NOTHING with the new title_ru).
// Mig 0103 is the production path; this test pins the contract so a
// future hand-edit of the seed (or the mig) can't silently drift.

describe('bug-4 Sub-PR A — teacher_subscription_plans Russian titles (mig 0103)', () => {
  it('exposes the renamed public titles for free / mid / pro', async () => {
    const result = await getDbPool().query<{ slug: string; title_ru: string }>(
      `select slug, title_ru
         from teacher_subscription_plans
        where slug in ('free', 'mid', 'pro')
        order by slug`,
    )
    const map = new Map(result.rows.map((r) => [r.slug, r.title_ru]))
    expect(map.get('free')).toBe('Стартовый')
    expect(map.get('mid')).toBe('Базовый')
    expect(map.get('pro')).toBe('Расширенный')
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
    // Defensive: if a partial rename slipped past in the future, this
    // catches the regression on a deterministic state.
    expect(titles).not.toContain('Free')
    expect(titles).not.toContain('Mid')
    expect(titles).not.toContain('Pro')
  })

  it('mig 0103 is idempotent — re-running the rename leaves the same state', async () => {
    // Inline-run the same SQL the migration uses. If it ever flips a
    // row twice or trips on the IS DISTINCT FROM guard, this test
    // catches it. We don't truncate first: this is purely an
    // idempotency test against current state.
    const pool = getDbPool()
    await pool.query(
      `update teacher_subscription_plans
          set title_ru = 'Стартовый',
              updated_at = now()
        where slug = 'free'
          and title_ru is distinct from 'Стартовый'`,
    )
    await pool.query(
      `update teacher_subscription_plans
          set title_ru = 'Базовый',
              updated_at = now()
        where slug = 'mid'
          and title_ru is distinct from 'Базовый'`,
    )
    await pool.query(
      `update teacher_subscription_plans
          set title_ru = 'Расширенный',
              updated_at = now()
        where slug = 'pro'
          and title_ru is distinct from 'Расширенный'`,
    )
    const result = await pool.query<{ slug: string; title_ru: string }>(
      `select slug, title_ru
         from teacher_subscription_plans
        where slug in ('free', 'mid', 'pro')
        order by slug`,
    )
    const map = new Map(result.rows.map((r) => [r.slug, r.title_ru]))
    expect(map.get('free')).toBe('Стартовый')
    expect(map.get('mid')).toBe('Базовый')
    expect(map.get('pro')).toBe('Расширенный')
  })
})
