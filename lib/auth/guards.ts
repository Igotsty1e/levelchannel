import { NextResponse } from 'next/server'

import { type Account, listAccountRoles } from '@/lib/auth/accounts'
import { getActiveConsent } from '@/lib/auth/consents'
import { isLearnerArchetypeCandidate } from '@/lib/auth/learner-archetype'
import { type Session, getCurrentSession } from '@/lib/auth/sessions'
import { resolveOperatorSetting } from '@/lib/admin/operator-settings'
import { getCurrentLegalVersion } from '@/lib/legal/versions'

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
export async function isSaasOfferGateEnabled(): Promise<boolean> {
  try {
    const resolved = await resolveOperatorSetting('SAAS_OFFER_GATE_ENABLED')
    return resolved.value === 1
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[saas-offer-gate] flag read failed; defaulting to OFF', {
      err: err instanceof Error ? err.message : String(err),
    })
    return false
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
  if (!consent || consent.legalDocumentVersionId !== live.id) {
    return { kind: 'consent_required' }
  }
  return { kind: 'ok' }
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
