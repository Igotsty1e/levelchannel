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
  // SAAS-PIVOT Epic 3 Day 4 (2026-05-22) — owning teacher (mig 0076a
  // added the column nullable; mig 0076b in Day 4 flipped NOT NULL).
  // String at the TS layer; UUID at the DB layer.
  teacherId: string
  // T3 (mig 0102): per-learner ACL discriminator.
  visibility: 'catalog' | 'private'
  // T3 (mig 0102): soft-delete tombstone.
  deletedAt: string | null
}

const PACKAGE_COLS =
  'id, slug, title_ru, description_ru, duration_minutes, count, amount_kopecks, ' +
  'currency, is_active, display_order, created_at, updated_at, teacher_id, ' +
  'visibility, deleted_at'

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
    teacherId: String(row.teacher_id),
    visibility: row.visibility === 'private' ? 'private' : 'catalog',
    deletedAt:
      row.deleted_at === null || row.deleted_at === undefined
        ? null
        : new Date(String(row.deleted_at)).toISOString(),
  }
}

// SAAS-PIVOT security-audit HIGH-2 round-1 BLOCKER#2 closure
// (2026-05-23). The learner-facing catalog `/cabinet/packages` must
// not show packages owned by non-plan-4 (Free/Mid/Pro) teachers: a
// learner who clicks Buy on one of those would surface the new 422
// `plan_4_required` gate in the checkout route — confusing UX AND
// useless catalog real-estate. Filter the catalog at read time by
// joining `teacher_subscriptions` and keeping only `plan_slug =
// 'operator-managed' and state = 'active'` rows. The bootstrap
// teacher is plan-4 (mig 0083), so legacy single-tenant catalogs are
// unaffected.
/**
 * T3 Sub-PR E (2026-06-02): per-viewer visibility filter.
 * - `viewerAccountId === null` / undefined → only `visibility='catalog'`
 *   packages (anonymous viewer, e.g. public catalog or pre-auth surfaces).
 * - `viewerAccountId` set → catalog packages PLUS private packages where
 *   the viewer has an active `learner_package_access` row.
 * Also adds `deleted_at IS NULL` symmetrically with the tariff side.
 *
 * Bug #2 fix (2026-06-02, plan docs/plans/bug-2-packages-scoped-to-teacher.md):
 * authenticated viewers must ALSO be filtered by `learner_teacher_links`
 * (active) so a fresh learner with zero links sees ZERO packages, and a
 * learner linked to teacher A does NOT see teacher B/C/D's catalog
 * packages. Anonymous branch (zero callers today, contract preserved)
 * still returns catalog from every operator-managed teacher.
 */
export async function listActivePackages(
  viewerAccountId?: string | null,
): Promise<LessonPackage[]> {
  const pool = getDbPool()
  const result = await pool.query(
    `select ${PACKAGE_COLS.split(',').map((c) => `lp.${c.trim()}`).join(', ')}
       from lesson_packages lp
       join teacher_subscriptions ts on ts.account_id = lp.teacher_id
      where lp.is_active = true
        and lp.deleted_at is null
        and ts.plan_slug = 'operator-managed'
        and ts.state = 'active'
        and (
          -- Anonymous viewer: legacy catalog-only contract (zero live
          -- callers today; preserved for back-compat).
          ($1::uuid is null and lp.visibility = 'catalog')
          or (
            -- Authenticated viewer: filter by active learner-teacher
            -- link first (Bug #2 closure), then by visibility +
            -- per-package grant.
            $1::uuid is not null
            and exists (
              select 1 from learner_teacher_links ltl
               where ltl.teacher_account_id = lp.teacher_id
                 and ltl.learner_account_id = $1::uuid
                 and ltl.unlinked_at is null
            )
            and (
              lp.visibility = 'catalog'
              or (
                lp.visibility = 'private'
                and exists (
                  select 1 from learner_package_access lpa
                   where lpa.package_id = lp.id
                     and lpa.learner_account_id = $1::uuid
                     and lpa.revoked_at is null
                )
              )
            )
          )
        )
      order by lp.display_order asc, lp.id asc`,
    [viewerAccountId ?? null],
  )
  return result.rows.map((r) => rowToPackage(r as Record<string, unknown>))
}

/**
 * T3 epic-end paranoia R1-BLOCKER#3 closure (2026-06-02): teacher-scope
 * + visibility filter. Called by the booking flow's `package_required`
 * hint after a learner without a matching package books a prepaid-method
 * slot. The hint must only surface packages the learner could actually
 * buy: same teacher as the slot, catalog or granted-private, not soft-deleted.
 *
 * - `teacherAccountId` set → filter to that teacher.
 * - `viewerAccountId` set → include private packages where viewer has
 *   an active learner_package_access row. `null` → only catalog.
 */
export async function listActivePackagesByDuration(
  durationMinutes: number,
  limit = 3,
  scope?: {
    teacherAccountId?: string | null
    viewerAccountId?: string | null
  },
): Promise<LessonPackage[]> {
  const pool = getDbPool()
  const result = await pool.query(
    `select ${PACKAGE_COLS.split(',').map((c) => `lp.${c.trim()}`).join(', ')}
       from lesson_packages lp
       join teacher_subscriptions ts on ts.account_id = lp.teacher_id
      where lp.is_active = true
        and lp.deleted_at is null
        and lp.duration_minutes = $1
        and ts.plan_slug = 'operator-managed'
        and ts.state = 'active'
        and ($3::uuid is null or lp.teacher_id = $3::uuid)
        and (
          lp.visibility = 'catalog'
          or (
            lp.visibility = 'private'
            and $4::uuid is not null
            and exists (
              select 1 from learner_package_access lpa
               where lpa.package_id = lp.id
                 and lpa.learner_account_id = $4::uuid
                 and lpa.revoked_at is null
            )
          )
        )
      order by lp.display_order asc, lp.id asc
      limit $2`,
    [
      durationMinutes,
      Math.min(Math.max(limit, 1), 20),
      scope?.teacherAccountId ?? null,
      scope?.viewerAccountId ?? null,
    ],
  )
  return result.rows.map((r) => rowToPackage(r as Record<string, unknown>))
}

/**
 * @deprecated SAAS-PIVOT Epic 3 Day 4 (2026-05-22) — global slug
 * uniqueness was retired by mig 0076b; slug is now unique only per
 * (teacher_id, slug). This helper still works on a fresh DB because
 * mig 0033's data has every row owned by the bootstrap teacher, but
 * it CAN return the wrong row in a multi-tenant world where two
 * teachers ship a package with the same slug. New code should call
 * `getPackageById(uuid)`; the webhook + grant paths read
 * metadata.packageId (populated since PR #382 at checkout-init time)
 * and skip slug-based lookup entirely. Kept for the public catalog
 * endpoint and the URL-bound checkout flow (`/checkout/package/[slug]`)
 * where the operator-scoped guarantee is still implicit.
 *
 * SAAS-PIVOT security-audit HIGH-1 (2026-05-23) closure: callers that
 * cannot tolerate cross-tenant ambiguity MUST first call
 * `countPackagesBySlug` and surface 400 `package_slug_ambiguous` when
 * more than one row matches; the route `/api/checkout/package/[slug]`
 * does exactly that.
 */
export async function getPackageBySlug(slug: string): Promise<LessonPackage | null> {
  const pool = getDbPool()
  const result = await pool.query(
    `select ${PACKAGE_COLS} from lesson_packages where slug = $1`,
    [slug],
  )
  return result.rows[0] ? rowToPackage(result.rows[0]) : null
}

// SAAS-PIVOT security-audit HIGH-1 (2026-05-23). Companion to
// `getPackageBySlug`: returns the count of rows that share a slug so
// the legacy global-slug callers (URL-bound public checkout) can fail
// closed with `package_slug_ambiguous` when mig 0089 lets two teachers
// own the same slug. Cheap COUNT — no row materialisation.
export async function countPackagesBySlug(slug: string): Promise<number> {
  const pool = getDbPool()
  const result = await pool.query<{ count: string }>(
    `select count(*)::text as count from lesson_packages where slug = $1`,
    [slug],
  )
  return Number(result.rows[0]?.count ?? 0)
}

// SAAS-PIVOT Epic 3 Day 4 (2026-05-22) — teacher-scoped catalog
// lookup. The public checkout flow accepts `/checkout/package/[slug]`
// URLs that are NOT scoped by teacher (a /teacher/<slug>/... namespace
// is future work); this helper exists for the teacher cabinet write
// surface so the editor can disambiguate two packages with the same
// slug owned by different teachers without relying on the deprecated
// global getPackageBySlug.
export async function getPackageBySlugForTeacher(
  teacherId: string,
  slug: string,
): Promise<LessonPackage | null> {
  const pool = getDbPool()
  const result = await pool.query(
    `select ${PACKAGE_COLS}
       from lesson_packages
      where teacher_id = $1::uuid
        and slug = $2`,
    [teacherId, slug],
  )
  return result.rows[0] ? rowToPackage(result.rows[0]) : null
}

// PKG-ADMIN-GRANT LBL.1 — operator grant route picks by `id` (UUID
// from URL `/admin/packages/[id]/grant`), not slug. Same shape as
// `getPackageBySlug`. Post-Epic-3-Day-4 this is the canonical
// catalog-by-id lookup; webhook + grant + admin paths all use this.
export async function getPackageById(id: string): Promise<LessonPackage | null> {
  const pool = getDbPool()
  const result = await pool.query(
    `select ${PACKAGE_COLS} from lesson_packages where id = $1::uuid`,
    [id],
  )
  return result.rows[0] ? rowToPackage(result.rows[0]) : null
}

// Admin-side create. Used by the legacy /admin/packages catalog UI
// AND the new /teacher/packages catalog UI (SAAS-PIVOT Epic 3 Day 4).
// Validation lives at the call site; this just inserts.
//
// SAAS-PIVOT Epic 3 Day 4 (2026-05-22): mig 0076b flipped
// lesson_packages.teacher_id NOT NULL. New callers pass `teacherId`
// explicitly (the /admin route resolves bootstrap, the /teacher route
// passes session.account.id). Callers that don't pass `teacherId`
// (existing /admin tests, fixture helpers) fall back to the bootstrap
// teacher; in a fresh DB (no admin row) the underlying NOT NULL
// constraint raises and the caller sees a 23502.
export async function createPackage(input: {
  slug: string
  titleRu: string
  descriptionRu?: string | null
  durationMinutes: number
  count: number
  amountKopecks: number
  isActive?: boolean
  displayOrder?: number
  teacherId?: string | null
}): Promise<LessonPackage> {
  const pool = getDbPool()
  let teacherId = input.teacherId ?? null
  if (!teacherId) {
    // Fall back to the bootstrap teacher row. In production, mig 0083
    // seeded it at deploy time; in test scenarios where the row was
    // truncated, `ensureBootstrapTeacherAccount` creates it on demand
    // so legacy fixtures keep working without a fixture-wide rewrite.
    teacherId = await ensureBootstrapTeacherAccount()
  }
  const result = await pool.query(
    `insert into lesson_packages
       (slug, title_ru, description_ru, duration_minutes, count, amount_kopecks,
        is_active, display_order, teacher_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9::uuid)
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
      teacherId,
    ],
  )
  return rowToPackage(result.rows[0])
}

// SAAS-PIVOT Epic 3 Day 4 (2026-05-22) — bootstrap teacher lookup.
// The /admin/packages legacy create + grant flows still need a
// teacher_id to satisfy the now-NOT-NULL constraint on
// lesson_packages.teacher_id; we route them through the bootstrap
// teacher account established by mig 0083 (marker
// 'bootstrap-2026-05-22'). Returns null on a fresh DB where mig 0083
// was a no-op (no admin to row-MOVE from); callers in that branch
// MUST 422 rather than fabricate a row.
export async function getBootstrapTeacherAccountId(): Promise<string | null> {
  const pool = getDbPool()
  const result = await pool.query<{ id: string }>(
    `select id
       from accounts
      where teacher_account_migration_marker = 'bootstrap-2026-05-22'
      limit 1`,
  )
  return result.rows[0] ? String(result.rows[0].id) : null
}

// SAAS-PIVOT Epic 3 Day 4 (2026-05-22) — find-or-create the bootstrap
// teacher row. Mig 0083 only seeds it when an admin account exists at
// migrate-time; integration tests truncate accounts between cases, so
// the row vanishes. Callers that need a satisfying teacher_id (legacy
// /admin/packages POST + the createPackage default branch) call this
// helper to get one regardless. The created row carries the same
// marker as the migration so a re-call returns the same id.
//
// `email` defaults to a synthetic internal address that can't collide
// with real signups (the UNIQUE on accounts.email keys is preserved).
// Caller can pass a custom email if a specific test scenario needs
// it (e.g. payment_orders.customer_email assertions).
export async function ensureBootstrapTeacherAccount(): Promise<string> {
  const existing = await getBootstrapTeacherAccountId()
  if (existing) return existing
  const pool = getDbPool()
  // The bootstrap email follows the migration's synthetic naming
  // convention (admin-2026-05-22@levelchannel.internal). For the
  // ensure path we use a distinct address so we don't collide with a
  // real-running mig 0083 row that the test suite later inserts.
  const email = 'bootstrap-2026-05-22@levelchannel.internal'
  const insertRes = await pool.query<{ id: string }>(
    `insert into accounts (email, password_hash, email_verified_at,
                           teacher_account_migration_marker, created_at, updated_at)
     values ($1, 'fake-hash-bootstrap-ensure', now(),
             'bootstrap-2026-05-22', now(), now())
     on conflict (email) do update
       set teacher_account_migration_marker = excluded.teacher_account_migration_marker,
           updated_at = now()
     returning id`,
    [email],
  )
  const id = String(insertRes.rows[0].id)
  // Make sure the row has the teacher role so it's discoverable as
  // a real teacher account.
  await pool.query(
    `insert into account_roles (account_id, role)
     values ($1, 'teacher')
     on conflict (account_id, role) do nothing`,
    [id],
  )
  return id
}

// SAAS-PIVOT Epic 3 Day 4 (2026-05-22) — teacher-scoped catalog list.
// Used by `/teacher/packages` cabinet SSR. Returns BOTH active and
// inactive packages owned by this teacher; the editor surface
// renders both buckets (active list + archived list) so the operator
// can re-activate or just see the historical record.
export async function listPackagesByTeacher(
  teacherId: string,
): Promise<LessonPackage[]> {
  const pool = getDbPool()
  const result = await pool.query(
    `select ${PACKAGE_COLS}
       from lesson_packages
      where teacher_id = $1::uuid
      order by is_active desc, display_order asc, id asc`,
    [teacherId],
  )
  return result.rows.map((r) => rowToPackage(r as Record<string, unknown>))
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
