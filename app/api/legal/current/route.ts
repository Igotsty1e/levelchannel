// SAAS-OFFER A1.1 (2026-05-31) — public endpoint для чтения текущей
// версии legal-документа по docKind. Используется на стороне клиента
// (/register UI, /saas-offer-accept form) чтобы получить version id
// для consent-pinning (TOCTOU гейт).
//
// No auth required — document id и label публичная информация (live
// document is already at /saas/offer / /offer / etc.). Rate-limited на
// случай скана.
import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import {
  type LegalDocKind,
  getCurrentLegalVersion,
} from '@/lib/legal/versions'
import { enforceRateLimit } from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ALLOWED: ReadonlySet<LegalDocKind> = new Set<LegalDocKind>([
  'offer',
  'privacy',
  'personal_data',
  'saas_offer',
  'saas_processor_terms',
])

export async function GET(request: Request) {
  const rl = await enforceRateLimit(request, 'legal-current:ip', 60, 60_000)
  if (rl) return rl

  const url = new URL(request.url)
  const kind = url.searchParams.get('kind') as LegalDocKind | null
  if (!kind || !ALLOWED.has(kind)) {
    return NextResponse.json(
      { error: 'kind query param required' },
      { status: 400, headers: NO_STORE },
    )
  }
  const live = await getCurrentLegalVersion(kind)
  if (!live) {
    return NextResponse.json(
      { error: 'no_published_version' },
      { status: 404, headers: NO_STORE },
    )
  }
  return NextResponse.json(
    {
      id: live.id,
      versionLabel: live.versionLabel,
      isPlaceholder: live.versionLabel.startsWith('v0-placeholder-'),
    },
    { status: 200, headers: NO_STORE },
  )
}
