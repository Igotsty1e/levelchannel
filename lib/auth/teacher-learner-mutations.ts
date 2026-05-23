// SAAS-PIVOT — teacher renames their linked learner.
//
// Plan: owner-requested 2026-05-23. One-PR feature.
//
// This helper is the SINGLE authoritative entry point for teachers
// renaming a learner's `display_name` and/or `email`. Anti-spoof lives
// HERE (not in the route layer) so any future call site (CLI script,
// admin tool, retry job) inherits the same checks.
//
// Anti-spoof contract:
//   1. teacherId MUST be a UUID (defensive — caller normally passes
//      session.account.id).
//   2. Learner MUST exist in `learner_teacher_links` with this teacher
//      AND `unlinked_at IS NULL`. Historical links (unlinked) do NOT
//      grant rename permission — the relationship must be active.
//   3. Target account MUST be a learner archetype: no `admin` or
//      `teacher` role. A teacher MUST NOT be able to rename another
//      teacher (cross-tenant lateral move) or an admin account.
//   4. Concurrent rename serialised via `pg_advisory_xact_lock` on the
//      same prefix family as `setAssignedTeacher` so an in-flight
//      operator reassign + teacher rename can't race.
//
// All checks + writes run inside a SINGLE transaction so a partial
// update is impossible (e.g. email updates but display_name fails).

import { randomUUID } from 'node:crypto'

import {
  normalizeAccountEmail,
} from '@/lib/auth/accounts'
import { getAuthPool } from '@/lib/auth/pool'
import { computeDisplayNameForStorage } from '@/lib/auth/profile-name'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Same shape as accounts.email server-side check (mig 0010 + the
// trim+lowercase normaliser). Client UI uses a softer hint regex; the
// authoritative reject still happens here.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export class TeacherRenameLearnerError extends Error {
  constructor(
    public readonly reason:
      | 'invalid_teacher_id'
      | 'invalid_learner_id'
      | 'not_found'
      | 'wrong_archetype'
      | 'displayName_empty'
      | 'displayName_too_long'
      | 'firstName_too_long'
      | 'lastName_too_long'
      | 'email_invalid'
      | 'email_in_use'
      | 'noop',
    message?: string,
  ) {
    super(message ?? reason)
    this.name = 'TeacherRenameLearnerError'
  }
}

export type RenameLearnerInput = {
  // `undefined` means "do not touch". Passing `null` is NOT supported
  // for displayName (back-compat with the rename surface — clearing
  // the display_name has no UX). firstName/lastName accept null to
  // explicitly clear that half of the name.
  displayName?: string
  // TASK-5 (mig 0095) — first_name / last_name. When EITHER is passed,
  // the helper recomputes display_name via computeDisplayNameForStorage.
  firstName?: string | null
  lastName?: string | null
  email?: string
}

export type RenameLearnerResult = {
  updated: {
    displayName?: string | null
    firstName?: string | null
    lastName?: string | null
    email?: string
  }
  // The actor's view of what changed (for the audit log line). Empty
  // object if nothing was provided (route layer pre-rejects that case,
  // but the helper is defensive).
  previous: {
    displayName: string | null
    firstName: string | null
    lastName: string | null
    email: string
  }
}

export async function renameLearnerByTeacher(
  teacherId: string,
  learnerId: string,
  input: RenameLearnerInput,
): Promise<RenameLearnerResult> {
  if (!UUID_PATTERN.test(teacherId)) {
    throw new TeacherRenameLearnerError('invalid_teacher_id')
  }
  if (!UUID_PATTERN.test(learnerId)) {
    throw new TeacherRenameLearnerError('invalid_learner_id')
  }

  // Validate / normalise inputs BEFORE opening a TX. Avoids holding a
  // connection while we shape-check a body.
  let normalisedDisplayName: string | undefined
  if (input.displayName !== undefined) {
    const trimmed = input.displayName.trim()
    if (trimmed.length === 0) {
      throw new TeacherRenameLearnerError('displayName_empty')
    }
    if (trimmed.length > 60) {
      throw new TeacherRenameLearnerError('displayName_too_long')
    }
    normalisedDisplayName = trimmed
  }

  // TASK-5 (mig 0095) — first/last name. null clears that half;
  // empty string also maps to null (storage CHECK rejects ''). The
  // 60-char cap matches the CHECK in mig 0095.
  const normaliseHalfName = (
    v: string | null | undefined,
  ): string | null | undefined => {
    if (v === undefined) return undefined
    if (v === null) return null
    const t = v.trim()
    return t.length === 0 ? null : t
  }
  const normalisedFirstName = normaliseHalfName(input.firstName)
  if (
    normalisedFirstName !== undefined &&
    normalisedFirstName !== null &&
    normalisedFirstName.length > 60
  ) {
    throw new TeacherRenameLearnerError('firstName_too_long')
  }
  const normalisedLastName = normaliseHalfName(input.lastName)
  if (
    normalisedLastName !== undefined &&
    normalisedLastName !== null &&
    normalisedLastName.length > 60
  ) {
    throw new TeacherRenameLearnerError('lastName_too_long')
  }

  let normalisedEmail: string | undefined
  if (input.email !== undefined) {
    const candidate = normalizeAccountEmail(input.email)
    if (!EMAIL_SHAPE.test(candidate) || candidate.length > 254) {
      throw new TeacherRenameLearnerError('email_invalid')
    }
    normalisedEmail = candidate
  }

  if (
    normalisedDisplayName === undefined &&
    normalisedFirstName === undefined &&
    normalisedLastName === undefined &&
    normalisedEmail === undefined
  ) {
    throw new TeacherRenameLearnerError(
      'noop',
      'nothing to update — pass displayName / firstName / lastName / email',
    )
  }

  const pool = getAuthPool()
  const client = await pool.connect()
  try {
    await client.query('begin')

    // Advisory lock keyed on (teacher_id, learner_id). Same prefix
    // family ('lc-saas-pivot:...') as Day-2 `setAssignedTeacher` so the
    // (teacher_id, learner_id) coordination is consistent across the
    // rename + reassign + invite-redeem trio. Two unrelated learners
    // serialise harmlessly if their hashes collide.
    await client.query(
      `select pg_advisory_xact_lock(hashtextextended($1, 0))`,
      [`lc-saas-pivot:rename-learner:${teacherId}:${learnerId}`],
    )

    // Anti-spoof gate 1: learner is in this teacher's ACTIVE roster.
    // We also re-fetch the learner's current display_name + first_name
    // + last_name + email (for the audit "previous" snapshot AND the
    // computeDisplayNameForStorage merge) in one round-trip.
    const guard = await client.query<{
      in_link: boolean
      email: string
      display_name: string | null
      first_name: string | null
      last_name: string | null
      has_admin: boolean
      has_teacher: boolean
    }>(
      `select
         exists (
           select 1 from learner_teacher_links
            where learner_account_id = $1
              and teacher_account_id = $2
              and unlinked_at is null
         ) as in_link,
         a.email,
         p.display_name,
         p.first_name,
         p.last_name,
         exists (
           select 1 from account_roles where account_id = $1 and role = 'admin'
         ) as has_admin,
         exists (
           select 1 from account_roles where account_id = $1 and role = 'teacher'
         ) as has_teacher
       from accounts a
       left join account_profiles p on p.account_id = a.id
       where a.id = $1
         and a.purged_at is null`,
      [learnerId, teacherId],
    )

    const row = guard.rows[0]
    if (!row) {
      // Account doesn't exist (or was purged). 404 to avoid leaking
      // existence — caller maps to `not_found`.
      await client.query('rollback')
      throw new TeacherRenameLearnerError('not_found')
    }
    if (!row.in_link) {
      // Learner not in this teacher's active roster. Same 404 shape
      // as "doesn't exist" — no info leak.
      await client.query('rollback')
      throw new TeacherRenameLearnerError('not_found')
    }
    if (row.has_admin || row.has_teacher) {
      // Target is an admin or teacher account. Refuse the rename —
      // this surface is learner-only. Distinct error code so the route
      // can map to 422; the route then surfaces a CLEAR message rather
      // than the generic 404 (the link check would have failed first
      // for true cross-tenant targets, so reaching this branch means
      // operator misconfigured the role grant — informative refusal is
      // the right UX).
      await client.query('rollback')
      throw new TeacherRenameLearnerError('wrong_archetype')
    }

    const updated: {
      displayName?: string | null
      firstName?: string | null
      lastName?: string | null
      email?: string
    } = {}

    if (normalisedEmail !== undefined && normalisedEmail !== row.email) {
      // Uniqueness check. UNIQUE index on accounts.email exists at the
      // DB level; pre-checking inside the TX gives a clean error code
      // path (no 23505 string parsing) and the UPDATE will still fail
      // safely if a parallel writer slips in (the advisory lock above
      // is per-learner so two DIFFERENT learners CAN race onto the
      // same email — the UNIQUE index is the last line of defence).
      const collision = await client.query(
        `select 1 from accounts where email = $1 and id <> $2 limit 1`,
        [normalisedEmail, learnerId],
      )
      if (collision.rows.length > 0) {
        await client.query('rollback')
        throw new TeacherRenameLearnerError('email_in_use')
      }
      try {
        await client.query(
          `update accounts
              set email = $2,
                  updated_at = now()
            where id = $1
              and purged_at is null`,
          [learnerId, normalisedEmail],
        )
      } catch (err) {
        // Defensive: UNIQUE race — surface as email_in_use even if our
        // pre-check passed.
        const code = (err as { code?: string } | null)?.code
        if (code === '23505') {
          await client.query('rollback')
          throw new TeacherRenameLearnerError('email_in_use')
        }
        throw err
      }
      updated.email = normalisedEmail
    }

    // TASK-5 (mig 0095) — figure out the effective name write.
    //
    // Merge rule:
    //   - If input.firstName / input.lastName provided → those win
    //     (null clears that half). Recompute display_name from the
    //     final (firstName ?? existing, lastName ?? existing) pair.
    //   - Else if input.displayName provided → legacy single-field
    //     write; first/last unchanged.
    //
    // The single TX writes all touched columns at once.
    const wantsNameUpdate =
      normalisedFirstName !== undefined ||
      normalisedLastName !== undefined ||
      normalisedDisplayName !== undefined

    if (wantsNameUpdate) {
      const effectiveFirstName =
        normalisedFirstName !== undefined ? normalisedFirstName : row.first_name
      const effectiveLastName =
        normalisedLastName !== undefined ? normalisedLastName : row.last_name
      const recomputedDisplayName =
        normalisedFirstName !== undefined || normalisedLastName !== undefined
          ? computeDisplayNameForStorage({
              firstName: effectiveFirstName,
              lastName: effectiveLastName,
            })
          : normalisedDisplayName ?? row.display_name

      // Upsert profile — a fresh learner may not have a row yet
      // (the cabinet creates one on first PATCH). We deliberately do
      // NOT use upsertAccountProfile() here because that helper would
      // open ITS OWN pool connection and break the single-TX guarantee.
      await client.query(
        `insert into account_profiles (account_id, display_name, first_name, last_name)
             values ($1, $2, $3, $4)
         on conflict (account_id) do update
             set display_name = excluded.display_name,
                 first_name   = excluded.first_name,
                 last_name    = excluded.last_name,
                 updated_at   = now()`,
        [
          learnerId,
          recomputedDisplayName,
          effectiveFirstName,
          effectiveLastName,
        ],
      )
      if (normalisedDisplayName !== undefined) {
        updated.displayName = normalisedDisplayName
      } else if (
        normalisedFirstName !== undefined ||
        normalisedLastName !== undefined
      ) {
        // Surface the recomputed display_name so the route can echo
        // the storage value back to the form.
        updated.displayName = recomputedDisplayName
      }
      if (normalisedFirstName !== undefined) {
        updated.firstName = normalisedFirstName
      }
      if (normalisedLastName !== undefined) {
        updated.lastName = normalisedLastName
      }
    }

    await client.query('commit')

    // Best-effort audit log. The `auth_audit_events.event_type` CHECK
    // constraint does NOT include `learner.profile.renamed_by_teacher`
    // (would need a migration). Per the feature spec we fall back to a
    // structured console.info line — the audit pipeline picks it up
    // from journalctl. ID generated client-side so a future migration
    // can backfill it into the table with stable identifiers.
    const auditId = randomUUID()
    console.info('[auth-audit] learner.profile.renamed_by_teacher', {
      auditId,
      teacherId,
      learnerId,
      changes: {
        displayName:
          updated.displayName !== undefined
            ? { from: row.display_name, to: updated.displayName }
            : undefined,
        email:
          updated.email !== undefined
            ? { from: row.email, to: updated.email }
            : undefined,
      },
      at: new Date().toISOString(),
    })

    return {
      updated,
      previous: {
        displayName: row.display_name,
        firstName: row.first_name,
        lastName: row.last_name,
        email: row.email,
      },
    }
  } catch (err) {
    // Make sure we don't leak a transaction. `commit` already closed
    // the happy path; rollback is a no-op after commit but throws on
    // already-closed clients in some pg versions — swallow.
    try {
      await client.query('rollback')
    } catch {
      /* noop */
    }
    throw err
  } finally {
    client.release()
  }
}
