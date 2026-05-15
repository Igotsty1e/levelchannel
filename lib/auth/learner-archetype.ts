// PKG-RECON wave RECON.0 — canonical learner-archetype predicate.
//
// Single source of truth for "is this account a valid learner-side
// target?" replacing the prior split between
// `lib/auth/accounts.ts:listLearnerCandidates` (paginated SQL) and
// `lib/auth/guards.ts:requireLearnerArchetype*` (request-time guard).
//
// Excluded conditions (account fails predicate when ANY holds):
//   - email_verified_at IS NULL    (unverified email)
//   - disabled_at IS NOT NULL      (manual disable)
//   - scheduled_purge_at IS NOT NULL (deletion grace period running;
//                                     anonymizer will fire)
//   - purged_at IS NOT NULL        (already anonymised)
//   - holds `admin` role grant     (admin/learner mutual exclusion
//                                   per the 2026-05-04 separation)
//   - holds `teacher` role grant   (operator separation; teachers
//                                   book through /teacher routes)
//
// scheduled_purge_at addition (round 1 BLOCKER #6 / round 2 WARN #6
// closure): the existing consumers omitted this column. RECON.0
// adds it to the canonical predicate so BOTH consumers gain the
// tighter check automatically.

import { getAuthPool } from '@/lib/auth/pool'

// SQL fragment for INTERPOLATION into a SELECT WHERE clause.
// Caller must alias the accounts table as `a` and bring its own
// accounts row into scope. NO trailing AND/OR; caller chains.
//
// This fragment + the isLearnerArchetypeCandidate function below
// MUST stay logically identical — drift is the bug-class this
// shared module exists to prevent. The drift test at
// tests/integration/auth/learner-archetype-predicate.test.ts pins
// both consumers to the same set of excluded conditions.
export const LEARNER_ARCHETYPE_CANDIDATE_WHERE_SQL = `
  a.email_verified_at is not null
  and a.disabled_at is null
  and a.scheduled_purge_at is null
  and a.purged_at is null
  and not exists (
    select 1 from account_roles r
     where r.account_id = a.id and r.role in ('admin', 'teacher')
  )
`

// Single-account predicate. Returns true iff the account is a valid
// learner-archetype TARGET (e.g. the operator picking a target for
// admin attach-account on /admin/reconciliation/package-grants).
//
// NOT a guard — does not consume a Request. Use
// `requireLearnerArchetype*` in `lib/auth/guards.ts` for request-time
// auth checks (those guards still check the request's OWN account,
// not an arbitrary target).
export async function isLearnerArchetypeCandidate(
  accountId: string,
): Promise<boolean> {
  const pool = getAuthPool()
  const result = await pool.query(
    `select 1
       from accounts a
      where a.id = $1
        and ${LEARNER_ARCHETYPE_CANDIDATE_WHERE_SQL}
      limit 1`,
    [accountId],
  )
  return result.rows.length > 0
}
