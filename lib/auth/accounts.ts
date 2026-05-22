import { randomUUID } from 'node:crypto'

import { normalizeEmail } from '@/lib/email/normalize'
import { getAuthPool } from '@/lib/auth/pool'

export type Account = {
  id: string
  email: string
  passwordHash: string
  emailVerifiedAt: string | null
  disabledAt: string | null
  scheduledPurgeAt: string | null
  purgedAt: string | null
  // Phase 6+ (1:1 legacy): single teacher binding. SAAS-PIVOT Day 2
  // (2026-05-22) re-purposed this as a BACK-COMPAT ALIAS for
  // `assignedTeacherIds[0] ?? null`. New code should consume
  // `assignedTeacherIds` directly and treat this as a convenience read
  // for the "first active teacher" case. Persisted in
  // accounts.assigned_teacher_id for the dual-write window (mig 0084
  // drops the column post-MVP). See plan §2.5.
  assignedTeacherId: string | null
  // SAAS-PIVOT Day 2 (2026-05-22) — n:m roll-out of teacher links.
  // Sourced from `learner_teacher_links` via
  // `getActiveTeacherIdsForLearner()` at session hydration. Ordered
  // `linked_at asc`. Empty array for learners with no active teacher
  // links. For non-learners (teacher / admin accounts) it's always
  // empty; the field is on the Account type for uniformity, not because
  // teachers ever have peers in `learner_teacher_links`.
  assignedTeacherIds: string[]
  createdAt: string
  updatedAt: string
}

export type AccountRole = 'admin' | 'teacher' | 'student'

// Account-flavoured alias of the project-wide normalizeEmail helper.
// The DB enforces the same invariant via a CHECK constraint (migrations/0010)
// so a bypass surfaces as a constraint violation, not a shadow account.
// See lib/email/normalize.ts for the canonical implementation.
export function normalizeAccountEmail(email: string): string {
  return normalizeEmail(email)
}

function rowToAccount(row: Record<string, unknown>): Account {
  return {
    id: String(row.id),
    email: String(row.email),
    passwordHash: String(row.password_hash),
    emailVerifiedAt: row.email_verified_at
      ? new Date(String(row.email_verified_at)).toISOString()
      : null,
    disabledAt: row.disabled_at
      ? new Date(String(row.disabled_at)).toISOString()
      : null,
    scheduledPurgeAt: row.scheduled_purge_at
      ? new Date(String(row.scheduled_purge_at)).toISOString()
      : null,
    purgedAt: row.purged_at
      ? new Date(String(row.purged_at)).toISOString()
      : null,
    assignedTeacherId: row.assigned_teacher_id
      ? String(row.assigned_teacher_id)
      : null,
    // SAAS-PIVOT Day 2 (2026-05-22) — populated authoritatively at
    // session hydration (lib/auth/sessions.ts) via
    // getActiveTeacherIdsForLearner(). For one-off Account row
    // materializations from getAccountById / getAccountByEmail /
    // listAccounts the n:m array is NOT joined here (those callers do
    // not consume it; adding a join would burn extra Postgres round-
    // trips on every list page). If a non-session caller ever needs
    // the n:m view, call getActiveTeacherIdsForLearner(accountId)
    // explicitly. Default is [].
    assignedTeacherIds: [],
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  }
}

export async function getAccountByEmail(email: string): Promise<Account | null> {
  const pool = getAuthPool()
  const result = await pool.query(
    `select id, email, password_hash, email_verified_at, disabled_at, scheduled_purge_at, purged_at, assigned_teacher_id, created_at, updated_at
     from accounts where email = $1 limit 1`,
    [normalizeAccountEmail(email)],
  )
  return result.rows[0] ? rowToAccount(result.rows[0]) : null
}

// UUID-shape guard. `accounts.id` is a uuid column; passing a non-uuid
// string makes Postgres throw "invalid input syntax for type uuid",
// which surfaces as a 500 to the route + a Sentry error. Bot probes
// of /admin/accounts/:id (literal `:id`) and the four sibling API
// routes that share the same `[id]` segment all hit this. Treat
// shape-invalid input as "not found" — same UX as a real lookup miss.
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function getAccountById(id: string): Promise<Account | null> {
  if (!UUID_PATTERN.test(id)) return null
  const pool = getAuthPool()
  const result = await pool.query(
    `select id, email, password_hash, email_verified_at, disabled_at, scheduled_purge_at, purged_at, assigned_teacher_id, created_at, updated_at
     from accounts where id = $1 limit 1`,
    [id],
  )
  return result.rows[0] ? rowToAccount(result.rows[0]) : null
}

export async function createAccount(params: {
  email: string
  passwordHash: string
}): Promise<Account> {
  const pool = getAuthPool()
  const id = randomUUID()
  const result = await pool.query(
    `insert into accounts (id, email, password_hash) values ($1, $2, $3)
     returning id, email, password_hash, email_verified_at, disabled_at, scheduled_purge_at, purged_at, assigned_teacher_id, created_at, updated_at`,
    [id, normalizeAccountEmail(params.email), params.passwordHash],
  )
  return rowToAccount(result.rows[0])
}

export async function markAccountVerified(accountId: string): Promise<void> {
  const pool = getAuthPool()
  await pool.query(
    `update accounts set email_verified_at = coalesce(email_verified_at, now()), updated_at = now()
     where id = $1`,
    [accountId],
  )
}

export async function setAccountPassword(
  accountId: string,
  passwordHash: string,
): Promise<void> {
  const pool = getAuthPool()
  await pool.query(
    `update accounts set password_hash = $2, updated_at = now() where id = $1`,
    [accountId, passwordHash],
  )
}

export type AccountListPage = {
  accounts: Account[]
  total: number
}

// Operator-side listing for /admin/accounts. Paginated by 50, optional
// case-insensitive partial e-mail search. Hides nothing — even purged
// rows are visible (the placeholder `deleted-<uuid>@example.invalid`
// makes them obvious without exposing the original e-mail).
export async function listAccounts(params: {
  search?: string
  limit?: number
  offset?: number
}): Promise<AccountListPage> {
  const pool = getAuthPool()
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200)
  const offset = Math.max(params.offset ?? 0, 0)
  const search = params.search?.trim() || ''
  const like = `%${search.toLowerCase()}%`

  const where = search ? `where lower(email) like $1` : ''
  const args: (string | number)[] = []
  if (search) args.push(like)
  args.push(limit, offset)

  const limitArg = `$${args.length - 1}`
  const offsetArg = `$${args.length}`

  const rowsResult = await pool.query(
    `select id, email, password_hash, email_verified_at, disabled_at,
            scheduled_purge_at, purged_at, assigned_teacher_id,
            created_at, updated_at
     from accounts
     ${where}
     order by created_at desc
     limit ${limitArg} offset ${offsetArg}`,
    args,
  )
  const countResult = await pool.query(
    `select count(*)::int as n from accounts ${where}`,
    search ? [like] : [],
  )
  return {
    accounts: rowsResult.rows.map(rowToAccount),
    total: Number(countResult.rows[0]?.n ?? 0),
  }
}

// Operator-side: list every account holding a given role. Used by
// /admin/slots to populate the teacher picker. Sorted by e-mail asc
// for predictable dropdown order.
export async function listAccountsByRole(
  role: AccountRole,
): Promise<Array<{ id: string; email: string }>> {
  const pool = getAuthPool()
  const result = await pool.query(
    `select a.id, a.email
       from accounts a
       join account_roles r on r.account_id = a.id
      where r.role = $1
        and a.purged_at is null
      order by a.email asc`,
    [role],
  )
  return result.rows.map((r) => ({
    id: String(r.id),
    email: String(r.email),
  }))
}

// Operator-side: list accounts that could be booked into a slot —
// verified, not disabled, not scheduled-for-purge, not purged,
// NOT holding admin/teacher roles. Used by the /admin/slots booking
// dropdown so the operator picks an existing learner instead of
// typing the e-mail by hand.
//
// PKG-RECON RECON.0: the WHERE-clause shape was extracted into
// LEARNER_ARCHETYPE_CANDIDATE_WHERE_SQL in lib/auth/learner-archetype.ts
// as the single source of truth. Same predicate is now ALSO consumed
// via isLearnerArchetypeCandidate(accountId) by the admin
// attach-account recon route. Adding scheduled_purge_at to the
// canonical predicate intentionally tightens THIS list too —
// previously a learner in the deletion grace period could still be
// picked from the dropdown; now they cannot.
export async function listLearnerCandidates(): Promise<
  Array<{ id: string; email: string }>
> {
  const { LEARNER_ARCHETYPE_CANDIDATE_WHERE_SQL } = await import(
    '@/lib/auth/learner-archetype'
  )
  const pool = getAuthPool()
  const result = await pool.query(
    `select a.id, a.email
       from accounts a
      where ${LEARNER_ARCHETYPE_CANDIDATE_WHERE_SQL}
      order by a.email asc`,
  )
  return result.rows.map((r) => ({
    id: String(r.id),
    email: String(r.email),
  }))
}

// Bulk-load roles for a set of accounts. Used by /admin/accounts list
// view to render a Роли column without an N+1 query.
export async function listRolesForAccounts(
  accountIds: string[],
): Promise<Map<string, AccountRole[]>> {
  const out = new Map<string, AccountRole[]>()
  if (accountIds.length === 0) return out
  const pool = getAuthPool()
  const result = await pool.query(
    `select account_id, role
       from account_roles
      where account_id = any($1)
      order by role asc`,
    [accountIds],
  )
  for (const row of result.rows) {
    const id = String(row.account_id)
    const role = String(row.role) as AccountRole
    const list = out.get(id) ?? []
    list.push(role)
    out.set(id, list)
  }
  return out
}

export async function listAccountRoles(accountId: string): Promise<AccountRole[]> {
  const pool = getAuthPool()
  const result = await pool.query(
    `select role from account_roles where account_id = $1 order by role asc`,
    [accountId],
  )
  return result.rows.map((r) => String(r.role) as AccountRole)
}

// Role exclusivity: an account is either an `admin` (operator-only,
// no learning workflow) OR a `teacher` / `student` (consumer side).
// The two trust boundaries don't overlap — granting one strips the
// other. This prevents the "operator is also their own teacher" mess
// that came up in manual testing 2026-05-04.
//
// Admin grants:
//   - revoke teacher / student first, then insert admin
// Teacher / student grants:
//   - refuse if account already holds admin (operator must lose
//     admin first; we don't silently demote them)
const ADMIN_ROLE: AccountRole = 'admin'
const CONSUMER_ROLES: AccountRole[] = ['teacher', 'student']

export async function grantAccountRole(
  accountId: string,
  role: AccountRole,
  grantedByAccountId: string | null,
): Promise<void> {
  const pool = getAuthPool()
  if (role === ADMIN_ROLE) {
    // Strip any consumer roles; they're mutually exclusive.
    await pool.query(
      `delete from account_roles
        where account_id = $1
          and role = any($2::text[])`,
      [accountId, CONSUMER_ROLES],
    )
  } else if (CONSUMER_ROLES.includes(role)) {
    // Refuse if admin is held — operator must explicitly revoke
    // admin first, otherwise we'd silently demote them.
    const existing = await pool.query(
      `select 1 from account_roles where account_id = $1 and role = $2`,
      [accountId, ADMIN_ROLE],
    )
    if (existing.rows.length > 0) {
      throw new Error('role/admin_exclusive')
    }
  }
  await pool.query(
    `insert into account_roles (account_id, role, granted_by_account_id)
     values ($1, $2, $3)
     on conflict (account_id, role) do nothing`,
    [accountId, role, grantedByAccountId],
  )
}

export async function revokeAccountRole(
  accountId: string,
  role: AccountRole,
): Promise<void> {
  const pool = getAuthPool()
  await pool.query(
    `delete from account_roles where account_id = $1 and role = $2`,
    [accountId, role],
  )
}

// Disables an account without scheduling its eventual data purge.
// Used by:
//   - the consent-withdrawal flow (152-ФЗ art.9 §5: stop processing
//     PD; data may stay on file under legitimate-interest grounds)
//   - the operator-side disable toggle in /admin
// Distinct from `requestAccountDeletion` which ALSO sets
// scheduled_purge_at to drive the 30-day anonymization timer.
export async function disableAccount(accountId: string): Promise<void> {
  const pool = getAuthPool()
  await pool.query(
    `update accounts
        set disabled_at = coalesce(disabled_at, now()),
            updated_at = now()
      where id = $1`,
    [accountId],
  )
}

export async function reenableAccount(accountId: string): Promise<void> {
  const pool = getAuthPool()
  await pool.query(
    `update accounts
        set disabled_at = null,
            scheduled_purge_at = null,
            updated_at = now()
      where id = $1
        and purged_at is null`,
    [accountId],
  )
}

// Phase 6+: assign / unassign a learner to a teacher account.
// Operator-side; admin /admin/accounts/[id] is the only call site.
//
// We do NOT enforce that the teacher account holds the `teacher` role
// at this layer — that's a UX guard in the admin UI (the dropdown
// only lists teacher-role accounts). The DB just stores a uuid FK.
// Pass null to unassign.
// Codex 2026-05-08 (MEDIUM-LOW) — verify the target actually has the
// `teacher` role before assigning. Pre-fix, the admin route only
// shape-validated the UUID; an admin could mistakenly point a learner
// at a non-teacher account, breaking downstream authorisation
// assumptions. Throwing here keeps the admin route's caller-side
// audit clean and the error message precise.
export class AssignedTeacherRoleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AssignedTeacherRoleError'
  }
}

export async function setAssignedTeacher(
  learnerId: string,
  teacherId: string | null,
): Promise<void> {
  if (teacherId !== null) {
    const roles = await listAccountRoles(teacherId)
    if (!roles.includes('teacher')) {
      throw new AssignedTeacherRoleError(
        `Account ${teacherId} does not have the 'teacher' role; refusing to assign as a learner's teacher.`,
      )
    }
  }
  const pool = getAuthPool()
  // SAAS-PIVOT Day 2 (2026-05-22) — dual-write: legacy
  // accounts.assigned_teacher_id AND new learner_teacher_links table
  // (plan §2.5). The pivot makes learner_teacher_links the canonical
  // truth at the reader layer; the legacy column stays through MVP for
  // the back-compat alias (mig 0084 post-MVP).
  //
  // Race-safety: this writer is the operator-mutation surface
  // (admin /accounts/[id] reassign). The invite-redeem path uses a
  // distinct atomic-CTE writer in lib/auth/teacher-invites.ts; both
  // ultimately INSERT into learner_teacher_links with ON CONFLICT
  // semantics, so concurrent redeem + manual reassign cannot create
  // duplicate (learner, teacher) rows (PK enforces uniqueness).
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query(
      `update accounts
          set assigned_teacher_id = $2,
              updated_at = now()
        where id = $1
          and purged_at is null`,
      [learnerId, teacherId],
    )
    if (teacherId === null) {
      // Unassign: soft-unlink ALL active links for this learner. This
      // matches the legacy "reset to null" semantics — an operator
      // clearing the assigned teacher should also tear down the n:m
      // active set, not just the alias.
      await client.query(
        `update learner_teacher_links
            set unlinked_at = coalesce(unlinked_at, now())
          where learner_account_id = $1
            and unlinked_at is null`,
        [learnerId],
      )
    } else {
      // Assign: SAAS-PIVOT Day 2 round-1 BLOCKER #1 closure (codex
      // paranoia 2026-05-22) — this writer is the operator-mutation
      // surface (admin /accounts/[id] teacher-reassignment). The admin
      // UI + the surrounding semantics are SINGLE-teacher: when an
      // operator picks "teacher B" the intent is to MOVE the learner
      // from their previous teacher to B, not to add B as a parallel
      // link. Without an explicit soft-unlink of the previous active
      // link, the legacy single-assign UI silently drifts learners
      // into multi-link state and routes start returning 400
      // needs_teacher_picker.
      //
      // Step 1: soft-unlink every active link to a teacher OTHER than
      // the target. Step 2: INSERT-or-revive the target link. Same
      // TX, same client — no torn state visible to a reader.
      //
      // The invite-redeem path (lib/auth/teacher-invites.ts) does NOT
      // call this helper — that path INSERTs a parallel link via its
      // own writable CTE per plan Q-7 (a learner with one teacher can
      // redeem a second teacher's invite and end up multi-link). The
      // single-teacher semantics here are SPECIFIC to the operator
      // reassignment route; the n:m model is preserved at the schema
      // layer + via redeems.
      await client.query(
        `update learner_teacher_links
            set unlinked_at = coalesce(unlinked_at, now())
          where learner_account_id = $1
            and teacher_account_id <> $2
            and unlinked_at is null`,
        [learnerId, teacherId],
      )
      // INSERT-or-revive the target. PK on (learner, teacher) means a
      // historic unlink is re-armed via DO UPDATE; ON CONFLICT also
      // covers the dedupe case where redeem-CTE already inserted the
      // row.
      await client.query(
        `insert into learner_teacher_links (learner_account_id, teacher_account_id, linked_at, unlinked_at)
           values ($1, $2, now(), null)
         on conflict (learner_account_id, teacher_account_id) do update
           set unlinked_at = null,
               linked_at = case
                 when learner_teacher_links.unlinked_at is not null then excluded.linked_at
                 else learner_teacher_links.linked_at
               end`,
        [learnerId, teacherId],
      )
    }
    await client.query('commit')
  } catch (err) {
    await client.query('rollback').catch(() => undefined)
    throw err
  } finally {
    client.release()
  }
}

// Phase 3 deletion grace: stamps both disabled_at and
// scheduled_purge_at. The retention job (scripts/db-retention-cleanup.mjs)
// finds rows where scheduled_purge_at <= now() AND purged_at IS NULL
// and anonymizes them. Idempotent: re-requesting deletion before the
// purge fires advances the scheduled date forward.
export async function requestAccountDeletion(
  accountId: string,
  graceDays = 30,
): Promise<void> {
  const pool = getAuthPool()
  await pool.query(
    `update accounts
        set disabled_at = coalesce(disabled_at, now()),
            scheduled_purge_at = now() + make_interval(days => $2),
            updated_at = now()
      where id = $1
        and purged_at is null`,
    [accountId, graceDays],
  )
}

// Cancellation during the 30-day grace: clears disabled_at AND
// scheduled_purge_at. Only valid before purged_at is stamped.
export async function cancelAccountDeletion(accountId: string): Promise<void> {
  const pool = getAuthPool()
  await pool.query(
    `update accounts
        set disabled_at = null,
            scheduled_purge_at = null,
            updated_at = now()
      where id = $1
        and purged_at is null`,
    [accountId],
  )
}
