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
import { recordConsent } from '@/lib/auth/consents'
import { requireTeacherAndVerified } from '@/lib/auth/guards'
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

  const submittedVersionId =
    typeof b.saasOfferConsentVersionId === 'string'
      ? b.saasOfferConsentVersionId.trim()
      : ''
  if (!submittedVersionId) {
    return NextResponse.json(
      {
        error: 'saas_offer_version_missing',
        message: 'Не указана версия SaaS-оферты.',
      },
      { status: 400, headers: NO_STORE },
    )
  }

  const live = await getCurrentLegalVersion('saas_offer')
  if (!live || live.versionLabel.startsWith('v0-placeholder-')) {
    return NextResponse.json(
      {
        error: 'saas_offer_awaiting_publication',
        message: 'Платформа обновляет SaaS-оферту. Возвращайтесь чуть позже.',
      },
      { status: 503, headers: NO_STORE },
    )
  }
  if (submittedVersionId !== live.id) {
    return NextResponse.json(
      {
        error: 'saas_offer_version_changed',
        message:
          'Оферта обновилась. Перечитайте новую версию и подтвердите ещё раз.',
      },
      { status: 409, headers: NO_STORE },
    )
  }

  await recordConsent({
    accountId: guard.account.id,
    documentKind: 'saas_offer',
    documentVersion: live.versionLabel,
    documentPath: '/saas/offer',
    legalDocumentVersionId: live.id,
    ip: getClientIp(request),
    userAgent: request.headers.get('user-agent'),
  })

  return NextResponse.json({ ok: true }, { status: 200, headers: NO_STORE })
}
