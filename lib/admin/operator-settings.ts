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

export type ProbeName =
  | 'auth-flow'
  | 'calendar-pathology'
  | 'webhook-flow'
  // BCS-DEF-1 (2026-05-19): widened to include the conflict-unresolved
  // alert probe. As-shipped: PROBE_NAMES in `lib/admin/probe-status.ts`
  // iterates all 4 probes and `/admin/settings/alerts` renders the
  // editor section for the 4 CONFLICT_UNRESOLVED_* keys alongside the
  // others. (The original layered Phase-1→Phase-4 staging is closed.)
  | 'conflict-unresolved'
  // BCS-DEF-5 (2026-05-19) — daily 08:00 teacher lesson digest.
  // Scope discriminator for the 3 TEACHER_DIGEST_* operator keys
  // (master switch, rate-limit-per-tick, max-attempts). The probe
  // itself is a user-facing digest, NOT an operator alert — it does
  // not iterate via PROBE_NAMES in lib/admin/probe-status.ts and is
  // not rendered on /admin/settings/alerts; it has its own admin
  // page at /admin/settings/digest (plan §2.7).
  | 'teacher-daily-digest'
  // BCS-DEF-4 (2026-05-19): widened to include the learner-reminders
  // scheduler. Structurally NOT an alert probe (no dedup-fingerprint,
  // no operator-storm semantics) — but co-located on /admin/settings/alerts
  // because the operator already visits that page daily and the
  // single-knob LEARNER_REMINDER_WINDOW_MINUTES fits the existing
  // SETTING_SCHEMA shape. `PROBE_NAMES` in `lib/admin/probe-status.ts`
  // intentionally EXCLUDES 'learner-reminders' so probe iteration
  // doesn't try to render a "last alert" card for the scheduler.
  | 'learner-reminders'

// BCS-DEF-1-TG (2026-05-19) — channel-wide scopes for cross-probe
// delivery channels (Telegram today; Slack/SMS deferred per plan
// §10.5). Channel-scope keys MUST NOT collide with any probe-scope
// key — invariant pinned by `tests/admin/operator-settings.test.ts`
// (R3 INFO#6 closure: partition-by-membership, not name prefix).
export type ChannelScope = 'telegram'

export type SettingScope = ProbeName | ChannelScope

type SettingSchemaInt = {
  kind: 'int'
  default: number
  min: number
  max: number
  envName: string
  description: string
  scope: SettingScope
}

type SettingSchemaDecimal = {
  kind: 'decimal'
  default: number
  min: number
  max: number
  decimalPlaces: number
  envName: string
  description: string
  scope: SettingScope
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
  // BCS-DEF-1 Phase 1 (2026-05-19) — conflict-unresolved probe
  // thresholds. The probe ships in Phase 2; these 4 keys land first
  // so the operator-settings table has a known schema by the time the
  // probe starts reading them. Defaults match
  // docs/plans/conflict-unresolved-alert.md §2.3.
  CONFLICT_UNRESOLVED_THRESHOLD_MINUTES: {
    kind: 'int',
    default: 120,
    min: 5,
    max: 1440,
    envName: 'CONFLICT_UNRESOLVED_THRESHOLD_MINUTES',
    description:
      'minutes a slot must carry external_conflict_at before alerting',
    scope: 'conflict-unresolved',
  },
  CONFLICT_UNRESOLVED_REPORT_LIMIT: {
    kind: 'int',
    default: 50,
    min: 1,
    max: 500,
    envName: 'CONFLICT_UNRESOLVED_REPORT_LIMIT',
    description:
      'global max offenders enumerated in the alert email body (after per-teacher cap)',
    scope: 'conflict-unresolved',
  },
  CONFLICT_UNRESOLVED_PER_TEACHER_LIMIT: {
    kind: 'int',
    default: 5,
    min: 1,
    max: 50,
    envName: 'CONFLICT_UNRESOLVED_PER_TEACHER_LIMIT',
    description:
      'max conflicts shown per teacher (keeps a noisy teacher from monopolising the global LIMIT)',
    scope: 'conflict-unresolved',
  },
  CONFLICT_UNRESOLVED_DEDUP_WINDOW_MS: {
    kind: 'int',
    default: 4 * 3600 * 1000,
    min: 60_000,
    max: 7 * 86_400_000,
    envName: 'CONFLICT_UNRESOLVED_DEDUP_WINDOW_MS',
    description:
      'suppress duplicate alerts within this window (ms); keep >= threshold-minutes*60000',
    scope: 'conflict-unresolved',
  },
  // BCS-DEF-1-TG (2026-05-19) — channel-wide Telegram knobs. Plan
  // §2.5: scope 'telegram' so `resolveChannelSettings(pool, 'telegram')`
  // (below) returns these without the per-probe filter. Operator flips
  // TELEGRAM_ALERTS_MASTER_SWITCH from 0 → 1 after BotFather setup
  // (runbook §2.1). The mjs mirror in `scripts/lib/operator-settings.mjs`
  // MUST stay in sync — drift test pins JSON.stringify equality.
  TELEGRAM_ALERTS_MASTER_SWITCH: {
    kind: 'int',
    default: 0,
    min: 0,
    max: 1,
    envName: 'TELEGRAM_ALERTS_MASTER_SWITCH',
    description:
      'master switch (1=on, 0=off) for the Telegram alert channel; requires TELEGRAM_BOT_TOKEN + TELEGRAM_ALERT_CHAT_ID env vars; OFF by default — flip after BotFather setup',
    scope: 'telegram',
  },
  TELEGRAM_ALERTS_RETRY_MAX: {
    kind: 'int',
    default: 2,
    min: 0,
    max: 5,
    envName: 'TELEGRAM_ALERTS_RETRY_MAX',
    description:
      'max retries (1s backoff) on transient Telegram API errors (5xx/network/429)',
    scope: 'telegram',
  },
  // BCS-DEF-5 (2026-05-19) — daily 08:00 teacher lesson digest. Plan
  // §2.4. Default master switch is OFF so the operator must explicitly
  // enable after deploy via /admin/settings/digest (Round-1 BLOCKER 7
  // closure: avoids the "first sends fire before operator reaches UI"
  // race).
  TEACHER_DIGEST_MASTER_SWITCH: {
    kind: 'int',
    default: 0,
    min: 0,
    max: 1,
    envName: 'TEACHER_DIGEST_MASTER_SWITCH',
    description:
      'master switch (1=on/0=off) for the daily 08:00 teacher lesson digest. Default off; operator enables after deploy.',
    scope: 'teacher-daily-digest',
  },
  TEACHER_DIGEST_RATE_LIMIT_PER_TICK: {
    kind: 'int',
    default: 200,
    min: 1,
    max: 5000,
    envName: 'TEACHER_DIGEST_RATE_LIMIT_PER_TICK',
    description:
      'max teachers processed per tick; remainder defers to subsequent ticks within the firing window.',
    scope: 'teacher-daily-digest',
  },
  TEACHER_DIGEST_MAX_ATTEMPTS: {
    kind: 'int',
    default: 3,
    min: 1,
    max: 10,
    envName: 'TEACHER_DIGEST_MAX_ATTEMPTS',
    description:
      'max retries for a single teacher digest within the firing window before terminal send_failed.',
    scope: 'teacher-daily-digest',
  },
  // BCS-DEF-4 (2026-05-19) — learner lesson reminder scheduler.
  // Three keys: email master switch + window + per-tick send cap.
  // No CSV-offsets, no late-tolerance, no max-attempts (one-shot
  // send per slot per channel; failures land as status='skipped'
  // skipped_reason='send_failed').
  //
  // Plan: docs/plans/bcs-def-4-learner-reminders.md §2.3.
  LEARNER_REMINDERS_EMAIL_ENABLED: {
    kind: 'int',
    default: 1,
    min: 0,
    max: 1,
    envName: 'LEARNER_REMINDERS_EMAIL_ENABLED',
    description:
      'master switch (1=on/0=off) for learner email reminders sent by scripts/learner-reminder-dispatch.mjs',
    scope: 'learner-reminders',
  },
  LEARNER_REMINDER_WINDOW_MINUTES: {
    kind: 'int',
    default: 60,
    min: 5,
    max: 360,
    envName: 'LEARNER_REMINDER_WINDOW_MINUTES',
    description:
      'single window (in minutes before slot start) at which a learner reminder is dispatched',
    scope: 'learner-reminders',
  },
  LEARNER_REMINDERS_RATE_LIMIT_PER_TICK: {
    kind: 'int',
    default: 200,
    min: 1,
    max: 5000,
    envName: 'LEARNER_REMINDERS_RATE_LIMIT_PER_TICK',
    description:
      'max reminder sends dispatched per scheduler tick (defends Resend / Telegram quota; counts email + telegram together)',
    scope: 'learner-reminders',
  },
  // BCS-DEF-4-TG (2026-05-20) — master switch for the learner Telegram
  // channel. Default OFF; operator flips to 1 after BotFather setup
  // (TELEGRAM_BOT_TOKEN env + setWebhook with secret token).
  // Plan: docs/plans/bcs-def-4-tg-telegram-reminders.md §2.2.
  LEARNER_REMINDERS_TELEGRAM_ENABLED: {
    kind: 'int',
    default: 0,
    min: 0,
    max: 1,
    envName: 'LEARNER_REMINDERS_TELEGRAM_ENABLED',
    description:
      'master switch (1=on/0=off) for the learner Telegram channel; OFF by default — flip after BotFather setup + webhook registration. Per-learner opt-in still required (accounts.learner_telegram_enabled=true after /start <code> handshake).',
    scope: 'learner-reminders',
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

// BCS-DEF-1-TG R1 BLOCKER#1 closure (2026-05-19) — channel-scope
// resolver. Sibling of `resolveOperatorSettingsForProbe`: filters
// `schema.scope === channel` instead of `=== probeName`. The two
// snapshots are merged at the call site (`{...probeSettings,
// ...channelSettings}`) and the partition invariant in
// `tests/admin/operator-settings.test.ts` keeps them disjoint, so the
// merge order is irrelevant for correctness.
//
// Uses `getDbPool()` like the rest of the TS resolvers; the .mjs twin
// takes a pool argument because the probe scripts own their own
// max:1 pool.
export async function resolveChannelSettings(
  channel: ChannelScope,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Record<string, ResolvedSetting>> {
  const keys = (Object.keys(SETTING_SCHEMA) as SettingKey[]).filter(
    (k) => (SETTING_SCHEMA[k].scope as SettingScope) === channel,
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
      console.warn('[operator-settings] channel snapshot DB read failed', {
        channel,
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

// ALERTS-EDITOR Sub-PR C (2026-05-18) — admin-page reader. Returns
// per-key ResolvedSetting + DB row updated_at + updatedByAccountId.
// Every form submit carries the expectedUpdatedAt the operator was
// looking at, for optimistic concurrency. Also surfaces
// `migrationPending: true` if the table itself is missing, so the
// page can show a banner instead of crashing.
export type AdminSettingView =
  | { migrationPending: true }
  | {
      migrationPending?: false
      keys: Record<
        string,
        ResolvedSetting & {
          updatedAt: string | null
          updatedByAccountId: string | null
        }
      >
    }

export async function listOperatorSettingsForAdmin(
  env: NodeJS.ProcessEnv = process.env,
): Promise<AdminSettingView> {
  const dbRows = new Map<
    string,
    { value: string; updated_at: unknown; updated_by_account_id: unknown }
  >()
  try {
    const pool = getDbPool()
    const r = await pool.query(
      `select key, value, updated_at, updated_by_account_id
         from operator_settings`,
    )
    for (const row of r.rows) {
      dbRows.set(String(row.key), {
        value: String(row.value),
        updated_at: row.updated_at,
        updated_by_account_id: row.updated_by_account_id,
      })
    }
  } catch (err) {
    if (isUndefinedTableError(err)) {
      return { migrationPending: true }
    }
    throw err
  }
  const keys: Record<
    string,
    ResolvedSetting & {
      updatedAt: string | null
      updatedByAccountId: string | null
    }
  > = {}
  for (const k of Object.keys(SETTING_SCHEMA) as SettingKey[]) {
    const schema = SETTING_SCHEMA[k]
    const dbRow = dbRows.get(k) ?? null
    const rawDb = dbRow?.value ?? null
    const envRawSource = env[schema.envName]
    const rawEnv =
      typeof envRawSource === 'string' ? envRawSource.trim() : null
    let value: number = schema.default
    let source: SettingSource = 'default'
    if (rawDb !== null) {
      const v = validate(schema, rawDb)
      if (v !== null) {
        value = v
        source = 'db'
      }
    }
    if (source === 'default' && rawEnv && rawEnv.length > 0) {
      const v = validate(schema, rawEnv)
      if (v !== null) {
        value = v
        source = 'env'
      }
    }
    keys[k] = {
      value,
      source,
      rawDb,
      rawEnv,
      updatedAt: dbRow
        ? new Date(String(dbRow.updated_at)).toISOString()
        : null,
      updatedByAccountId: dbRow
        ? dbRow.updated_by_account_id === null
          ? null
          : String(dbRow.updated_by_account_id)
        : null,
    }
  }
  return { keys }
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
