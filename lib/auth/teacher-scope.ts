// SAAS-PIVOT Epic 1 Day 2 — current-teacher context helper.
//
// Plan: docs/plans/saas-pivot-master.md §2.5 (current-teacher context
// contract) + §5 Day 2.
//
// Today every read-site that decides "whose roster to show this
// learner" calls `session.account.assignedTeacherId` (single-value).
// The SaaS-pivot promotes that to n:m via `learner_teacher_links`. This
// module is the single source of truth for the new context lookup.
//
// Three semantics (per §2.5):
//   - "the active teacher" — `getActiveTeacherForLearner(accountId)`:
//     - (a) single link → that teacher's id
//     - (b) multiple links → null + `needsPicker: true`
//     - (c) zero links → null + `needsPicker: false`
//   - "any teacher" (admin reads) — out of scope here; admin routes
//     simply skip the helper and read with no teacher filter.
//   - "specific teacher" (cabinet drill-down) — caller passes
//     `teacher_id` from URL, validated against the link set via
//     `getActiveTeacherIdsForLearner()`.
//
// Active link predicate: `unlinked_at IS NULL`. The PK on the table is
// `(learner_account_id, teacher_account_id)` — at most one row per
// pair — so the dedupe vs `assigned_teacher_id` dual-write happens at
// INSERT time (ON CONFLICT DO UPDATE SET unlinked_at = NULL) rather
// than in the reader. Order: `linked_at asc` keeps the back-compat
// alias deterministic (first teacher = oldest active link).

import { getAuthPool } from '@/lib/auth/pool'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type ActiveTeacherResolution = {
  /**
   * The single active teacher's account_id if exactly one active link
   * exists, otherwise null. Routes that need a forced single-value
   * answer (booking, calendar) should use this AND surface a 400
   * `needs_teacher_picker` when `needsPicker` is true so the client
   * can render a teacher chooser.
   */
  teacherId: string | null
  /**
   * True when the learner has >= 2 active links. Caller must accept
   * `?teacher=<id>` and validate it via getActiveTeacherIdsForLearner.
   */
  needsPicker: boolean
}

/**
 * Resolve the learner's active teacher for surfaces that historically
 * consumed a single value (`session.account.assignedTeacherId`).
 *
 * Returns `{ teacherId: null, needsPicker: false }` when:
 *   - the input is malformed (non-UUID — defensive)
 *   - the learner has zero active links
 * Returns `{ teacherId: null, needsPicker: true }` when the learner has
 * multiple active links — caller is responsible for surfacing the
 * disambiguation error to the client.
 */
export async function getActiveTeacherForLearner(
  learnerAccountId: string,
): Promise<ActiveTeacherResolution> {
  if (!UUID_PATTERN.test(learnerAccountId)) {
    return { teacherId: null, needsPicker: false }
  }
  const pool = getAuthPool()
  const result = await pool.query<{ teacher_account_id: string }>(
    `select teacher_account_id
       from learner_teacher_links
      where learner_account_id = $1
        and unlinked_at is null
      order by linked_at asc, teacher_account_id asc
      limit 2`,
    [learnerAccountId],
  )
  if (result.rows.length === 0) {
    return { teacherId: null, needsPicker: false }
  }
  if (result.rows.length === 1) {
    return { teacherId: String(result.rows[0].teacher_account_id), needsPicker: false }
  }
  // >= 2 rows; the LIMIT 2 above is enough to discriminate the two
  // cases. needsPicker = true.
  return { teacherId: null, needsPicker: true }
}

/**
 * Array variant used by session hydration (so the cached
 * `assignedTeacherIds: string[]` carries every link, not just the
 * first). Ordered by `linked_at asc` so the back-compat alias
 * `assignedTeacherIds[0]` is stable across reads.
 */
export async function getActiveTeacherIdsForLearner(
  learnerAccountId: string,
): Promise<string[]> {
  if (!UUID_PATTERN.test(learnerAccountId)) {
    return []
  }
  const pool = getAuthPool()
  const result = await pool.query<{ teacher_account_id: string }>(
    `select teacher_account_id
       from learner_teacher_links
      where learner_account_id = $1
        and unlinked_at is null
      order by linked_at asc, teacher_account_id asc`,
    [learnerAccountId],
  )
  return result.rows.map((r) => String(r.teacher_account_id))
}
