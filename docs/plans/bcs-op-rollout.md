# Epic: BCS-OP-ROLLOUT — operator activation for the calendar contour

**Status:** PLAN-MODE round 3 (drafted 2026-05-14 by Claude; round 1 returned BLOCK with 7 BLOCKERs + 5 WARNs, round 2 returned BLOCK with 3 BLOCKERs + 2 WARNs, all addressed in this revision)
**Project:** LevelChannel
**Codex-Paranoia model:** epic-level (per the contract at `~/.claude/CLAUDE.md §Two-checkpoint paranoia pipeline` + `~/.claude/skills/codex-paranoia/SKILL.md`)

## 1. Problem

Five calendar workers shipped to `lib/calendar/` across BCS-D / BCS-E / BCS-G but were never wired into production execution. The library code exists; the cron entries do not. On prod RIGHT NOW:

| Worker | Source | Cadence (plan) | Currently runs on prod? |
|---|---|---|---|
| `drainPullJobs` | `lib/calendar/pull-worker.ts` | every 1 min (cron fallback for webhook-driven path) | **NO** |
| `drainPushJobs` | `lib/calendar/push-worker.ts` | every 1 min | **NO** |
| `drainIntents` | `lib/calendar/intent-worker.ts` | every 30s (cron mode: every 5 min) | **NO** |
| `renewExpiringChannels` | `lib/calendar/channel-renewer.ts` | daily | **NO** |
| `reviveBlockedIntents` | `lib/calendar/intent-worker.ts` | hourly | **NO** |
| `runReconcileSweep` | `lib/calendar/reconcile-runner.ts` (BCS-G.1) | daily | **NO** |

(The pathology-alert probe DOES run after PR #215 wired it into `activate-prod-ops.sh`.)

User-visible consequences of the gap:

- **Pull worker silent:** `teacher_external_busy_intervals` stales out. The 10-min freshness TTL drops sync_state out of the booking gate → double-bookings against teacher's personal Google events become possible. Hidden-slots banner under-counts (now mirrors the gate).
- **Push worker silent:** new bookings never appear in teacher's Google → teacher logs into Google, sees no lesson, manually re-creates → orphan event, then F9‴ pathology loop triggers (which we now DO alert on).
- **Intent worker silent:** cancellations don't propagate to Google → teacher sees a cancelled lesson on their Google calendar at the original time → confusion.
- **Channel renewer silent:** Google channels expire at 7-day max → webhook stops firing → silent breakage of the realtime sync path. The first push from Google goes missing after day 7 of any teacher's connection.
- **Intent-revival silent:** Intents that landed in `blocked_integration` status (when the teacher was disconnected) never flip back to `pending` after the teacher reconnects → cancellation forever stale.
- **Reconcile silent:** F9″ active healer (BCS-G.1) never runs → drift between LC and Google accumulates → pathology counter never increments → pathology alert never fires either.

Plus a related gap surfaced by Codex in BCS-G.1 round 5 paranoia and deferred at the time:

- **Plan §4.11 401 refresh-retry:** `ensureFreshAccessToken` reuses a still-by-timestamp-valid cached token. If Google revokes the token server-side (manual revoke, scope change, account suspension), every consumer gets a 401 RESULT VARIANT (not an exception — Google clients in this repo return `{ok:false, reason:'auth_expired'}` / `{ok:false, error: {kind:'http', status:401}}`, see `lib/calendar/google/pull.ts:202-210, 432-436`, `lib/calendar/google/push.ts:198-201, 315-318, 353-356`, `lib/calendar/google/channels.ts:82-90, 157-164`) and skips the cycle indefinitely. Plan mandates "on 401 retry once with refreshed token; on second 401 flip to disconnected." Today NO consumer implements it.

## 2. Goals

By the end of this epic:

1. All 6 worker entry-points (5 listed + reconcile-runner) are invoked on a cron cadence on prod.
2. Each invocation is observable via journalctl with a structured outcome line.
3. The 401-retry contract from plan §4.11 is implemented in `ensureFreshAccessToken` (via `forceRefresh` flag) and used by every consumer.
4. No customer-visible regression: the booking gate, hidden-slots banner, push/pull/cancel flows all continue working.
5. Activation is mechanical via `scripts/activate-prod-ops.sh` — the operator copies the rendered systemd units and starts the timers; no hand-rolled cron jobs.

## 3. Non-goals

- New worker logic. All 6 worker functions are already written + tested.
- Multi-instance / horizontal scaling. Single-VPS cron only.
- Cron-as-a-service migration (e.g. GH Actions, render.com cron). VPS-local systemd timers, same as the other 5 maintenance jobs.
- API rate-limit prioritisation across workers. Each worker has its own internal budget; we don't add a global rate-budget here.

## 4. Architecture

### 4.1 Trigger surface — internal API routes

Each worker gets its own POST endpoint under `/api/cron/calendar/`:

| Endpoint | Worker |
|---|---|
| `/api/cron/calendar/pull` | `drainPullJobs` |
| `/api/cron/calendar/push` | `drainPushJobs` |
| `/api/cron/calendar/intents` | `drainIntents` |
| `/api/cron/calendar/renew-channels` | `renewExpiringChannels` |
| `/api/cron/calendar/revive-blocked` | `reviveBlockedIntents` |
| `/api/cron/calendar/reconcile` | `runReconcileSweep` |

Why API routes (vs `.mjs` raw-pg scripts like the existing maintenance jobs):

- Workers are written in TypeScript, use `lib/calendar/google/*` for Google API calls, OAuth tokens (encrypted via `CALENDAR_ENCRYPTION_KEY`), `getDbPool()` pooling, structured logging. Reimplementing that in `.mjs` is unrealistic and creates a divergence risk.
- The Next.js runtime is already on prod, serving the rest of the app — adding 6 internal-only routes is cheap.
- Easier to test: each route gets a unit test that mocks the underlying worker + verifies auth.

Why NOT a single `/api/cron/calendar/tick` endpoint that runs everything in sequence:

- Cadences differ (1 min vs daily). Coupling them means most cron runs are wasted.
- Failure isolation: one slow worker shouldn't starve the others.
- Timer offsets stagger DB load.

### 4.2 Authentication

Two-layer gate (Codex round 1 WARN #9 — bearer alone is publicly reachable):

1. **Loopback-only host check** (route-side). `requireCronSecret` first asserts the request's `Host` header is `127.0.0.1:<port>` or `localhost:<port>` OR resolves from a `CRON_TRUSTED_HOST` env-list. If the host doesn't match → 404 (NOT 401 — avoid leaking the existence of the route).
2. **Bearer-secret** (route-side). After the host check passes, `Authorization: Bearer ${CRON_SHARED_SECRET}` is required. Mismatch → 401.

This way an attacker hitting `https://levelchannel.ru/api/cron/calendar/pull` from the internet gets 404 (host mismatch via nginx-set Host header — nginx terminates TLS and the upstream sees `Host: levelchannel.ru`, not `127.0.0.1`). The local cron, however, hits `127.0.0.1:3000` directly and the loopback path passes.

- New env vars (in `.env.example`):
  - `CRON_SHARED_SECRET` — 32+ random chars.
  - `CRON_TRUSTED_HOST` (optional, comma-separated) — extra allow-list for non-loopback callers; defaults to empty.
- Auth helper: `lib/api/cron-auth.ts` exports `requireCronSecret(request: Request): Response | null`. Order of checks: host → bearer.
- All 6 routes call it at the top.
- Rate limit: 12/min/IP (defense in depth — if the secret leaks AND a route somehow gets exposed, attacker doesn't get unlimited replay).

### 4.3 Worker invocation contract

Each route handler is:

```typescript
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const authGate = requireCronSecret(request)
  if (authGate) return authGate
  const rl = await enforceRateLimit(request, 'cron:<worker>:ip', 12, 60_000)
  if (rl) return rl
  const t0 = Date.now()
  try {
    const result = await <worker>({})  // default opts
    const durationMs = Date.now() - t0
    console.log(JSON.stringify({
      probe: 'cron-calendar-<worker>',
      level: 'info',
      duration_ms: durationMs,
      ...summarizeResult(result),
    }))
    return NextResponse.json({ ok: true, ...summarizeResult(result), duration_ms: durationMs }, { headers: NO_STORE })
  } catch (e) {
    console.error(`[cron/calendar/<worker>] failed`, e)
    return NextResponse.json({ ok: false, error: 'worker_failed' }, { status: 500, headers: NO_STORE })
  }
}
```

#### 4.3.1 `summarizeResult` PII contract (Codex round 1 WARN #11)

Each worker's `summarizeResult` is an EXPLICIT allowlist of fields, NOT a `...result` spread. Specifically:

- `renewExpiringChannels` returns `{ renewed: N, details: [{externalCalendarId, status, ...}] }` — `externalCalendarId` can be an email-like Google calendar id (PII for third parties). The summary log MUST extract only `{ renewed: N }` and per-row `{ status }` aggregates, NEVER the calendar id directly.
- `reconcile-runner` returns `outcomes` map + `details: [{ slotId, outcome }]` — slotId is an internal UUID (not PII) so it's OK; `outcome.message` fields from `skipped_network` / `skipped_shape` MAY contain remote error strings that occasionally include emails. Truncate at 100 chars + strip anything that looks like an email.
- `intent-worker` / `push-worker` / `pull-worker` — outcomes are enum-shaped + counts. Safe.

Test (per worker): `summarizeResult({ … synthetic-with-PII-fields … })` returns an object whose JSON serialization does NOT contain the PII inputs. Tightens the rule against future drift.

### 4.4 Cron entry script

A single parameterised `scripts/calendar-cron.mjs`:

- Reads `CALENDAR_CRON_TARGET` env (e.g. `pull`, `push`, `intents`, `renew-channels`, `revive-blocked`, `reconcile`) → constructs the URL.
- POSTs to `http://127.0.0.1:3000/api/cron/calendar/${target}` with the bearer header.
- **HTTP timeout is per-target** (Codex round 2 BLOCKER #2 — a single 8-min global was inconsistent with the per-unit `TimeoutStartSec` table in §4.5.2). Each target's HTTP timeout = its unit's `TimeoutStartSec` − 30s, so the Node fetch aborts and logs a clean error 30s before systemd would SIGKILL. The script reads a built-in lookup table:

  | `CALENDAR_CRON_TARGET` | HTTP timeout (s) | Matches `TimeoutStartSec` (s) |
  |---|---|---|
  | `pull` | 570 | 600 |
  | `push` | 270 | 300 |
  | `intents` | 270 | 300 |
  | `renew-channels` | 570 | 600 |
  | `revive-blocked` | 90 | 120 |
  | `reconcile` | 870 | 900 |

  Unknown target → script exits 2 (config error) without making a request. Implementation: `const TIMEOUTS_SEC = { pull: 570, push: 270, intents: 270, 'renew-channels': 570, 'revive-blocked': 90, reconcile: 870 }; const t = TIMEOUTS_SEC[target]; if (!t) { process.exit(2) }; const controller = new AbortController(); setTimeout(() => controller.abort(), t * 1000);`.
- Logs the response JSON to journald.
- Exit code 0 on 2xx, 1 on non-2xx, 2 on config error.

Why one script not six: same code path for all six routes; per-target customisation is just an env-var dispatch + a small lookup table for the timeout.

### 4.5 Systemd units

One `.service` template per worker (renders the env-file + WorkingDirectory placeholders like the existing 5 maintenance units), plus one `.timer` per worker with the right cadence.

#### 4.5.1 Cadence + explicit-stagger table (Codex round 1 WARN #8)

systemd `OnCalendar=` accepts second-resolution; we use it to stagger high-frequency timers so two never fire on the same instant.

| Unit | Cadence | OnCalendar | Why this stagger |
|---|---|---|---|
| `levelchannel-calendar-pull.timer` | every minute | `*-*-* *:*:05` (HH:MM:05) | leading offset 5s after each minute to avoid clocking on :00 with everything else |
| `levelchannel-calendar-push.timer` | every minute | `*-*-* *:*:25` (HH:MM:25) | 20s after pull; pull writes busy_intervals, push reads them; some overlap is fine |
| `levelchannel-calendar-intents.timer` | every 5 min | `*-*-* *:00/5:35` | every 5th min at :35, well clear of pull/push |
| `levelchannel-calendar-revive-blocked.timer` | hourly | `*-*-* *:13:00` | unique minute-of-hour |
| `levelchannel-calendar-reconcile.timer` | daily | `*-*-* 02:30:00` UTC | quiet hour for the VPS |
| `levelchannel-calendar-renew-channels.timer` | daily | `*-*-* 03:00:00` UTC | after reconcile but still pre-traffic |

All timers add `RandomizedDelaySec=10` to absorb cron-storm risk on very-coarse cadences. Workers' internal `FOR UPDATE SKIP LOCKED` makes accidental overlap safe.

#### 4.5.2 Service units — TimeoutStartSec (Codex round 1 BLOCKER #6)

Existing oneshot templates in `scripts/systemd/levelchannel-*.service` do NOT set `TimeoutStartSec`. The systemd default (90s) will SIGKILL long-running pull / reconcile jobs and leave them in a half-written state.

Each new service unit adds an explicit timeout:

| Unit | TimeoutStartSec |
|---|---|
| `levelchannel-calendar-pull.service` | 600 (10 min) |
| `levelchannel-calendar-push.service` | 300 (5 min) |
| `levelchannel-calendar-intents.service` | 300 |
| `levelchannel-calendar-renew-channels.service` | 600 |
| `levelchannel-calendar-revive-blocked.service` | 120 |
| `levelchannel-calendar-reconcile.service` | 900 (15 min — sweep of 100 slots × 1-2 events.get each) |

The `calendar-cron.mjs` HTTP timeout for each target is `TimeoutStartSec − 30s` (per the lookup table in §4.4) so the script aborts the fetch and logs a clean error before systemd `TimeoutStartSec` fires SIGKILL.

#### 4.5.3 Sandbox

Same 12-directive set as the rest of `scripts/systemd/levelchannel-*.service`. No `ReadWritePaths` needed (cron script only POSTs HTTP; no on-disk state).

### 4.6 401 refresh-retry (plan §4.11)

#### 4.6.1 `ensureFreshAccessToken` adds `forceRefresh`

The helper gains `forceRefresh: boolean` option. When `true`, skip the cached-token branch and go straight to `refreshAccessToken`. Returns the refreshed integration + new token. Existing failure shape is preserved (`{ok:false, reason: 'integration_missing' | 'disconnected' | 'no_refresh_token' | 'config_missing' | 'transient' | 'permanent'}`).

#### 4.6.2 `withTokenRetry` helper — result-union 401 contract

401 in this codebase comes back as a RESULT VARIANT from the Google clients, not an exception (see citations in §1). The helper's contract:

```typescript
type CallResult<T> = { ok: true; value: T } | { ok: false; auth401: boolean; raw: unknown }

async function withTokenRetry<T>(
  accountId: string,
  exec: (token: string) => Promise<CallResult<T>>,
): Promise<CallResult<T>> {
  const first = await ensureFreshAccessToken({ accountId })
  if (!first.ok) return { ok: false, auth401: false, raw: first }

  let result = await exec(first.accessToken)
  if (result.ok || !result.auth401) return result

  // 1st real Google 401 → force-refresh, retry.
  const second = await ensureFreshAccessToken({ accountId, forceRefresh: true })
  if (!second.ok) {
    // ensureFreshAccessToken itself decided this is permanent
    // (it already flips to disconnected on its own permanent path,
    // see lib/calendar/google/token-refresh.ts:104-114). Don't
    // double-disconnect — just surface.
    return { ok: false, auth401: false, raw: second }
  }

  result = await exec(second.accessToken)
  if (!result.ok && result.auth401) {
    // 2nd real Google 401 in a row → flip integration to disconnected
    // per plan §4.11. ensureFreshAccessToken's refresh succeeded
    // (so the access_token IS fresh), but Google itself rejects it —
    // the OAuth grant is dead in Google's view, not ours.
    await disconnectGoogleIntegration(accountId).catch(() => {})
  }
  return result
}
```

Two key invariants:

- Per-call-site adapter: each consumer wraps its Google call into a `CallResult<T>` shape, mapping `auth_expired` / `http 401` to `auth401: true`. Other failure kinds → `auth401: false`.
- Channel-renewer's `stopChannel` of OLD channel after persist-new is BEST-EFFORT and MUST NOT use `withTokenRetry` (see §4.6.4).

`disconnectGoogleIntegration` already exists in `lib/calendar/integrations.ts:333-355`.

#### 4.6.3 Consumer inventory (corrected)

Per Codex plan-round-1 BLOCKER #3, the actual Google API call sites (NOT just consumers of `ensureFreshAccessToken`) that need `withTokenRetry`:

| Call site | Google API used |
|---|---|
| `lib/calendar/pull-runner.ts:155` (called by `drainPullJobs`) | `events.list` (single call site — see note below) |
| `lib/calendar/push-worker.ts:444-477` (the create + delete enqueue paths invoke `insertEventIdempotent` / `patchEvent` / `deleteEvent`) | `events.insert`, `events.patch`, `events.delete` |
| `lib/calendar/reconcile-runner.ts:337-355` (`fetchEventById`) | `events.get` |
| `lib/calendar/channel-renewer.ts:setupChannelForIntegration` (watchChannel) | `channels.watch` (NOT stopChannel — see §4.6.4) |
| `app/api/teacher/slots/[id]/delete-external-conflict/route.ts:149-166` | `events.delete` (live request-time path) |

NOT in scope:

- `lib/calendar/intent-worker.ts` — has ZERO Google API calls. It only writes to `slot_lifecycle_intents` and `calendar_push_jobs` tables. Skip.
- `lib/calendar/pull-worker.ts` itself — calls `runPullForCalendar` (in pull-runner.ts) which IS the Google call site. Worker layer just routes job rows; the wrap goes on the inner function.
- `listCalendars` (Google `calendarList.list`) — NOT invoked from `runPullForCalendar`. The only consumer today is the OAuth callback init path (`app/api/teacher/calendar/google/callback/route.ts`) which is request-time (operator-driven, not cron-driven) and out of scope for THIS epic. Codex round 2 BLOCKER #1 flagged my round-1 mention as inaccurate — corrected here. A future ergonomics wave can wire `listCalendars` into `runPullForCalendar` to populate `is_writable_in_source` reliably, but it's a separate concern.

#### 4.6.4 Channel-renewer special case (Codex round 1 BLOCKER #5)

`setupChannelForIntegration` in `lib/calendar/channel-renewer.ts:143-176`:
1. Persists the NEW (channelId, resourceId, expires_at, token) on `teacher_calendar_integrations` first.
2. Then best-effort `stopChannel()` on the OLD channel — `.catch(() => {})` swallows failures.

The wrap rules:

- **`watchChannel` call** (creating the new channel) → IS wrapped in `withTokenRetry`. On 2nd 401, disconnect is correct.
- **`stopChannel` call** (cleaning the old channel) → NOT wrapped. Use a different inert wrapper that does ONE refresh attempt on 401 but does NOT call `disconnectGoogleIntegration` on a 2nd 401, because at that point the new channel is already authoritative on our side — disconnecting would self-break.

Concretely: introduce a sibling `tryRefreshOnce(accountId, exec)` helper used only by the stopChannel call site. Returns a result-union without disconnect side effects.

### 4.7 Test plan

#### 4.7.1 Cron-route tests — RAW Request, not buildRequest (Codex round 1 WARN #10)

The existing `tests/integration/helpers.ts:buildRequest()` always stamps `Origin: https://levelchannel.ru` + `Sec-Fetch-Site: same-origin`. The real cron caller (a curl from systemd on 127.0.0.1) sends NEITHER. Using `buildRequest()` for cron-route tests would silent-green even if the route's host gate broke.

New helper: `buildCronRequest(url, { bearer, host })` in `tests/integration/helpers.ts` — constructs `new Request()` with ONLY `Host: 127.0.0.1:3000` + `Authorization: Bearer ${bearer}` headers, no Origin / Sec-Fetch-Site / Accept.

Cron-route tests:

- 404 when Host header is `levelchannel.ru` (simulated external request via nginx).
- 401 when Host is loopback but bearer is missing / wrong.
- 200 happy path with mocked worker + loopback Host + correct bearer.
- 500 when worker throws.
- 429 when rate-limited.

#### 4.7.2 `forceRefresh` tests

- Unit test: cached-token branch is skipped when flag true.
- Unit test: on refresh failure, returns the same `permanent`/`transient` shape as today.

#### 4.7.3 `withTokenRetry` tests

- Unit test: `ok:true` first try → no second `ensureFreshAccessToken` call.
- Unit test: `auth401:true` first try → second `ensureFreshAccessToken({forceRefresh:true})` → `ok:true` returned.
- Unit test: `auth401:true` twice → `disconnectGoogleIntegration` called → final result is the failing `CallResult`.
- Unit test: 1st `auth401:true`, then `ensureFreshAccessToken` permanent-fail → result surfaces the permanent-fail without `disconnectGoogleIntegration` being called again (the helper already did its own disconnect).

#### 4.7.4 `summarizeResult` PII tests (Codex round 1 WARN #11)

One unit test per worker:

- Seed a result with synthetic PII (e.g. `details: [{externalCalendarId: "teacher@example.com", ...}]`).
- Run `summarizeResult(result)`.
- Assert JSON-serialized summary does NOT contain `teacher@example.com` substring.

#### 4.7.5 Integration test scope (Docker Postgres)

- Cron-route auth integration test (one per route, parameterised via `buildCronRequest`).
- Per-worker invocation integration test that seeds DB, posts to the route, asserts side effects (the underlying worker functions are already individually tested; the new tests assert the ROUTE wires through correctly + the auth gate fires correctly).
- Channel-renewer specific test: simulate 2nd-401 on stopChannel of old channel — verify `disconnectGoogleIntegration` is NOT called (per §4.6.4 special case).

## 5. Sub-PR decomposition

### Sub-PR OP.1 — `forceRefresh` flag + `withTokenRetry` helper + retrofit (foundation)

Why first: every cron route needs ensureFreshAccessToken to be 401-retry-safe before we put traffic on it. Foundation for both the routes (OP.2) and any future Google-API consumer.

Files:

- `lib/calendar/google/token-refresh.ts` — add `forceRefresh?: boolean` option; when true, skip the cached-token branch.
- `lib/calendar/token-retry.ts` (new) — `withTokenRetry` + `tryRefreshOnce` helpers (per §4.6).
- `lib/calendar/pull-runner.ts` — wrap the `events.list` call site at `pull-runner.ts:155` via `withTokenRetry`. `listCalendars` is NOT touched (not invoked from `runPullForCalendar` today; see §4.6.3). The `is_writable_in_source` poisoning concern Codex round 2 BLOCKER #1 flagged stays as-is in this epic — `drainPullJobs` continues to call `runPullForCalendar` without a writability opt; `delete-external-conflict` continues to hard-refuse when the flag is false. Fixing that requires plumbing `accessRole` through and is a separate ergonomics epic (tracked as a follow-up).
- `lib/calendar/push-worker.ts` — wrap `insertEventIdempotent` / `patchEvent` / `deleteEvent` paths.
- `lib/calendar/reconcile-runner.ts` — wrap `fetchEventById` calls.
- `lib/calendar/channel-renewer.ts` — `watchChannel` via `withTokenRetry`; `stopChannel` via `tryRefreshOnce` (per §4.6.4).
- `app/api/teacher/slots/[id]/delete-external-conflict/route.ts` — wrap the `deleteEvent` request-time call.
- `tests/calendar/token-refresh.test.ts` (new — no existing file by this name; Codex round 3 WARN #3 corrected) — unit tests for `ensureFreshAccessToken({forceRefresh:true})` cached-token-skip + permanent/transient passthrough.
- `tests/calendar/token-retry.test.ts` (new) — `withTokenRetry` + `tryRefreshOnce` unit tests.
- `tests/integration/calendar/channels.test.ts` (existing renewer suite — NOT `channel-renewer.test.ts` per Codex round 3 WARN #3) — extend with stopChannel-401 no-disconnect regression at the `setupChannelForIntegration` boundary.
- `tests/integration/calendar/pull-runner.test.ts` (Codex round 2 WARN #5) — existing fetcher mocks at lines 113-117 return raw success/failure shapes; the new `withTokenRetry` adapter expects a `CallResult<T>` union. Update the mocks to return `{ok: true, value: <events-list>}` for success and `{ok: false, auth401: true|false, raw: ...}` for failure. Add at least one regression test that simulates a 1st-401-then-success retry path through `runPullForCalendar`.
- `tests/integration/calendar/pull-worker.test.ts` (Codex round 2 WARN #5) — same fetcher-mock shape update at lines 103-115. Worker-level test does not need to add new retry scenarios beyond what pull-runner covers, but the mock shape MUST be migrated or the worker tests turn red on OP.1 land.
- `tests/integration/calendar/conflict-actions.test.ts` (Codex round 3 WARN #5) — add two regression cases against the live `/api/teacher/slots/[id]/delete-external-conflict` route: (1) first Google `events.delete` returns 401 → ensureFreshAccessToken refresh → second call returns 200 → route succeeds; (2) two consecutive 401s → `disconnectGoogleIntegration` called → route returns a graceful error. Helper-level green is not enough because this route is already production-live.

NOT in scope: `lib/calendar/intent-worker.ts` (no Google API calls).

Size: ~400 LOC + ~300 test LOC.

Trailer: `Codex-Paranoia: SUB-WAVE self-reviewed (epic bcs-op-rollout); epic-end review pending`.

### Sub-PR OP.2 — 6 cron API routes + auth helper + tests

Why second: routes call workers; workers must already be 401-safe (OP.1).

Files:

- `lib/api/cron-auth.ts` (new) — `requireCronSecret(request)` with loopback-Host gate + bearer.
- `app/api/cron/calendar/pull/route.ts` — POST handler.
- `app/api/cron/calendar/push/route.ts` — POST handler.
- `app/api/cron/calendar/intents/route.ts` — POST handler.
- `app/api/cron/calendar/renew-channels/route.ts` — POST handler.
- `app/api/cron/calendar/revive-blocked/route.ts` — POST handler.
- `app/api/cron/calendar/reconcile/route.ts` — POST handler.
- `tests/integration/helpers.ts` — add `buildCronRequest(url, opts)` raw-Request helper (no Origin / Sec-Fetch-Site).
- `tests/integration/cron-calendar/auth.test.ts` (new) — 404 on external Host, 401 on missing/wrong bearer, 200 happy path per route.
- `tests/integration/cron-calendar/happy-path.test.ts` (new) — 200 with mocked workers, side-effects observed.
- `.env.example` — add `CRON_SHARED_SECRET` + optional `CRON_TRUSTED_HOST`.

Size: ~750 LOC (route boilerplate + auth helper + summarizeResult per worker) + ~500 test LOC.

Trailer: same SUB-WAVE.

### Sub-PR OP.3 — systemd unit templates + activate-prod-ops.sh wiring + cron entry script

Why third: routes must exist before we trigger them.

Files:

- `scripts/calendar-cron.mjs` (new) — parameterised cron entry.
- 6 systemd unit pairs under `scripts/systemd/` (.service + .timer each) with the cadence + TimeoutStartSec from §4.5.
- `scripts/activate-prod-ops.sh` — **four** distinct changes (Codex round 1 BLOCKERs #1 + #2 + Codex round 2 BLOCKER #3):
  - **Auto-synthesis path for `CRON_SHARED_SECRET`** (Codex round 2 BLOCKER #3). The current script hard-stops if any `required_env_keys[@]` member is missing from the shell environment at startup (`scripts/activate-prod-ops.sh:75-87`). `CRON_SHARED_SECRET` is operator-INVISIBLE — it's generated by the script, not supplied by the operator. So:
    1. **DO NOT** add `CRON_SHARED_SECRET` to `required_env_keys`. The operator-supplied-required gate (`ALERT_EMAIL_TO`, `DATABASE_URL`, etc.) MUST NOT block on this key.
    2. **Introduce a new array** `auto_generated_env_keys=("CRON_SHARED_SECRET")` near the existing `required_env_keys` declaration.
    3. **Synthesise BEFORE building `env_kv`**: in the env-append block (the existing `scripts/activate-prod-ops.sh:75-97` pattern that handles `ALERT_EMAIL_TO` / `SENTRY_DSN` defaults), iterate `auto_generated_env_keys[@]`. For each key not already exported AND not already present in `$ENV_FILE (the script's existing env-file variable defined at `scripts/activate-prod-ops.sh:65-72`)`, run `openssl rand -hex 32 | tr -d '\n'` and `printf 'CRON_SHARED_SECRET=%s\n' "$secret" >> $ENV_FILE (the script's existing env-file variable defined at `scripts/activate-prod-ops.sh:65-72`)`. Then re-source the env-file so the rest of the script sees the new value.
    4. Note the rename from round 2: "just like `ALERT_EMAIL_TO` / `SENTRY_DSN`" was misleading — those are operator-supplied with literal defaults. `CRON_SHARED_SECRET` is operator-OPAQUE auto-generated. Distinct mechanism, distinct array.
  - **Reorder activation steps to the canonical sequence** (Codex round 2 WARN #4 — §5 and §7 previously described different orders). Canonical order (BOTH §5 OP.3 and §7 follow this exact sequence):
    1. Synthesise + append `CRON_SHARED_SECRET` if missing (per the auto-synthesis path above).
    2. Copy 6 new `.service` / `.timer` files into `/etc/systemd/system/`.
    3. `systemctl daemon-reload`.
    4. `systemctl restart levelchannel.service` so the Next.js process picks up the new secret.
    5. `systemctl enable --now` the 6 new timers. First timer-fire now hits a Next.js process that already has the secret loaded → no 401-on-first-tick race.
    Today the script enables timers BEFORE restarting the app; reorder to the sequence above.
  - Extend `units=()`, `timers=()`, summary grep with all 6 new units.
- **NOT** `OPERATIONS.md` (Codex round 1 BLOCKER #7) — the tracked file is a public pointer to the private runbook per `OPERATIONS.md:1-29` + `DOCUMENTATION.md:25-30`. Prod procedures, secrets handling, manual curl invocations live in the private runbook (operator-side, not in git). Tracked file gets at most a one-line pointer "Calendar worker cron units listed in `scripts/activate-prod-ops.sh`; activation per private runbook."
- `README.md` — extend env-vars list to include `CRON_SHARED_SECRET` + `CRON_TRUSTED_HOST` (Codex round 1 WARN #12).
- `SECURITY.md` — append `Cron-route trust boundary` paragraph under the existing trust-boundary table (loopback-Host gate + bearer; external paths 404 by design) (Codex round 1 WARN #12).
- `ARCHITECTURE.md` — add the 6 new cron routes to the routes map. Also fix the stale cron references Codex called out at `ARCHITECTURE.md:257-266` (Codex round 1 WARN #12).

ENV: `CRON_SHARED_SECRET` is operator-managed AFTER activation; the activator auto-generates a default on first run if missing.

Size: ~12 new systemd files (~250 LOC) + ~120 LOC of `activate-prod-ops.sh` diffs + ~30 LOC docs (README + SECURITY + ARCHITECTURE).

Trailer: same SUB-WAVE.

### Epic-close PR — Codex-Paranoia: SIGN-OFF + Brain dump

After all 3 sub-PRs are merged, run `/codex-paranoia wave c96da68..main` (or whatever the actual epic range is). Final epic-close PR carries:

```
Codex-Paranoia: SIGN-OFF round N/3 (epic-end on <range>)
```

Brain dump: `~/Obsidian/Brain/raw/notes/<date>-codex-paranoia-LevelChannel-bcs-op-rollout.md`.

## 6. Invariants this epic must not break

1. Booking gate (`lib/scheduling/slots/booking.ts:BUSY_OVERLAP_GATE_SQL`) — JOIN on `tci.sync_state='active' AND tci.last_pulled_at >= now() - 10min`. Pull worker MUST keep updating `last_pulled_at` on every cycle (it does; we just need the cycle to run).
2. Hidden-slots gate (`lib/calendar/hidden-slots.ts` — same predicate as #1, kept consistent by BCS-G retro PR #215).
3. Reconcile sweep's F9‴ gated re-enqueue (`lib/calendar/reconcile-runner.ts`) — DO NOT trigger reconcile faster than daily, or the pathology counter increments under normal operating conditions and the operator alert fires false-positives.
4. Ownership-stamp invariants (`lc_origin`, `lc_slot_id`, `lc_epoch`) — workers DON'T mutate these.
5. CALENDAR_ENCRYPTION_KEY blast-radius separation — workers use it via existing helpers; don't bypass.
6. Single-instance assumption — same as the rest of prod ops. Multi-instance is out of scope; if/when it lands, cron routes need leader-election (a backlog item already exists for it).

## 7. Rollout plan

- **OP.1 merges first** → `forceRefresh` available + `withTokenRetry` wraps live call sites including the request-time delete-external-conflict route. Behavior change on prod: existing route + workers gain 401-retry semantics. NOT just an inert flag — Codex round 1 BLOCKER #3 surfaced that the previous "no behavior change" framing was wrong because `delete-external-conflict` is a request-time path that ALREADY calls `ensureFreshAccessToken` on prod and gains the retry on OP.1 merge.
- **OP.2 merges** → cron routes live on prod, host-gated to loopback. External request to `/api/cron/calendar/*` returns 404 (per §4.2). No caller invokes them yet (no systemd unit) → still no scheduled behavior change.
- **OP.3 merges** → operator runs `scripts/activate-prod-ops.sh` on the VPS. The script executes the canonical sequence (identical to §5 OP.3 — single source of truth):
  1. Synthesise + append `CRON_SHARED_SECRET` to `$ENV_FILE (the script's existing env-file variable defined at `scripts/activate-prod-ops.sh:65-72`)` if missing.
  2. Copy 6 new `.service` / `.timer` files into `/etc/systemd/system/`.
  3. `systemctl daemon-reload`.
  4. `systemctl restart levelchannel.service` so the Next.js process reads the new secret.
  5. `systemctl enable --now` the 6 new timers. First fire hits a secret-aware app process → no 401.
  This ordering closes the env-introduce-then-require race (Codex round 1 BLOCKER #2) and aligns with the OP.3 file-list ordering after Codex round 2 WARN #4.
- Activation is reversible: `systemctl stop` + `disable` the timers → workers stop firing. The library code stays loaded but unused. The 401-retry wraps from OP.1 stay active (they're inline in workers' call sites; they only fire when a Google call happens, so disabling timers is sufficient).

## 8. Failure modes considered

- **Cron route DoS**: two-layer gate (loopback-Host check first → 404 on mismatch; then bearer → 401 on mismatch) + per-IP rate limit on each route. External attackers see 404 (don't even know the route exists); on-box attackers without the secret see 401.
- **Secret leak**: 32-char random per `.env.example` boilerplate. Rotation: change the env on VPS, restart Next.js, update `.env` (or systemd EnvironmentFile) on the cron-runner. Routes pick up new secret on next request.
- **Worker timeout**: each cron target has a per-target HTTP timeout (`pull` 570s, `push` 270s, `intents` 270s, `renew-channels` 570s, `revive-blocked` 90s, `reconcile` 870s — per §4.4 table; each = `TimeoutStartSec − 30s`) > the worker's worst-case internal budget. If a worker stalls, the cron request aborts with a clean log line; systemd `TimeoutStartSec` SIGKILL is the next-tier failsafe. The next tick runs cleanly.
- **Concurrent cron ticks**: each worker uses `FOR UPDATE SKIP LOCKED` on its own job table; concurrent ticks don't double-process.
- **Restart-during-cron**: each worker is idempotent at the DB level (UPDATE WHERE clauses + `ON CONFLICT DO NOTHING`); a torn run picks up next tick.
- **Token revoke**: closed by OP.1's `withTokenRetry` + `disconnectGoogleIntegration` flip on 2nd 401.

## 9. Round-3 BLOCK — UNRESOLVED + escalation to user

Plan-mode paranoia hit the 3-round hard cap and returned BLOCK on round 3 with the following unresolved BLOCKER. Per the contract at `~/.claude/skills/codex-paranoia/SKILL.md §4.2`, this STOPS the epic from starting code until the user decides scope. The WARNs on round 3 (#3, #4, #5) were applied to this plan in-place above and are not blocking.

### 9.1 UNRESOLVED BLOCKER #1 — `is_writable_in_source` poisoning when pull cron activates

**Concern (Codex round 3, citing prior round 2 too):** `drainPullJobs` → `runPullForCalendar` does not pass a writability opt today; `runPullForCalendar` defaults `is_writable_in_source = false` when the opt is missing (`lib/calendar/pull-runner.ts:75-79, 229`). The live request-time route `app/api/teacher/slots/[id]/delete-external-conflict/route.ts:102-146` hard-refuses on `is_writable_in_source = false`. Activating pull cron without addressing this WILL cause writable Google calendars to be re-imported as read-only on the first tick, and the teacher-side delete-conflict UI will start regressing for events that worked yesterday.

**Plan round 3 attempted resolution (REJECTED by Codex):** declared the gap "out of scope, follow-up epic." Round 3 confirmed this is not safe — activation IS the regression.

**Resolution options for the user:**

- **(A) Add writability plumbing to OP.1.** Surgical ~5-10 LOC scope addition: `drainPullJobs` reads the existing `accessRole` from `teacher_calendar_integrations` (already in scope from the OAuth callback init path), passes a `writabilityOpt` to `runPullForCalendar`, which honors it instead of defaulting to false. Slight OP.1 scope creep; cleanest closure.
- **(B) Drop pull from the cron activation.** Activate only push / intents / renew-channels / revive-blocked / reconcile in this epic. Ship pull cron as a separate follow-up epic AFTER the writability plumbing lands. Loses freshness-TTL closure on `teacher_external_busy_intervals` (the original problem this epic was supposed to fix), so booking-gate double-booking risk persists.
- **(C) Document the regression risk + ship anyway.** Operator-facing warning in private runbook; manual unfix-after-import procedure. Risky — surfaces user-visible delete failures before the operator notices.

**Recommendation:** (A). It's tight, surgical, and closes the BLOCKER cleanly. Final report at `/tmp/codex-paranoia-20260514T143126Z-bcs-op-rollout-final.md`.

### 9.2 Round summary

| Round | Outcome | Findings |
|---|---|---|
| 1 | BLOCK | 7 BLOCKERs + 5 WARNs (all addressed in round 2 revision) |
| 2 | BLOCK | 3 BLOCKERs + 2 WARNs (all addressed in round 3 revision) |
| 3 | BLOCK | 2 BLOCKERs + 3 WARNs (WARNs applied in-place; BLOCKER #1 awaits user scope decision; BLOCKER #2 was a doc-only path/variable typo, also applied in-place) |

Hard cap reached. NO round 4.

## 10. Codex-Paranoia plan-checkpoint requested findings

When Codex paranoia-reviews this plan, surface specifically:

- Hidden coupling not surfaced (e.g. another consumer of `ensureFreshAccessToken` we missed).
- Untouched references the change misses (renames, migrations, fixtures).
- Production safety gaps (deploy ordering between sub-PRs).
- Cron-route auth shape — is bearer-header enough, or should we also require origin/host check?
- Whether the per-worker `summarizeResult` log shape ever leaks PII (encrypted summary fields, learner emails).
- Whether the 2nd-401-flip-to-disconnected logic in `withTokenRetry` interacts badly with the channel-renewer (renewing a channel for an integration that's about to be flipped to disconnected).
- Test-coverage gaps in the new cron-route auth + happy-path suites.
- Anything a 200-IQ paranoid engineer would catch.
