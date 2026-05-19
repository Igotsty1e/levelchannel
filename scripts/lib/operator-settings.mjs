// ALERTS-EDITOR Sub-PR A (2026-05-17) — JS mirror of
// lib/admin/operator-settings.ts. Probe scripts (Sub-PR B) will
// import resolveOperatorSettingsForProbe from here. The schema
// constant MUST stay structurally identical to the TS file; a
// drift test pins JSON.stringify equality.

// SETTING_SCHEMA — mirror of the TS const. Order MUST match.
export const SETTING_SCHEMA = Object.freeze({
  CALENDAR_PATHOLOGY_THRESHOLD: Object.freeze({
    kind: 'int',
    default: 3,
    min: 1,
    max: 100,
    envName: 'CALENDAR_PATHOLOGY_THRESHOLD',
    description: 'cancel_repush_count floor for triggering the alert',
    scope: 'calendar-pathology',
  }),
  CALENDAR_PATHOLOGY_REPORT_LIMIT: Object.freeze({
    kind: 'int',
    default: 10,
    min: 1,
    max: 100,
    envName: 'CALENDAR_PATHOLOGY_REPORT_LIMIT',
    description: 'max offenders enumerated in the alert email body',
    scope: 'calendar-pathology',
  }),
  CALENDAR_PATHOLOGY_DEDUP_WINDOW_MS: Object.freeze({
    kind: 'int',
    default: 86_400_000,
    min: 60_000,
    max: 7 * 86_400_000,
    envName: 'CALENDAR_PATHOLOGY_DEDUP_WINDOW_MS',
    description: 'suppress duplicate alerts within this window (ms)',
    scope: 'calendar-pathology',
  }),
  AUTH_FLOW_WINDOW_MINUTES: Object.freeze({
    kind: 'int',
    default: 60,
    min: 5,
    max: 1440,
    envName: 'AUTH_FLOW_WINDOW_MINUTES',
    description: 'rolling window of failed-login activity (minutes)',
    scope: 'auth-flow',
  }),
  AUTH_FLOW_MAX_PER_IP: Object.freeze({
    kind: 'int',
    default: 50,
    min: 5,
    max: 10000,
    envName: 'AUTH_FLOW_MAX_PER_IP',
    description: 'failed-login count per IP that triggers an alert',
    scope: 'auth-flow',
  }),
  AUTH_FLOW_MAX_PER_EMAIL_HASH: Object.freeze({
    kind: 'int',
    default: 20,
    min: 3,
    max: 10000,
    envName: 'AUTH_FLOW_MAX_PER_EMAIL_HASH',
    description: 'failed-login count per (hashed) email that triggers an alert',
    scope: 'auth-flow',
  }),
  AUTH_FLOW_DEDUP_WINDOW_MS: Object.freeze({
    kind: 'int',
    default: 4 * 3600 * 1000,
    min: 60_000,
    max: 7 * 86_400_000,
    envName: 'AUTH_FLOW_DEDUP_WINDOW_MS',
    description: 'suppress duplicate alerts within this window (ms)',
    scope: 'auth-flow',
  }),
  WEBHOOK_FLOW_WINDOW_MINUTES: Object.freeze({
    kind: 'int',
    default: 60,
    min: 5,
    max: 1440,
    envName: 'WEBHOOK_FLOW_WINDOW_MINUTES',
    description: 'rolling window of webhook activity (minutes)',
    scope: 'webhook-flow',
  }),
  WEBHOOK_FLOW_MIN_VOLUME: Object.freeze({
    kind: 'int',
    default: 5,
    min: 1,
    max: 10000,
    envName: 'WEBHOOK_FLOW_MIN_VOLUME',
    description: 'minimum webhook volume in window before alert is considered',
    scope: 'webhook-flow',
  }),
  WEBHOOK_FLOW_TERMINATED_RATIO: Object.freeze({
    kind: 'decimal',
    default: 0.3,
    min: 0,
    max: 1,
    decimalPlaces: 2,
    envName: 'WEBHOOK_FLOW_TERMINATED_RATIO',
    description: 'terminated-vs-success ratio threshold (0.0 to 1.0)',
    scope: 'webhook-flow',
  }),
  // BCS-DEF-1 Phase 1 (2026-05-19) — conflict-unresolved probe
  // thresholds. Mirror of lib/admin/operator-settings.ts; the probe
  // script (scripts/conflict-unresolved-alert.mjs) ships in Phase 2.
  CONFLICT_UNRESOLVED_THRESHOLD_MINUTES: Object.freeze({
    kind: 'int',
    default: 120,
    min: 5,
    max: 1440,
    envName: 'CONFLICT_UNRESOLVED_THRESHOLD_MINUTES',
    description:
      'minutes a slot must carry external_conflict_at before alerting',
    scope: 'conflict-unresolved',
  }),
  CONFLICT_UNRESOLVED_REPORT_LIMIT: Object.freeze({
    kind: 'int',
    default: 50,
    min: 1,
    max: 500,
    envName: 'CONFLICT_UNRESOLVED_REPORT_LIMIT',
    description:
      'global max offenders enumerated in the alert email body (after per-teacher cap)',
    scope: 'conflict-unresolved',
  }),
  CONFLICT_UNRESOLVED_PER_TEACHER_LIMIT: Object.freeze({
    kind: 'int',
    default: 5,
    min: 1,
    max: 50,
    envName: 'CONFLICT_UNRESOLVED_PER_TEACHER_LIMIT',
    description:
      'max conflicts shown per teacher (keeps a noisy teacher from monopolising the global LIMIT)',
    scope: 'conflict-unresolved',
  }),
  CONFLICT_UNRESOLVED_DEDUP_WINDOW_MS: Object.freeze({
    kind: 'int',
    default: 4 * 3600 * 1000,
    min: 60_000,
    max: 7 * 86_400_000,
    envName: 'CONFLICT_UNRESOLVED_DEDUP_WINDOW_MS',
    description:
      'suppress duplicate alerts within this window (ms); keep >= threshold-minutes*60000',
    scope: 'conflict-unresolved',
  }),
})

const INTEGER_PATTERN = /^\d+$/

function validateInt(schema, raw) {
  if (!INTEGER_PATTERN.test(raw)) return null
  const n = Number(raw)
  if (!Number.isInteger(n) || n < schema.min || n > schema.max) return null
  return n
}

function validateDecimal(schema, raw) {
  const pattern = new RegExp(
    `^(0|[1-9]\\d*)(\\.\\d{1,${schema.decimalPlaces}})?$`,
  )
  if (!pattern.test(raw)) return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n < schema.min || n > schema.max) return null
  return n
}

function validate(schema, raw) {
  return schema.kind === 'int'
    ? validateInt(schema, raw)
    : validateDecimal(schema, raw)
}

function isUndefinedTableError(err) {
  return Boolean(err && typeof err === 'object' && err.code === '42P01')
}

// Per-probe snapshot reader. The probe passes its OWN pg.Pool
// (max:1, oneshot, shut down on exit) — this helper MUST NOT call
// any Next.js singleton pool, and MUST NOT throw on DB errors.
//
// Returns { [KEY]: { value, source, rawDb, rawEnv } } for every
// key whose scope === probeName.
export async function resolveOperatorSettingsForProbe(
  pool,
  probeName,
  env = process.env,
) {
  const keys = Object.entries(SETTING_SCHEMA)
    .filter(([, schema]) => schema.scope === probeName)
    .map(([k]) => k)
  const dbValues = new Map()
  try {
    const r = await pool.query(
      `select key, value from operator_settings where key = any($1::text[])`,
      [keys],
    )
    for (const row of r.rows) {
      dbValues.set(String(row.key), String(row.value))
    }
  } catch (err) {
    if (!isUndefinedTableError(err)) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          probe: probeName,
          msg: 'operator-settings snapshot read failed (using env+default)',
          error: err instanceof Error ? err.message : String(err),
        }),
      )
    }
  }
  const out = {}
  for (const k of keys) {
    const schema = SETTING_SCHEMA[k]
    const rawDb = dbValues.has(k) ? dbValues.get(k) : null
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
