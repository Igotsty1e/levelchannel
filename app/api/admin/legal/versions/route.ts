import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { readJsonObjectOr400 } from '@/lib/api/json-body'
import { requireAdminRole } from '@/lib/auth/guards'
import {
  type LegalDocKind,
  createLegalVersion,
  listLegalVersions,
} from '@/lib/legal/versions'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'


const ALLOWED_KINDS = new Set<LegalDocKind>([
  'offer',
  'privacy',
  'personal_data',
  'saas_offer',
  'saas_processor_terms',
])

// Wave 19 — admin Versions surface.
// GET    /api/admin/legal/versions?kind=offer   ─ list 50 newest
// POST   /api/admin/legal/versions               ─ publish new version
//
// No PATCH / DELETE: the design is append-only by contract. A typo
// fix in v2 = publish v3; the chain stays intact for audit. The DB
// has no trigger preventing UPDATE today, but the API surface keeps
// publish-only-forward semantics.

export async function GET(request: Request) {
  const guard = await requireAdminRole(request)
  if (!guard.ok) return guard.response

  const url = new URL(request.url)
  const kind = url.searchParams.get('kind') as LegalDocKind | null
  if (!kind || !ALLOWED_KINDS.has(kind)) {
    return NextResponse.json(
      {
        error:
          'kind query param required (offer | privacy | personal_data | saas_offer | saas_processor_terms)',
      },
      { status: 400, headers: NO_STORE },
    )
  }
  const versions = await listLegalVersions(kind, 50)
  return NextResponse.json({ versions }, { status: 200, headers: NO_STORE })
}

export async function POST(request: Request) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(
    request,
    'admin:legal-versions:ip',
    10,
    60_000,
  )
  if (rl) return rl

  const guard = await requireAdminRole(request)
  if (!guard.ok) return guard.response

  const parsed = await readJsonObjectOr400(request)
  if (!parsed.ok) return parsed.response
  const b = parsed.body

  const docKind =
    typeof b.docKind === 'string' && ALLOWED_KINDS.has(b.docKind as LegalDocKind)
      ? (b.docKind as LegalDocKind)
      : null
  if (!docKind) {
    return NextResponse.json(
      {
        error:
          'docKind must be one of: offer, privacy, personal_data, saas_offer, saas_processor_terms',
      },
      { status: 400, headers: NO_STORE },
    )
  }

  const versionLabel =
    typeof b.versionLabel === 'string' ? b.versionLabel.trim() : ''
  if (!versionLabel || versionLabel.length > 32) {
    return NextResponse.json(
      { error: 'versionLabel must be 1..32 chars (e.g. "v2", "2026-05-15")' },
      { status: 400, headers: NO_STORE },
    )
  }
  // SAAS-OFFER bundle round-1 BLOCKER#1 closure — the `v0-placeholder-*`
  // prefix is the gate's hard-reject signal (per evaluateSaasOfferGate in
  // lib/auth/guards.ts + /saas-offer-accept SSR guard). The placeholder
  // body ships ONLY as the migration 0096 seed; admin must NOT publish a
  // new version with this prefix or the gate would lock all teachers in
  // perpetual `awaiting_publication` state. Reserved prefix applies across
  // ALL doc_kinds (defence-in-depth — the gate predicate only knows
  // saas_offer today; widening the placeholder convention is one rule).
  if (versionLabel.startsWith('v0-placeholder-')) {
    return NextResponse.json(
      {
        error: 'version_label_reserved_prefix',
        message:
          'Префикс "v0-placeholder-" зарезервирован под seed-строки миграций — выберите другую метку версии.',
      },
      { status: 400, headers: NO_STORE },
    )
  }

  const bodyMd = typeof b.bodyMd === 'string' ? b.bodyMd : ''
  if (!bodyMd.trim()) {
    return NextResponse.json(
      { error: 'bodyMd must be non-empty markdown' },
      { status: 400, headers: NO_STORE },
    )
  }
  if (bodyMd.length > 200_000) {
    return NextResponse.json(
      { error: 'bodyMd too long (max 200000 chars)' },
      { status: 413, headers: NO_STORE },
    )
  }

  let effectiveFrom: Date | undefined
  if (typeof b.effectiveFrom === 'string') {
    // Codex Wave 19 MEDIUM. Require ISO-8601 with explicit timezone,
    // not any Date-parseable string. Bare local-time strings would
    // silently shift the effective moment by the server tz.
    const ISO_RE =
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/
    if (!ISO_RE.test(b.effectiveFrom)) {
      return NextResponse.json(
        {
          error:
            'effectiveFrom must be an ISO-8601 timestamp with explicit timezone (e.g. 2026-05-15T09:00:00Z)',
        },
        { status: 400, headers: NO_STORE },
      )
    }
    const parsedDate = new Date(b.effectiveFrom)
    if (Number.isNaN(parsedDate.getTime())) {
      return NextResponse.json(
        { error: 'effectiveFrom must be a valid ISO timestamp' },
        { status: 400, headers: NO_STORE },
      )
    }
    effectiveFrom = parsedDate
  }

  try {
    const created = await createLegalVersion({
      docKind,
      versionLabel,
      bodyMd,
      effectiveFrom,
      createdByAccountId: guard.account.id,
    })
    return NextResponse.json(
      { version: created },
      { status: 201, headers: NO_STORE },
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    // Codex Wave 19 HIGH. Translate UNIQUE (doc_kind, version_label)
    // violation into a clean 409 instead of falling through to 500.
    const code = (err as { code?: string } | null)?.code ?? ''
    if (code === '23505') {
      return NextResponse.json(
        {
          error: 'version_label_already_exists',
          message: `Версия "${versionLabel}" этого документа уже опубликована.`,
        },
        { status: 409, headers: NO_STORE },
      )
    }
    console.warn('[admin.legal.versions.create] unexpected error', {
      error: msg,
    })
    return NextResponse.json(
      { error: 'internal_error' },
      { status: 500, headers: NO_STORE },
    )
  }
}
