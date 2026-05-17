// ALERTS-EDITOR Sub-PR A (2026-05-17) — schema + resolver + write
// path for operator-tunable settings.
//
// Plan: docs/plans/alerts-editor.md.
//
// Contract: DB row → env var → hardcoded default. Reads tolerate
// malformed DB (log + fall through). Writes use single-TX `select
// for update` + split INSERT-with-ON-CONFLICT-DO-NOTHING / UPDATE
// paths so concurrent admins can't both succeed silently.
//
// Schema MUST stay in sync with scripts/lib/operator-settings.mjs.
// A drift test pins JSON.stringify equality between the two files.

import { isUndefinedTableError } from '@/lib/db/errors'
import { getDbPool } from '@/lib/db/pool'

export type ProbeName = 'auth-flow' | 'calendar-pathology' | 'webhook-flow'

type SettingSchemaInt = {
  kind: 'int'
  default: number
  min: number
  max: number
  envName: string
  description: string
  scope: ProbeName
}

type SettingSchemaDecimal = {
  kind: 'decimal'
  default: number
  min: number
  max: number
  decimalPlaces: number
  envName: string
  description: string
  scope: ProbeName
}

type SettingSchema = SettingSchemaInt | SettingSchemaDecimal

// The whitelist. Adding a key requires landing it in BOTH this file
// AND scripts/lib/operator-settings.mjs in the same PR. The drift
// test catches divergence.
export const SETTING_SCHEMA = {
  CALENDAR_PATHOLOGY_THRESHOLD: {
    kind: 'int',
    default: 3,
    min: 1,
    max: 100,
    envName: 'CALENDAR_PATHOLOGY_THRESHOLD',
    description: 'cancel_repush_count floor for triggering the alert',
    scope: 'calendar-pathology',
  },
  CALENDAR_PATHOLOGY_REPORT_LIMIT: {
    kind: 'int',
    default: 10,
    min: 1,
    max: 100,
    envName: 'CALENDAR_PATHOLOGY_REPORT_LIMIT',
    description: 'max offenders enumerated in the alert email body',
    scope: 'calendar-pathology',
  },
  CALENDAR_PATHOLOGY_DEDUP_WINDOW_MS: {
    kind: 'int',
    default: 86_400_000,
    min: 60_000,
    max: 7 * 86_400_000,
    envName: 'CALENDAR_PATHOLOGY_DEDUP_WINDOW_MS',
    description: 'suppress duplicate alerts within this window (ms)',
    scope: 'calendar-pathology',
  },
  AUTH_FLOW_WINDOW_MINUTES: {
    kind: 'int',
    default: 60,
    min: 5,
    max: 1440,
    envName: 'AUTH_FLOW_WINDOW_MINUTES',
    description: 'rolling window of failed-login activity (minutes)',
    scope: 'auth-flow',
  },
  AUTH_FLOW_MAX_PER_IP: {
    kind: 'int',
    default: 50,
    min: 5,
    max: 10000,
    envName: 'AUTH_FLOW_MAX_PER_IP',
    description: 'failed-login count per IP that triggers an alert',
    scope: 'auth-flow',
  },
  AUTH_FLOW_MAX_PER_EMAIL_HASH: {
    kind: 'int',
    default: 20,
    min: 3,
    max: 10000,
    envName: 'AUTH_FLOW_MAX_PER_EMAIL_HASH',
    description: 'failed-login count per (hashed) email that triggers an alert',
    scope: 'auth-flow',
  },
  AUTH_FLOW_DEDUP_WINDOW_MS: {
    kind: 'int',
    default: 4 * 3600 * 1000,
    min: 60_000,
    max: 7 * 86_400_000,
    envName: 'AUTH_FLOW_DEDUP_WINDOW_MS',
    description: 'suppress duplicate alerts within this window (ms)',
    scope: 'auth-flow',
  },
  WEBHOOK_FLOW_WINDOW_MINUTES: {
    kind: 'int',
    default: 60,
    min: 5,
    max: 1440,
    envName: 'WEBHOOK_FLOW_WINDOW_MINUTES',
    description: 'rolling window of webhook activity (minutes)',
    scope: 'webhook-flow',
  },
  WEBHOOK_FLOW_MIN_VOLUME: {
    kind: 'int',
    default: 5,
    min: 1,
    max: 10000,
    envName: 'WEBHOOK_FLOW_MIN_VOLUME',
    description: 'minimum webhook volume in window before alert is considered',
    scope: 'webhook-flow',
  },
  WEBHOOK_FLOW_TERMINATED_RATIO: {
    kind: 'decimal',
    default: 0.3,
    min: 0,
    max: 1,
    decimalPlaces: 2,
    envName: 'WEBHOOK_FLOW_TERMINATED_RATIO',
    description: 'terminated-vs-success ratio threshold (0.0 to 1.0)',
    scope: 'webhook-flow',
  },
} as const satisfies Record<string, SettingSchema>

export type SettingKey = keyof typeof SETTING_SCHEMA

export type SettingSource = 'db' | 'env' | 'default'
export type ResolvedSetting = {
  value: number
  source: SettingSource
  rawDb: string | null
  rawEnv: string | null
}

const INTEGER_PATTERN = /^\d+$/

function validateInt(schema: SettingSchemaInt, raw: string): number | null {
  if (!INTEGER_PATTERN.test(raw)) return null
  const n = Number(raw)
  if (!Number.isInteger(n) || n < schema.min || n > schema.max) return null
  return n
}

function validateDecimal(
  schema: SettingSchemaDecimal,
  raw: string,
): number | null {
  const pattern = new RegExp(
    `^(0|[1-9]\\d*)(\\.\\d{1,${schema.decimalPlaces}})?$`,
  )
  if (!pattern.test(raw)) return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n < schema.min || n > schema.max) return null
  return n
}

function validate(schema: SettingSchema, raw: string): number | null {
  return schema.kind === 'int'
    ? validateInt(schema, raw)
    : validateDecimal(schema, raw)
}

// Single-key resolver. Reads DB → env → default.
export async function resolveOperatorSetting<K extends SettingKey>(
  key: K,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ResolvedSetting> {
  const schema = SETTING_SCHEMA[key]
  let rawDb: string | null = null
  let rawEnv: string | null = null
  try {
    const pool = getDbPool()
    const r = await pool.query(
      `select value from operator_settings where key = $1`,
      [key],
    )
    if (r.rows[0]) {
      rawDb = String(r.rows[0].value)
      const v = validate(schema, rawDb)
      if (v !== null) {
        return { value: v, source: 'db', rawDb, rawEnv: null }
      }
      // eslint-disable-next-line no-console
      console.warn('[operator-settings] DB row invalid', { key, rawDb })
    }
  } catch (err) {
    if (!isUndefinedTableError(err)) {
      // eslint-disable-next-line no-console
      console.warn('[operator-settings] DB read failed', {
        key,
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }
  const envRaw = env[schema.envName]
  rawEnv = typeof envRaw === 'string' ? envRaw.trim() : null
  if (rawEnv && rawEnv.length > 0) {
    const v = validate(schema, rawEnv)
    if (v !== null) {
      return { value: v, source: 'env', rawDb, rawEnv }
    }
  }
  return { value: schema.default, source: 'default', rawDb, rawEnv }
}

// Per-probe snapshot. ONE round-trip reads all keys for the probe;
// the result is the immutable config for the whole tick (no
// mid-tick re-read). R1 BLOCKER #2.
export async function resolveOperatorSettingsForProbe(
  probeName: ProbeName,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Record<string, ResolvedSetting>> {
  const keys = (Object.keys(SETTING_SCHEMA) as SettingKey[]).filter(
    (k) => SETTING_SCHEMA[k].scope === probeName,
  )
  const dbValues = new Map<string, string>()
  try {
    const pool = getDbPool()
    const r = await pool.query(
      `select key, value from operator_settings where key = any($1::text[])`,
      [keys],
    )
    for (const row of r.rows) {
      dbValues.set(String(row.key), String(row.value))
    }
  } catch (err) {
    if (!isUndefinedTableError(err)) {
      // eslint-disable-next-line no-console
      console.warn('[operator-settings] snapshot DB read failed', {
        probeName,
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }
  const out: Record<string, ResolvedSetting> = {}
  for (const k of keys) {
    const schema = SETTING_SCHEMA[k]
    const rawDb = dbValues.has(k) ? (dbValues.get(k) as string) : null
    const envRaw = env[schema.envName]
    const rawEnv = typeof envRaw === 'string' ? envRaw.trim() : null
    if (rawDb !== null) {
      const v = validate(schema, rawDb)
      if (v !== null) {
        out[k] = { value: v, source: 'db', rawDb, rawEnv }
        continue
      }
    }
    if (rawEnv && rawEnv.length > 0) {
      const v = validate(schema, rawEnv)
      if (v !== null) {
        out[k] = { value: v, source: 'env', rawDb, rawEnv }
        continue
      }
    }
    out[k] = { value: schema.default, source: 'default', rawDb, rawEnv }
  }
  return out
}

export type WriteResult =
  | { ok: true; updatedAt: string }
  | {
      ok: false
      reason:
        | 'unknown_key'
        | 'invalid_value'
        | 'concurrent_update'
        | 'migration_pending'
    }

// R3 post-loop fix — split INSERT-with-ON-CONFLICT-DO-NOTHING vs
// UPDATE paths so the first-create race surfaces as 409, not
// silent overwrite.
export async function setOperatorSetting(input: {
  key: SettingKey
  value: string
  expectedUpdatedAt: string | null
  byAccountId: string
}): Promise<WriteResult> {
  const schema = SETTING_SCHEMA[input.key]
  if (!schema) return { ok: false, reason: 'unknown_key' }
  const validated = validate(schema, input.value)
  if (validated === null) return { ok: false, reason: 'invalid_value' }
  const client = await getDbPool().connect()
  try {
    await client.query('begin')
    const prior = await client.query(
      `select value, updated_at from operator_settings where key = $1 for update`,
      [input.key],
    )
    const priorRow = prior.rows[0] as
      | { value: unknown; updated_at: unknown }
      | undefined
    const persistedValue =
      schema.kind === 'decimal'
        ? validated.toFixed(schema.decimalPlaces)
        : String(validated)
    let updatedAtIso: string
    if (!priorRow) {
      if (input.expectedUpdatedAt !== null) {
        await client.query('rollback')
        return { ok: false, reason: 'concurrent_update' }
      }
      const inserted = await client.query(
        `insert into operator_settings (key, value, description, updated_by_account_id)
         values ($1, $2, $3, $4)
         on conflict (key) do nothing
         returning updated_at`,
        [input.key, persistedValue, schema.description, input.byAccountId],
      )
      if (inserted.rows.length === 0) {
        await client.query('rollback')
        return { ok: false, reason: 'concurrent_update' }
      }
      updatedAtIso = new Date(
        String(inserted.rows[0].updated_at),
      ).toISOString()
    } else {
      if (input.expectedUpdatedAt === null) {
        await client.query('rollback')
        return { ok: false, reason: 'concurrent_update' }
      }
      const priorIso = new Date(String(priorRow.updated_at)).toISOString()
      if (priorIso !== input.expectedUpdatedAt) {
        await client.query('rollback')
        return { ok: false, reason: 'concurrent_update' }
      }
      const updated = await client.query(
        `update operator_settings set
           value = $2,
           description = $3,
           updated_at = now(),
           updated_by_account_id = $4
         where key = $1
         returning updated_at`,
        [input.key, persistedValue, schema.description, input.byAccountId],
      )
      updatedAtIso = new Date(
        String(updated.rows[0].updated_at),
      ).toISOString()
    }
    await client.query(
      `insert into operator_settings_events
         (key, event_kind, old_value, new_value, updated_by_account_id)
       values ($1, 'set', $2, $3, $4)`,
      [
        input.key,
        priorRow ? String(priorRow.value) : null,
        persistedValue,
        input.byAccountId,
      ],
    )
    await client.query('commit')
    return { ok: true, updatedAt: updatedAtIso }
  } catch (err) {
    await client.query('rollback').catch(() => {})
    if (isUndefinedTableError(err)) {
      return { ok: false, reason: 'migration_pending' }
    }
    throw err
  } finally {
    client.release()
  }
}

export async function deleteOperatorSetting(input: {
  key: SettingKey
  expectedUpdatedAt: string
  byAccountId: string
}): Promise<WriteResult> {
  const schema = SETTING_SCHEMA[input.key]
  if (!schema) return { ok: false, reason: 'unknown_key' }
  const client = await getDbPool().connect()
  try {
    await client.query('begin')
    const prior = await client.query(
      `select value, updated_at from operator_settings where key = $1 for update`,
      [input.key],
    )
    if (!prior.rows[0]) {
      await client.query('rollback')
      return { ok: false, reason: 'concurrent_update' }
    }
    const priorIso = new Date(
      String(prior.rows[0].updated_at),
    ).toISOString()
    if (priorIso !== input.expectedUpdatedAt) {
      await client.query('rollback')
      return { ok: false, reason: 'concurrent_update' }
    }
    await client.query(`delete from operator_settings where key = $1`, [
      input.key,
    ])
    await client.query(
      `insert into operator_settings_events
         (key, event_kind, old_value, new_value, updated_by_account_id)
       values ($1, 'delete', $2, null, $3)`,
      [input.key, String(prior.rows[0].value), input.byAccountId],
    )
    await client.query('commit')
    return { ok: true, updatedAt: new Date().toISOString() }
  } catch (err) {
    await client.query('rollback').catch(() => {})
    if (isUndefinedTableError(err)) {
      return { ok: false, reason: 'migration_pending' }
    }
    throw err
  } finally {
    client.release()
  }
}
