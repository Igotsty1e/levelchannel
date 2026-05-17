# ALERTS-EDITOR — operator-tunable alert thresholds (per-probe, DB-backed)

**Scope class:** epic (proposed decomposition: 3 sub-PRs sharing this plan).
**Wave name:** `alerts-editor`.
**Origin:** `docs/plans/admin-ux-coverage.md §5.2 + §10.1 P3`. Backlog task #50. Unlocks the deferred POLICY-KNOBS UI editor (which can later stack on `operator_settings`).

ALERTS-OBS (shipped 2026-05-16, PRs #249/#250/#254) gave operators a read-only `/admin/settings/alerts` with last-run, last-alert, effective-thresholds, and a dry-run test-send button. ALERTS-EDITOR makes the **thresholds** editable from /admin without an SSH+env+restart cycle, while keeping the env-fallback bootstrap path intact (Codex finding #5 from admin-ux-coverage.md §9 — DB-only with no env fallback breaks bootstrap/recovery).

Plan paranoia round 1 surfaced 5 BLOCKERs + 7 WARNs; round 2 surfaced 4 more BLOCKERs after revision (true transactional atomicity for write+audit, env-var rename, and stats.thresholds shape drift). This revision addresses all of them. Key design decisions baked in:

- **Scope: thresholds only.** `ALERT_EMAIL_TO` (recipient) STAYS env-only. The alert-suppression/reroute surface is too security-sensitive for a v1 web editor. R1 BLOCKER #4 + WARN #12.
- **Resolver contract: DB → env → default.** Canonical. R1 WARN #6 closure.
- **Atomic per-probe snapshot at probe-tick start.** R1 BLOCKER #2 closure.
- **Optimistic concurrency on writes via single-TX `select … for update` + UPDATE.** R2 BLOCKER #1 closure (R1 BLOCKER #3 was inadequately closed with autocommit statements).
- **Single-pool single-TX write+audit atomicity.** Both `operator_settings` write AND `operator_settings_events` insert happen in the SAME transaction on the MAIN pool. Audit-table integrity is enforced by a DB-level trigger (`block_update_delete_on_operator_settings_events`) that REVOKEs UPDATE/DELETE from any role on the events table — the role-isolation property previously sought via the audit-writer pool is structurally enforced by SQL constraints instead. R2 BLOCKER #2 + R1 WARN #7 closure.
- **Migration-pending state for editor UI** mirrors ALERTS-OBS shape. R1 BLOCKER #5 closure.
- **`new_value` nullable + `event_kind` enum** on the events table so DELETE is a first-class event shape. R1 BLOCKER #1 closure.
- **`WEBHOOK_FLOW_TERMINATED_RATIO` stays as decimal** (no env-var rename to `_BPS`). Schema supports a new `kind: 'decimal'` with min/max as floats + a strict decimal regex parser. R2 BLOCKER #3 closure.
- **`probe_runs.stats.thresholds` shape stays scalar** (`CALENDAR_PATHOLOGY_THRESHOLD: 3`). A parallel `stats.thresholds_source` field carries the per-knob source (`'db'|'env'|'default'`). Backwards-compatible with the live `/admin/settings/alerts` rendering — Sub-PR B can ship without dragging Sub-PR C rendering changes along. R2 BLOCKER #4 closure.
- **Retention** in `db-retention-cleanup.mjs` (90 days, mirrors `probe_runs`). R1 WARN #11 closure.
- **Drift detection** = TS↔MJS schema equality AS WELL AS per-probe integration tests. R1 WARN #8 closure.
- **Resolver returns `{ value, source, rawDb, rawEnv }`** so the UI can render badges + a malformed-raw warning. R1 WARN #9 closure.
- **Auth via `requireAdminRole(request)` JSON contract**. R1 WARN #10 closure.

## 1. Existing surface inventory

Per `~/.claude/COMPANY.md` survey-before-plan.

### 1.1 Three probe scripts (10 numeric knobs, NO recipient)

`scripts/calendar-pathology-alert.mjs` (3 knobs):
- `CALENDAR_PATHOLOGY_THRESHOLD` (default 3) — `cancel_repush_count` floor for triggering
- `CALENDAR_PATHOLOGY_REPORT_LIMIT` (default 10, clamped ≤100) — max offenders in alert body
- `CALENDAR_PATHOLOGY_DEDUP_WINDOW_MS` (default 24h)

`scripts/auth-flow-alert.mjs` (4 knobs):
- `AUTH_FLOW_WINDOW_MINUTES` (default 60)
- `AUTH_FLOW_MAX_PER_IP` (default 50)
- `AUTH_FLOW_MAX_PER_EMAIL_HASH` (default 20)
- `AUTH_FLOW_DEDUP_WINDOW_MS` (default 4h)

`scripts/webhook-flow-alert.mjs` (3 knobs):
- `WEBHOOK_FLOW_WINDOW_MINUTES` (default 60)
- `WEBHOOK_FLOW_MIN_VOLUME` (default 5)
- `WEBHOOK_FLOW_TERMINATED_RATIO` (default 0.3) — decimal, schema kind=`decimal` (R2 BLOCKER #3 — env var name unchanged for bootstrap parity)

Total: **9 integer knobs + 1 decimal knob.**

**Explicitly NOT in scope for this wave:**

- `ALERT_EMAIL_TO` — env-only. Operator changes recipient via SSH+env+restart, audit-loggable at the env-edit layer. R1 BLOCKER #4 + WARN #12.
- `EMAIL_FROM` — env-only. Rarely changes.
- `RESEND_API_KEY` — secret. Env-only.
- `*_STATE_FILE` paths — operational, not policy.

### 1.2 Current /admin/settings/alerts surface

`app/admin/(gated)/settings/alerts/page.tsx` server component reads from `probe_runs` table (`lib/admin/probe-status.ts:57 getProbeStatus`). Migration-pending banner via `lib/db/errors.ts isUndefinedTableError` covers the deploy-before-migrate window for `probe_runs`. Same pattern applies for the new `operator_settings`.

### 1.3 Auth shape (R1 WARN #10 closure)

API admin routes use `requireAdminRole(request)` (`lib/auth/guards.ts:32`) which returns either `{ ok: true; account; ... }` or `{ ok: false; response: NextResponse }` — caller returns `response` on failure. Reference: `app/api/admin/accounts/[id]/role/route.ts` post-AUDIT-CODE-1. SSR pages use the `(gated)/layout.tsx` redirect.

### 1.4 Audit-table immutability (R1 WARN #7 + R2 BLOCKER #2 closure)

Existing audit tables (`payment_audit_events`, `auth_audit_events`) use a separate `levelchannel_audit_writer` INSERT-only role via `lib/audit/pool.ts getAuditPool()`. That pattern works for app-emitted audit events (different connection from the app's main writes).

For `operator_settings_events` this approach **does not work** because the audit insert MUST happen in the SAME transaction as the `operator_settings` write — otherwise config can commit without an audit row (R2 BLOCKER #2). Single-pool single-TX is the only correct shape here.

The role-isolation property ("nobody can rewrite history") is preserved via a **DB-level trigger** that REVOKEs UPDATE/DELETE on `operator_settings_events` from any role. Same trust boundary, enforced by SQL constraints instead of GRANT semantics. Migration 0055 §3 ships this trigger.

### 1.5 Retention contract (R1 WARN #11 closure)

`scripts/db-retention-cleanup.mjs:253` already enumerates per-table retention windows. New `operator_settings_events` joins: **90-day retention** (mirrors `probe_runs`). Real operational events; long enough to forensic-review a quarter; short enough to bound growth.

### 1.6 Migration numbering

`migrations/0054_calendar_channel_token_enc.sql` is current head. **Next free: 0055.**

### 1.7 Test-send route (R1 BLOCKER #4 acknowledgement)

`app/api/admin/settings/alerts/[probe]/test-send/route.ts` reads `ALERT_EMAIL_TO` from env. Since this wave keeps `ALERT_EMAIL_TO` env-only, the test-send route does NOT need to change. If a future wave makes the recipient tunable, that wave must update the test-send route to use the resolver — but it's NOT part of this scope.

### 1.8 withIdempotency contract (R1 BLOCKER #3 acknowledgement)

`lib/security/idempotency.ts` after the post-merge rollback (PR #258) is **sequential-only same-key dedup**. Concurrent same-key callers MAY both execute. ALERTS-EDITOR write paths CANNOT rely on withIdempotency for concurrency safety. Use optimistic concurrency via `updated_at` check; the audit log captures all writes regardless of which wins.

## 2. Threat model

**What we get:** operators roll alert thresholds from /admin without SSH/env edit/restart. Eliminates a class of deploy friction.

**What we explicitly defer:**
- ALERT_EMAIL_TO editor — suppression/reroute surface.
- Tunable secrets — env-only.
- Multi-environment fan-out — one DB row per env (staging vs prod use different DBs).

**Safety properties:**

1. **DB → env → default chain** (R1 WARN #6 — single contract). Operator sets DB row → app uses DB value. To override a bad DB tune via env, operator DELETEs the DB row (editor button or psql), THEN env wins. **No silent "env preferred" fallback.** Documented.
2. **Strict validation** in write path. Read path tolerates malformed DB (falls through to env/default + logs).
3. **Audit trail** via `levelchannel_audit_writer` INSERT-only role. App-process compromise cannot retroactively rewrite history. 90-day retention.
4. **Optimistic concurrency.** Writes carry `expected_updated_at`; mismatch → 409 + UI re-fetch.
5. **Per-tick snapshot** in probe scripts — single SELECT at top of main() reads all knobs. No torn config mid-tick.
6. **Migration-pending tolerance** in both read path (resolver swallows 42P01) AND editor UI (banner + disabled save buttons).
7. **Whitelist of editable keys** enforced in the POST route. DB-direct writes by an operator with psql access are not blocked but only whitelisted keys are read by app code.

**Security caveat — suppression surface even for thresholds:**

Even threshold tunables can suppress incident detection if an attacker with admin access cranks `*_MAX_PER_IP` to 999999 etc. Acceptable risk because:

- All edits land in `operator_settings_events` with `account_id` + `old`/`new` values.
- Retention 90 days — forensic review is feasible.
- `SECURITY.md §ALERTS-EDITOR trust boundary` documents this explicitly.

If post-mortem on a compromised-admin scenario shows this surface was exploited, the right answer is to remove specific knobs from the whitelist + force them back to env-only via a follow-up.

## 3. Schema design — migration 0055

`migrations/0055_operator_settings.sql`:

```sql
-- ALERTS-EDITOR (2026-05-17) — operator-tunable settings table.
-- Single-row-per-key shape; key is the env-var name (e.g.
-- 'CALENDAR_PATHOLOGY_THRESHOLD'). App resolves: DB row → env →
-- hardcoded default. Empty/missing DB row means "use env or default"
-- (no implicit override).
--
-- Whitelist of editable keys lives in lib/admin/operator-settings.ts
-- as a TypeScript constant + scripts/lib/operator-settings.mjs (mirror).
-- DB layer does not enforce the whitelist; POST route + app reads do.

create table if not exists operator_settings (
  key text primary key
    check (key ~ '^[A-Z][A-Z0-9_]+$' and length(key) <= 64),
  value text not null
    check (length(value) <= 1024),
  description text,
  updated_at timestamptz not null default now(),
  updated_by_account_id uuid references accounts(id) on delete set null
);

-- Audit-writer role pattern (migration 0029): INSERT-only.
create table if not exists operator_settings_events (
  id bigserial primary key,
  key text not null,
  event_kind text not null
    check (event_kind in ('set', 'delete')),
  old_value text,      -- null on first-ever set
  new_value text,      -- null on delete (R1 BLOCKER #1 closure)
  updated_by_account_id uuid references accounts(id) on delete set null,
  ts timestamptz not null default now(),
  check (
    (event_kind = 'set' and new_value is not null)
    or (event_kind = 'delete' and new_value is null)
  )
);

create index if not exists operator_settings_events_key_ts_idx
  on operator_settings_events (key, ts desc);
create index if not exists operator_settings_events_ts_idx
  on operator_settings_events (ts desc);

-- R2 BLOCKER #2 + R1 WARN #7 — enforce audit-table immutability
-- via a DB trigger instead of role isolation. Same trust boundary
-- ("no one can modify history") via SQL constraint rather than a
-- separate INSERT-only role; lets write+audit happen in a single
-- TX on a single pool (required for atomicity — see §4.1 write
-- path). On UPDATE or DELETE, the trigger raises and rolls back.
create or replace function block_update_delete_on_operator_settings_events()
returns trigger language plpgsql as $$
begin
  raise exception 'operator_settings_events is INSERT-only (immutable audit log)';
end$$;

drop trigger if exists block_update_delete_on_operator_settings_events_trg
  on operator_settings_events;
create trigger block_update_delete_on_operator_settings_events_trg
  before update or delete on operator_settings_events
  for each row execute function block_update_delete_on_operator_settings_events();
```

The `do $$` block makes the role grant idempotent + safe on dev/test DBs where the role isn't created (audit-writer role is operator-side prod-only setup).

## 4. Application changes

### 4.1 New module: `lib/admin/operator-settings.ts`

Schema + resolver + write path. **Resolver returns `{ value, source, raw }`** so the UI can render badges. R1 WARN #9 closure.

```ts
import { getDbPool } from '@/lib/db/pool'
import { isUndefinedTableError } from '@/lib/db/errors'

export type SettingSource = 'db' | 'env' | 'default'
export type ResolvedSetting<T> = {
  value: T
  source: SettingSource
  rawDb: string | null     // raw DB row value, even if malformed
  rawEnv: string | null    // raw env value, even if malformed
}

type SettingSchemaInt = {
  kind: 'int'
  default: number
  min: number
  max: number
  envName: string
  description: string
  scope: 'auth-flow' | 'calendar-pathology' | 'webhook-flow'
}

type SettingSchemaDecimal = {
  kind: 'decimal'
  default: number
  min: number
  max: number
  decimalPlaces: number  // strict regex enforces "0", "0.1", "0.30", etc.
  envName: string
  description: string
  scope: 'auth-flow' | 'calendar-pathology' | 'webhook-flow'
}

type SettingSchema = SettingSchemaInt | SettingSchemaDecimal

export const SETTING_SCHEMA = {
  CALENDAR_PATHOLOGY_THRESHOLD: {
    kind: 'int', default: 3, min: 1, max: 100,
    envName: 'CALENDAR_PATHOLOGY_THRESHOLD',
    description: 'cancel_repush_count floor for triggering the alert',
    scope: 'calendar-pathology',
  },
  CALENDAR_PATHOLOGY_REPORT_LIMIT: {
    kind: 'int', default: 10, min: 1, max: 100,
    envName: 'CALENDAR_PATHOLOGY_REPORT_LIMIT',
    description: 'max offenders enumerated in the alert email body',
    scope: 'calendar-pathology',
  },
  CALENDAR_PATHOLOGY_DEDUP_WINDOW_MS: {
    kind: 'int', default: 86_400_000, min: 60_000, max: 7 * 86_400_000,
    envName: 'CALENDAR_PATHOLOGY_DEDUP_WINDOW_MS',
    description: 'suppress duplicate alerts within this window (ms)',
    scope: 'calendar-pathology',
  },
  AUTH_FLOW_WINDOW_MINUTES: {
    kind: 'int', default: 60, min: 5, max: 1440,
    envName: 'AUTH_FLOW_WINDOW_MINUTES',
    description: 'rolling window of failed-login activity (minutes)',
    scope: 'auth-flow',
  },
  AUTH_FLOW_MAX_PER_IP: {
    kind: 'int', default: 50, min: 5, max: 10000,
    envName: 'AUTH_FLOW_MAX_PER_IP',
    description: 'failed-login count per IP that triggers an alert',
    scope: 'auth-flow',
  },
  AUTH_FLOW_MAX_PER_EMAIL_HASH: {
    kind: 'int', default: 20, min: 3, max: 10000,
    envName: 'AUTH_FLOW_MAX_PER_EMAIL_HASH',
    description: 'failed-login count per (hashed) email that triggers an alert',
    scope: 'auth-flow',
  },
  AUTH_FLOW_DEDUP_WINDOW_MS: {
    kind: 'int', default: 4 * 3600 * 1000, min: 60_000, max: 7 * 86_400_000,
    envName: 'AUTH_FLOW_DEDUP_WINDOW_MS',
    description: 'suppress duplicate alerts within this window (ms)',
    scope: 'auth-flow',
  },
  WEBHOOK_FLOW_WINDOW_MINUTES: {
    kind: 'int', default: 60, min: 5, max: 1440,
    envName: 'WEBHOOK_FLOW_WINDOW_MINUTES',
    description: 'rolling window of webhook activity (minutes)',
    scope: 'webhook-flow',
  },
  WEBHOOK_FLOW_MIN_VOLUME: {
    kind: 'int', default: 5, min: 1, max: 10000,
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
} as const satisfies Record<string, SettingSchemaInt | SettingSchemaDecimal>

export type SettingKey = keyof typeof SETTING_SCHEMA
```

**Resolver (single-key):**

```ts
const INTEGER_PATTERN = /^\d+$/

function validateInt(schema: SettingSchemaInt, raw: string): number | null {
  if (!INTEGER_PATTERN.test(raw)) return null
  const n = Number(raw)
  if (!Number.isInteger(n) || n < schema.min || n > schema.max) return null
  return n
}

function validateDecimal(schema: SettingSchemaDecimal, raw: string): number | null {
  // Strict: integer part `0` OR `[1-9]\d*`, optional `.` + up to N digits.
  // Forbids leading/trailing whitespace, signs, exponent, multiple dots.
  const pattern = new RegExp(`^(0|[1-9]\\d*)(\\.\\d{1,${schema.decimalPlaces}})?$`)
  if (!pattern.test(raw)) return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n < schema.min || n > schema.max) return null
  return n
}

function validate(schema: SettingSchema, raw: string): number | null {
  return schema.kind === 'int' ? validateInt(schema, raw) : validateDecimal(schema, raw)
}

export async function resolveOperatorSetting<K extends SettingKey>(
  key: K,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ResolvedSetting<number>> {
  const schema = SETTING_SCHEMA[key]
  let rawDb: string | null = null
  let rawEnv: string | null = null
  // Step 1 — DB
  try {
    const pool = getDbPool()
    const r = await pool.query(
      `select value from operator_settings where key = $1`, [key],
    )
    if (r.rows[0]) {
      rawDb = String(r.rows[0].value)
      const v = validate(schema, rawDb)
      if (v !== null) return { value: v, source: 'db', rawDb, rawEnv: null }
      console.warn('[operator-settings] DB row invalid', { key, rawDb })
    }
  } catch (err) {
    if (!isUndefinedTableError(err)) {
      console.warn('[operator-settings] DB read failed', { key, err })
    }
  }
  // Step 2 — env
  rawEnv = env[schema.envName]?.trim() ?? null
  if (rawEnv && rawEnv.length > 0) {
    const v = validate(schema, rawEnv)
    if (v !== null) return { value: v, source: 'env', rawDb, rawEnv }
  }
  // Step 3 — default
  return { value: schema.default, source: 'default', rawDb, rawEnv }
}
```

**Snapshot read (per-tick, used by probes):**

```ts
// R1 BLOCKER #2 closure — read ALL keys for a probe in ONE
// round-trip at tick start. Probes use the snapshot for the whole
// tick; no mid-tick re-read.
export async function resolveOperatorSettingsForProbe(
  probeName: 'auth-flow' | 'calendar-pathology' | 'webhook-flow',
  env: NodeJS.ProcessEnv = process.env,
): Promise<Record<string, ResolvedSetting<number>>> {
  const keys = Object.entries(SETTING_SCHEMA)
    .filter(([, schema]) => schema.scope === probeName)
    .map(([k]) => k as SettingKey)
  // Build the result by resolving each — but read DB in one query.
  const pool = getDbPool()
  let dbRows: Map<string, string> = new Map()
  try {
    const r = await pool.query(
      `select key, value from operator_settings where key = any($1::text[])`,
      [keys],
    )
    for (const row of r.rows) {
      dbRows.set(String(row.key), String(row.value))
    }
  } catch (err) {
    if (!isUndefinedTableError(err)) {
      console.warn('[operator-settings] snapshot DB read failed', { probeName, err })
    }
  }
  const out: Record<string, ResolvedSetting<number>> = {}
  for (const k of keys) {
    const schema = SETTING_SCHEMA[k]
    const rawDb = dbRows.get(k) ?? null
    if (rawDb !== null) {
      const v = validate(schema, rawDb)
      if (v !== null) {
        out[k] = { value: v, source: 'db', rawDb, rawEnv: null }
        continue
      }
    }
    const rawEnv = env[schema.envName]?.trim() ?? null
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
```

**Write path:**

```ts
export type WriteResult =
  | { ok: true; updatedAt: string }
  | { ok: false; reason: 'unknown_key' | 'invalid_value' | 'concurrent_update' | 'migration_pending' | 'unauthorized' }

// R2 BLOCKER #1 + #2 closure — single TX wraps select-for-update,
// the upsert, AND the audit insert. FOR UPDATE holds until COMMIT;
// audit write happens iff the config write commits.
export async function setOperatorSetting(input: {
  key: SettingKey
  value: string                    // raw string from form, validated here
  expectedUpdatedAt: string | null // optimistic concurrency check; null on first-ever set
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
    const priorRow = prior.rows[0]
    // R3 BLOCKER #1 closure — split INSERT vs UPDATE paths so the
    // first-create race surfaces as 409, not silent overwrite. Two
    // concurrent admins both with expectedUpdatedAt=null: only one
    // INSERT succeeds; the other gets ON CONFLICT DO NOTHING →
    // rowCount=0 → returns concurrent_update.
    let newRow: { rows: Array<{ updated_at: unknown }> }
    if (!priorRow) {
      if (input.expectedUpdatedAt !== null) {
        await client.query('rollback')
        return { ok: false, reason: 'concurrent_update' }
      }
      newRow = await client.query(
        `insert into operator_settings (key, value, description, updated_by_account_id)
         values ($1, $2, $3, $4)
         on conflict (key) do nothing
         returning updated_at`,
        [input.key, String(validated), schema.description, input.byAccountId],
      )
      if (newRow.rows.length === 0) {
        await client.query('rollback')
        return { ok: false, reason: 'concurrent_update' }
      }
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
      newRow = await client.query(
        `update operator_settings set
           value = $2,
           description = $3,
           updated_at = now(),
           updated_by_account_id = $4
         where key = $1
         returning updated_at`,
        [input.key, String(validated), schema.description, input.byAccountId],
      )
    }
    await client.query(
      `insert into operator_settings_events
         (key, event_kind, old_value, new_value, updated_by_account_id)
       values ($1, 'set', $2, $3, $4)`,
      [
        input.key,
        priorRow ? String(priorRow.value) : null,
        String(validated),
        input.byAccountId,
      ],
    )
    await client.query('commit')
    return { ok: true, updatedAt: new Date(String(newRow.rows[0].updated_at)).toISOString() }
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
    const priorIso = new Date(String(prior.rows[0].updated_at)).toISOString()
    if (priorIso !== input.expectedUpdatedAt) {
      await client.query('rollback')
      return { ok: false, reason: 'concurrent_update' }
    }
    await client.query(`delete from operator_settings where key = $1`, [input.key])
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
```

### 4.2 Probe-script integration (R1 BLOCKER #2 + WARN #8 closure)

Each probe script's `main()` reads its full snapshot at the top:

```js
// scripts/calendar-pathology-alert.mjs (was: top-level Number(process.env...))
import { resolveOperatorSettingsForProbe } from './lib/operator-settings.mjs'

async function main() {
  // ... pool init ...
  const settings = await resolveOperatorSettingsForProbe('calendar-pathology', pool)
  const THRESHOLD = settings.CALENDAR_PATHOLOGY_THRESHOLD.value
  const REPORT_LIMIT = settings.CALENDAR_PATHOLOGY_REPORT_LIMIT.value
  const DEDUP_WINDOW_MS = settings.CALENDAR_PATHOLOGY_DEDUP_WINDOW_MS.value
  // R2 BLOCKER #4 — keep stats.thresholds scalar (backwards
  // compatible with /admin/settings/alerts page rendering). Add a
  // parallel stats.thresholds_source map carrying the source. The
  // ALERTS-OBS page can ignore thresholds_source until Sub-PR C
  // teaches it the new shape; meanwhile B can ship without
  // breaking the live page rendering.
  const capturedThresholds = {
    CALENDAR_PATHOLOGY_THRESHOLD: THRESHOLD,
    CALENDAR_PATHOLOGY_REPORT_LIMIT: REPORT_LIMIT,
    CALENDAR_PATHOLOGY_DEDUP_WINDOW_MS: DEDUP_WINDOW_MS,
  }
  const capturedThresholdsSource = {
    CALENDAR_PATHOLOGY_THRESHOLD: settings.CALENDAR_PATHOLOGY_THRESHOLD.source,
    CALENDAR_PATHOLOGY_REPORT_LIMIT: settings.CALENDAR_PATHOLOGY_REPORT_LIMIT.source,
    CALENDAR_PATHOLOGY_DEDUP_WINDOW_MS: settings.CALENDAR_PATHOLOGY_DEDUP_WINDOW_MS.source,
  }
  // ... rest of probe uses these constants ...
  // ... probe_runs.stats includes BOTH thresholds (scalar) AND
  //     thresholds_source (source-per-key) ...
}
```

`probe_runs.stats.thresholds` stays scalar (existing /admin rendering unchanged); a NEW parallel `probe_runs.stats.thresholds_source` field is added in Sub-PR B for the editor UI (Sub-PR C) to consume.

`scripts/lib/operator-settings.mjs` mirrors the TS module: same SETTING_SCHEMA constant + same resolver shape. **Drift detection has TWO layers (R1 WARN #8 closure):**

- **Schema equality test:** loads both files, asserts `JSON.stringify(SETTING_SCHEMA)` is identical.
- **Per-probe integration tests:** for each probe + each knob, set a DB row → run the probe (mock pool/email) → assert the probe's emitted `stats.thresholds` reflects the DB value AND the operative gate uses it.

The per-probe tests are the load-bearing ones — they catch "schema updated in both files but probe forgot to wire new key".

### 4.3 /admin/settings/alerts editor UI (R1 BLOCKER #5 + WARN #9 closure)

`app/admin/(gated)/settings/alerts/page.tsx` server component now resolves per-key settings + renders per-probe edit panels. Each input shows:

- Current effective value
- Source badge (`DB` / `env` / `default`)
- Schema constraints (min, max, type) shown in placeholder/help
- Raw-DB warning badge if `rawDb !== null && validation_failed` (R1 WARN #9 closure — UI distinguishes "row absent" from "row malformed")
- "Save" button → POST `/api/admin/settings/alerts/setting/[key]` with `{ value, expectedUpdatedAt }`
- "Reset to env/default" button → DELETE same route

**Migration-pending state:** the GET-side resolver swallows 42P01 + falls to env/default (no banner needed for the threshold values themselves). The **editor save buttons** are disabled with a banner "Editor unavailable — `operator_settings` table missing; run migration 0055." This requires the page to do ONE extra probe query: `select 1 from information_schema.tables where table_name = 'operator_settings' limit 1`. If 0 rows → banner + disable.

### 4.4 POST/DELETE routes (R1 BLOCKER #3 + WARN #10 closure)

New: `app/api/admin/settings/alerts/setting/[key]/route.ts`. Auth shape matches AUDIT-CODE-1 wave:

```ts
export async function POST(request: Request, ctx: { params: Promise<{ key: string }> }) {
  const guard = await requireAdminRole(request)
  if (!guard.ok) return guard.response
  const rl = await enforceRateLimit(request, 'admin:operator-settings:write', 30, 60_000)
  if (rl) return rl
  const { key } = await ctx.params
  if (!(key in SETTING_SCHEMA)) {
    return NextResponse.json({ error: 'unknown_key' }, { status: 400, headers: NO_STORE })
  }
  const body = await request.json().catch(() => null)
  if (!body || typeof body.value !== 'string') {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400, headers: NO_STORE })
  }
  const result = await setOperatorSetting({
    key: key as SettingKey,
    value: body.value,
    expectedUpdatedAt: body.expectedUpdatedAt ?? null,
    byAccountId: guard.account.id,
  })
  if (!result.ok) {
    const statusMap: Record<typeof result.reason, number> = {
      unknown_key: 400,
      invalid_value: 400,
      concurrent_update: 409,
      migration_pending: 503,
      unauthorized: 403,
    }
    return NextResponse.json({ error: result.reason }, { status: statusMap[result.reason], headers: NO_STORE })
  }
  return NextResponse.json({ ok: true, updatedAt: result.updatedAt }, { headers: NO_STORE })
}
```

DELETE mirrors POST. Both **do NOT use `withIdempotency`** — the post-merge rollback made it sequential-only (no concurrency safety), and our optimistic concurrency via `expectedUpdatedAt` does the right thing. Audit log captures every write regardless of which one wins.

Rate limit: 30/min/admin. The endpoint is operator-facing, not abused under normal use.

### 4.5 Retention (R1 WARN #11 closure)

`scripts/db-retention-cleanup.mjs` adds:

```js
{ table: 'operator_settings_events', column: 'ts', days: 90 },
```

Same shape as `probe_runs`. 90 days bounds growth without losing the forensic-review window for a calendar quarter.

### 4.6 Docs

- `ARCHITECTURE.md` — new section on operator_settings + resolver chain.
- `SECURITY.md` — `§ALERTS-EDITOR trust boundary`: thresholds tunable; recipient stays env-only; suppression-via-overinflate is acceptable risk because of audit log + 90d retention; recipient changes are NOT permitted via this surface; INSERT-only audit role.
- `OPERATIONS.md` — one-line pointer (procedure stays private).
- `docs/plans/admin-ux-coverage.md §10.1` — flip ALERTS-EDITOR row to "in flight / shipped after merge".
- `docs/plans/alerts-obs.md` — note ALERTS-EDITOR follow-up.

## 5. Sub-PR decomposition (epic, ONE plan-mode paranoia + ONE wave-mode at epic-end)

**Sub-PR A — schema + resolver + drift test (foundation):**
- Migration 0055.
- `lib/admin/operator-settings.ts` (TS schema + resolver + write/delete).
- `scripts/lib/operator-settings.mjs` (mirror).
- `tests/admin/operator-settings.test.ts` — unit on resolver chain (DB hit, env fallback, default fallback, malformed DB row → env fallback + log, schema drift between TS + MJS).
- `tests/integration/admin/operator-settings.test.ts` — write/delete with optimistic concurrency + 409 first-create race + 409 expectedUpdatedAt mismatch; audit-log row landed in same TX; trigger blocks UPDATE/DELETE on events table.
- `scripts/db-retention-cleanup.mjs` entry for `operator_settings_events`.
- No /admin UI yet; no probe-script changes. Validates the foundation.

**Sub-PR B — probe scripts migrate to the resolver:**
- All 3 scripts use `resolveOperatorSettingsForProbe` snapshot at top of `main()`.
- `probe_runs.stats.thresholds` stays scalar (existing shape); a NEW parallel `probe_runs.stats.thresholds_source` field is added per-knob (`'db'|'env'|'default'`). Backwards-compatible with current `/admin/settings/alerts` rendering.
- Per-probe integration tests (R1 WARN #8): set DB row → run probe → assert `stats.thresholds` reflects DB + operative gate uses it. One test per (probe × knob).
- ALERTS-OBS UI still shows last-run thresholds; no editor yet.

**Sub-PR C — /admin/settings/alerts editor + idempotent POST + audit trail + docs (epic-close):**
- Editor UI panel per probe.
- POST + DELETE routes for each editable key.
- Migration-pending banner.
- Doc sweep.
- Integration tests on the routes (anon/non-admin/admin happy-path, malformed input, 409 concurrent_update, 503 migration_pending).

`/codex-paranoia wave` on the combined A+B+C diff before the epic-close PR.

## 6. Failure modes / rollback

- **DB row malformed:** resolver returns `{ source: 'env'|'default', rawDb: '<malformed>' }`. Editor UI shows warning badge with the raw value. Operator re-edits or DELETEs.
- **DB unavailable:** resolver returns `{ source: 'env'|'default' }`. Probes log + continue with safe defaults. Editor save attempts get 503.
- **Migration 0055 not applied:** resolver catches 42P01 + falls through. Editor save returns 503 `migration_pending`; UI shows banner.
- **Concurrent admin edits:** the second POST sees `expectedUpdatedAt` mismatch → 409. UI re-fetches + asks operator to re-submit.
- **Admin edits an unknown key:** 400 `unknown_key`.
- **DB-direct write to a non-whitelisted key:** silently inert (no app code reads). Future garbage-collection script can prune unknown keys.
- **Audit insert fails inside TX:** the whole TX rolls back — config row is NOT committed. Atomicity guarantee held.
- **Rollback the wave:** `drop table operator_settings cascade; drop table operator_settings_events cascade;` — app falls back to env/default. No behaviour change beyond losing the tunable layer.

## 7. Out of scope

- ALERT_EMAIL_TO editor (security suppression surface — env-only).
- EMAIL_FROM editor.
- Secrets editor (RESEND_API_KEY etc).
- POLICY-KNOBS DB-tunable upgrade (separate wave; this plan unblocks it).
- Multi-environment fan-out.
- Per-teacher/per-tariff threshold overrides.

## 8. Acceptance

- Migration 0055 lands.
- `lib/admin/operator-settings.ts` + `scripts/lib/operator-settings.mjs` schema + resolver shipped. Schema-equality + per-probe integration tests green.
- All 3 probe scripts read via snapshot resolver. Each (probe × knob) covered.
- `/admin/settings/alerts` editor section renders all 10 editable knobs with `DB`/`env`/`default` source badges + malformed-DB warning badge + concurrent-update handling.
- POST + DELETE routes admin-gated, rate-limited, optimistic-concurrency-aware (single-TX `select for update` + split INSERT-with-ON-CONFLICT-DO-NOTHING / UPDATE paths), audit-logged in the same TX.
- Migration-pending banner shows when `operator_settings` table missing.
- `operator_settings_events` retention 90 days in `db-retention-cleanup.mjs`.
- Doc sweep complete.
- Full integration suite green.
- Plan-mode `/codex-paranoia` SIGN-OFF before sub-PR A code; wave-mode SIGN-OFF on aggregated A+B+C diff before epic-close PR.
- PR trailers: A + B = `Codex-Paranoia: SUB-WAVE self-reviewed (epic alerts-editor); epic-end review pending`. C = `Codex-Paranoia: SIGN-OFF round N/3 (epic-end on <commit-range>)`.
