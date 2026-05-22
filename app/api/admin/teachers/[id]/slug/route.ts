import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { listAccountRoles } from '@/lib/auth/accounts'
import { requireAdminRole } from '@/lib/auth/guards'
import { getDbPool } from '@/lib/db/pool'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

// SAAS-PIVOT Epic 6 Day 6 (2026-05-22) — admin teacher_public_slug edit.
//
// Plan: docs/plans/saas-pivot-master.md §2.8 + §5 Day 6.
//
// Contract:
//   POST /api/admin/teachers/<id>/slug
//   Body: { slug: string | null }   // null clears the slug
//
// Slug allowlist regex: ^[a-z0-9][a-z0-9-]{2,30}$
// (3-31 chars, lowercase alphanumeric + hyphen, must start with alnum,
// URL-safe). Mirrors the mig 0082 CHECK constraint.
//
// Anti-spoof: re-verify admin role + target is a teacher.
// UNIQUE violation on the partial index → 409 slug_in_use.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{2,30}$/

type RouteParams = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: RouteParams) {
  const origin = enforceTrustedBrowserOrigin(request)
  if (origin) return origin

  const rl = await enforceRateLimit(request, 'admin:teachers:slug', 20, 60_000)
  if (rl) return rl

  const auth = await requireAdminRole(request)
  if (!auth.ok) return auth.response

  const { id: teacherAccountId } = await params
  if (!UUID_PATTERN.test(teacherAccountId)) {
    return NextResponse.json(
      { error: 'invalid_teacher_id' },
      { status: 400, headers: NO_STORE },
    )
  }

  let body: { slug?: string | null }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'invalid_body' },
      { status: 400, headers: NO_STORE },
    )
  }

  const rawSlug = body.slug
  let nextSlug: string | null = null
  if (rawSlug === null || (typeof rawSlug === 'string' && rawSlug.trim() === '')) {
    nextSlug = null
  } else if (typeof rawSlug === 'string') {
    const trimmed = rawSlug.trim()
    if (!SLUG_PATTERN.test(trimmed)) {
      return NextResponse.json(
        {
          error: 'invalid_slug',
          message:
            'Допустим slug длиной 3–31, lowercase alnum + дефис, начало — буква/цифра.',
        },
        { status: 400, headers: NO_STORE },
      )
    }
    nextSlug = trimmed
  } else {
    return NextResponse.json(
      { error: 'invalid_slug' },
      { status: 400, headers: NO_STORE },
    )
  }

  // Anti-spoof: target must be a teacher.
  const targetRoles = await listAccountRoles(teacherAccountId)
  if (!targetRoles.includes('teacher')) {
    return NextResponse.json(
      { error: 'target_not_teacher' },
      { status: 404, headers: NO_STORE },
    )
  }

  const pool = getDbPool()

  // Upsert account_profiles row (existing row update; insert if absent).
  try {
    await pool.query(
      `insert into account_profiles (account_id, teacher_public_slug, display_name, timezone, locale)
         values ($1::uuid, $2, null, 'Europe/Moscow', 'ru')
         on conflict (account_id) do update
           set teacher_public_slug = excluded.teacher_public_slug,
               updated_at = now()`,
      [teacherAccountId, nextSlug],
    )
  } catch (e: unknown) {
    const code =
      e instanceof Error && 'code' in e
        ? (e as Error & { code?: string }).code
        : undefined
    if (code === '23505') {
      return NextResponse.json(
        {
          error: 'slug_in_use',
          message: 'Этот slug уже занят другим учителем.',
        },
        { status: 409, headers: NO_STORE },
      )
    }
    throw e
  }

  console.info('[admin.teacher.slug]', {
    operatorAccountId: auth.account.id,
    targetAccountId: teacherAccountId,
    nextSlug,
    timestamp: new Date().toISOString(),
  })

  return NextResponse.json(
    { ok: true, slug: nextSlug },
    { status: 200, headers: NO_STORE },
  )
}
