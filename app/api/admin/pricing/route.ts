import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { readJsonObjectOr400 } from '@/lib/api/json-body'
import { getBootstrapTeacherId } from '@/lib/auth/bootstrap-teacher'
import { requireAdminRole } from '@/lib/auth/guards'
import {
  type TariffInput,
  createTariffForTeacher,
  listAllTariffs,
  validateTariffInput,
} from '@/lib/pricing/tariffs'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'


export async function GET(request: Request) {
  const rl = await enforceRateLimit(request, 'admin:pricing:ip', 60, 60_000)
  if (rl) return rl

  const guard = await requireAdminRole(request)
  if (!guard.ok) return guard.response

  // teacher-scope: admin-global — operator's catalogue editor lists
  // every teacher's tariffs (Epic 6 will add a teacher-filter chip).
  // Soft-deleted rows hidden by default; ?includeArchived=1 to see them.
  const url = new URL(request.url)
  const includeArchived = url.searchParams.get('includeArchived') === '1'
  const tariffs = await listAllTariffs({ includeArchived })
  return NextResponse.json({ tariffs }, { status: 200, headers: NO_STORE })
}

export async function POST(request: Request) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(request, 'admin:pricing:ip', 30, 60_000)
  if (rl) return rl

  const guard = await requireAdminRole(request)
  if (!guard.ok) return guard.response

  const parsed = await readJsonObjectOr400(request)
  if (!parsed.ok) return parsed.response
  const raw = parsed.body
  const input: Partial<TariffInput> & { teacherId?: string } = {}
  if (typeof raw.slug === 'string') input.slug = raw.slug
  if (typeof raw.titleRu === 'string') input.titleRu = raw.titleRu
  if (typeof raw.descriptionRu === 'string' || raw.descriptionRu === null) {
    input.descriptionRu = raw.descriptionRu as string | null
  }
  if (typeof raw.amountKopecks === 'number') {
    input.amountKopecks = raw.amountKopecks
  }
  if (typeof raw.durationMinutes === 'number') {
    input.durationMinutes = raw.durationMinutes
  }
  if (typeof raw.isActive === 'boolean') input.isActive = raw.isActive
  if (typeof raw.displayOrder === 'number') {
    input.displayOrder = raw.displayOrder
  }
  // SAAS-PIVOT Epic 2 Day 3 — optional teacher override. The admin
  // pricing UI is legacy: it has no teacher-picker yet (Epic 6
  // ships /admin/teachers/[id]/tariffs). For now we default to the
  // bootstrap teacher account (mig 0083 marker) so existing
  // operator-driven INSERTs stay green. A future epic surfaces the
  // picker; until then a request can override via `teacherId` body.
  if (typeof raw.teacherId === 'string') input.teacherId = raw.teacherId

  if (
    typeof input.slug !== 'string' ||
    typeof input.titleRu !== 'string' ||
    typeof input.amountKopecks !== 'number' ||
    typeof input.durationMinutes !== 'number'
  ) {
    return NextResponse.json(
      { error: 'slug, titleRu, amountKopecks, durationMinutes are required.' },
      { status: 400, headers: NO_STORE },
    )
  }

  const validation = validateTariffInput(input)
  if (validation) {
    return NextResponse.json(
      { error: `${validation.field}/${validation.reason}` },
      { status: 400, headers: NO_STORE },
    )
  }

  // Resolve owning teacher. Body override wins (for tests / future
  // picker UI); fall back to bootstrap. If neither path produces a
  // valid id we 409 with an actionable error — better than a generic
  // NOT NULL violation.
  let teacherId = input.teacherId ?? null
  if (teacherId === null) {
    teacherId = await getBootstrapTeacherId()
  }
  if (teacherId === null) {
    return NextResponse.json(
      {
        error: 'bootstrap_teacher_missing',
        message:
          'Не найден bootstrap-учитель (мигр. 0083 не выполнена). Создайте тариф через /teacher/tariffs или передайте teacherId явно.',
      },
      { status: 409, headers: NO_STORE },
    )
  }

  try {
    const tariff = await createTariffForTeacher({
      teacherId,
      slug: input.slug,
      titleRu: input.titleRu,
      descriptionRu: input.descriptionRu ?? null,
      amountKopecks: input.amountKopecks,
      durationMinutes: input.durationMinutes,
      isActive: input.isActive,
      displayOrder: input.displayOrder,
    })
    return NextResponse.json({ tariff }, { status: 201, headers: NO_STORE })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    if (message.includes('pricing_tariffs_slug_unique')) {
      return NextResponse.json(
        { error: 'slug/already_taken' },
        { status: 409, headers: NO_STORE },
      )
    }
    throw err
  }
}
