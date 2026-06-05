// SAAS-3+4 teacher invite token primitives + DB-bound helpers.
//
// docs/plans/teacher-self-reg-invite.md §3.3 + §3.5.
//
// TINV.1 (2026-05-18) shipped the pure-function HMAC sign/verify
// primitives. TINV.3+4 (2026-05-18) adds the DB-bound helpers:
//   - createInviteForTeacher: INSERT row + sign token + return URL.
//   - listInvitesForTeacher: status display in cabinet.
//   - revokeInvite: ownership-in-WHERE-clause + atomic UPDATE.
//   - redeemInviteAndBindLearnerAtomic: SINGLE Postgres statement
//     using a writable CTE that marks the invite used AND sets
//     accounts.assigned_teacher_id, atomically verifying via EXISTS
//     that the inviter still holds the `teacher` role at the moment
//     of redeem (closes the round-3 BLOCKER#1 race window).
//
// Token wire format (per §3.3):
//   <base64url(payload)>.<base64url(hmac)>
//
// where:
//   payload = utf8 JSON { v: 1, iid: <uuid>, tid: <uuid>, exp: <epoch-seconds> }
//   hmac    = HMAC-SHA256(TEACHER_INVITE_SECRET, base64url(payload))
//
// Verify uses `timingSafeEqual` — never a plain `===` on the hmac
// bytes, even though the secret is the only sensitive part.

import { createHmac, timingSafeEqual } from 'node:crypto'

import { paymentConfig } from '@/lib/payments/config'
import { getAuthPool } from '@/lib/auth/pool'

// Per-call env read (no module-scope memoization, matching the
// `email-hash.ts` pattern so rotation takes effect on the next
// request without a process restart).
//
// Production-required, dev-fallback. Boot-fails if unset in production.
const DEV_FALLBACK_SECRET = 'lc-dev-teacher-invite-fallback'

export function getTeacherInviteSecret(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const raw = (env.TEACHER_INVITE_SECRET ?? '').trim()
  if (raw.length > 0) return raw
  if (env.NODE_ENV === 'production') {
    throw new Error('TEACHER_INVITE_SECRET is required in production')
  }
  return DEV_FALLBACK_SECRET
}

export type InvitePayloadV1 = {
  v: 1
  /** Database id of the teacher_invites row (uuid). */
  iid: string
  /** Inviting teacher's account id (uuid). Duplicated from the row
   *  for a fast preview; server still re-fetches by `iid` and trusts
   *  the DB value (anti-spoof). */
  tid: string
  /** Expiry as epoch SECONDS (not ms). */
  exp: number
}

// Type-only alias — currently identical to V1 but kept distinct so a
// future v2 schema can be added with discriminated-union semantics.
export type InvitePayload = InvitePayloadV1

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function base64urlEncode(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function base64urlDecode(s: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null
  // Re-pad for `Buffer.from` (which is lenient but stricter is safer).
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  try {
    return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64')
  } catch {
    return null
  }
}

function hmacSign(secret: string, payloadEncoded: string): string {
  return base64urlEncode(
    createHmac('sha256', secret).update(payloadEncoded).digest(),
  )
}

/**
 * Sign an invite payload into the wire token.
 * Caller is responsible for ensuring the payload is well-formed; this
 * function does not validate `iid` / `tid` uuid shape (verify does).
 */
export function signInviteToken(
  payload: InvitePayload,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const secret = getTeacherInviteSecret(env)
  const payloadEncoded = base64urlEncode(
    Buffer.from(JSON.stringify(payload), 'utf-8'),
  )
  const hmac = hmacSign(secret, payloadEncoded)
  return `${payloadEncoded}.${hmac}`
}

/**
 * Verify a wire token and return its payload, or `null` on ANY failure.
 *
 * Returns `null` (with no detail) on:
 *   - malformed shape (not exactly two `.`-separated parts).
 *   - base64url decode failure.
 *   - JSON parse failure.
 *   - HMAC mismatch.
 *   - version mismatch (only `v: 1` supported today).
 *   - missing/invalid iid or tid uuid.
 *   - missing/invalid exp.
 *   - expired token (exp <= now-seconds).
 *
 * Anti-enumeration: the response surface is uniformly `null` so a caller
 * can't distinguish "tampered HMAC" from "expired" via the lib.
 */
export function verifyInviteToken(
  token: string,
  env: NodeJS.ProcessEnv = process.env,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): InvitePayload | null {
  if (typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [payloadEncoded, hmacEncoded] = parts
  if (!payloadEncoded || !hmacEncoded) return null

  // HMAC check first (constant-time compare on equal-length buffers).
  const secret = getTeacherInviteSecret(env)
  const expectedHmac = hmacSign(secret, payloadEncoded)
  const expectedBuf = base64urlDecode(expectedHmac)
  const actualBuf = base64urlDecode(hmacEncoded)
  if (!expectedBuf || !actualBuf) return null
  if (expectedBuf.length !== actualBuf.length) return null
  try {
    if (!timingSafeEqual(expectedBuf, actualBuf)) return null
  } catch {
    return null
  }

  // Payload decode + parse.
  const payloadBuf = base64urlDecode(payloadEncoded)
  if (!payloadBuf) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(payloadBuf.toString('utf-8'))
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const obj = parsed as Record<string, unknown>
  if (obj.v !== 1) return null
  if (typeof obj.iid !== 'string' || !UUID_RE.test(obj.iid)) return null
  if (typeof obj.tid !== 'string' || !UUID_RE.test(obj.tid)) return null
  if (typeof obj.exp !== 'number' || !Number.isFinite(obj.exp)) return null
  if (obj.exp <= nowSeconds) return null

  return { v: 1, iid: obj.iid, tid: obj.tid, exp: obj.exp }
}

/**
 * Default invite lifetime — 7 days from issue. Not env-tunable for
 * MVP; tunable knob lives behind operator_settings if/when needed.
 */
export const TEACHER_INVITE_DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60

// =============================================================================
// DB-bound primitives (TINV.3+4)
// =============================================================================

export type InviteDefaultPaymentMethod =
  | 'postpaid'
  | 'prepaid_packages'
  | 'none'

const VALID_DEFAULT_PAYMENT_METHODS: ReadonlyArray<InviteDefaultPaymentMethod> = [
  'postpaid',
  'prepaid_packages',
  'none',
]

export function isValidInviteDefaultPaymentMethod(
  value: unknown,
): value is InviteDefaultPaymentMethod {
  return (
    typeof value === 'string'
    && (VALID_DEFAULT_PAYMENT_METHODS as ReadonlyArray<string>).includes(value)
  )
}

export type CreatedInvite = {
  /** UUID of the new teacher_invites row. */
  id: string
  /** The wire token (base64url(payload).base64url(hmac)). */
  token: string
  /** Full register URL ready to copy/paste. */
  url: string
  /** Expiry as a Date object (epoch ms). */
  expiresAt: Date
  /** Default payment method seeded for the resulting (teacher, learner) pair. */
  defaultPaymentMethod: InviteDefaultPaymentMethod
}

/**
 * Generate a new invite row for a teacher and return the signed token
 * + the register URL. Caller is responsible for the requireTeacher-
 * AndVerified + rate-limit guards.
 *
 * The teacher's role is NOT re-verified here at creation time — the
 * route guard already enforced it. The redeem-time CTE
 * (redeemInviteAndBindLearnerAtomic) re-checks the role at use time,
 * which is the load-bearing security guarantee.
 *
 * Per docs/plans/per-learner-payment-method.md §Scope item 6 — invite
 * can carry a teacher-picked `defaultPaymentMethod` which is written
 * onto `teacher_invites.default_payment_method` and propagated into
 * `learner_billing_preferences` at redeem time. Default `'none'`
 * preserves the legacy behaviour (booking blocked until teacher picks
 * a method on the learner card).
 */
export async function createInviteForTeacher(
  teacherAccountId: string,
  options?: {
    ttlSeconds?: number
    env?: NodeJS.ProcessEnv
    defaultPaymentMethod?: InviteDefaultPaymentMethod
  },
): Promise<CreatedInvite> {
  const env = options?.env ?? process.env
  const ttl = options?.ttlSeconds ?? TEACHER_INVITE_DEFAULT_TTL_SECONDS
  const defaultPaymentMethod: InviteDefaultPaymentMethod =
    options?.defaultPaymentMethod ?? 'none'
  if (!isValidInviteDefaultPaymentMethod(defaultPaymentMethod)) {
    // Defensive — should be impossible given the union, but keep the
    // assertion close to the DB write so an off-union value never lands
    // in `teacher_invites.default_payment_method` (CHECK constraint
    // would catch it, but the error surface would be opaque).
    throw new Error(
      `teacher-invites/invalid-default-payment-method: ${String(defaultPaymentMethod)}`,
    )
  }
  const expiresAt = new Date(Date.now() + ttl * 1000)
  const pool = getAuthPool()
  const inserted = await pool.query<{ id: string; expires_at: Date }>(
    `insert into teacher_invites (teacher_account_id, expires_at, default_payment_method)
       values ($1, $2, $3)
       returning id, expires_at`,
    [teacherAccountId, expiresAt, defaultPaymentMethod],
  )
  const row = inserted.rows[0]
  if (!row) {
    throw new Error('teacher-invites/insert-returned-no-row')
  }
  const token = signInviteToken(
    {
      v: 1,
      iid: row.id,
      tid: teacherAccountId,
      exp: Math.floor(row.expires_at.getTime() / 1000),
    },
    env,
  )
  const url = `${paymentConfig.siteUrl}/register?invite=${encodeURIComponent(token)}`
  return {
    id: row.id,
    token,
    url,
    expiresAt: row.expires_at,
    defaultPaymentMethod,
  }
}

export type InviteRow = {
  id: string
  createdAt: Date
  expiresAt: Date
  usedAt: Date | null
  /** Joined from `accounts` on `used_by_account_id`; null if not yet
   *  used OR if the redeemed learner was purged. */
  usedByEmail: string | null
  revokedAt: Date | null
  status: 'active' | 'used' | 'revoked' | 'expired'
}

function resolveInviteStatus(row: {
  used_at: Date | null
  revoked_at: Date | null
  expires_at: Date
}): InviteRow['status'] {
  if (row.used_at !== null) return 'used'
  if (row.revoked_at !== null) return 'revoked'
  if (row.expires_at.getTime() <= Date.now()) return 'expired'
  return 'active'
}

/**
 * List the last N invites a teacher has issued (most recent first).
 * Joins the redeemer's email when present + not purged.
 */
export async function listInvitesForTeacher(
  teacherAccountId: string,
  limit = 50,
): Promise<InviteRow[]> {
  const pool = getAuthPool()
  const res = await pool.query<{
    id: string
    created_at: Date
    expires_at: Date
    used_at: Date | null
    used_by_email: string | null
    revoked_at: Date | null
  }>(
    `select i.id,
            i.created_at,
            i.expires_at,
            i.used_at,
            i.revoked_at,
            case when a.purged_at is null then a.email else null end as used_by_email
       from teacher_invites i
       left join accounts a on a.id = i.used_by_account_id
      where i.teacher_account_id = $1
      order by i.created_at desc
      limit $2`,
    [teacherAccountId, limit],
  )
  return res.rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    usedAt: r.used_at,
    usedByEmail: r.used_by_email,
    revokedAt: r.revoked_at,
    status: resolveInviteStatus(r),
  }))
}

/**
 * Revoke an unused invite. Returns true if the invite was revoked,
 * false if it was already used / revoked OR is owned by another
 * teacher (ownership is in the WHERE clause — anti-spoof).
 *
 * 404-normalised at the route layer to avoid id-existence enumeration.
 */
export async function revokeInvite(
  inviteId: string,
  teacherAccountId: string,
  opts: { client?: import('pg').PoolClient } = {},
): Promise<boolean> {
  // saas-offer-mutation-wrapper-poc (2026-06-04, plan §4): when caller
  // passes `client`, use the wrapper's PoolClient so the UPDATE runs
  // inside the outer REPEATABLE READ TX. When omitted, fall back to
  // the legacy module-pool path for back-compat with non-migrated
  // callers and tests.
  const queryRunner = opts.client ?? getAuthPool()
  const res = await queryRunner.query<{ id: string }>(
    `update teacher_invites
        set revoked_at = now()
      where id = $1
        and teacher_account_id = $2
        and used_at is null
        and revoked_at is null
      returning id`,
    [inviteId, teacherAccountId],
  )
  return res.rows.length > 0
}

/**
 * Atomically redeem an invite AND bind the learner account to the
 * inviting teacher. Wraps a single writable CTE statement inside an
 * explicit TX so the redeem-side advisory lock can be taken
 * (see "Concurrency note" below).
 *
 * Verifies in the same snapshot that:
 *   1. The invite is active (used_at IS NULL, revoked_at IS NULL,
 *      expires_at > now()).
 *   2. The inviter still holds the `teacher` role at the moment of
 *      redeem (EXISTS subquery against account_roles).
 *
 * If any condition fails → 0 rows in CTE → no writes → returns null.
 * Caller (register route) should fail the entire register and surface
 * invite_already_used_or_expired.
 *
 * If all conditions hold → 1 row in CTE → UPDATE accounts.assigned_
 * teacher_id (dual-write back-compat) AND INSERT learner_teacher_links
 * (canonical, SAAS-PIVOT Day 2). Both writes derive from the CTE's
 * teacher_account_id (NEVER from any client-submitted field —
 * anti-spoof guarantee).
 *
 * Closes round-3 BLOCKER#1 (race window between role-check and
 * accounts.assigned_teacher_id UPDATE). SAAS-PIVOT Day 2 extends the
 * single-statement writable CTE to ALSO INSERT a row into
 * learner_teacher_links (plan §2.5) with via_invite_id = inviteId.
 * ON CONFLICT (learner, teacher) DO UPDATE SET unlinked_at=NULL keeps
 * re-link a single-row idempotent operation per plan §2.1 row 0077
 * comment.
 *
 * Per Q-7 (§4): redeeming an invite from a SECOND teacher when the
 * learner already has a link to a first teacher just adds the new
 * teacher to the link set — both rows present, learner becomes n:m.
 * The PK (learner, teacher) prevents duplicates within a pair; no
 * row dedupe is needed across teachers.
 *
 * Writer inventory (SAAS-PIVOT Day 2, 2026-05-22): this CTE is ONE OF
 * TWO writers to learner_teacher_links. The other is
 * lib/auth/accounts.ts setAssignedTeacher (operator reassignment).
 * Both writers serialise via the same tx advisory lock keyed on
 * learner uuid so concurrent invocations do not produce drift in
 * the active-link set.
 */
export async function redeemInviteAndBindLearnerAtomic(
  inviteId: string,
  learnerAccountId: string,
): Promise<
  | {
      teacherAccountId: string
      defaultPaymentMethod: InviteDefaultPaymentMethod
      // True iff the seed actually inserted a new
      // learner_billing_preferences row (i.e. there was no prior
      // pair-pref). False on conflict-preserve (a previous redeem
      // or operator-PATCH already wrote the pair's pref). Callers
      // who emit `auth.billing.method_changed` MUST gate on this —
      // logging a "change" that never happened would be a falsified
      // audit row (codex-paranoia wave round-1 BLOCKER #1 closure).
      seededPrefInserted: boolean
    }
  | null
> {
  if (!UUID_RE.test(inviteId) || !UUID_RE.test(learnerAccountId)) {
    return null
  }
  const pool = getAuthPool()
  // The writable CTE has FOUR statements chained:
  //   1. verified_invite — UPDATE teacher_invites with the role-EXISTS
  //      anti-spoof check; returns teacher_account_id +
  //      default_payment_method.
  //   2. linked — INSERT into learner_teacher_links (canonical n:m
  //      table). ON CONFLICT revives a previously-unlinked row.
  //   3. dual_write — UPDATE accounts.assigned_teacher_id (back-compat
  //      alias for any not-yet-rewritten reader; mig 0084 drops it).
  //   4. seeded_pref — UPSERT learner_billing_preferences from the
  //      invite's default_payment_method (per-learner-payment-method
  //      §Scope item 6). ON CONFLICT DO NOTHING: an existing pref row
  //      wins (e.g. the learner was previously linked to this teacher
  //      under a non-'none' method, then unlinked, and is now
  //      re-redeeming a fresh invite). The seed never clobbers an
  //      explicit teacher choice. Caller emits the
  //      `auth.billing.method_changed` audit row OUT-OF-CTE so the
  //      audit row carries the same shape as a teacher-driven PATCH
  //      (event_type + payload schema identical to setPaymentMethodForPair).
  // All four see the SAME teacher_account_id from the CTE — even if a
  // concurrent transaction yanks the inviter's teacher role between
  // (1) and (2), the snapshot wraps the entire statement so no
  // mid-flight role-mutation can sneak through.
  //
  // Concurrency note (codex-paranoia round-2 BLOCKER #1 closure,
  // 2026-05-22): the operator reassign writer
  // (lib/auth/accounts.ts:setAssignedTeacher) takes a tx advisory lock
  // keyed on the learner uuid before mutating learner_teacher_links.
  // Redeem-and-bind takes the SAME advisory lock so concurrent redeem
  // + operator reassign serialise. Without it, a redeem committing
  // its INSERT between the operator's soft-unlink and INSERT would
  // leave the learner multi-link.
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query(
      'select pg_advisory_xact_lock(hashtext($1)::bigint)',
      [`lc-saas-pivot:learner-teacher-links:${learnerAccountId}`],
    )
    const res = await client.query<{
      teacher_account_id: string
      default_payment_method: string
      seeded_pref_inserted: boolean
    }>(
      `with verified_invite as (
         update teacher_invites
            set used_at = now(),
                used_by_account_id = $2
          where id = $1
            and used_at is null
            and revoked_at is null
            and expires_at > now()
            and exists (
              select 1 from account_roles r
               where r.account_id = teacher_invites.teacher_account_id
                 and r.role = 'teacher'
            )
         returning teacher_account_id, id as invite_id, default_payment_method
       ),
       linked as (
         insert into learner_teacher_links (learner_account_id, teacher_account_id, linked_at, unlinked_at, via_invite_id)
         select $2, vi.teacher_account_id, now(), null, vi.invite_id
           from verified_invite vi
         on conflict (learner_account_id, teacher_account_id) do update
           set unlinked_at = null,
               linked_at = case
                 when learner_teacher_links.unlinked_at is not null then excluded.linked_at
                 else learner_teacher_links.linked_at
               end,
               via_invite_id = coalesce(learner_teacher_links.via_invite_id, excluded.via_invite_id)
         returning teacher_account_id
       ),
       dual_write as (
         update accounts
            set assigned_teacher_id = vi.teacher_account_id
           from verified_invite vi
          where accounts.id = $2
          returning vi.teacher_account_id
       ),
       seeded_pref as (
         insert into learner_billing_preferences (
           teacher_account_id, learner_account_id, payment_method, updated_by_account_id
         )
         select vi.teacher_account_id, $2, vi.default_payment_method, vi.teacher_account_id
           from verified_invite vi
         on conflict (teacher_account_id, learner_account_id) do nothing
         returning teacher_account_id
       )
       select vi.teacher_account_id,
              vi.default_payment_method,
              exists(select 1 from seeded_pref) as seeded_pref_inserted
         from verified_invite vi`,
      [inviteId, learnerAccountId],
    )
    await client.query('commit')
    const row = res.rows[0]
    if (!row) return null
    const defaultPaymentMethod = isValidInviteDefaultPaymentMethod(
      row.default_payment_method,
    )
      ? row.default_payment_method
      : 'none'
    return {
      teacherAccountId: row.teacher_account_id,
      defaultPaymentMethod,
      seededPrefInserted: Boolean(row.seeded_pref_inserted),
    }
  } catch (err) {
    await client.query('rollback').catch(() => undefined)
    throw err
  } finally {
    client.release()
  }
}
