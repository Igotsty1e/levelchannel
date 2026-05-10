import { NextResponse } from 'next/server'

import { readJsonObjectOr400 } from '@/lib/api/json-body'
import { requireAdminRole } from '@/lib/auth/guards'
import { createPackage, listActivePackages } from '@/lib/billing/packages'
import { getDbPool } from '@/lib/db/pool'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' }

// Default display_order for new packages. Spaced at 100 so the operator
// can insert "in between" two existing rows by picking 50 / 150 / 250
// without renumbering the catalog. Mid-range value keeps room for future
// reordering on either side.
const DEFAULT_DISPLAY_ORDER = 100

// Billing wave PR 4 — admin packages CRUD (create + list).
//
// Edit (PATCH) is intentionally NOT shipped here for v1. The DB
// trigger on lesson_packages refuses economic-field UPDATE once
// any purchase exists, so the safe operator path is "deactivate
// old + create new". A future PR can add an in-place editor that
// surfaces the immutability error inline; today the admin uses
// this CREATE flow + the existing soft-archive path (set
// is_active=false via direct DB or future PATCH).

export async function GET(request: Request) {
  const guard = await requireAdminRole(request)
  if (!guard.ok) return guard.response
  // listActivePackages returns active only; for admin we want all.
  const pool = getDbPool()
  const result = await pool.query(
    `select id, slug, title_ru, description_ru, duration_minutes, count,
            amount_kopecks, currency, is_active, display_order,
            created_at, updated_at
       from lesson_packages
      order by is_active desc, display_order asc, id asc`,
  )
  return NextResponse.json(
    {
      packages: result.rows.map((r) => ({
        id: String(r.id),
        slug: String(r.slug),
        titleRu: String(r.title_ru),
        descriptionRu: r.description_ru ? String(r.description_ru) : null,
        durationMinutes: Number(r.duration_minutes),
        count: Number(r.count),
        amountKopecks: Number(r.amount_kopecks),
        currency: String(r.currency),
        isActive: Boolean(r.is_active),
        displayOrder: Number(r.display_order),
        createdAt: new Date(String(r.created_at)).toISOString(),
        updatedAt: new Date(String(r.updated_at)).toISOString(),
      })),
    },
    { status: 200, headers: NO_STORE },
  )
  // listActivePackages is left for the public endpoint.
  void listActivePackages
}

export async function POST(request: Request) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(request, 'admin:packages:create', 10, 60_000)
  if (rl) return rl

  const guard = await requireAdminRole(request)
  if (!guard.ok) return guard.response

  const parsed = await readJsonObjectOr400(request)
  if (!parsed.ok) return parsed.response
  const body = parsed.body

  const slug = typeof body.slug === 'string' ? body.slug : null
  const titleRu = typeof body.titleRu === 'string' ? body.titleRu : null
  const durationMinutes =
    typeof body.durationMinutes === 'number' ? body.durationMinutes : null
  const count = typeof body.count === 'number' ? body.count : null
  const amountKopecks =
    typeof body.amountKopecks === 'number' ? body.amountKopecks : null

  if (!slug || !titleRu || !durationMinutes || !count || !amountKopecks) {
    return NextResponse.json(
      {
        error:
          'slug, titleRu, durationMinutes, count, amountKopecks are required',
      },
      { status: 400, headers: NO_STORE },
    )
  }

  try {
    const pkg = await createPackage({
      slug,
      titleRu,
      descriptionRu:
        typeof body.descriptionRu === 'string' ? body.descriptionRu : null,
      durationMinutes,
      count,
      amountKopecks,
      isActive:
        typeof body.isActive === 'boolean' ? body.isActive : true,
      displayOrder:
        typeof body.displayOrder === 'number'
          ? body.displayOrder
          : DEFAULT_DISPLAY_ORDER,
    })
    return NextResponse.json(
      { package: pkg },
      { status: 201, headers: NO_STORE },
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    // PG error code 23505 = unique_violation. Match by code, not by
    // message substring — Codex round (Pass 2 #6): `msg.includes("unique")`
    // is too broad and would misclassify any error containing the
    // substring (e.g. a translated message like "must be unique").
    const code = (err as { code?: string } | null)?.code ?? ''
    if (code === '23505' || msg.includes('lesson_packages_slug_key')) {
      return NextResponse.json(
        { error: 'slug_already_exists' },
        { status: 409, headers: NO_STORE },
      )
    }
    // 23514 = check_violation. Migration 0033 has positive-value CHECKs
    // on amount_kopecks / count / duration_minutes; the route doesn't
    // pre-validate ranges, so a hostile/negative input lands here.
    // Treat as 400 with a stable code (don't leak constraint name).
    if (code === '23514') {
      return NextResponse.json(
        { error: 'invalid_input' },
        { status: 400, headers: NO_STORE },
      )
    }
    console.warn('[admin.packages.create] unexpected error', { error: msg })
    return NextResponse.json(
      { error: 'internal_error' },
      { status: 500, headers: NO_STORE },
    )
  }
}
