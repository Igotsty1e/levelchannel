import { randomUUID } from 'node:crypto'

import { getAuthPool } from '@/lib/auth/pool'

export type Account = {
  id: string
  email: string
  passwordHash: string
  emailVerifiedAt: string | null
  disabledAt: string | null
  scheduledPurgeAt: string | null
  purgedAt: string | null
  // Phase 6+: 1:1 binding to a teacher account. Cabinet uses this to
  // filter open slots so a learner only sees their teacher's
  // availability. Null = no teacher assigned yet (cabinet renders a
  // "обратитесь к оператору" hint).
  assignedTeacherId: string | null
  createdAt: string
  updatedAt: string
}

export type AccountRole = 'admin' | 'teacher' | 'student'

// Single source of truth for the canonical email shape stored in accounts.
// trim() catches the trailing-space class of duplicates (`user@example.com `
// vs `user@example.com`). lower-case handles the standard variant. Every
// read and every write goes through this helper. The DB enforces the same
// invariant via a CHECK constraint (migrations/0010) so a bypass surfaces
// as a constraint violation, not a shadow account.
export function normalizeAccountEmail(email: string): string {
  return email.trim().toLowerCase()
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

export async function getAccountById(id: string): Promise<Account | null> {
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
// verified, not disabled, not purged, NOT holding the admin role
// (admin is mutually exclusive with the learner workflow per the
// 2026-05-04 separation). Used by the /admin/slots booking dropdown
// so the operator picks an existing learner instead of typing the
// e-mail by hand.
export async function listLearnerCandidates(): Promise<
  Array<{ id: string; email: string }>
> {
  const pool = getAuthPool()
  const result = await pool.query(
    `select a.id, a.email
       from accounts a
      where a.email_verified_at is not null
        and a.disabled_at is null
        and a.purged_at is null
        and not exists (
          select 1 from account_roles r
           where r.account_id = a.id and r.role = 'admin'
        )
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
export async function setAssignedTeacher(
  learnerId: string,
  teacherId: string | null,
): Promise<void> {
  const pool = getAuthPool()
  await pool.query(
    `update accounts
        set assigned_teacher_id = $2,
            updated_at = now()
      where id = $1
        and purged_at is null`,
    [learnerId, teacherId],
  )
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
