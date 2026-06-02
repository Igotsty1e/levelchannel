import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { recordAuthAuditEvent } from '@/lib/audit/auth-events'
import {
  createAccount,
  getAccountByEmail,
  grantAccountRole,
} from '@/lib/auth/accounts'
import { recordConsent } from '@/lib/auth/consents'
import { isSaasOfferGateEnabled as isSaasOfferGateEnabledForRegister } from '@/lib/auth/guards'
import { computeDisplayNameForStorage } from '@/lib/auth/profile-name'
import { upsertAccountProfile } from '@/lib/auth/profiles'
import {
  redeemInviteAndBindLearnerAtomic,
  verifyInviteToken,
} from '@/lib/auth/teacher-invites'
import { getDummyHash } from '@/lib/auth/dummy-hash'
import { rateLimitScope } from '@/lib/auth/email-hash'
import { hashPassword, verifyPassword } from '@/lib/auth/password'
import { validatePasswordPolicy } from '@/lib/auth/policy'
import { createEmailVerification } from '@/lib/auth/verifications'
import {
  sendAlreadyRegisteredEmail,
  sendVerifyEmail,
} from '@/lib/email/dispatch'
import { PERSONAL_DATA_DOCUMENT_VERSION } from '@/lib/legal/personal-data'
import { getCurrentLegalVersion } from '@/lib/legal/versions'
import { validateCustomerEmail } from '@/lib/payments/catalog'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
  getClientIp,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/auth/register
//
// Anti-enumeration via symmetric work (per /plan-eng-review D1):
// - new-email path: hashPassword (~250ms bcrypt) → INSERT account →
//   record consent → create verify token → send verify email.
// - existing-email path: dummy verifyPassword (~250ms bcrypt) → no DB
//   write → send "already registered" email through the same Resend SDK.
// Both paths consume one bcrypt cycle and one Resend dispatch. Response
// body is byte-equal: { ok: true }.


export async function POST(request: Request) {
  const rl = await enforceRateLimit(request, 'auth:register:ip', 5, 60_000)
  if (rl) return rl

  const origin = enforceTrustedBrowserOrigin(request)
  if (origin) return origin

  let body: {
    email?: string
    password?: string
    personalDataConsentAccepted?: boolean
    saasOfferConsentAccepted?: boolean
    saasOfferConsentVersionId?: string
    role?: string
    inviteToken?: string
    firstName?: string | null
    lastName?: string | null
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'Invalid request body.' },
      { status: 400, headers: NO_STORE },
    )
  }

  // SAAS-3 (2026-05-18) — registration accepts an optional `role` to
  // distinguish learners from self-registered teachers. Missing/invalid
  // role defaults to 'student', preserving the pre-SaaS default-no-role
  // learner-archetype shape on the existing-email branch (we never
  // grant a role to existing accounts). Only the new-email + teacher
  // branch performs a single extra INSERT into account_roles; the
  // anti-enumeration wall-clock budget is preserved (one INSERT vs
  // 250ms bcrypt is in the noise).
  let requestedRole: 'student' | 'teacher' =
    body.role === 'teacher' ? 'teacher' : 'student'

  // SAAS-4 (2026-05-18) — invite-link auto-bind. If the body carries
  // an `inviteToken`, server-side anti-spoof RULE: HMAC must verify,
  // and the role is forced to `student` regardless of body.role
  // (an invited account is by definition a learner). The redeem +
  // assigned_teacher_id UPDATE happen atomically via the single-
  // statement CTE inside the new-email branch AFTER createAccount.
  // If verifyInviteToken returns null, we silently strip the token —
  // the register continues without binding, and the client UI is
  // expected to show its own banner if it had a token to start with.
  let invitePayload: ReturnType<typeof verifyInviteToken> = null
  if (typeof body.inviteToken === 'string' && body.inviteToken.length > 0) {
    invitePayload = verifyInviteToken(body.inviteToken)
    if (invitePayload !== null) {
      // Invited learner: force role to student (anti-spoof).
      requestedRole = 'student'
    }
  }

  const emailValidation = validateCustomerEmail(String(body.email || ''))
  if (!emailValidation.ok) {
    return NextResponse.json(
      { error: emailValidation.message },
      { status: 400, headers: NO_STORE },
    )
  }

  const passwordPolicy = validatePasswordPolicy(body.password)
  if (!passwordPolicy.ok) {
    return NextResponse.json(
      { error: passwordPolicy.message },
      { status: 400, headers: NO_STORE },
    )
  }

  if (body.personalDataConsentAccepted !== true) {
    return NextResponse.json(
      { error: 'Подтвердите согласие на обработку персональных данных.' },
      { status: 400, headers: NO_STORE },
    )
  }

  // SAAS-OFFER A1.1 (2026-05-31) — teacher self-reg gate.
  // Round-1 WARN#4 closure (2026-05-31) — REQUIRE non-placeholder
  // saas_processor_terms наряду с saas_offer. Без обоих живых
  // документов v2 §6.3.2 (ссылка на Приложение № 1) ведёт в 404
  // и правовое основание поручения теряется. Не оставляем «offer-
  // only consent cohort» которая никогда не re-gated при publish
  // processor_terms позже — enforce ordering в коде, не ops-discipline.
  let saasOfferLiveVersion: Awaited<
    ReturnType<typeof getCurrentLegalVersion>
  > = null
  let saasProcessorTermsLiveVersion: Awaited<
    ReturnType<typeof getCurrentLegalVersion>
  > = null
  if (
    requestedRole === 'teacher'
    && invitePayload === null
    && (await isSaasOfferGateEnabledForRegister())
  ) {
    if (body.saasOfferConsentAccepted !== true) {
      return NextResponse.json(
        { error: 'Подтвердите согласие с условиями SaaS-оферты.' },
        { status: 400, headers: NO_STORE },
      )
    }
    saasOfferLiveVersion = await getCurrentLegalVersion('saas_offer')
    if (
      !saasOfferLiveVersion
      || saasOfferLiveVersion.versionLabel.startsWith('v0-placeholder-')
    ) {
      return NextResponse.json(
        { error: 'saas_offer_awaiting_publication' },
        { status: 503, headers: NO_STORE },
      )
    }
    saasProcessorTermsLiveVersion = await getCurrentLegalVersion(
      'saas_processor_terms',
    )
    if (
      !saasProcessorTermsLiveVersion
      || saasProcessorTermsLiveVersion.versionLabel.startsWith('v0-placeholder-')
    ) {
      // Приложение № 1 ещё не опубликовано — register блокируется,
      // operator должен опубликовать оба документа.
      return NextResponse.json(
        { error: 'saas_offer_awaiting_publication' },
        { status: 503, headers: NO_STORE },
      )
    }
    const submittedId =
      typeof body.saasOfferConsentVersionId === 'string'
        ? body.saasOfferConsentVersionId.trim()
        : ''
    if (submittedId !== saasOfferLiveVersion.id) {
      return NextResponse.json(
        { error: 'saas_offer_version_changed' },
        { status: 409, headers: NO_STORE },
      )
    }
  }

  const email = emailValidation.email
  const password = String(body.password)

  const emailRl = await enforceRateLimit(
    request,
    rateLimitScope('register', email),
    3,
    60 * 60_000,
  )
  if (emailRl) return emailRl

  const existing = await getAccountByEmail(email)

  if (existing) {
    // Existing-email path: same wall-clock budget as new-email path.
    await verifyPassword(password, await getDummyHash())
    await sendAlreadyRegisteredEmail(email)
    // Wave 5 — audit the register attempt on a known email. Reason
    // tag distinguishes from a legit register so the alert query can
    // tell "abuser sweeping known emails" apart from organic load.
    // Response stays generic for anti-enumeration; reason is INTERNAL.
    await recordAuthAuditEvent({
      eventType: 'auth.register.created',
      accountId: existing.id,
      email,
      clientIp: getClientIp(request),
      userAgent: request.headers.get('user-agent'),
      payload: { branch: 'already_registered' },
    })
  } else {
    // New-email path.
    const passwordHash = await hashPassword(password)
    const account = await createAccount({
      email,
      passwordHash,
    })
    // SAAS-3 (2026-05-18) — self-registered teacher gets an explicit
    // teacher role on the new-email path.
    //
    // 2026-06-02 fix: also grant the explicit `student` role for
    // learner registrations (including invite redeem path). Previously
    // we relied on the implicit "no role = learner" default — that
    // works for `isLearnerArchetypeCandidate` but trips up surfaces
    // like /cabinet/settings/calendar that test `roles.includes('student')`
    // explicitly. Granting the role gives a single, unambiguous role
    // shape for every account.
    //
    // Failure to grant is fatal to register because returning ok:true
    // without the role would silently land an account on the wrong
    // surface — worse than a fail-fast 5xx that prompts retry.
    if (requestedRole === 'teacher') {
      await grantAccountRole(account.id, 'teacher', null)
    } else {
      await grantAccountRole(account.id, 'student', null)
    }

    // TASK-5 (mig 0095) — best-effort post-create profile UPSERT for
    // firstName/lastName carried in the register body. Round-2
    // BLOCKER #5: register stays non-transactional; failure here logs
    // but does NOT fail the register (the formatter falls back to
    // email at render time, and the cabinet's first PATCH lazily
    // creates the profile row otherwise).
    const rawFirstName =
      typeof body.firstName === 'string' ? body.firstName.trim() : ''
    const rawLastName =
      typeof body.lastName === 'string' ? body.lastName.trim() : ''
    if (rawFirstName.length > 0 || rawLastName.length > 0) {
      const firstName = rawFirstName.length > 0 ? rawFirstName.slice(0, 60) : null
      const lastName = rawLastName.length > 0 ? rawLastName.slice(0, 60) : null
      try {
        // upsertAccountProfile validates length + computes the storage
        // display_name server-side. We pass firstName + lastName as the
        // canonical inputs; the writer derives display_name from them.
        await upsertAccountProfile(account.id, {
          firstName,
          lastName,
          // Pass displayName explicitly so the writer treats this PATCH
          // as a full name-write (idempotent with the recompute path).
          displayName: computeDisplayNameForStorage({ firstName, lastName }),
        })
      } catch (err) {
        // Log + continue — the account exists, the formatter handles
        // missing profile gracefully. Operator alert lives in the auth
        // audit pipeline; we surface a structured line here.
        console.warn('[auth.register] best-effort profile UPSERT failed', {
          accountId: account.id,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    // SAAS-4 (2026-05-18) — atomic redeem-and-bind if the body
    // carried a verified invite token. The single-statement CTE in
    // redeemInviteAndBindLearnerAtomic verifies that the inviter
    // still holds the `teacher` role at the moment of redeem AND
    // sets accounts.assigned_teacher_id from the DB-side
    // teacher_account_id (never from the client-submitted token's
    // `tid` — anti-spoof guarantee).
    //
    // Failure modes (returns null): invite used / revoked / expired
    // / inviter-no-longer-teacher. All collapse to the same
    // `invite_already_used_or_expired` 409 response. The newly-
    // created account still exists; the learner can retry with a
    // fresh invite or proceed without a teacher binding (operator
    // can assign manually). This deliberately does NOT roll back
    // account creation: a half-merged state (account-with-no-teacher)
    // is recoverable; a no-account-with-link-already-redeemed state
    // would be worse. The "full TX rollback on redeem failure" claim
    // from the plan §3.7 is deferred to TINV.2 helper-refactor.
    let boundTeacherAccountId: string | null = null
    if (invitePayload !== null) {
      const redeemed = await redeemInviteAndBindLearnerAtomic(
        invitePayload.iid,
        account.id,
      )
      if (redeemed === null) {
        return NextResponse.json(
          {
            error: 'invite_already_used_or_expired',
            message:
              'Ссылка-приглашение уже использована или истекла. Зарегистрируйтесь без ссылки или попросите учителя новую.',
          },
          { status: 409, headers: NO_STORE },
        )
      }
      boundTeacherAccountId = redeemed.teacherAccountId
      await recordAuthAuditEvent({
        eventType: 'auth.invite.redeemed',
        accountId: account.id,
        email,
        clientIp: getClientIp(request),
        userAgent: request.headers.get('user-agent'),
        payload: {
          inviteId: invitePayload.iid,
          teacherAccountId: redeemed.teacherAccountId,
        },
      })
    }
    // Legal-versioning sister wave (migration 0032): capture the
    // FK to the snapshot row currently in force, alongside the
    // legacy text version for backward-compat. The lookup is
    // best-effort — if the seed row is somehow missing (fresh test
    // DB before migration applied), the consent still records with
    // the text version and FK = null. Not a hard fail.
    const currentPdVersion = await getCurrentLegalVersion('personal_data').catch(
      () => null,
    )
    await recordConsent({
      accountId: account.id,
      documentKind: 'personal_data',
      documentVersion: PERSONAL_DATA_DOCUMENT_VERSION,
      legalDocumentVersionId: currentPdVersion?.id ?? null,
      ip: getClientIp(request),
      userAgent: request.headers.get('user-agent') || null,
    })
    // SAAS-OFFER A1.1 — teacher self-reg with active gate: write
    // saas_offer consent с combinedVersion = saas_offer + processor_terms
    // (Приложение Q5 recommendation). Round-1 WARN#4 closure: гейт
    // вверху уже REQUIRED обе версии non-placeholder; здесь нет fallback
    // на saas_offer-only — combinedVersion всегда содержит обе.
    if (saasOfferLiveVersion && saasProcessorTermsLiveVersion) {
      const combinedVersion = `saas_offer:${saasOfferLiveVersion.versionLabel}+processor_terms:${saasProcessorTermsLiveVersion.versionLabel}`
      await recordConsent({
        accountId: account.id,
        documentKind: 'saas_offer',
        documentVersion: combinedVersion,
        documentPath: '/saas/offer',
        legalDocumentVersionId: saasOfferLiveVersion.id,
        ip: getClientIp(request),
        userAgent: request.headers.get('user-agent') || null,
      })
    }
    const { token } = await createEmailVerification(account.id)
    await sendVerifyEmail(email, token)
    await recordAuthAuditEvent({
      eventType: 'auth.register.created',
      accountId: account.id,
      email,
      clientIp: getClientIp(request),
      userAgent: request.headers.get('user-agent'),
      payload: {
        branch: 'new_account',
        role: requestedRole,
        boundTeacherAccountId,
      },
    })
    if (requestedRole === 'teacher') {
      await recordAuthAuditEvent({
        eventType: 'auth.teacher.self_registered',
        accountId: account.id,
        email,
        clientIp: getClientIp(request),
        userAgent: request.headers.get('user-agent'),
        payload: { role: 'teacher' },
      })
    }
  }

  return NextResponse.json({ ok: true }, { status: 200, headers: NO_STORE })
}
