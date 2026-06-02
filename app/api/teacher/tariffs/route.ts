import { randomBytes } from 'node:crypto'

import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { readJsonObjectOr400 } from '@/lib/api/json-body'
import { requireTeacherWithCurrentSaasOfferConsent } from '@/lib/auth/guards'
import { resolveTeacherWriteCaps } from '@/lib/billing/teacher-subscription'
import { getDbPool } from '@/lib/db/pool'
import {
  countActiveTariffsForTeacherTx,
  createTariffForTeacherTx,
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

  const guard = await requireTeacherWithCurrentSaasOfferConsent(request)
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

  const guard = await requireTeacherWithCurrentSaasOfferConsent(request)
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

  // Free-tier 1pkg+1tariff unlock (2026-06-02). Plan:
  // docs/plans/free-tier-1pkg-1tariff-unlock.md §3.
  //
  // Replaces the old `isOperatorManagedTeacher` gate. Same shape as
  // /api/teacher/packages POST: open a TX, take advisory_xact_lock,
  // check cap, count active, create. On cap=0 → 422
  // plan_upgrade_required; on count>=cap → 422 tier_write_cap_reached.
  //
  // Slug collision retry: now nested inside the TX. The collision
  // path rolls back the TX and re-opens a new one, because aborting
  // mid-TX poisons the connection. Three attempts max.
  const pool = getDbPool()

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const client = await pool.connect()
    try {
      await client.query('begin')
      await client.query(
        `select pg_advisory_xact_lock(hashtext('tier-cap:' || $1::text))`,
        [guard.account.id],
      )
      const caps = await resolveTeacherWriteCaps(guard.account.id)
      if (caps.maxTariffs <= 0) {
        await client.query('rollback')
        return NextResponse.json(
          {
            error: 'plan_upgrade_required',
            message:
              'Создание тарифов недоступно на вашем тарифе. Перейдите на тариф с тарифами или свяжитесь с оператором LevelChannel.',
          },
          { status: 422, headers: NO_STORE },
        )
      }
      const current = await countActiveTariffsForTeacherTx(
        client,
        guard.account.id,
      )
      if (current >= caps.maxTariffs) {
        await client.query('rollback')
        const tier: 'free' = 'free'
        return NextResponse.json(
          {
            error: 'tier_write_cap_reached',
            message:
              'Лимит тарифов на тарифе исчерпан. Архивируйте старый тариф, чтобы создать новый.',
            cap: caps.maxTariffs,
            current,
            tier,
          },
          { status: 422, headers: NO_STORE },
        )
      }
      const slug = synthesiseSlug(durationMinutes)
      try {
        const tariff = await createTariffForTeacherTx(client, {
          teacherId: guard.account.id, // anti-spoof: bound from session
          slug,
          titleRu,
          descriptionRu,
          amountKopecks,
          durationMinutes,
          isActive,
          displayOrder,
        })
        await client.query('commit')
        return NextResponse.json(
          { tariff },
          { status: 201, headers: NO_STORE },
        )
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown'
        if (message.includes('pricing_tariffs_slug_unique')) {
          // Roll back + try again with a fresh TX + nonce.
          await client.query('rollback')
          continue
        }
        await client.query('rollback')
        console.error('[teacher.tariffs.create] unexpected error', err)
        return NextResponse.json(
          { error: 'internal_error' },
          { status: 500, headers: NO_STORE },
        )
      }
    } catch (err) {
      try {
        await client.query('rollback')
      } catch {
        // already in failed state
      }
      console.error('[teacher.tariffs.create] tx error', err)
      return NextResponse.json(
        { error: 'internal_error' },
        { status: 500, headers: NO_STORE },
      )
    } finally {
      client.release()
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
