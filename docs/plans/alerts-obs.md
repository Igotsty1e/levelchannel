# ALERTS-OBS — `/admin/settings/alerts` read-only observability

**Status:** SHIPPED 2026-05-17 (PR #249). Archive.

Plan-mode trail:
- Round 1: BLOCK (8 BLOCKERs + 3 WARNs) → v2 closed all.
- Round 2: BLOCK (2 BLOCKERs invented-shapes + rollout-race + 3 WARNs) → v3 closed all.
- Round 3 (final, cap-3): BLOCK (2 BLOCKERs missing-table + taxonomy + 3 WARNs) → fixed inline post-cap.
- Manual fresh-eyes Explore pass: 3 additional gaps (retention shape mismatch, ambiguous probe-coverage in §4.3, hard-coded 302 redirect status) → fixed inline.

Wave-mode paranoia: SIGN-OFF round 1/3 with 2 WARNs (transport-error wrap + 502/503 test coverage) closed inline before merge.

Follow-ups discovered during wave-mode and tracked in `ENGINEERING_BACKLOG.md §Audit findings — 2026-05-17`: AUDIT-CODE-2 (idempotency cache poisoning fix, PR #254), AUDIT-CODE-3 (extract `isUndefinedTableError` helper), AUDIT-CODE-7 (success-side detector log).
**Wave name:** ALERTS-OBS (one-PR epic; small enough to fit in a single PR).
**Trigger:** admin-ux-coverage §10.1 P2. Operator has no signal today that the three alert probes (auth-flow, calendar-pathology, webhook-flow) are actually running, what they last decided, or that the email transport works — only journald and per-probe local dedup state files. The operator cannot see this without SSH.

## 1. Goal

Stand up `/admin/settings/alerts` as a **read-only** operator observability surface that answers four questions per probe:

1. **Last run** — when did this probe last execute? (timestamp + verdict kind). EXCLUDES manual test-sends.
2. **Last alert** — when did this probe last actually send a real alert email? (timestamp + recipient + fingerprint). EXCLUDES manual test-sends.
3. **Effective thresholds** — what were the runtime-active env values on the LAST probe tick? (Read from the probe_runs row's `stats.thresholds` jsonb — NOT from the Next.js process env, which is stale.)
4. **Dry-run test-send** — can the operator force a "test email" to verify ALERT_EMAIL_TO + RESEND_API_KEY without waiting for a real incident?

**Explicit non-goals:**

- **No editor.** Threshold knobs remain env-only. That's `Wave ALERTS-EDITOR` (admin-ux-coverage §10.1 P3) — gated on this wave proving the read-only workflow first.
- **No new alert types.** The three existing probes are the universe.
- **No replacement of the existing email transport.** Probes keep calling Resend directly; this wave adds an observability layer + minimal `sendAlertEmail` return-contract refactor.

## 2. Existing surface inventory

Per the COMPANY.md Survey-before-plan rule. All citations verified 2026-05-16 against current `main`.

### 2.1 Probe scripts

| Probe | Script | Cadence | Dedup state | Email transport |
|---|---|---|---|---|
| auth-flow | `scripts/auth-flow-alert.mjs` | every 30 min, 7 min boot offset | `./var/auth-flow-alert-state.json` (`AUTH_FLOW_STATE_FILE` overridable) | direct Resend SDK |
| calendar-pathology | `scripts/calendar-pathology-alert.mjs` | every 4 h at :17 offset | `./var/calendar-pathology-state.json` (`CALENDAR_PATHOLOGY_STATE_FILE` overridable) | direct Resend SDK |
| webhook-flow | `scripts/webhook-flow-alert.mjs` | every 30 min, 5 min boot offset | **NONE — explicitly stateless** (lines 38–42) | direct Resend SDK |

All three:
- Are `Type=oneshot` systemd units, user `levelchannel`, with `EnvironmentFile=__LEVELCHANNEL_ENV_FILE__` and `ProtectSystem=strict` sandboxing.
- Log structured JSON to stdout → journalctl (`logJson(level, msg, extra)` helper inline in each script).
- Read `DATABASE_URL` + `RESEND_API_KEY` + `ALERT_EMAIL_TO` + `EMAIL_FROM` from env on every run.
- Use **script-local `pg.Pool({max: 1})`** with explicit `await pool.end()` at script exit (NOT `getDbPool()`). This matters for the helper design — see §3.2 BLOCKER #4 closure.

### 2.2 Env knobs (per probe)

- **auth-flow** (`AUTH_FLOW_*`): `WINDOW_MINUTES=60`, `MAX_PER_IP=50`, `MAX_PER_EMAIL_HASH=20`, `DEDUP_WINDOW_MS=4h`. Reads `auth_audit_events` (migration 0028).
- **calendar-pathology** (`CALENDAR_PATHOLOGY_*`): `THRESHOLD=3`, `REPORT_LIMIT=10`, `DEDUP_WINDOW_MS=24h`. Reads `lesson_slots.cancel_repush_count`. Verdict SoT lives in `lib/calendar/pathology.ts:45-53,94-121`.
- **webhook-flow** (`WEBHOOK_FLOW_*`): `WINDOW_MINUTES=60`, `MIN_VOLUME=5`, `TERMINATED_RATIO=0.3`. No dedup state.

### 2.3 Actual probe verdict shapes (corrects round-1 BLOCKER #6 + round-2 BLOCKER #1)

**Verified verbatim against current code 2026-05-16:**

- **auth-flow** (`scripts/auth-flow-alert.mjs:146-156,325-355`):
  - `decideVerdict(stats).kind` returns one of: `'alert'` | `'no_failures'` | `'ok'`.
  - Stats shape (from `readWindowStats` line 129–141): `{ totalFailed, offendingIps: [{ip, failures}], offendingEmailHashes: [{emailHashShort, failures}] }`.
  - Script also has script-level pseudo-verdicts: `'alert_suppressed_by_dedup'` (line 343), and the `sendAlertEmail` early-returns on missing key / Resend failure (lines 226–238, 303–308) — see §2.7 for the bug this masks.
- **webhook-flow** (`scripts/webhook-flow-alert.mjs:83-122,128-198`):
  - `decideVerdict(stats).kind` returns one of: `'alert'` | `'low_volume_skip'` | `'all_resolved'` | `'ok'`.
  - Stats shape (from `readWindowStats` line 83–101): `{ created, paidWebhooks, failWebhooks, cancelled }`.
  - The `alert` and `ok` verdict variants CARRY their own derived fields `{ ratio, terminated, resolved }` inside the verdict object (NOT in stats). The plan's probe_runs.stats blob extracts these into `stats.derived = { ratio, terminated, resolved }` to keep the row self-contained.
- **calendar-pathology** (`scripts/calendar-pathology-alert.mjs:160-237` + `lib/calendar/pathology.ts:45-52,96-114`):
  - `lib/calendar/pathology.ts:decideVerdict(opts).kind` returns: `'ok'` | `'alert'`.
  - The SCRIPT does NOT use `decideVerdict` directly — it operates on `offenders` array and early-returns at four script-level branches:
    1. `'no offenders above threshold'` (line 175).
    2. `'offenders unchanged within dedup window; skipping email'` (line 189).
    3. `'alert would fire but email destination/key not set; state NOT advanced'` (line 204) — already has the post-Codex fix; auth-flow does NOT yet.
    4. `'resend email failed; state NOT advanced'` (line 222) — already has the post-Codex fix.
    5. `'pathology alert email sent'` (line 228).
  - The plan maps these to probe_runs `verdict_kind` values explicitly — see §4.1.
  - Stats shape: `{ threshold, offenderCount, dedupWindowMs }`.

The plan's `verdict_kind` CHECK constraint enumerates all of these (§4.1).

### 2.4 Admin layout slot

`app/admin/(gated)/layout.tsx:73-82` defines 10 current tabs. The plan adds an 11th. The layout DOES NOT return 401/403 for unauthorized — it redirects: anonymous → `/admin/login`, non-admin → `/cabinet` (`app/admin/(gated)/layout.tsx:30-40`). Integration tests assert redirect status + Location header, NOT 401/403.

### 2.5 Existing observability infrastructure

- **No `probe_runs` / `probe_alerts` audit table exists today.** Each probe's only signal is journald + (for two of three) a local dedup state file.
- **`payment_audit_events`** (migration 0012) requires real `invoice_id` FK + `customer_email` + `amount_kopecks`. **NOT a valid sink for dry-run test-sends** (round-1 BLOCKER #7).
- **No existing `/admin/settings/*` route family.** First time `settings` appears in the layout.

### 2.6 Existing `.mjs` constraint

`scripts/calendar-pathology-alert.mjs:11-13` explicitly documents that systemd-cron `.mjs` scripts **cannot import `@/...` path-aliased TypeScript modules** — Node CLI doesn't understand the alias and the runtime is plain ESM. The shared helper for this wave MUST be `.mjs` and live in a path the probes can resolve relative-import-style (round-1 BLOCKER #3).

### 2.7 Existing dedup-state-on-failure bug (auth-flow)

`scripts/auth-flow-alert.mjs:224-239,303-310,327-354` — `sendAlertEmail()` currently swallows missing-key / Resend-API errors and returns nothing distinguishable; caller advances dedup state regardless. This means a failed send today already false-positively suppresses retries. The plan SCOPES IN a small return-contract refactor as part of round-1 BLOCKER #5 closure — see §4.3.

### 2.8 Retention owner

`scripts/db-retention-cleanup.mjs:13-55,214-271` is the only janitor that prunes audit/log tables. It does NOT today know about `probe_runs`. The plan adds a retention rule there (§4.7).

## 3. Design — Option B+ (single `probe_runs` table, refactored probe contract)

Round 1 confirmed Option A (state-file reads + journald parse) is too fragile and Option C (split tables) is premature. Option B remains correct but needs three rounds of refinement closed in this revision:

### 3.1 Schema captures everything the page needs

`probe_runs` row carries: probe_name, ran_at, verdict_kind, alert_sent, **recipient_email** (snapshot at send time), alert_email_id, fingerprint, **stats** (includes `thresholds` sub-object — see §3.3), error_message, **is_test**, **initiator_account_id**. Closes round-1 BLOCKER #1 + #2 + #8.

### 3.2 Probe-side helper is pure ESM

`scripts/lib/probe-runs.mjs` — pure `.mjs`, no TS, no `@/`. Each probe imports it via relative path `import { recordProbeRun } from './lib/probe-runs.mjs'`. The helper RECEIVES a `pg.Pool` instance (the probe's existing local pool, `max: 1`) — it does NOT call `getDbPool()`. After-INSERT shutdown stays with the probe's existing `await pool.end()`. Closes round-1 BLOCKER #3 + #4.

### 3.3 Thresholds travel WITH the probe tick, not the admin process

Each probe captures its env-read at the top of the run and includes it in `stats.thresholds`. Admin page reads thresholds from the latest probe_runs row, NEVER from `process.env`. Probes are oneshot → env is always fresh on their tick → page shows what was actually in effect on the last run. Closes round-1 BLOCKER #8.

### 3.4 Test-sends never pollute "last run" / "last alert"

`is_test=true` rows are excluded from both queries. `initiator_account_id` carries the operator id. Test-send writes to `probe_runs` ONLY — no `payment_audit_events` involvement. Closes round-1 BLOCKER #1 + #7.

### 3.5 `sendAlertEmail` return contract refactored

Each probe's `sendAlertEmail` now returns `{ ok: true, emailId: string } | { ok: false, error: string }`. Caller decides whether to advance dedup state AND records the probe_runs row with correct `alertSent`. Closes round-1 BLOCKER #5 (and incidentally fixes a real pre-existing bug in auth-flow where failed sends were masking retries).

## 4. Implementation

### 4.1 Migration `0053_probe_runs.sql`

```sql
create table if not exists probe_runs (
  id uuid primary key default gen_random_uuid(),
  probe_name text not null check (probe_name in (
    'auth-flow', 'calendar-pathology', 'webhook-flow'
  )),
  ran_at timestamptz not null default now(),
  verdict_kind text not null check (verdict_kind in (
    'alert_sent',           -- any probe: alert verdict + email sent successfully
    'alert_send_failed',    -- any probe: alert verdict + Resend returned error
    'dedup_skip',           -- any probe: same offender set inside dedup window
    -- auth-flow specific (verbatim from decideVerdict in scripts/auth-flow-alert.mjs:146-156)
    'no_failures',          -- auth-flow: totalFailed == 0
    'within_thresholds',    -- auth-flow: 'ok' kind (failures but none over threshold)
    -- calendar-pathology specific (verbatim from script branches in calendar-pathology-alert.mjs:160-237)
    'no_offenders',         -- calendar-pathology: empty offenders list
    -- webhook-flow specific (verbatim from decideVerdict in scripts/webhook-flow-alert.mjs:105-122)
    'low_volume_skip',      -- webhook-flow: created < MIN_VOLUME
    'all_resolved',         -- webhook-flow: terminated + cancelled >= created
    'ok',                   -- webhook-flow: ratio above floor; healthy
    -- shared
    'config_missing',       -- any probe: ALERT_EMAIL_TO / RESEND_API_KEY unset on an alert-needed run
    'error',                -- any probe: unexpected exception
    'test_send_succeeded',  -- /api/admin/settings/alerts/[probe]/test-send happy path
    'test_send_failed'      -- /api/admin/settings/alerts/[probe]/test-send error path
  )),
  alert_sent boolean not null default false,
  recipient_email text null,
  alert_email_id text null,
  fingerprint text null,
  stats jsonb null,
  error_message text null,
  is_test boolean not null default false,
  -- Round-2 WARN #3 closure: on delete restrict matches the sibling
  -- operator-action audit tables (payment_refund_attempts,
  -- package_grant_resolutions). on delete set null was wrong for an
  -- audit trail — provenance would be lost. If an operator account
  -- ever needs purge, their probe_runs test rows must be addressed
  -- first (same contract as refund attempts).
  initiator_account_id uuid null references accounts(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists probe_runs_real_runs_idx
  on probe_runs (probe_name, ran_at desc)
  where is_test = false;
create index if not exists probe_runs_real_alerts_idx
  on probe_runs (probe_name, ran_at desc)
  where alert_sent = true and is_test = false;
```

The CHECK on `verdict_kind` is INCLUSIVE — a typo from probe code fails the INSERT (defence-in-depth since probes are `.mjs` without TS type safety per round-1 WARN #11).

### 4.2 Shared helper `scripts/lib/probe-runs.mjs`

```javascript
// scripts/lib/probe-runs.mjs — pure ESM, used by .mjs probes only.
// Probes pass their own pg.Pool (max:1, explicit end()) — do NOT
// call getDbPool() (that's a Next.js singleton with max:10 + no
// shutdown path, wrong shape for oneshot systemd jobs).

// Round-3 BLOCKER #2 closure: every key's value MUST appear verbatim
// in migration 0053's verdict_kind CHECK constraint (§4.1). Adding a
// new constant requires extending the CHECK first.
export const VERDICT_KINDS = Object.freeze({
  ALERT_SENT: 'alert_sent',
  ALERT_SEND_FAILED: 'alert_send_failed',
  DEDUP_SKIP: 'dedup_skip',            // shared kind for both auth-flow and calendar-pathology "same set inside dedup window"
  NO_FAILURES: 'no_failures',
  WITHIN_THRESHOLDS: 'within_thresholds',
  NO_OFFENDERS: 'no_offenders',
  LOW_VOLUME_SKIP: 'low_volume_skip',
  ALL_RESOLVED: 'all_resolved',
  OK: 'ok',
  CONFIG_MISSING: 'config_missing',
  ERROR: 'error',
  TEST_SEND_SUCCEEDED: 'test_send_succeeded',
  TEST_SEND_FAILED: 'test_send_failed',
})

export async function recordProbeRun(pool, params) {
  // Best-effort. NEVER throws. NEVER blocks the probe's primary
  // job (sending the alert email).
  try {
    await pool.query(
      `insert into probe_runs (
         probe_name, verdict_kind, alert_sent, recipient_email,
         alert_email_id, fingerprint, stats, error_message,
         is_test, initiator_account_id
       ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)`,
      [
        params.probeName,
        params.verdictKind,
        params.alertSent ?? false,
        params.recipientEmail ?? null,
        params.alertEmailId ?? null,
        params.fingerprint ?? null,
        params.stats ? JSON.stringify(params.stats) : null,
        params.errorMessage ?? null,
        params.isTest ?? false,
        params.initiatorAccountId ?? null,
      ],
    )
  } catch (err) {
    console.warn(JSON.stringify({
      level: 'warn',
      msg: 'recordProbeRun failed (best-effort)',
      probe: params.probeName,
      error: err instanceof Error ? err.message : String(err),
    }))
  }
}
```

### 4.3 `sendAlertEmail` return-contract refactor

All three probes refactor their inline `sendAlertEmail` to return:

```javascript
// Before (any of the three): swallowed errors, returned undefined.
// After:
return { ok: true, emailId }
// or
return { ok: false, error: 'missing_resend_api_key' }
return { ok: false, error: 'missing_alert_email_to' }
return { ok: false, error: 'resend_send_failed', detail: err.message }
```

Caller pattern (same across all three probes — auth-flow, webhook-flow, calendar-pathology each get this same conditional after the `sendAlertEmail` call, the same top-level try/catch wrap below, and the same call to `recordProbeRun` on every verdict branch):

```javascript
const sendResult = await sendAlertEmail(...)
const stats = { ...probeStats, thresholds: capturedEnv }
const recipientEmail = process.env.ALERT_EMAIL_TO || null
if (sendResult.ok) {
  await advanceDedupState(...)  // ONLY on real send success
  await recordProbeRun(pool, {
    probeName: 'auth-flow',
    verdictKind: VERDICT_KINDS.ALERT_SENT,
    alertSent: true,
    recipientEmail,
    alertEmailId: sendResult.emailId,
    fingerprint,
    stats,
  })
} else {
  await recordProbeRun(pool, {
    probeName: 'auth-flow',
    verdictKind: sendResult.error === 'missing_resend_api_key' || sendResult.error === 'missing_alert_email_to'
      ? VERDICT_KINDS.CONFIG_MISSING
      : VERDICT_KINDS.ALERT_SEND_FAILED,
    alertSent: false,
    recipientEmail,
    errorMessage: sendResult.error,
    stats,
  })
}
```

The non-alert verdict branches (`no_failures`, `dedup_skip`, etc.) also call `recordProbeRun` with the matching `verdictKind`, `alertSent: false`, and full `stats.thresholds`.

**Round-3 WARN #5 closure — `'error'` verdict path is reachable.** Each probe wraps its `main()` body in a top-level try/catch that, on any unexpected exception, calls `recordProbeRun(pool, { probeName, verdictKind: VERDICT_KINDS.ERROR, alertSent: false, errorMessage: err.message, stats: { thresholds: capturedEnv } })` BEFORE re-throwing for the existing journald log + `process.exit(1)`. Without this, a crash leaves stale "last run" data on the admin page indefinitely. Pseudocode:

```javascript
async function main() {
  const pool = new pg.Pool({ ... })
  const capturedEnv = { /* thresholds */ }
  try {
    // ... existing probe logic ...
  } catch (err) {
    await recordProbeRun(pool, {
      probeName: 'auth-flow',  // per probe
      verdictKind: VERDICT_KINDS.ERROR,
      alertSent: false,
      errorMessage: err instanceof Error ? err.message : String(err),
      stats: { thresholds: capturedEnv },
    })
    throw err
  } finally {
    await pool.end()
  }
}
```

This means `recordProbeRun` MUST tolerate being called with `pool` in any state (including post-error). The helper is wrapped in its own try/catch (§4.2) so a pool already in a broken state surfaces as a `warn` log, not a re-throw cascading over the original error.

### 4.4 Per-probe stats blob — verified verbatim shapes (closes round-1 BLOCKER #6 + round-2 BLOCKER #1)

Field names below MATCH the existing `readWindowStats` return shape in each probe — no renaming, no invented fields:

```javascript
// auth-flow (mirrors readWindowStats in scripts/auth-flow-alert.mjs:129-141)
stats = {
  totalFailed,                  // existing field, kept as-is
  offendingIps,                 // existing: [{ip, failures}, ...]
  offendingEmailHashes,         // existing: [{emailHashShort, failures}, ...]
  thresholds: {                 // NEW: snapshot of env at this tick
    AUTH_FLOW_WINDOW_MINUTES,
    AUTH_FLOW_MAX_PER_IP,
    AUTH_FLOW_MAX_PER_EMAIL_HASH,
    AUTH_FLOW_DEDUP_WINDOW_MS,
  },
}

// calendar-pathology (mirrors readOffenders return + existing log payloads in scripts/calendar-pathology-alert.mjs:175,189-193)
stats = {
  offenderCount,                // existing: offenders.length
  thresholds: {                 // NEW: snapshot of env at this tick
    CALENDAR_PATHOLOGY_THRESHOLD,
    CALENDAR_PATHOLOGY_REPORT_LIMIT,
    CALENDAR_PATHOLOGY_DEDUP_WINDOW_MS,
  },
}

// webhook-flow (mirrors readWindowStats in scripts/webhook-flow-alert.mjs:83-101; alert/ok verdict variants carry {ratio, terminated, resolved} INSIDE the verdict object — extract them into stats.derived so probe_runs.stats is self-contained)
stats = {
  created,                      // existing
  paidWebhooks,                 // existing
  failWebhooks,                 // existing
  cancelled,                    // existing
  derived: {                    // NEW: extracted from verdict for self-contained row.
    // Round-3 WARN #4 closure: pin the shape for every verdict kind.
    // On 'low_volume_skip' the decideVerdict only returns { kind },
    // so we backfill from raw counters: terminated = paid + fail,
    // resolved = terminated + cancelled, ratio = null (no signal,
    // not zero — zero would imply "all fail", which is wrong).
    // On 'all_resolved': ratio = null (same reasoning — the alert
    // path didn't run). On 'alert' / 'ok': all three from verdict.
    ratio,                      // number | null
    terminated,                 // always present (= paid + fail)
    resolved,                   // always present (= terminated + cancelled)
  },
  thresholds: {                 // NEW: snapshot of env at this tick
    WEBHOOK_FLOW_WINDOW_MINUTES,
    WEBHOOK_FLOW_MIN_VOLUME,
    WEBHOOK_FLOW_TERMINATED_RATIO,
  },
}
```

### 4.5 Admin page `app/admin/(gated)/settings/alerts/page.tsx`

Server component. Reads three queries (one per probe) via a new lib helper `lib/admin/probe-status.ts`:

```typescript
// lib/admin/probe-status.ts — Next.js server side, OK to use @/ alias.
// Round-3 WARN #3 closure: ProbeStatus carries an explicit
// `migrationPending` flag so the page banner path is fully typed.
export type ProbeStatus =
  | { migrationPending: true }
  | {
      migrationPending?: false
      probeName: ProbeName
      lastRun: { ranAt: string; verdictKind: string; stats: unknown } | null
      lastAlert: {
        ranAt: string
        recipientEmail: string | null
        fingerprint: string | null
        alertEmailId: string | null
      } | null
    }

export async function getProbeStatus(probeName: ProbeName): Promise<ProbeStatus>
```

`getProbeStatus` runs two `select ... from probe_runs where probe_name=$1 and is_test=false order by ran_at desc limit 1` — one filtered by `alert_sent=true`. Uses the partial indexes from §4.1.

**Graceful degradation on migration-pending (closes round-2 BLOCKER #2):** both queries wrap in try/catch. On Postgres error code `42P01` ("relation does not exist"), return `{ migrationPending: true }` instead of throwing. The page renders a one-line banner: «БД миграция не применена — обновите `npm run migrate:up` на VPS». Same handling in the test-send endpoint returns `503 { error: 'migration_pending' }`.

UI renders one card per probe with thresholds from `lastRun.stats.thresholds`. If `lastRun` is null (table empty but exists), render "нет данных — пробник ещё не запускался". If migration pending, the banner above takes precedence.

### 4.6 Dry-run test-send `POST /api/admin/settings/alerts/[probe]/test-send`

Auth: `requireAdminRole` + `enforceTrustedBrowserOrigin` + rate limit (5 req / hour / IP).
Body: `{ confirmReason: string }` (operator must type non-empty reason — anti-fat-finger).
**Idempotency:** wrapped in `withIdempotency` (closes round-1 WARN #9), scope `admin:alerts:test-send:${probe}:${operatorAccountId}`.

Action:
1. Validate `probe` param against the three known names.
2. **Migration-pending preflight (closes round-3 BLOCKER #1):** the endpoint runs an explicit `select 1 from probe_runs limit 0` BEFORE any other side effect. On Postgres error code `42P01` (relation does not exist), it returns `503 { error: 'migration_pending', message: 'БД миграция не применена — обновите npm run migrate:up на VPS' }` and does NOT call Resend. This makes the contract end-to-end: missing table → 503, never 200/422 with a side-effect email.
3. Read `ALERT_EMAIL_TO` + `RESEND_API_KEY` from env. If either missing → 422 + `recordProbeRun` with `verdictKind=test_send_failed`, `is_test=true`, `errorMessage='config_missing'`.
4. Call Resend with a hardcoded `[LevelChannel] TEST — {probe} dry-run` email.
5. `recordProbeRun(pool, { probeName, verdictKind: TEST_SEND_SUCCEEDED|TEST_SEND_FAILED, alertSent: ok, recipientEmail, alertEmailId, fingerprint: 'test-${operatorAccountId}-${ts}', stats: { reason: confirmReason }, isTest: true, initiatorAccountId: session.account.id })`.
6. Returns `{ ok: true, emailId, sentAt }` or `{ error: 'missing_alert_email_to' | 'missing_resend_api_key' | 'send_failed' }`.

NO `payment_audit_events` involvement — that table is payment-domain and requires invoice_id FK. The `probe_runs` row with `is_test=true` + `initiator_account_id` IS the audit record.

### 4.7 Retention rule

`scripts/db-retention-cleanup.mjs:225-271` calls `deleteWindow(pool, label, sql)` per table inside the `Promise.all([...])` block. The plan adds ONE new call following the same pattern (verified verbatim against current code — round-3 post-Codex pass caught the original config-object proposal didn't match the script's shape):

```javascript
deleteWindow(
  pool,
  'probe_runs',
  `delete from probe_runs
    where ran_at < now() - interval '90 days'`,
),
```

90 days covers a full quarterly retro window. Volume: ~6 INSERTs/h × 24 × 90 = ~13k rows max. The retention job runs daily on its own systemd timer.

### 4.8 Layout nav addition

`app/admin/(gated)/layout.tsx` gets one new tab: `Алерты → /admin/settings/alerts`. Placed after Документы, before Реконсилиация.

### 4.9 Tests

Integration:
- `tests/integration/admin/alerts-obs.test.ts`:
  - **anonymous → redirect to /admin/login**. Assertion: `[307, 308, 303, 302].includes(res.status)` AND `res.headers.get('location')?.endsWith('/admin/login')`. Next.js `redirect()` from `next/navigation` doesn't guarantee 302 specifically — hard-coding 302 would be flaky across Next.js versions (caught in manual review post-round-3).
  - **learner → redirect to /cabinet**. Same assertion shape.
  - Admin happy path: seeds 3 probe_runs rows (one per probe), page renders 3 cards with correct lastRun + lastAlert + thresholds.
  - Test-send happy path: probe_runs row inserted with is_test=true + initiator_account_id; "last run" + "last alert" queries still see the prior real run (test row excluded).
  - Test-send rate-limit: 6th request in an hour → 429.
  - Test-send missing ALERT_EMAIL_TO → 422 + probe_runs row with `verdictKind=test_send_failed`, `is_test=true`.
  - Test-send withIdempotency (sequential replay): same Idempotency-Key fired SEQUENTIALLY → returns cached response, ONE probe_runs row, ONE email. (NOTE: concurrent double-fire of the same Idempotency-Key MAY still produce two emails because `withIdempotency` is read-execute-save; this is acceptable for operator-triggered test-send — round-2 WARN #4 explicitly caveats this.)
- `tests/integration/observability/probe-runs.test.ts`:
  - `recordProbeRun` writes correctly with all field shapes.
  - DB outage simulation (closing pool mid-call) → no throw, warn logged.
  - All `verdict_kind` values from `VERDICT_KINDS` pass the DB CHECK; an invented kind fails.
- `tests/integration/billing/probe-runs-schema.test.ts`:
  - CHECK on probe_name rejects unknown values.
  - CHECK on verdict_kind rejects unknown values.
  - Partial indexes exist (assert via `pg_indexes` catalog query — `where indexname = 'probe_runs_real_runs_idx' and indexdef like '%where (is_test = false)%'`). NOT an EXPLAIN check — planner on a small table picks seq scan even with a valid partial index, so round-2 WARN #5 explicitly drops EXPLAIN in favor of catalog-level assertion.
  - `initiator_account_id` FK on delete restrict behaves correctly (attempting to delete a referenced account → 23503 foreign-key violation).

## 5. Rollout

**Round-2 BLOCKER #2 closure: graceful degradation when migration hasn't applied yet.**

The VPS autodeploy script does NOT enforce migrate-before-restart ordering (verified 2026-05-16 — the script lives only on the VPS, not the repo; no `migrate:up` invocation in `scripts/post-deploy-smoke.sh` either). The same PR ships migration 0053 + admin page + probe edits, so there's a window between code reload and `migrate:up` where `/admin/settings/alerts` and `POST /test-send` would hit a non-existent table → 500.

**Mitigation: both the admin page and the test-send endpoint wrap every `probe_runs` query in a try/catch that detects the `relation "probe_runs" does not exist` error code (`42P01`) and returns a graceful "service unavailable; awaiting database migration" response.** The admin page renders a one-line warning banner; the test-send endpoint returns `503` + `{ error: 'migration_pending' }`.

Probes are unaffected — `recordProbeRun` is best-effort and silently logs a warn on the same error.

**Deploy steps:**

1. Migration 0053 + probe edits + lib helper + admin page + test-send endpoint + retention update all in same PR (single-PR epic).
2. After merge to main: operator runs `npm run migrate:up` on prod (idempotent).
3. Autodeploy timer picks up the new code on next tick; if code lands BEFORE the operator runs step 2, the admin page shows "migration pending" and the test-send returns 503. No 500s.
4. Validation: ssh into prod, force one probe run (`systemctl start levelchannel-webhook-flow-alert.service`), curl the admin page, verify row appears + thresholds match `.env`.

**Rollback:** the migration is additive (new table + new index). Rolling back code reverts the admin page and probe edits; the table can stay (zero downstream consumers). If full rollback needed: `drop table probe_runs`.

## 6. Risks + mitigations

- **R1 — probe edits cause new failure mode.** Best-effort `recordProbeRun` swallows errors and logs `warn`; probe's email-send path is untouched (modulo the return-contract refactor in §4.3, which is a strict bug fix). Mitigation locked in via lib contract.
- **R2 — DB write storms.** 3 probes × 2 ticks/h = 6 INSERTs/h. Negligible.
- **R3 — test-send abused.** Rate limit 5/h/IP + admin-only + withIdempotency + audit row (probe_runs with is_test=true + initiator_account_id). Mitigation matches `/api/admin/refunds` shape.
- **R4 — env-read freshness drift between Next.js process and probes.** Closed by §3.3: page reads thresholds from probe_runs.stats, never from `process.env`. Operator sees what was actually in effect, not what the long-lived Next.js process happens to remember.
- **R5 — verdict_kind typo silently lands.** DB CHECK rejects unknown values (§4.1). VERDICT_KINDS frozen constant in probe lib (§4.2) gives JS-level guard for the probe scripts (no TS).
- **R6 — auth-flow dedup-state-on-send-failure bug carries forward.** Closed by §4.3 refactor: dedup state advances ONLY on `sendResult.ok=true`.
- **R7 — probe_runs unbounded growth.** Closed by §4.7 retention rule (90 d, ~13k rows max).

## 7. Open questions for paranoia round 2

1. Does the `withIdempotency` scope key (`admin:alerts:test-send:${probe}:${operatorAccountId}`) leak across operators in a way that matters? (Including operatorAccountId makes the same key unique per operator, so two operators clicking "Test" within seconds get two emails — that's correct, both operators wanted confirmation.)
2. Should the `is_test=true` rows have their OWN partial index for an admin-only "test send history" subview, or do we let those queries scan the small table?
3. Does `initiator_account_id` FK `on delete set null` lose audit value if an operator is purged? (Tradeoff: keeping it strict would block deletion. set-null is correct for audit ergonomics.)
4. The probe scripts already create their own `pg.Pool`. Should `recordProbeRun` REQUIRE the caller to pass it (as designed) or default to spawning its own ephemeral pool if not passed? (Design says require — simpler, no second-pool-leak risk.)
5. Should `/admin/settings/alerts` have a "force re-poll" button that triggers `systemctl start levelchannel-{probe}-alert.service`? (Decision: NO — out of scope; that's `ALERTS-EDITOR` territory and crosses the systemd boundary.)
