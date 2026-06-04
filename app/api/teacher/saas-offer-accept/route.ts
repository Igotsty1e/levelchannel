// SAAS-OFFER bundle (Sub-A.2-3-5, 2026-05-30) — POST handler for
// the existing-teacher acceptance interstitial at
// `/saas-offer-accept`.
//
// Auth: uses `requireTeacherAndVerified` (NOT the gated variant) —
// the user is heading TO consent capture; gating on consent would
// infinite-loop.
//
// TOCTOU contract (round-10 BLOCKER#1 closure): the client submits
// the version id it was rendered against. The server fetches the
// CURRENT live version and asserts strict equality. Any divergence
// (operator published v2 in between) returns 409
// `saas_offer_version_changed`, which the client surfaces as a
// banner + reloads the page so the user reads the new body.
//
// Re-acceptance idempotency: application-level, NOT a DB constraint.
// Re-accepting the same live version writes a second row. The
// CURRENT consent = latest non-revoked row matching the CURRENT
// live version id. Backfill + admin-side write paths share this
// contract.
import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { readJsonObjectOr400 } from '@/lib/api/json-body'
import { recordAuthAuditEvent } from '@/lib/audit/auth-events'
import { recordConsent } from '@/lib/auth/consents'
import { requireTeacherAndVerified } from '@/lib/auth/guards'
import { buildCombinedVersion } from '@/lib/legal/combined-version'
import { getCurrentLegalVersion } from '@/lib/legal/versions'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
  getClientIp,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(
    request,
    'teacher:saas-offer-accept:ip',
    20,
    60_000,
  )
  if (rl) return rl

  const guard = await requireTeacherAndVerified(request)
  if (!guard.ok) return guard.response

  const parsed = await readJsonObjectOr400(request)
  if (!parsed.ok) return parsed.response
  const b = parsed.body

  const submittedOfferId =
    typeof b.saasOfferConsentVersionId === 'string'
      ? b.saasOfferConsentVersionId.trim()
      : ''
  const submittedTermsId =
    typeof b.saasProcessorTermsConsentVersionId === 'string'
      ? b.saasProcessorTermsConsentVersionId.trim()
      : ''
  if (!submittedOfferId) {
    return NextResponse.json(
      {
        error: 'saas_offer_version_missing',
        message: 'Не указана версия SaaS-оферты.',
      },
      { status: 400, headers: NO_STORE },
    )
  }
  if (!submittedTermsId) {
    return NextResponse.json(
      {
        error: 'saas_processor_terms_version_missing',
        message: 'Не указана версия Приложения № 1.',
      },
      { status: 400, headers: NO_STORE },
    )
  }

  // §0af Closure for BLOCKER #4 (Sub-A.5 two-document TOCTOU): read
  // BOTH live versions and pin BOTH ids GET→POST. Either missing /
  // placeholder → 503; either id drifted → 409 with `drifted` object
  // naming which document changed.
  const [live, processorTermsLive] = await Promise.all([
    getCurrentLegalVersion('saas_offer'),
    getCurrentLegalVersion('saas_processor_terms'),
  ])
  if (
    !live
    || live.versionLabel.startsWith('v0-placeholder-')
    || !processorTermsLive
    || processorTermsLive.versionLabel.startsWith('v0-placeholder-')
  ) {
    return NextResponse.json(
      {
        error: 'saas_offer_awaiting_publication',
        message: 'Платформа обновляет SaaS-оферту. Возвращайтесь чуть позже.',
      },
      { status: 503, headers: NO_STORE },
    )
  }
  if (
    submittedOfferId !== live.id
    || submittedTermsId !== processorTermsLive.id
  ) {
    return NextResponse.json(
      {
        error: 'saas_offer_version_changed',
        message:
          'Оферта обновилась. Перечитайте новую версию и подтвердите ещё раз.',
        drifted: {
          saas_offer: submittedOfferId !== live.id,
          saas_processor_terms: submittedTermsId !== processorTermsLive.id,
        },
      },
      { status: 409, headers: NO_STORE },
    )
  }

  // §0af Closure for BLOCKER #1 + §0ag Closure #4: write SINGLE
  // consent row with combinedVersion = `saas_offer:<offerLabel>+
  // processor_terms:<termsLabel>`. Matches the register-flow shape
  // at `app/api/auth/register/route.ts:388`.
  const combinedVersion = buildCombinedVersion(
    live.versionLabel,
    processorTermsLive.versionLabel,
  )
  await recordConsent({
    accountId: guard.account.id,
    documentKind: 'saas_offer',
    documentVersion: combinedVersion,
    documentPath: '/saas/offer',
    legalDocumentVersionId: live.id,
    ip: getClientIp(request),
    userAgent: request.headers.get('user-agent'),
  })

  // §0af Closure for WARN #7 / §0ac Closure #7: emit the canonical
  // audit event alongside the consent row. The event type was already
  // in the AUTH_AUDIT_EVENT_TYPES allowlist + the SQL CHECK; this
  // route is the writer. recordAuthAuditEvent is silent-skip on
  // missing pool — best-effort, NOT hard-TX-coupled with recordConsent.
  await recordAuthAuditEvent({
    eventType: 'auth.teacher.saas_offer_accepted',
    accountId: guard.account.id,
    email: guard.account.email,
    clientIp: getClientIp(request),
    userAgent: request.headers.get('user-agent'),
    payload: {
      saas_offer_version_id: live.id,
      saas_offer_label: live.versionLabel,
      saas_processor_terms_version_id: processorTermsLive.id,
      saas_processor_terms_label: processorTermsLive.versionLabel,
    },
  })

  return NextResponse.json({ ok: true }, { status: 200, headers: NO_STORE })
}
