import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { readJsonObjectOr400 } from '@/lib/api/json-body'
import { requireTeacherWithCurrentSaasOfferConsent } from '@/lib/auth/guards'
import { countActivePackagesByTeacherTx } from '@/lib/billing/packages'
import {
  getPackageById,
  updatePackageMetadata,
} from '@/lib/billing/packages'
import { resolveTeacherWriteCaps } from '@/lib/billing/teacher-subscription'
import { getDbPool } from '@/lib/db/pool'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

// SAAS-PIVOT Epic 3 Day 4 (2026-05-22) — teacher-owned package metadata
// edit. Same shape as /api/admin/packages/[id]/route.ts but scoped by
// teacher_id ownership: a teacher CAN'T edit another teacher's package
// (404 not_found to avoid leaking existence).
//
// Economic fields stay immutable (DB trigger from mig 0033 refuses
// the UPDATE once any purchase exists); the route also pre-rejects
// any body that names them.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type RouteParams = { params: Promise<{ id: string }> }

export async function PATCH(request: Request, { params }: RouteParams) {
  const { id } = await params
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json(
      { error: 'not_found' },
      { status: 404, headers: NO_STORE },
    )
  }

  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(
    request,
    'teacher:packages:update',
    20,
    60_000,
  )
  if (rl) return rl

  const guard = await requireTeacherWithCurrentSaasOfferConsent(request)
  if (!guard.ok) return guard.response

  // Anti-spoof: re-verify the package belongs to this teacher. We
  // return 404 (not 403) on a foreign id so the route doesn't leak
  // existence of another teacher's package.
  const existing = await getPackageById(id)
  if (!existing) {
    return NextResponse.json(
      { error: 'not_found' },
      { status: 404, headers: NO_STORE },
    )
  }
  if (existing.teacherId !== guard.account.id) {
    return NextResponse.json(
      { error: 'not_found' },
      { status: 404, headers: NO_STORE },
    )
  }

  const parsed = await readJsonObjectOr400(request)
  if (!parsed.ok) return parsed.response
  const b = parsed.body

  const patch: Parameters<typeof updatePackageMetadata>[1] = {}
  if (typeof b.titleRu === 'string') {
    const t = b.titleRu.trim()
    if (!t) {
      return NextResponse.json(
        { error: 'titleRu cannot be empty' },
        { status: 400, headers: NO_STORE },
      )
    }
    patch.titleRu = t
  }
  if (typeof b.descriptionRu === 'string' || b.descriptionRu === null) {
    patch.descriptionRu =
      typeof b.descriptionRu === 'string' ? b.descriptionRu.trim() || null : null
  }
  if (typeof b.isActive === 'boolean') {
    patch.isActive = b.isActive
  }
  if (typeof b.displayOrder === 'number' && Number.isInteger(b.displayOrder)) {
    patch.displayOrder = b.displayOrder
  }

  // Reject any attempt to send the immutable monetary / identity
  // fields. Same shape as /api/admin/packages/[id]/route.ts. teacher_id
  // is added: a teacher MUST NOT be able to re-assign a package to a
  // different teacher via this route.
  for (const blocked of [
    'amountKopecks',
    'amount_kopecks',
    'durationMinutes',
    'duration_minutes',
    'count',
    'currency',
    'slug',
    'teacherId',
    'teacher_id',
  ] as const) {
    if (blocked in b) {
      return NextResponse.json(
        {
          error: 'immutable_field',
          message: `Поле ${blocked} нельзя изменить после создания. Деактивируйте пакет и создайте новый.`,
        },
        { status: 400, headers: NO_STORE },
      )
    }
  }

  // R1-BLOCKER closure (free-tier-1pkg-1tariff wave paranoia, 2026-06-03):
  // PATCH must enforce the same write-cap as POST when reactivating
  // (isActive=false → isActive=true). Without this, a free teacher
  // could create→archive→create→reactivate to bypass the cap. Wrap
  // in the same advisory lock used by POST so concurrent reactivate
  // + create can't both win.
  const willReactivate = patch.isActive === true && !existing.isActive
  if (willReactivate) {
    const client = await getDbPool().connect()
    try {
      await client.query('begin')
      await client.query(
        `select pg_advisory_xact_lock(hashtext('tier-cap:' || $1::text))`,
        [guard.account.id],
      )
      const caps = await resolveTeacherWriteCaps(guard.account.id)
      // R2-BLOCKER closure (wave-paranoia): mirror POST's cap=0 →
      // plan_upgrade_required branch so downgraded / no-subscription
      // teachers reactivating get the same code + copy as create.
      if (caps.maxPackages === 0) {
        await client.query('rollback')
        return NextResponse.json(
          {
            error: 'plan_upgrade_required',
            message:
              'Создание и реактивация пакетов недоступны на текущем тарифе. Свяжитесь с оператором LevelChannel.',
          },
          { status: 422, headers: NO_STORE },
        )
      }
      const activeCount = await countActivePackagesByTeacherTx(
        client,
        guard.account.id,
      )
      if (activeCount >= caps.maxPackages) {
        await client.query('rollback')
        return NextResponse.json(
          {
            error: 'tier_write_cap_reached',
            message:
              'Лимит активных пакетов исчерпан. Архивируйте другой пакет, чтобы реактивировать этот.',
            cap: caps.maxPackages,
            current: activeCount,
          },
          { status: 422, headers: NO_STORE },
        )
      }
      // Cap fine — perform the update inside the same TX so the lock
      // serialises any concurrent create/reactivate against this row's
      // count check.
      const updated = await updatePackageMetadata(id, patch, client)
      await client.query('commit')
      if (!updated) {
        return NextResponse.json(
          { error: 'not_found' },
          { status: 404, headers: NO_STORE },
        )
      }
      return NextResponse.json(
        { package: updated },
        { status: 200, headers: NO_STORE },
      )
    } catch (err) {
      await client.query('rollback').catch(() => {})
      const msg = err instanceof Error ? err.message : 'unknown'
      console.warn('[teacher.packages.update] reactivate-path error', {
        teacherId: guard.account.id,
        id,
        error: msg,
      })
      return NextResponse.json(
        { error: 'internal_error' },
        { status: 500, headers: NO_STORE },
      )
    } finally {
      client.release()
    }
  }

  try {
    const updated = await updatePackageMetadata(id, patch)
    if (!updated) {
      return NextResponse.json(
        { error: 'not_found' },
        { status: 404, headers: NO_STORE },
      )
    }
    return NextResponse.json(
      { package: updated },
      { status: 200, headers: NO_STORE },
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    console.warn('[teacher.packages.update] unexpected error', {
      teacherId: guard.account.id,
      id,
      error: msg,
    })
    return NextResponse.json(
      { error: 'internal_error' },
      { status: 500, headers: NO_STORE },
    )
  }
}
