import { randomUUID } from 'node:crypto'

import type { PoolClient } from 'pg'

import { getDbPool } from '@/lib/db/pool'

export type PricingTariff = {
  id: string
  slug: string
  titleRu: string
  descriptionRu: string | null
  amountKopecks: number
  // BUG-2026-05-13-3: lesson length is part of the product (a 60-min
  // tariff is a different deliverable than a 90-min one). Required at
  // the DB level (migration 0046) and immutable after first slot
  // reference (same pattern as amount_kopecks).
  durationMinutes: number
  currency: 'RUB'
  isActive: boolean
  displayOrder: number
  // SAAS-PIVOT Epic 2 Day 3 — owning teacher account.
  // NOT NULL after mig 0088. Historical readers still get the field
  // populated; UI lists scope by teacher_id at the query layer.
  teacherId: string
  // SAAS-PIVOT Epic 2 Day 3 — soft-delete sentinel. `null` = active
  // (visible in teacher CRUD + bookable); non-null = archived.
  // Historical slot reads MUST still JOIN unfiltered (price/title
  // snapshot survives archive).
  deletedAt: string | null
  // T3 (mig 0102): per-learner ACL discriminator. 'catalog' = visible
  // to everyone (default for pre-T3 tariffs); 'private' = restricted
  // to learners with an active learner_tariff_access row.
  visibility: 'catalog' | 'private'
  createdAt: string
  updatedAt: string
}

export type TariffInput = {
  slug: string
  titleRu: string
  descriptionRu?: string | null
  amountKopecks: number
  durationMinutes: number
  isActive?: boolean
  displayOrder?: number
}

export type TariffPatch = Partial<TariffInput>

export type TariffValidationError =
  | { field: 'slug'; reason: 'invalid_format' }
  | { field: 'titleRu'; reason: 'too_short' | 'too_long' }
  | { field: 'descriptionRu'; reason: 'too_long' }
  | { field: 'amountKopecks'; reason: 'out_of_band' | 'not_integer' }
  | { field: 'durationMinutes'; reason: 'out_of_band' | 'not_integer' }

// SAAS-PIVOT Epic 2 Day 3 — booking-time gate error. Thrown by
// `assertTariffActive()` when the tariff is soft-deleted (deleted_at
// IS NOT NULL) or missing. Used by createSlot + bulkCreateSlots so the
// route can map to a 400 error rather than letting the FK fall through.
export class TariffNotActiveError extends Error {
  constructor(public readonly reason: 'unknown' | 'soft_deleted') {
    super(`slot/tariffId/${reason === 'unknown' ? 'unknown' : 'archived'}`)
    this.name = 'TariffNotActiveError'
  }
}

// SAAS-PIVOT Epic 2 Day 3 — cross-teacher slot creation guard. Thrown by
// `assertTariffOwnedByTeacher()` when a teacher tries to create a slot
// using a tariff that belongs to a DIFFERENT teacher. Routes map to
// 403/400. Defence-in-depth: the route already binds teacherAccountId
// from session, so this fires only when something silly happens
// upstream (or in admin contexts where a teacher_id arrives from body).
export class TariffOwnershipError extends Error {
  constructor(
    public readonly tariffOwnerId: string | null,
    public readonly expectedOwnerId: string,
  ) {
    super(`slot/tariffId/wrong_teacher`)
    this.name = 'TariffOwnershipError'
  }
}

const MIN_DURATION_MIN = 15
const MAX_DURATION_MIN = 240

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/

// Same band as the SQL CHECK constraint (1₽–1 000 000₽). Validating
// here gives a friendlier error than a constraint violation.
const MIN_AMOUNT_KOPECKS = 100
const MAX_AMOUNT_KOPECKS = 100_000_000

const MAX_TITLE_LEN = 120
const MAX_DESCRIPTION_LEN = 600

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function validateTariffInput(
  input: Partial<TariffInput>,
): TariffValidationError | null {
  if (input.slug !== undefined) {
    if (!SLUG_PATTERN.test(input.slug)) {
      return { field: 'slug', reason: 'invalid_format' }
    }
  }
  if (input.titleRu !== undefined) {
    const trimmed = input.titleRu.trim()
    if (trimmed.length === 0) {
      return { field: 'titleRu', reason: 'too_short' }
    }
    if (trimmed.length > MAX_TITLE_LEN) {
      return { field: 'titleRu', reason: 'too_long' }
    }
  }
  if (
    input.descriptionRu !== undefined &&
    input.descriptionRu !== null &&
    input.descriptionRu.length > MAX_DESCRIPTION_LEN
  ) {
    return { field: 'descriptionRu', reason: 'too_long' }
  }
  if (input.amountKopecks !== undefined) {
    if (!Number.isInteger(input.amountKopecks)) {
      return { field: 'amountKopecks', reason: 'not_integer' }
    }
    if (
      input.amountKopecks < MIN_AMOUNT_KOPECKS ||
      input.amountKopecks > MAX_AMOUNT_KOPECKS
    ) {
      return { field: 'amountKopecks', reason: 'out_of_band' }
    }
  }
  if (input.durationMinutes !== undefined) {
    if (!Number.isInteger(input.durationMinutes)) {
      return { field: 'durationMinutes', reason: 'not_integer' }
    }
    if (
      input.durationMinutes < MIN_DURATION_MIN ||
      input.durationMinutes > MAX_DURATION_MIN
    ) {
      return { field: 'durationMinutes', reason: 'out_of_band' }
    }
  }
  return null
}

// SAAS-PIVOT Epic 2 Day 3 — row mapper now hydrates teacher_id +
// deleted_at. After mig 0088 teacher_id is NOT NULL; we still defensively
// cast via String() and never assert non-null in case some pre-flip
// snapshot survives in a long-running connection.
function rowToTariff(row: Record<string, unknown>): PricingTariff {
  return {
    id: String(row.id),
    slug: String(row.slug),
    titleRu: String(row.title_ru),
    descriptionRu:
      row.description_ru === null ? null : String(row.description_ru),
    amountKopecks: Number(row.amount_kopecks),
    durationMinutes: Number(row.duration_minutes),
    currency: String(row.currency) as 'RUB',
    isActive: Boolean(row.is_active),
    displayOrder: Number(row.display_order),
    teacherId: row.teacher_id ? String(row.teacher_id) : '',
    deletedAt:
      row.deleted_at === null || row.deleted_at === undefined
        ? null
        : new Date(String(row.deleted_at)).toISOString(),
    visibility:
      row.visibility === 'private' ? 'private' : 'catalog',
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  }
}

// Column projection shared across reads. Centralised so the mapper
// can't drift away from the SELECT list silently.
const TARIFF_COLS = `id, slug, title_ru, description_ru, amount_kopecks,
       duration_minutes, currency, is_active, display_order,
       teacher_id, deleted_at, visibility, created_at, updated_at`

// SAAS-PIVOT Epic 2 Day 3 — admin-global view. By default hides
// soft-deleted rows (matches the operator's "show me my active catalog"
// expectation). Pass `includeArchived: true` for the recovery / audit
// surface. teacher-scope: admin-global.
export async function listAllTariffs(opts?: {
  includeArchived?: boolean
}): Promise<PricingTariff[]> {
  const pool = getDbPool()
  const includeArchived = opts?.includeArchived === true
  const result = await pool.query(
    `select ${TARIFF_COLS}
       from pricing_tariffs
      where ${includeArchived ? 'true' : 'deleted_at is null'}
      order by is_active desc, display_order asc, created_at asc`,
  )
  return result.rows.map(rowToTariff)
}

// SAAS-PIVOT Epic 2 Day 3 — listActiveTariffs now teacher-scopes.
// Pass `{ teacherId: null }` for admin-global (annotated -- teacher-scope:
// admin-global at the call-site). Pass `{ teacherId: '<uuid>' }` for
// the teacher's own catalogue.
//
// `is_active = true` AND `deleted_at IS NULL` — the booking surface
// requires both: an admin-archived tariff (`is_active=false`) and a
// teacher-soft-deleted tariff (`deleted_at IS NOT NULL`) are both
// excluded from new-write flows. Historical reads use the unfiltered
// JOIN path (`lib/scheduling/slots/queries.ts:29`, etc.).
export async function listActiveTariffs(opts?: {
  teacherId: string | null
}): Promise<PricingTariff[]> {
  const pool = getDbPool()
  const teacherId = opts?.teacherId ?? null
  if (teacherId === null) {
    const result = await pool.query(
      `select ${TARIFF_COLS}
         from pricing_tariffs
        where is_active = true
          and deleted_at is null
        order by display_order asc, created_at asc`,
    )
    return result.rows.map(rowToTariff)
  }
  if (!UUID_PATTERN.test(teacherId)) {
    return []
  }
  const result = await pool.query(
    `select ${TARIFF_COLS}
       from pricing_tariffs
      where is_active = true
        and deleted_at is null
        and teacher_id = $1
      order by display_order asc, created_at asc`,
    [teacherId],
  )
  return result.rows.map(rowToTariff)
}

// SAAS-PIVOT Epic 2 Day 3 — teacher CRUD surface list. Includes
// inactive (is_active=false) so the teacher can re-activate from the
// editor; excludes soft-deleted by default. Pass `includeArchived: true`
// for the archive view (admin tier or "show archived" toggle in /teacher/tariffs).
export async function listTariffsForTeacher(
  teacherId: string,
  opts?: { includeArchived?: boolean },
): Promise<PricingTariff[]> {
  if (!UUID_PATTERN.test(teacherId)) return []
  const pool = getDbPool()
  const includeArchived = opts?.includeArchived === true
  const result = await pool.query(
    `select ${TARIFF_COLS}
       from pricing_tariffs
      where teacher_id = $1
        ${includeArchived ? '' : 'and deleted_at is null'}
      order by deleted_at asc nulls first,
               is_active desc, display_order asc, created_at asc`,
    [teacherId],
  )
  return result.rows.map(rowToTariff)
}

// ─────────────────────────────────────────────────────────────────
// Free-tier 1pkg+1tariff unlock — 2026-06-02.
//
// Plan: docs/plans/free-tier-1pkg-1tariff-unlock.md §3+§4.
//
// `countActiveTariffsForTeacher` returns the active catalogue size
// for a teacher. Active = `deleted_at IS NULL` (the tariff UI has an
// explicit "Архивировать" button that writes deleted_at; archived
// tariffs no longer count toward the cap, so "archive → create new"
// works inside the free tier's 1-tariff budget).
//
// `countActiveTariffsForTeacherTx` is the same query bound to a
// pre-opened `PoolClient` — used by the route handler inside the
// advisory-lock TX so the count + create are serialized against
// concurrent POSTs from the same teacher.
//
// Note: we intentionally do NOT filter by `is_active=true` here
// because pricing_tariffs.is_active controls visibility in
// /admin/pricing (admin can deactivate a tariff while keeping it
// "owned" by the teacher); the teacher cap should reflect the
// teacher's owned catalogue, which is bounded by deleted_at only.
// ─────────────────────────────────────────────────────────────────

export async function countActiveTariffsForTeacher(
  teacherId: string,
): Promise<number> {
  if (!UUID_PATTERN.test(teacherId)) return 0
  const pool = getDbPool()
  const result = await pool.query<{ count: string }>(
    `select count(*)::text as count
       from pricing_tariffs
      where teacher_id = $1::uuid
        and deleted_at is null`,
    [teacherId],
  )
  return Number(result.rows[0]?.count ?? 0)
}

export async function countActiveTariffsForTeacherTx(
  client: PoolClient,
  teacherId: string,
): Promise<number> {
  if (!UUID_PATTERN.test(teacherId)) return 0
  const result = await client.query<{ count: string }>(
    `select count(*)::text as count
       from pricing_tariffs
      where teacher_id = $1::uuid
        and deleted_at is null`,
    [teacherId],
  )
  return Number(result.rows[0]?.count ?? 0)
}

/**
 * TX-aware variant of `createTariffForTeacher`. Caller MUST pass an
 * explicit `teacherId`. Used by /api/teacher/tariffs POST inside the
 * advisory-lock TX so the count + insert are serialized.
 *
 * Performs the same validation as `createTariffForTeacher`; raises
 * before the INSERT if validation fails. Caller commits/rolls back
 * the TX.
 */
export async function createTariffForTeacherTx(
  client: PoolClient,
  input: {
    teacherId: string
    slug: string
    titleRu: string
    descriptionRu?: string | null
    amountKopecks: number
    durationMinutes: number
    isActive?: boolean
    displayOrder?: number
  },
): Promise<PricingTariff> {
  if (!UUID_PATTERN.test(input.teacherId)) {
    throw new Error('tariff validation failed: teacherId/invalid')
  }
  const validation = validateTariffInput({
    slug: input.slug,
    titleRu: input.titleRu,
    descriptionRu: input.descriptionRu ?? undefined,
    amountKopecks: input.amountKopecks,
    durationMinutes: input.durationMinutes,
    isActive: input.isActive,
    displayOrder: input.displayOrder,
  })
  if (validation) {
    throw new Error(
      `tariff validation failed: ${validation.field}/${validation.reason}`,
    )
  }
  if (!Number.isInteger(input.durationMinutes)) {
    throw new Error(
      'tariff validation failed: durationMinutes/required_integer',
    )
  }
  const id = randomUUID()
  const result = await client.query(
    `insert into pricing_tariffs (
       id, slug, title_ru, description_ru, amount_kopecks,
       duration_minutes, is_active, display_order, teacher_id
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     returning ${TARIFF_COLS}`,
    [
      id,
      input.slug,
      input.titleRu.trim(),
      input.descriptionRu ?? null,
      input.amountKopecks,
      input.durationMinutes,
      input.isActive ?? true,
      input.displayOrder ?? 0,
      input.teacherId,
    ],
  )
  return rowToTariff(result.rows[0])
}

export async function getTariffById(id: string): Promise<PricingTariff | null> {
  const pool = getDbPool()
  const result = await pool.query(
    `select ${TARIFF_COLS}
       from pricing_tariffs
      where id = $1`,
    [id],
  )
  return result.rows[0] ? rowToTariff(result.rows[0]) : null
}

// SAAS-PIVOT Epic 2 Day 3 — anti-spoof read. Returns the tariff ONLY
// when (teacher_id = $teacherId AND deleted_at IS NULL). Used by the
// /teacher/tariffs UI + by the slot creation gate. Anonymous "is this
// my tariff?" probe — does not throw on mismatch, just returns null,
// keeping the surface compatible with not-found UI.
export async function getTariffForTeacher(
  id: string,
  teacherId: string,
  opts?: { includeArchived?: boolean },
): Promise<PricingTariff | null> {
  if (!UUID_PATTERN.test(id)) return null
  if (!UUID_PATTERN.test(teacherId)) return null
  const pool = getDbPool()
  const includeArchived = opts?.includeArchived === true
  const result = await pool.query(
    `select ${TARIFF_COLS}
       from pricing_tariffs
      where id = $1
        and teacher_id = $2
        ${includeArchived ? '' : 'and deleted_at is null'}`,
    [id, teacherId],
  )
  return result.rows[0] ? rowToTariff(result.rows[0]) : null
}

// Legacy createTariff — kept for the admin-global write path. After
// mig 0088 every INSERT needs a teacher_id; we route admin writes
// through `createTariffForTeacher` with an explicit teacher (the
// bootstrap teacher being the default in the admin UI).
export async function createTariff(
  input: TariffInput & { teacherId: string },
): Promise<PricingTariff> {
  return createTariffForTeacher({
    teacherId: input.teacherId,
    slug: input.slug,
    titleRu: input.titleRu,
    descriptionRu: input.descriptionRu ?? null,
    amountKopecks: input.amountKopecks,
    durationMinutes: input.durationMinutes,
    isActive: input.isActive,
    displayOrder: input.displayOrder,
  })
}

// SAAS-PIVOT Epic 2 Day 3 — teacher-scoped create. Sets `teacher_id`
// at insertion. UNIQUE on slug is still global (mig 0076b's composite
// flip is for lesson_packages, NOT pricing_tariffs — the latter retains
// its global slug uniqueness until a separate epic addresses it). To
// keep slug collisions tractable while the global UNIQUE stands, the
// teacher's id-prefix MAY be embedded into the slug at the route layer,
// but the storage primitive does not enforce that — callers decide.
export async function createTariffForTeacher(input: {
  teacherId: string
  slug: string
  titleRu: string
  descriptionRu?: string | null
  amountKopecks: number
  durationMinutes: number
  isActive?: boolean
  displayOrder?: number
}): Promise<PricingTariff> {
  if (!UUID_PATTERN.test(input.teacherId)) {
    throw new Error('tariff validation failed: teacherId/invalid')
  }
  const validation = validateTariffInput({
    slug: input.slug,
    titleRu: input.titleRu,
    descriptionRu: input.descriptionRu ?? undefined,
    amountKopecks: input.amountKopecks,
    durationMinutes: input.durationMinutes,
    isActive: input.isActive,
    displayOrder: input.displayOrder,
  })
  if (validation) {
    throw new Error(
      `tariff validation failed: ${validation.field}/${validation.reason}`,
    )
  }
  // BUG-2026-05-13-3: duration_minutes is now a required input. Catch
  // missing values at the app layer so the friendlier error fires
  // before the DB NOT NULL constraint does.
  if (!Number.isInteger(input.durationMinutes)) {
    throw new Error(
      'tariff validation failed: durationMinutes/required_integer',
    )
  }
  const pool = getDbPool()
  const id = randomUUID()
  const result = await pool.query(
    `insert into pricing_tariffs (
       id, slug, title_ru, description_ru, amount_kopecks,
       duration_minutes, is_active, display_order, teacher_id
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     returning ${TARIFF_COLS}`,
    [
      id,
      input.slug,
      input.titleRu.trim(),
      input.descriptionRu ?? null,
      input.amountKopecks,
      input.durationMinutes,
      input.isActive ?? true,
      input.displayOrder ?? 0,
      input.teacherId,
    ],
  )
  return rowToTariff(result.rows[0])
}

export async function updateTariff(
  id: string,
  patch: TariffPatch,
): Promise<PricingTariff | null> {
  const validation = validateTariffInput(patch)
  if (validation) {
    throw new Error(
      `tariff validation failed: ${validation.field}/${validation.reason}`,
    )
  }
  const pool = getDbPool()
  // Billing wave PR 1 / Codex round 1: amount_kopecks is immutable
  // once any lesson_slot references this tariff. App-layer guard
  // surfaces the friendly UI error before the DB trigger fires
  // (migration 0033 installs the trigger as the security boundary).
  if ('amountKopecks' in patch && patch.amountKopecks != null) {
    const refCheck = await pool.query(
      `select 1 from lesson_slots where tariff_id = $1 limit 1`,
      [id],
    )
    if (refCheck.rows.length > 0) {
      const current = await pool.query(
        `select amount_kopecks from pricing_tariffs where id = $1`,
        [id],
      )
      const currentAmount = current.rows[0]
        ? Number(current.rows[0].amount_kopecks)
        : null
      if (currentAmount !== null && patch.amountKopecks !== currentAmount) {
        throw new Error(
          'tariff validation failed: amountKopecks/immutable_after_first_slot_reference',
        )
      }
    }
  }
  // BUG-2026-05-13-3: duration_minutes is also immutable once any
  // lesson_slot references this tariff. Same FK-as-snapshot pattern;
  // the DB trigger `pricing_tariffs_duration_guard` (migration 0046)
  // is the hard guard. App-layer check fires the friendlier error.
  if ('durationMinutes' in patch && patch.durationMinutes != null) {
    const refCheck = await pool.query(
      `select 1 from lesson_slots where tariff_id = $1 limit 1`,
      [id],
    )
    if (refCheck.rows.length > 0) {
      const current = await pool.query(
        `select duration_minutes from pricing_tariffs where id = $1`,
        [id],
      )
      const currentDuration = current.rows[0]
        ? Number(current.rows[0].duration_minutes)
        : null
      if (
        currentDuration !== null &&
        patch.durationMinutes !== currentDuration
      ) {
        throw new Error(
          'tariff validation failed: durationMinutes/immutable_after_first_slot_reference',
        )
      }
    }
  }
  // COALESCE-by-flag pattern matching account_profiles.upsert: we need
  // to distinguish "leave unchanged" (key absent) from "clear to null"
  // (key present with null value).
  const result = await pool.query(
    `update pricing_tariffs set
       slug             = case when $2 then $3            else slug             end,
       title_ru         = case when $4 then $5            else title_ru         end,
       description_ru   = case when $6 then $7            else description_ru   end,
       amount_kopecks   = case when $8 then $9            else amount_kopecks   end,
       is_active        = case when $10 then $11          else is_active        end,
       display_order    = case when $12 then $13          else display_order    end,
       duration_minutes = case when $14 then $15          else duration_minutes end,
       updated_at = now()
     where id = $1
     returning ${TARIFF_COLS}`,
    [
      id,
      'slug' in patch,
      patch.slug ?? null,
      'titleRu' in patch,
      patch.titleRu?.trim() ?? null,
      'descriptionRu' in patch,
      patch.descriptionRu ?? null,
      'amountKopecks' in patch,
      patch.amountKopecks ?? null,
      'isActive' in patch,
      patch.isActive ?? null,
      'displayOrder' in patch,
      patch.displayOrder ?? null,
      'durationMinutes' in patch,
      patch.durationMinutes ?? null,
    ],
  )
  return result.rows[0] ? rowToTariff(result.rows[0]) : null
}

// SAAS-PIVOT Epic 2 Day 3 — teacher-scoped UPDATE. Anti-spoof: WHERE
// teacher_id = $teacherId is IN the UPDATE (NOT a read-then-write), so
// no time-of-check-vs-time-of-use leak. Returns null when (a) the
// tariff doesn't exist, (b) it belongs to a different teacher, or
// (c) it's already soft-deleted. The route maps null → 404 (don't
// distinguish — that would leak existence to a non-owner).
export async function updateTariffForTeacher(
  id: string,
  teacherId: string,
  patch: TariffPatch,
): Promise<PricingTariff | null> {
  if (!UUID_PATTERN.test(id)) return null
  if (!UUID_PATTERN.test(teacherId)) return null
  const validation = validateTariffInput(patch)
  if (validation) {
    throw new Error(
      `tariff validation failed: ${validation.field}/${validation.reason}`,
    )
  }
  const pool = getDbPool()
  // Re-use immutability guards from the legacy path; cheaper to dedup
  // by ownership-checking the tariff first (single round trip) than
  // to wedge `teacher_id = $X` into every guard's read query.
  const ownership = await pool.query(
    `select 1
       from pricing_tariffs
      where id = $1
        and teacher_id = $2
        and deleted_at is null`,
    [id, teacherId],
  )
  if (ownership.rowCount === 0) return null

  if ('amountKopecks' in patch && patch.amountKopecks != null) {
    const refCheck = await pool.query(
      `select 1 from lesson_slots where tariff_id = $1 limit 1`,
      [id],
    )
    if (refCheck.rows.length > 0) {
      const current = await pool.query(
        `select amount_kopecks from pricing_tariffs where id = $1`,
        [id],
      )
      const currentAmount = current.rows[0]
        ? Number(current.rows[0].amount_kopecks)
        : null
      if (currentAmount !== null && patch.amountKopecks !== currentAmount) {
        throw new Error(
          'tariff validation failed: amountKopecks/immutable_after_first_slot_reference',
        )
      }
    }
  }
  if ('durationMinutes' in patch && patch.durationMinutes != null) {
    const refCheck = await pool.query(
      `select 1 from lesson_slots where tariff_id = $1 limit 1`,
      [id],
    )
    if (refCheck.rows.length > 0) {
      const current = await pool.query(
        `select duration_minutes from pricing_tariffs where id = $1`,
        [id],
      )
      const currentDuration = current.rows[0]
        ? Number(current.rows[0].duration_minutes)
        : null
      if (
        currentDuration !== null &&
        patch.durationMinutes !== currentDuration
      ) {
        throw new Error(
          'tariff validation failed: durationMinutes/immutable_after_first_slot_reference',
        )
      }
    }
  }

  const result = await pool.query(
    `update pricing_tariffs set
       slug             = case when $3 then $4            else slug             end,
       title_ru         = case when $5 then $6            else title_ru         end,
       description_ru   = case when $7 then $8            else description_ru   end,
       amount_kopecks   = case when $9 then $10           else amount_kopecks   end,
       is_active        = case when $11 then $12          else is_active        end,
       display_order    = case when $13 then $14          else display_order    end,
       duration_minutes = case when $15 then $16          else duration_minutes end,
       updated_at = now()
     where id = $1
       and teacher_id = $2
       and deleted_at is null
     returning ${TARIFF_COLS}`,
    [
      id,
      teacherId,
      'slug' in patch,
      patch.slug ?? null,
      'titleRu' in patch,
      patch.titleRu?.trim() ?? null,
      'descriptionRu' in patch,
      patch.descriptionRu ?? null,
      'amountKopecks' in patch,
      patch.amountKopecks ?? null,
      'isActive' in patch,
      patch.isActive ?? null,
      'displayOrder' in patch,
      patch.displayOrder ?? null,
      'durationMinutes' in patch,
      patch.durationMinutes ?? null,
    ],
  )
  return result.rows[0] ? rowToTariff(result.rows[0]) : null
}

// SAAS-PIVOT Epic 2 Day 3 — soft-delete. Sets deleted_at = now() ONLY
// when (teacher_id = $teacherId AND deleted_at IS NULL). Single
// statement; no read-then-write race. Historical slot reads still
// resolve title/price via the unfiltered LEFT JOIN (queries.ts:29,
// payment slot-binding, paid-state).
//
// Returns:
//   - { ok: true, tariff } — soft-deleted; the row is now deleted_at=now()
//   - { ok: false, reason: 'not_found' } — id doesn't exist, isn't this
//     teacher's, or is already archived. Routes map all three to 404 to
//     avoid leaking existence.
export async function softDeleteTariffForTeacher(
  id: string,
  teacherId: string,
): Promise<
  | { ok: true; tariff: PricingTariff }
  | { ok: false; reason: 'not_found' }
> {
  if (!UUID_PATTERN.test(id)) return { ok: false, reason: 'not_found' }
  if (!UUID_PATTERN.test(teacherId)) {
    return { ok: false, reason: 'not_found' }
  }
  const pool = getDbPool()
  const result = await pool.query(
    `update pricing_tariffs
        set deleted_at = now(),
            is_active = false,
            updated_at = now()
      where id = $1
        and teacher_id = $2
        and deleted_at is null
      returning ${TARIFF_COLS}`,
    [id, teacherId],
  )
  if (result.rows[0]) {
    return { ok: true, tariff: rowToTariff(result.rows[0]) }
  }
  return { ok: false, reason: 'not_found' }
}

// SAAS-PIVOT Epic 2 Day 3 — booking-time gate. Used by createSlot +
// bulkCreateSlots to refuse binding a tariff that has been soft-deleted
// (deleted_at IS NOT NULL) or never existed. Returns the tariff on
// success; throws TariffNotActiveError on rejection so the route can
// surface a clean error.
export async function assertTariffActive(
  tariffId: string,
): Promise<PricingTariff> {
  const tariff = await getTariffById(tariffId)
  if (!tariff) {
    throw new TariffNotActiveError('unknown')
  }
  if (tariff.deletedAt !== null) {
    throw new TariffNotActiveError('soft_deleted')
  }
  return tariff
}

// SAAS-PIVOT Epic 2 Day 3 — slot-create ownership gate. Throws
// TariffOwnershipError when the tariff's teacher_id differs from the
// expected one (slot's teacher creator). Used by createSlot +
// bulkCreateSlots for teacher writers; admin writers pick the slot's
// `teacherAccountId` from the body, so the helper compares against
// THAT (not the session) to keep the admin "as which teacher" UX.
export async function assertTariffOwnedByTeacher(
  tariffId: string,
  teacherAccountId: string,
): Promise<void> {
  const tariff = await getTariffById(tariffId)
  if (!tariff) {
    // Surface "unknown" via the not-active error path — same UX
    // (createSlot wraps both into slot/tariffId/unknown OR ...archived).
    throw new TariffNotActiveError('unknown')
  }
  if (tariff.teacherId !== teacherAccountId) {
    throw new TariffOwnershipError(tariff.teacherId, teacherAccountId)
  }
}

// BUG-2 (2026-05-13 intake): hard-delete a tariff row. Refuses if ANY
// lesson_slot ever referenced it — even cancelled past slots, because
// the FK is `on delete set null`, and we'd silently wipe the
// audit/billing trail. Operator is asked to deactivate instead.
//
// Returns:
//   - { ok: true, snapshot }
//     — row deleted; snapshot is the EXACT row that DELETE saw
//       (`DELETE … RETURNING *` under FOR UPDATE), so the audit log
//       caller can never record drifted state from a concurrent PATCH.
//   - { ok: false, reason: 'not_found' }
//   - { ok: false, reason: 'has_slot_references', slotCount }
//     — at least one slot points (or pointed) at this tariff
export async function deleteTariffIfUnreferenced(
  id: string,
): Promise<
  | { ok: true; snapshot: PricingTariff }
  | { ok: false, reason: 'not_found' }
  | { ok: false, reason: 'has_slot_references', slotCount: number }
> {
  const pool = getDbPool()
  // Single TX so a concurrent slot creation can't slip past the
  // reference check between SELECT and DELETE, and a concurrent PATCH
  // can't drift the snapshot we return for audit logging.
  const client = await pool.connect()
  try {
    await client.query('begin')
    const exists = await client.query(
      `select 1 from pricing_tariffs where id = $1 for update`,
      [id],
    )
    if (exists.rows.length === 0) {
      await client.query('rollback')
      return { ok: false, reason: 'not_found' }
    }
    const refCount = await client.query(
      `select count(*)::int as n from lesson_slots where tariff_id = $1`,
      [id],
    )
    const n = Number(refCount.rows[0]?.n ?? 0)
    if (n > 0) {
      await client.query('rollback')
      return { ok: false, reason: 'has_slot_references', slotCount: n }
    }
    const deleted = await client.query(
      `delete from pricing_tariffs where id = $1 returning *`,
      [id],
    )
    await client.query('commit')
    return { ok: true, snapshot: rowToTariff(deleted.rows[0]) }
  } catch (err) {
    await client.query('rollback')
    throw err
  } finally {
    client.release()
  }
}
