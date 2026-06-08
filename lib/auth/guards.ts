import { NextResponse } from 'next/server'

import { type Account, listAccountRoles } from '@/lib/auth/accounts'
import { getActiveConsent } from '@/lib/auth/consents'
import { isLearnerArchetypeCandidate } from '@/lib/auth/learner-archetype'
import { type Session, getCurrentSession } from '@/lib/auth/sessions'
import { resolveOperatorSetting } from '@/lib/admin/operator-settings'
import { getCurrentLegalVersion, isEditorialOnlyChain } from '@/lib/legal/versions'

export type GuardResult =
  | { ok: true; account: Account; session: Session }
  | { ok: false; response: NextResponse }

// One-stop session guard for cabinet API routes. Returns the resolved
// account + session, or a NextResponse the caller should immediately
// `return` (401 with no-store headers, no cookie clear — the cabinet's
// /api/auth/me does the clear; chained 401 from a different surface
// should not double-stamp the cookie).
export async function requireAuthenticated(
  request: Request,
): Promise<GuardResult> {
  const current = await getCurrentSession(request)
  if (!current) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Not authenticated.' },
        { status: 401, headers: { 'Cache-Control': 'no-store, max-age=0' } },
      ),
    }
  }
  return { ok: true, account: current.account, session: current.session }
}

// Admin-only gate for /api/admin/* and the /admin SSR pages. Reuses
// requireAuthenticated, then checks the role list. 401 is returned to
// anonymous; 403 is returned to a logged-in non-admin so the UI can
// distinguish "your session is gone" from "you can't be here".
export async function requireAdminRole(request: Request): Promise<GuardResult> {
  const auth = await requireAuthenticated(request)
  if (!auth.ok) return auth
  const roles = await listAccountRoles(auth.account.id)
  if (!roles.includes('admin')) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Forbidden.' },
        { status: 403, headers: { 'Cache-Control': 'no-store, max-age=0' } },
      ),
    }
  }
  return { ok: true, account: auth.account, session: auth.session }
}

// Phase 4 booking gate: authenticated AND email-verified. Slot
// booking creates a real-world commitment; we require the learner to
// have proved they own the e-mail before they can occupy a teacher's
// time. Returns 403 with a structured `error: 'email_not_verified'`
// so the UI can surface a "подтвердите e-mail" hint instead of a
// generic forbidden.
export async function requireAuthenticatedAndVerified(
  request: Request,
): Promise<GuardResult> {
  const auth = await requireAuthenticated(request)
  if (!auth.ok) return auth
  if (!auth.account.emailVerifiedAt) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'email_not_verified' },
        { status: 403, headers: { 'Cache-Control': 'no-store, max-age=0' } },
      ),
    }
  }
  return { ok: true, account: auth.account, session: auth.session }
}

// Wave 1 (security) — learner-archetype gate.
//
// "Learner archetype" = an account that is allowed to book / cancel /
// list lessons as a student. Two archetypes today fall under this:
//   - accounts with no role at all (the default after registration);
//   - accounts with the explicit `student` role (assigned by an
//     operator for accounting / reporting; semantically identical
//     to "no role" at the gate level).
//
// Accounts with `admin` or `teacher` roles are NOT learners. Per
// migration 0023, those roles are mutually exclusive with `student`,
// so we don't need to special-case "admin who is also student" —
// that combination is rejected at role-grant time.
//
// Why deny-list (admin/teacher) instead of allow-list (student):
// historical accounts pre-dating the role system have no role row.
// An allow-list would lock those accounts out of their own bookings
// after a deploy. A deny-list reads "block elevated roles, anyone
// else passes" and keeps the existing user base unbroken.
//
// Use these for any /api/slots/* endpoint a learner reaches; they
// preserve the existing 401 (no session) and 403 (verified-required)
// shape AND add a `wrong_role` 403 with a translatable message so
// the UI can render an explanation instead of a bare forbidden.
function rejectElevated(): GuardResult {
  return {
    ok: false,
    response: NextResponse.json(
      {
        error: 'wrong_role',
        message: 'Эта операция доступна только ученикам.',
      },
      { status: 403, headers: { 'Cache-Control': 'no-store, max-age=0' } },
    ),
  }
}

export async function requireLearnerArchetype(
  request: Request,
): Promise<GuardResult> {
  const auth = await requireAuthenticated(request)
  if (!auth.ok) return auth
  const roles = await listAccountRoles(auth.account.id)
  if (roles.includes('admin') || roles.includes('teacher')) {
    return rejectElevated()
  }
  return { ok: true, account: auth.account, session: auth.session }
}

export async function requireLearnerArchetypeAndVerified(
  request: Request,
): Promise<GuardResult> {
  const auth = await requireAuthenticatedAndVerified(request)
  if (!auth.ok) return auth
  const roles = await listAccountRoles(auth.account.id)
  if (roles.includes('admin') || roles.includes('teacher')) {
    return rejectElevated()
  }
  // AUDIT-SEC-3 (2026-05-17) — align with the canonical predicate so
  // accounts inside deletion-grace (scheduled_purge_at set) or
  // already-purged or disabled can NOT hit downstream learner write
  // endpoints (/api/slots/[id]/book, /api/checkout/package/[slug],
  // etc.). Role check above is necessary but not sufficient: a learner
  // who tapped /account/delete still has their session valid until
  // grace expires + the anonymizer fires; without this gate they
  // could continue booking slots during the grace window. The
  // canonical predicate also re-asserts email-verified (already
  // enforced by requireAuthenticatedAndVerified — defense-in-depth).
  const stillEligible = await isLearnerArchetypeCandidate(auth.account.id)
  if (!stillEligible) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'learner_target_unavailable',
          message:
            'Аккаунт не может выполнять ученическую операцию (в графике удаления, выключен или роль изменилась).',
        },
        { status: 403, headers: { 'Cache-Control': 'no-store, max-age=0' } },
      ),
    }
  }
  return { ok: true, account: auth.account, session: auth.session }
}

// Wave A (calendar) — teacher gate. Allowed roles: only `teacher`,
// not `admin+teacher` (admin precedence redirects them to /admin/slots
// per `pickActiveCalendarRole` rule + Codex round 3 #2). Verified
// email required (same as learner).
export async function requireTeacherAndVerified(
  request: Request,
): Promise<GuardResult> {
  const auth = await requireAuthenticatedAndVerified(request)
  if (!auth.ok) return auth
  const roles = await listAccountRoles(auth.account.id)
  // Admin precedence: hybrid admin+teacher accounts get bounced to
  // /admin/slots by the route-level redirect; this guard rejects
  // them at API level so they don't accidentally accept teacher
  // surface writes (defense-in-depth, Wave 7 #3 lesson).
  if (roles.includes('admin')) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'admin_precedence',
          message: 'Hybrid admin+teacher accounts use /admin/slots.',
        },
        { status: 403, headers: { 'Cache-Control': 'no-store, max-age=0' } },
      ),
    }
  }
  if (!roles.includes('teacher')) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'wrong_role', message: 'Доступно только учителям.' },
        { status: 403, headers: { 'Cache-Control': 'no-store, max-age=0' } },
      ),
    }
  }
  return { ok: true, account: auth.account, session: auth.session }
}

// SAAS-OFFER bundle (Sub-A.2-3-5, 2026-05-30) — SaaS-оферта consent
// gate predicate.
//
// Why a single core helper + two wrappers (Request + Account):
//
//   The same verdict is consumed by THREE callers that don't share
//   a Request object:
//
//   1. SSR layout (`app/teacher/layout.tsx`): the layout already
//      resolves the session via `cookies()` + `lookupSession` and has
//      the Account in hand — no Request.
//
//   2. API route guards (`app/api/teacher/**`): they have a Request
//      and currently call `requireTeacherAndVerified(request)`. They
//      need a Request-shaped wrapper.
//
//   3. Telegram webhook teacher-bind consume path
//      (`app/api/telegram/webhook/route.ts`): the request comes FROM
//      Telegram (not the teacher's browser session); the
//      teacher_account_id is known from the bind row, NOT a session.
//      It needs the Account-shaped helper.
//
// Keeping the core verdict-keyed by accountId means all three callers
// share the same predicate. Adding a new policy invariant later
// (e.g., a v2 oферта must be re-accepted within N days) lands in one
// place, not three.
//
// Gate semantics (when flag is ON):
//   - live version is null OR label starts with 'v0-placeholder-' →
//     'awaiting_publication' (operator hasn't published v1 yet).
//   - account has no active 'saas_offer' consent OR the active row
//     does NOT FK the current live version id →
//     'consent_required' (route the user to the interstitial).
//   - active consent row FKs the current live version id → 'ok'.
//
// Gate semantics (when flag is OFF, default): always 'ok'.
//
// Canonical error codes:
//   - 'awaiting_publication' → HTTP 503 with error code
//     `saas_offer_awaiting_publication`.
//   - 'consent_required' → HTTP 403 with error code
//     `saas_offer_consent_required`.
//
// Placeholder convention: `v0-placeholder-do-not-accept` is the seed
// row from migration 0096. The gate REJECTS any version whose label
// starts with `v0-placeholder-` so admin can't accidentally publish
// a placeholder body. Real v1 publication via the admin UI uses a
// non-placeholder label.

export type SaasOfferGateVerdict =
  | { kind: 'ok' }
  | { kind: 'awaiting_publication' }
  | { kind: 'consent_required' }

// Hot-read helper. Reads operator_settings → env → default chain via
// the existing resolver. Returns true when the flag value is 1.
//
// Round-1 WARN#6 closure (2026-05-30) — latency. The original concern
// (one DB row read per teacher SSR request) is moot in this PR because
// round-1 BLOCKER#2 closure DEFERRED the SSR hookup in
// app/teacher/layout.tsx. The only callers of evaluateSaasOfferGate
// shipping in this foundation PR are the 3 NEW routes (/saas-offer-
// accept, /saas-offer-awaiting, /saas/offer — the last one doesn't
// even call the gate, it only reads getCurrentLegalVersion). None of
// these are on the critical path of an active teacher session.
// When the follow-up PR re-introduces the SSR hookup, it must also
// introduce a short-TTL in-process cache (or an LRU) so the DB read
// doesn't fire per request. A naive env-only short-circuit would
// silently break the plan-doc Day 2 step 4 rollout sequence (operator
// flips DB row via /admin/settings/saas-offer admin UI without a
// deploy) — env=0 would short-circuit the DB read and the operator's
// flip would be invisible.
//
// Round-1 WARN#3 closure (2026-05-30) — fail-open vs fail-closed:
//
//   resolveOperatorSetting itself handles the "table missing"
//   (`isUndefinedTableError`) path internally and falls through to
//   env/default. That covers the bootstrap window before mig 0096
//   lands. Anything else escaping into this catch is a real runtime
//   DB error (pool exhaustion, hard timeout, network partition).
//
//   We INTENTIONALLY return false (= treat as OFF) on runtime errors,
//   NOT throw. Reasoning: at the time this PR lands, gate enforcement
//   lives in three OPTIONAL surfaces: /saas-offer-accept, /saas-offer-
//   awaiting, and the still-deferred SSR hookup. NONE of those are on
//   the critical request path of a working teacher. A transient DB
//   blip on a runtime read here is harmless: the user sees the legacy
//   behaviour (cabinet renders, accept page redirects to /teacher
//   harmlessly). Once the follow-up Sub-A.3/A.5 lands and the flag is
//   the enforcement perimeter for /api/teacher/** mutations, this
//   policy can be revisited (the right call there is likely a TX-
//   coupled snapshot read, not a fail-closed throw — that would lock
//   teachers out on a transient DB blip).
//
//   The log line surfaces the runtime path so operator alerting can
//   distinguish bootstrap-missing-table from steady-state DB errors.
// Exported so callers outside the guard module (notably /api/auth/register)
// can short-circuit the gate check when the flag is OFF.
//
// security-audit-2026-06-02 F3a closure (round-N paranoia SIGN-OFF) —
// truly fail-CLOSED policy.
//
// Prior contract (A1.1 round-1 WARN#5, kept fail-CLOSED ONLY when env
// override `SAAS_OFFER_GATE_ENABLED=1` was explicitly set) was wrong
// for the canonical prod state: operator flips the flag via admin UI,
// which writes to `operator_settings` table; env stays unset. On a DB
// blip `resolveOperatorSetting` swallows the error INTERNALLY (inner
// catch in operator-settings.ts) and falls through to env/default.
// Outer catch here never fires → return false → all 24 perimeter
// routes silently bypass the gate.
//
// New contract: `resolveOperatorSetting` now surfaces `dbErrored: true`
// on a non-undefined-table runtime DB failure. When that's set AND the
// env override is not explicitly '0', we fail-CLOSED (return true).
// Trade-off: brief 503 / awaiting-publication banner on a real DB blip
// even when the flag is genuinely off in DB. Upside: no silent
// perimeter bypass on the canonical prod state.
export async function isSaasOfferGateEnabled(): Promise<boolean> {
  try {
    const resolved = await resolveOperatorSetting('SAAS_OFFER_GATE_ENABLED')
    if (resolved.dbErrored) {
      // Distinguish env-explicit-off from absent: only an explicit '0'
      // env override stays fail-OPEN (operator-asserted "the gate is
      // off, regardless of DB state"). Anything else → fail-CLOSED.
      const rawEnv = (process.env.SAAS_OFFER_GATE_ENABLED ?? '').trim()
      const envExplicitlyOff = rawEnv === '0'
      // eslint-disable-next-line no-console
      console.warn(
        '[saas-offer-gate] DB read failed; fail-CLOSED',
        {
          envExplicitlyOff,
          source: resolved.source,
        },
      )
      return !envExplicitlyOff
    }
    return resolved.value === 1
  } catch (err) {
    // Defensive — resolveOperatorSetting should not throw at all (it
    // swallows DB errors and returns dbErrored=true). If it does, treat
    // as a worse-than-DB-blip and still fail-CLOSED unless env says off.
    const rawEnv = (process.env.SAAS_OFFER_GATE_ENABLED ?? '').trim()
    const envExplicitlyOff = rawEnv === '0'
    // eslint-disable-next-line no-console
    console.warn(
      '[saas-offer-gate] resolver threw unexpectedly; fail-CLOSED',
      {
        err: err instanceof Error ? err.message : String(err),
        envExplicitlyOff,
      },
    )
    return !envExplicitlyOff
  }
}

// CORE: evaluates the gate for a given account id. No Request, no
// Account snapshot — the caller already knows the account id. This
// is the single source of truth for the policy verdict.
//
// Round-1 WARN#4 closure (2026-05-30) — snapshot consistency.
//
// Codex flagged that getCurrentLegalVersion + getActiveConsent are
// two independent reads. If an admin publishes v2 between them, the
// teacher's v1 consent might still pass the FK match check against
// the now-stale snapshot we read first. The race window is ~1ms; the
// resulting failure mode is at most one SSR page load showing the
// /teacher cabinet on a now-superseded consent — the very next page
// load re-reads and surfaces /saas-offer-accept.
//
// For SSR cabinet entry (round-1 BLOCKER#2 closure deferred this)
// the benign outcome is acceptable. For mutating API wrappers
// shipping in the follow-up Sub-A.3 PR, the right fix is a
// transaction wrapping both reads (BEGIN; SELECT live; SELECT
// consent; ...; COMMIT;) so the planner sees a single snapshot. We
// defer that to the follow-up because:
//   1. The wrapper accepts a `request: Request`, and threading a
//      pool/client through requires an API change in every caller.
//   2. The TX semantics depend on whether the caller already holds
//      a TX (the register flow does, the cabinet SSR doesn't).
// Both questions are resolved cleanly when the follow-up swaps the
// 24 routes; doing it here would lock in a shape that the follow-up
// will have to redo.
export async function evaluateSaasOfferGate(
  accountId: string,
): Promise<SaasOfferGateVerdict> {
  const flagOn = await isSaasOfferGateEnabled()
  if (!flagOn) return { kind: 'ok' }
  const live = await getCurrentLegalVersion('saas_offer')
  if (!live || live.versionLabel.startsWith('v0-placeholder-')) {
    return { kind: 'awaiting_publication' }
  }
  const consent = await getActiveConsent(accountId, 'saas_offer')
  if (!consent) return { kind: 'consent_required' }
  if (consent.legalDocumentVersionId === live.id) return { kind: 'ok' }
  // mig 0116 auto-pass: if every link from `live` down to the consented
  // version is editorial, accept the existing consent (non-material
  // typo-fix shouldn't force re-acceptance). Legacy consent rows
  // with NULL legalDocumentVersionId predate the FK column and must
  // never auto-pass — fall through to consent_required so they
  // re-accept against the current live row explicitly.
  if (consent.legalDocumentVersionId === null) {
    return { kind: 'consent_required' }
  }
  const editorialOk = await isEditorialOnlyChain(
    live.id,
    consent.legalDocumentVersionId,
  )
  if (editorialOk) return { kind: 'ok' }
  return { kind: 'consent_required' }
}

// MUTATION-PATH GATE — Class C race closure from plan §0af.
//
// `evaluateSaasOfferGate` (above) is SSR-only: two independent reads
// of legal + consent. For SSR pages the race is harmless (the page
// rendered against an old snapshot still routes correctly on the
// next request). For MUTATING `/api/teacher/**` routes that race is
// real — a publish-v2 commit landing between gate-read and
// route-write lets one stale-consent mutation through.
//
// This helper takes a caller-controlled `PoolClient` so the gate
// read runs inside the route's write TX. The caller MUST:
//   1. open a TX at isolation REPEATABLE READ (or stronger) BEFORE
//      calling this helper,
//   2. acquire shared advisory locks on the same per-kind keys that
//      `createLegalVersion` takes exclusively (lib/legal/versions.ts
//      line 140-141 — `pg_advisory_xact_lock(hashtext('legal:' || docKind))`),
//   3. abort the TX with `rollback` on anything other than `ok`,
//   4. keep the route's writes inside the same TX so publish-v2 that
//      commits before the route's commit conflicts and rolls back
//      cleanly.
//
// Two-document bundle (round-9 BLOCKER#2 + §0ad Corrigendum #1): the
// SaaS оферта lives as TWO docs (`saas_offer` + `saas_processor_terms`).
// Live versions of BOTH must be non-placeholder AND the consent row's
// combinedVersion must encode BOTH live labels. The consent row is a
// SINGLE entry under document_kind='saas_offer' (matches the live
// register-flow shape at app/api/auth/register/route.ts:388).
//
// SHARED locks coexist (many readers; multiple gates run in parallel);
// EXCLUSIVE (held by publish) blocks SHARED. So while publish is in
// flight, gates queue; after publish commits, queued gates read the
// new live label via the single CTE below and return `consent_required`
// for any combinedVersion that no longer matches.
export async function evaluateSaasOfferGateForMutation(
  client: import('pg').PoolClient,
  accountId: string,
): Promise<SaasOfferGateVerdict> {
  const flagOn = await isSaasOfferGateEnabled()
  if (!flagOn) return { kind: 'ok' }

  // Acquire shared locks on both kinds. Both are held for the rest
  // of the TX so the snapshot stays consistent under REPEATABLE READ.
  await client.query(
    `select pg_advisory_xact_lock_shared(hashtext($1))`,
    ['legal:saas_offer'],
  )
  await client.query(
    `select pg_advisory_xact_lock_shared(hashtext($1))`,
    ['legal:saas_processor_terms'],
  )

  // Single CTE — one round-trip, one consistent read. Mirrors the
  // canonical SQL shape from getCurrentLegalVersion (effective_from
  // <= now() + tie-break created_at desc) and getActiveConsent
  // (revoked_at IS NULL + order by accepted_at desc).
  const res = await client.query<{
    live_offer_label: string | null
    live_offer_id: string | null
    live_terms_label: string | null
    consent_combined_version: string | null
    consent_legal_document_version_id: string | null
  }>(
    `with live_offer as (
       select id, version_label
         from legal_document_versions
        where doc_kind = 'saas_offer'
          and effective_from <= now()
        order by effective_from desc, created_at desc
        limit 1
     ),
     live_terms as (
       select version_label
         from legal_document_versions
        where doc_kind = 'saas_processor_terms'
          and effective_from <= now()
        order by effective_from desc, created_at desc
        limit 1
     ),
     consent as (
       select document_version, legal_document_version_id
         from account_consents
        where account_id = $1::uuid
          and document_kind = 'saas_offer'
          and revoked_at is null
        order by accepted_at desc
        limit 1
     )
     select
       (select version_label from live_offer) as live_offer_label,
       (select id from live_offer) as live_offer_id,
       (select version_label from live_terms) as live_terms_label,
       (select document_version from consent) as consent_combined_version,
       (select legal_document_version_id from consent) as consent_legal_document_version_id`,
    [accountId],
  )
  const row = res.rows[0]
  const PLACEHOLDER_PREFIX = 'v0-placeholder-'
  if (
    row.live_offer_label === null
    || row.live_terms_label === null
    || row.live_offer_label.startsWith(PLACEHOLDER_PREFIX)
    || row.live_terms_label.startsWith(PLACEHOLDER_PREFIX)
  ) {
    return { kind: 'awaiting_publication' }
  }
  if (row.consent_combined_version === null) {
    return { kind: 'consent_required' }
  }
  const { parseCombinedVersion } = await import('@/lib/legal/combined-version')
  const parsed = parseCombinedVersion(row.consent_combined_version)
  if (parsed === null) return { kind: 'consent_required' }
  const labelsMatch =
    parsed.saasOfferLabel === row.live_offer_label
    && parsed.processorTermsLabel === row.live_terms_label
  if (labelsMatch) return { kind: 'ok' }
  // mig 0116 auto-pass — accept if the saas_offer chain from live down
  // to the consented row is editorial-only. Reads run on the caller's
  // PoolClient so they stay inside the same REPEATABLE READ snapshot.
  // We DO NOT skip processor_terms mismatch (different doc; would need
  // its own chain walk + separate editorial successor).
  if (
    row.live_offer_id
    && row.consent_legal_document_version_id
    && parsed.processorTermsLabel === row.live_terms_label
  ) {
    const editorialOk = await isEditorialOnlyChain(
      row.live_offer_id,
      row.consent_legal_document_version_id,
      client,
    )
    if (editorialOk) return { kind: 'ok' }
  }
  return { kind: 'consent_required' }
}

// REQUEST WRAPPER: combines requireTeacherAndVerified with the gate.
// Used by every /api/teacher/** route handler that mutates state.
// The /api/teacher/saas-offer-accept POST handler is the documented
// exception — it uses requireTeacherAndVerified directly because
// gating the consent capture itself would infinite-loop.
export async function requireTeacherWithCurrentSaasOfferConsent(
  request: Request,
): Promise<GuardResult> {
  const inner = await requireTeacherAndVerified(request)
  if (!inner.ok) return inner
  const verdict = await evaluateSaasOfferGate(inner.account.id)
  if (verdict.kind === 'ok') return inner
  if (verdict.kind === 'awaiting_publication') {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'saas_offer_awaiting_publication',
          message:
            'Платформа обновляет SaaS-оферту. Возвращайтесь чуть позже.',
        },
        { status: 503, headers: { 'Cache-Control': 'no-store, max-age=0' } },
      ),
    }
  }
  return {
    ok: false,
    response: NextResponse.json(
      {
        error: 'saas_offer_consent_required',
        message:
          'Подтвердите согласие с условиями SaaS-оферты в кабинете LevelChannel.',
      },
      { status: 403, headers: { 'Cache-Control': 'no-store, max-age=0' } },
    ),
  }
}

// MUTATION-PATH WRAPPER — higher-order helper that opens a write TX
// at REPEATABLE READ, runs the saas-offer gate inside the TX, and
// invokes the caller's mutation callback with the SAME client. Either
// commits on success OR rolls back on a non-`ok` verdict / thrown
// error.
//
// Use this for any `/api/teacher/**` route that writes data AND must
// be safe against the publish-vs-mutation race documented in plan
// §0af Closure for BLOCKER #6. Routes that only read (or do not need
// race-safe gating) can keep using `requireTeacherWithCurrentSaasOfferConsent`.
//
// Contract:
//   - Returns a `NextResponse` if the gate / auth rejects (caller
//     `return`s it directly).
//   - Returns the callback's value on success (caller wraps it in a
//     `NextResponse.json(...)` as needed).
//
// Caller responsibilities:
//   - Do NOT call `client.query('commit')` / `rollback` inside the
//     callback. The wrapper handles both.
//   - Do NOT open additional TXes on the same client. Use savepoints
//     if nested error handling is required.
//   - Throw to abort + rollback; return normally to commit.
export async function requireTeacherWithMutationGate<T>(
  request: Request,
  fn: (
    client: import('pg').PoolClient,
    account: Account,
  ) => Promise<T>,
): Promise<NextResponse | T> {
  const inner = await requireTeacherAndVerified(request)
  if (!inner.ok) return inner.response
  return runInSaasOfferMutationGate(inner.account.id, (client) =>
    fn(client, inner.account),
  )
}

// Typed-abort sentinel for routes that consume `runInSaasOfferMutationGate`
// directly. Throwing this from inside the callback rolls back the TX and
// returns the carried NextResponse unchanged.
//
// Contract (plan §0a-3 + §0b-2):
//   - ONLY `throw MutationGateAbort.fromJson(...)` (or `new MutationGateAbort(response)`)
//     triggers wrapper rollback + typed response return.
//   - Helper return values are ALWAYS treated as commit. A helper that
//     wants to signal failure must return a discriminated union; the
//     ROUTE then maps it to a `throw MutationGateAbort.fromJson(...)`
//     if rollback is required, or returns it normally to commit.
//   - Helpers MUST NOT `catch (err)` and re-wrap the sentinel into a
//     generic Error — that would defeat the typed-response contract.
//     Drift-test pin in tests/security/saas-offer-mutation-gate-perimeter.test.ts.
export class MutationGateAbort extends Error {
  constructor(public readonly response: NextResponse) {
    super('mutation_gate_abort')
    this.name = 'MutationGateAbort'
  }
  static fromJson(body: unknown, init: ResponseInit): MutationGateAbort {
    return new MutationGateAbort(NextResponse.json(body, init))
  }
}

// Run a callback inside a REPEATABLE READ transaction gated by the
// saas-offer mutation gate. Caller MUST have already authenticated via
// `requireTeacherAndVerified` (or equivalent) and resolved an
// `accountId`. The 2-step split (auth → rate-limit → gate) lets routes
// keep their existing rate-limit shape AFTER auth but BEFORE opening
// the TX (saas-offer-mutation-wrapper-rollout-poc.md §2-3).
//
// On gate-rejection: returns NextResponse (caller must check
// `instanceof NextResponse`). On callback throw: rolls back; if the
// throw is a `MutationGateAbort`, returns the typed response; any
// other throw propagates.
//
// Caller responsibilities (same as `requireTeacherWithMutationGate`):
//   - Do NOT call `client.query('commit'|'rollback')` inside the callback.
//   - Do NOT open additional TXes on the same client (use savepoints).
//   - Pass ONLY `auth.account.id` as `accountId` (anti-spoof; drift-test
//     pinned in tests/security/saas-offer-mutation-gate-perimeter.test.ts).
export async function runInSaasOfferMutationGate<T>(
  accountId: string,
  fn: (client: import('pg').PoolClient) => Promise<T>,
): Promise<NextResponse | T> {
  const { getDbPool } = await import('@/lib/db/pool')
  const pool = getDbPool()
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query('set transaction isolation level repeatable read')
    const verdict = await evaluateSaasOfferGateForMutation(client, accountId)
    if (verdict.kind === 'awaiting_publication') {
      await client.query('rollback').catch(() => {})
      return NextResponse.json(
        {
          error: 'saas_offer_awaiting_publication',
          message: 'Платформа обновляет SaaS-оферту. Возвращайтесь чуть позже.',
        },
        { status: 503, headers: { 'Cache-Control': 'no-store, max-age=0' } },
      )
    }
    if (verdict.kind === 'consent_required') {
      await client.query('rollback').catch(() => {})
      return NextResponse.json(
        {
          error: 'saas_offer_consent_required',
          message:
            'Подтвердите согласие с условиями SaaS-оферты в кабинете LevelChannel.',
        },
        { status: 403, headers: { 'Cache-Control': 'no-store, max-age=0' } },
      )
    }
    const result = await fn(client)
    await client.query('commit')
    return result
  } catch (err) {
    await client.query('rollback').catch(() => {})
    if (err instanceof MutationGateAbort) {
      return err.response
    }
    throw err
  } finally {
    client.release()
  }
}
