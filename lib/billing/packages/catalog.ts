// Wave 42 — operator-managed package catalog (lesson_packages).
// All economic fields immutable after first purchase via DB trigger
// (migration 0033 + admin layer only edits metadata).

import { getDbPool } from '@/lib/db/pool'

export type LessonPackage = {
  id: string
  slug: string
  titleRu: string
  descriptionRu: string | null
  durationMinutes: number
  count: number
  amountKopecks: number
  currency: string
  isActive: boolean
  displayOrder: number
  createdAt: string
  updatedAt: string
}

const PACKAGE_COLS =
  'id, slug, title_ru, description_ru, duration_minutes, count, amount_kopecks, ' +
  'currency, is_active, display_order, created_at, updated_at'

function rowToPackage(row: Record<string, unknown>): LessonPackage {
  return {
    id: String(row.id),
    slug: String(row.slug),
    titleRu: String(row.title_ru),
    descriptionRu: row.description_ru ? String(row.description_ru) : null,
    durationMinutes: Number(row.duration_minutes),
    count: Number(row.count),
    amountKopecks: Number(row.amount_kopecks),
    currency: String(row.currency),
    isActive: Boolean(row.is_active),
    displayOrder: Number(row.display_order),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  }
}

export async function listActivePackages(): Promise<LessonPackage[]> {
  const pool = getDbPool()
  const result = await pool.query(
    `select ${PACKAGE_COLS}
       from lesson_packages
      where is_active = true
      order by display_order asc, id asc`,
  )
  return result.rows.map((r) => rowToPackage(r as Record<string, unknown>))
}

export async function listActivePackagesByDuration(
  durationMinutes: number,
  limit = 3,
): Promise<LessonPackage[]> {
  const pool = getDbPool()
  const result = await pool.query(
    `select ${PACKAGE_COLS}
       from lesson_packages
      where is_active = true
        and duration_minutes = $1
      order by display_order asc, id asc
      limit $2`,
    [durationMinutes, Math.min(Math.max(limit, 1), 20)],
  )
  return result.rows.map((r) => rowToPackage(r as Record<string, unknown>))
}

export async function getPackageBySlug(slug: string): Promise<LessonPackage | null> {
  const pool = getDbPool()
  const result = await pool.query(
    `select ${PACKAGE_COLS} from lesson_packages where slug = $1`,
    [slug],
  )
  return result.rows[0] ? rowToPackage(result.rows[0]) : null
}

// PKG-ADMIN-GRANT LBL.1 — operator grant route picks by `id` (UUID
// from URL `/admin/packages/[id]/grant`), not slug. Same shape as
// `getPackageBySlug`.
export async function getPackageById(id: string): Promise<LessonPackage | null> {
  const pool = getDbPool()
  const result = await pool.query(
    `select ${PACKAGE_COLS} from lesson_packages where id = $1::uuid`,
    [id],
  )
  return result.rows[0] ? rowToPackage(result.rows[0]) : null
}

// Admin-side create. Used by the future /admin/packages catalog UI
// (PR 4). Validation lives at the call site; this just inserts.
export async function createPackage(input: {
  slug: string
  titleRu: string
  descriptionRu?: string | null
  durationMinutes: number
  count: number
  amountKopecks: number
  isActive?: boolean
  displayOrder?: number
}): Promise<LessonPackage> {
  const pool = getDbPool()
  const result = await pool.query(
    `insert into lesson_packages
       (slug, title_ru, description_ru, duration_minutes, count, amount_kopecks,
        is_active, display_order)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     returning ${PACKAGE_COLS}`,
    [
      input.slug,
      input.titleRu,
      input.descriptionRu ?? null,
      input.durationMinutes,
      input.count,
      input.amountKopecks,
      input.isActive ?? true,
      input.displayOrder ?? 100,
    ],
  )
  return rowToPackage(result.rows[0])
}

// Wave 15 — admin metadata edit. The DB trigger
// `lesson_packages_economic_fields_immutable` refuses any UPDATE
// touching amount_kopecks / duration_minutes / count / currency
// once a purchase exists, so this helper deliberately ONLY accepts
// the metadata fields (title_ru, description_ru, is_active,
// display_order). Monetary edits remain "deactivate old + create
// new" by design.
export async function updatePackageMetadata(
  id: string,
  patch: {
    titleRu?: string
    descriptionRu?: string | null
    isActive?: boolean
    displayOrder?: number
  },
): Promise<LessonPackage | null> {
  const pool = getDbPool()
  const sets: string[] = []
  const args: (string | number | boolean | null)[] = [id]
  if (patch.titleRu !== undefined) {
    args.push(patch.titleRu)
    sets.push(`title_ru = $${args.length}`)
  }
  if (patch.descriptionRu !== undefined) {
    args.push(patch.descriptionRu)
    sets.push(`description_ru = $${args.length}`)
  }
  if (patch.isActive !== undefined) {
    args.push(patch.isActive)
    sets.push(`is_active = $${args.length}`)
  }
  if (patch.displayOrder !== undefined) {
    args.push(patch.displayOrder)
    sets.push(`display_order = $${args.length}`)
  }
  if (sets.length === 0) {
    // Nothing to do — return the row as-is so the caller can render
    // the current state without writing a no-op UPDATE.
    const cur = await pool.query(
      `select ${PACKAGE_COLS} from lesson_packages where id = $1`,
      [id],
    )
    return cur.rows[0] ? rowToPackage(cur.rows[0]) : null
  }
  sets.push(`updated_at = now()`)
  const result = await pool.query(
    `update lesson_packages
        set ${sets.join(', ')}
      where id = $1
      returning ${PACKAGE_COLS}`,
    args,
  )
  return result.rows[0] ? rowToPackage(result.rows[0]) : null
}
