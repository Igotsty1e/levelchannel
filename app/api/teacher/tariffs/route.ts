import { randomBytes } from 'node:crypto'

import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { readJsonObjectOr400 } from '@/lib/api/json-body'
import { requireTeacherAndVerified } from '@/lib/auth/guards'
import {
  createTariffForTeacher,
  listTariffsForTeacher,
  validateTariffInput,
} from '@/lib/pricing/tariffs'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// SAAS-PIVOT Epic 2 Day 3 — teacher tariffs CRUD.
//
// Plan: docs/plans/saas-pivot-master.md §3 Epic 2.
//
// Anti-spoof contract: teacher_id is ALWAYS bound from
// `guard.account.id`, NEVER from the request body. The body's
// `teacherId` field, if present, is silently dropped. Mutations on
// /tariffs/[id] re-check the same way: the row must satisfy
// `teacher_id = $session` or the route returns 404 (which doubles as
// "not yours" without leaking existence).
//
// Slug strategy: pricing_tariffs.slug is still globally UNIQUE on
// Day 3 (the composite (teacher_id, slug) flip is out of scope for
// Epic 2 — only lesson_packages gets that). To minimise cross-teacher
// collisions while the global UNIQUE stands, this route synthesises a
// slug from a random 8-hex-char nonce plus a duration tag. The
// operator-style /admin/pricing UI keeps its explicit-slug input for
// back-compat; teachers don't see slugs in their editor.

function synthesiseSlug(durationMinutes: number): string {
  const nonce = randomBytes(4).toString('hex')
  return `t-${durationMinutes}m-${nonce}`
}

export async function GET(request: Request) {
  const rl = await enforceRateLimit(request, 'teacher:tariffs:ip', 60, 60_000)
  if (rl) return rl

  const guard = await requireTeacherAndVerified(request)
  if (!guard.ok) return guard.response

  const url = new URL(request.url)
  const includeArchived = url.searchParams.get('archived') === '1'
  const tariffs = await listTariffsForTeacher(guard.account.id, {
    includeArchived,
  })
  return NextResponse.json({ tariffs }, { status: 200, headers: NO_STORE })
}

export async function POST(request: Request) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(request, 'teacher:tariffs:ip', 30, 60_000)
  if (rl) return rl

  const guard = await requireTeacherAndVerified(request)
  if (!guard.ok) return guard.response

  const parsed = await readJsonObjectOr400(request)
  if (!parsed.ok) return parsed.response
  const raw = parsed.body

  const titleRu = typeof raw.titleRu === 'string' ? raw.titleRu : null
  const amountKopecks =
    typeof raw.amountKopecks === 'number' ? raw.amountKopecks : null
  const durationMinutes =
    typeof raw.durationMinutes === 'number' ? raw.durationMinutes : null
  const descriptionRu =
    typeof raw.descriptionRu === 'string' || raw.descriptionRu === null
      ? (raw.descriptionRu as string | null)
      : null
  const isActive = typeof raw.isActive === 'boolean' ? raw.isActive : true
  const displayOrder =
    typeof raw.displayOrder === 'number' ? raw.displayOrder : 0

  if (titleRu === null || amountKopecks === null || durationMinutes === null) {
    return NextResponse.json(
      { error: 'titleRu, amountKopecks, durationMinutes are required.' },
      { status: 400, headers: NO_STORE },
    )
  }

  const validation = validateTariffInput({
    titleRu,
    amountKopecks,
    durationMinutes,
    descriptionRu,
    displayOrder,
    isActive,
  })
  if (validation) {
    return NextResponse.json(
      { error: `${validation.field}/${validation.reason}` },
      { status: 400, headers: NO_STORE },
    )
  }

  // Slug synthesis. Retry up to 3 times on UNIQUE collision (extremely
  // unlikely with 8 random hex chars per duration bucket, but cheap
  // insurance). On exhausted retries we surface a server error rather
  // than a 4xx — a 4-collision streak is operational, not user input.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const slug = synthesiseSlug(durationMinutes)
    try {
      const tariff = await createTariffForTeacher({
        teacherId: guard.account.id, // anti-spoof: bound from session
        slug,
        titleRu,
        descriptionRu,
        amountKopecks,
        durationMinutes,
        isActive,
        displayOrder,
      })
      return NextResponse.json(
        { tariff },
        { status: 201, headers: NO_STORE },
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown'
      if (message.includes('pricing_tariffs_slug_unique')) {
        // try again with a fresh nonce
        continue
      }
      console.error('[teacher.tariffs.create] unexpected error', err)
      return NextResponse.json(
        { error: 'internal_error' },
        { status: 500, headers: NO_STORE },
      )
    }
  }
  return NextResponse.json(
    {
      error: 'slug_collision_retries_exhausted',
      message: 'Не удалось подобрать уникальный slug. Повторите попытку.',
    },
    { status: 503, headers: NO_STORE },
  )
}
