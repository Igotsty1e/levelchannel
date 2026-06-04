// Server helper for `learner-first-cabinet-tour-3steps` per spec §1.2.
// Returns a single boolean: should the welcome tour render on the
// learner's /cabinet home this request?
//
// Trigger contract:
//   1. The learner has at least one active teacher link
//      (`learner_teacher_links.unlinked_at IS NULL`).
//   2. The learner has 0 completed lessons (`lesson_completions` row
//      count = 0).
//   3. The learner has not dismissed the hint
//      (`dismissed_hints.learner_cabinet_tour` IS undefined).

import { getDbPool } from '@/lib/db/pool'
import { getOnboardingState } from '@/lib/onboarding/state'

export async function shouldShowLearnerCabinetTour(
  learnerAccountId: string,
): Promise<boolean> {
  const pool = getDbPool()
  const [linkRow, completionRow, state] = await Promise.all([
    pool.query<{ exists: boolean }>(
      `select exists(
         select 1 from learner_teacher_links
          where learner_account_id = $1::uuid
            and unlinked_at is null
       ) as exists`,
      [learnerAccountId],
    ),
    pool.query<{ exists: boolean }>(
      // lesson_completions has no learner_account_id column directly —
      // join through lesson_slots to find completions where the
      // learner was the booked party. mig 0092 + lesson_slots.learner_account_id.
      `select exists(
         select 1 from lesson_completions lc
           join lesson_slots ls on ls.id = lc.slot_id
          where ls.learner_account_id = $1::uuid
       ) as exists`,
      [learnerAccountId],
    ),
    getOnboardingState(learnerAccountId),
  ])
  const hasTeacher = Boolean(linkRow.rows[0]?.exists)
  const hasCompletion = Boolean(completionRow.rows[0]?.exists)
  const dismissed = 'learner_cabinet_tour' in state.dismissedHints
  return hasTeacher && !hasCompletion && !dismissed
}
