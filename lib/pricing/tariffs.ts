import { randomUUID } from 'node:crypto'

import { getDbPool } from '@/lib/db/pool'

export type PricingTariff = {
  id: string
  slug: string
  titleRu: string
  descriptionRu: string | null
  amountKopecks: number
  currency: 'RUB'
  isActive: boolean
  displayOrder: number
  createdAt: string
  updatedAt: string
}

export type TariffInput = {
  slug: string
  titleRu: string
  descriptionRu?: string | null
  amountKopecks: number
  isActive?: boolean
  displayOrder?: number
}

export type TariffPatch = Partial<TariffInput>

export type TariffValidationError =
  | { field: 'slug'; reason: 'invalid_format' }
  | { field: 'titleRu'; reason: 'too_short' | 'too_long' }
  | { field: 'descriptionRu'; reason: 'too_long' }
  | { field: 'amountKopecks'; reason: 'out_of_band' | 'not_integer' }

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/

// Same band as the SQL CHECK constraint (1₽–1 000 000₽). Validating
// here gives a friendlier error than a constraint violation.
const MIN_AMOUNT_KOPECKS = 100
const MAX_AMOUNT_KOPECKS = 100_000_000

const MAX_TITLE_LEN = 120
const MAX_DESCRIPTION_LEN = 600

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
  return null
}

function rowToTariff(row: Record<string, unknown>): PricingTariff {
  return {
    id: String(row.id),
    slug: String(row.slug),
    titleRu: String(row.title_ru),
    descriptionRu:
      row.description_ru === null ? null : String(row.description_ru),
    amountKopecks: Number(row.amount_kopecks),
    currency: String(row.currency) as 'RUB',
    isActive: Boolean(row.is_active),
    displayOrder: Number(row.display_order),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  }
}

export async function listAllTariffs(): Promise<PricingTariff[]> {
  const pool = getDbPool()
  const result = await pool.query(
    `select id, slug, title_ru, description_ru, amount_kopecks, currency,
            is_active, display_order, created_at, updated_at
     from pricing_tariffs
     order by is_active desc, display_order asc, created_at asc`,
  )
  return result.rows.map(rowToTariff)
}

export async function listActiveTariffs(): Promise<PricingTariff[]> {
  const pool = getDbPool()
  const result = await pool.query(
    `select id, slug, title_ru, description_ru, amount_kopecks, currency,
            is_active, display_order, created_at, updated_at
     from pricing_tariffs
     where is_active = true
     order by display_order asc, created_at asc`,
  )
  return result.rows.map(rowToTariff)
}

export async function getTariffById(id: string): Promise<PricingTariff | null> {
  const pool = getDbPool()
  const result = await pool.query(
    `select id, slug, title_ru, description_ru, amount_kopecks, currency,
            is_active, display_order, created_at, updated_at
     from pricing_tariffs
     where id = $1`,
    [id],
  )
  return result.rows[0] ? rowToTariff(result.rows[0]) : null
}

export async function createTariff(input: TariffInput): Promise<PricingTariff> {
  const validation = validateTariffInput(input)
  if (validation) {
    throw new Error(
      `tariff validation failed: ${validation.field}/${validation.reason}`,
    )
  }
  const pool = getDbPool()
  const id = randomUUID()
  const result = await pool.query(
    `insert into pricing_tariffs (
       id, slug, title_ru, description_ru, amount_kopecks,
       is_active, display_order
     ) values ($1, $2, $3, $4, $5, $6, $7)
     returning id, slug, title_ru, description_ru, amount_kopecks, currency,
               is_active, display_order, created_at, updated_at`,
    [
      id,
      input.slug,
      input.titleRu.trim(),
      input.descriptionRu ?? null,
      input.amountKopecks,
      input.isActive ?? true,
      input.displayOrder ?? 0,
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
  // COALESCE-by-flag pattern matching account_profiles.upsert: we need
  // to distinguish "leave unchanged" (key absent) from "clear to null"
  // (key present with null value).
  const result = await pool.query(
    `update pricing_tariffs set
       slug           = case when $2 then $3            else slug           end,
       title_ru       = case when $4 then $5            else title_ru       end,
       description_ru = case when $6 then $7            else description_ru end,
       amount_kopecks = case when $8 then $9            else amount_kopecks end,
       is_active      = case when $10 then $11          else is_active      end,
       display_order  = case when $12 then $13          else display_order  end,
       updated_at = now()
     where id = $1
     returning id, slug, title_ru, description_ru, amount_kopecks, currency,
               is_active, display_order, created_at, updated_at`,
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
    ],
  )
  return result.rows[0] ? rowToTariff(result.rows[0]) : null
}
