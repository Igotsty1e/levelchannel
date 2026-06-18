// Server helper for the `teacher-invite-plan-limit-banner` onboarding
// hint (spec §1.1 `teacher-invite-plan-limit-banner`).
//
// Returns the teacher's active-learner count + plan-side learner limit
// so the cabinet UI can render a soft/hard-limit banner above the
// invite list:
//   - allowed: render the banner row.
//   - mode='soft' when M ≥ ceil(0.8 * N).
//   - mode='hard' when M = N (button disabled at the client side).
//
// `limit === null` → unlimited tier (plan-4 / operator-managed). UI
// hides the banner entirely.

import { getDbPool } from '@/lib/db/pool'

export type TeacherPlanLearnerLimit =
  | { kind: 'unlimited' }
  | {
      kind: 'limited'
      activeCount: number
      limit: number
      planSlug: string
      planTitleRu: string
    }

export async function getTeacherPlanLearnerLimit(
  teacherAccountId: string,
): Promise<TeacherPlanLearnerLimit> {
  const pool = getDbPool()
  // Resolve the teacher's current plan. No active subscription row →
  // free tier baseline (the operator UX guarantees every teacher has
  // at least an entry; defensive default keeps the banner sane).
  const planRow = await pool.query<{
    plan_slug: string
    plan_title: string | null
    learner_limit: number | null
  }>(
    `select
        ts.plan_slug,
        p.title_ru as plan_title,
        p.learner_limit
       from teacher_subscriptions ts
       left join teacher_subscription_plans p on p.slug = ts.plan_slug
      where ts.account_id = $1::uuid
        and ts.state = 'active'
      limit 1`,
    [teacherAccountId],
  )
  let plan = planRow.rows[0]
  if (!plan) {
    // No active subscription — fall back to the 'free' plan baseline
    // by reading the canonical plan row directly. This keeps the
    // banner sane for teachers in the pre-subscription window.
    const freeRow = await pool.query<{
      title_ru: string
      learner_limit: number | null
    }>(
      `select title_ru, learner_limit
         from teacher_subscription_plans
        where slug = 'free'
        limit 1`,
    )
    const free = freeRow.rows[0]
    plan = {
      plan_slug: 'free',
      plan_title: free?.title_ru ?? 'Стартовый',
      // A.1 tariff reprice (2026-06-18): free fallback limit поднят 1→3.
      learner_limit: free?.learner_limit ?? 3,
    }
  }
  const planSlug = plan.plan_slug
  const planTitleRu = plan.plan_title ?? 'Стартовый'
  const learnerLimit = plan.learner_limit
  if (learnerLimit === null) {
    return { kind: 'unlimited' }
  }
  // Active linked learners — same predicate the
  // `learner_teacher_links` table uses for n:m membership.
  const countRow = await pool.query<{ count: string }>(
    `select count(*)::text as count
       from learner_teacher_links
      where teacher_account_id = $1::uuid
        and unlinked_at is null`,
    [teacherAccountId],
  )
  const activeCount = Number.parseInt(countRow.rows[0]?.count ?? '0', 10) || 0
  return {
    kind: 'limited',
    activeCount,
    limit: learnerLimit,
    planSlug,
    planTitleRu,
  }
}
