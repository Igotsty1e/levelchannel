# Calendar onboarding cleanup — follow-up fix-PR 2026-06-06

Status: PLAN — SIGN-OFF round 10/3 (off-protocol, owner authorized; precedent PRs #515 32 rounds, #410 12 rounds). 9 substantive BLOCK→fix cycles then SIGN-OFF on round 10 with 2 WARNs + 1 INFO applied inline.

Parent epic: `docs/plans/calendar-onboarding-cleanup-2026-06-05.md` (PR #537, squash 9a366f7, merged 2026-06-05). Wave-paranoia round 1 surfaced 1 BLOCKER + 2 WARNs + 1 INFO. This fix-PR closes all three findings inline.

## Existing surface inventory

(Round-2 BLOCKER 1 closure — Survey-before-plan per COMPANY.md §151. This fix-PR proposes new `lib/security/local-host.ts` helper + multiple new test files.)

### Loopback / localhost classification

```bash
rg -nl --type ts 'localhost\b|loopback|LOOPBACK|isLoopback|127\.0\.0\.1' lib app
```

Hits:
- `lib/db/pool.ts:103-120` — `host === 'localhost' || host === '127.0.0.1' || host === '::1'` (after stripping IPv6 brackets). Comments at lines 114-118 explicitly note that `*.local` wildcard was REMOVED after Codex found a TLS-bypass via attacker-controlled mDNS hosts. **Authoritative current policy: literal loopback only.**
- `lib/api/cron-auth.ts:26` — `LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])` — duplicate of pool's set.
- `lib/api/origin.ts:16` (parent epic) — `fromConfig.startsWith('http://localhost')` — string-prefix shortcut, the BLOCKER 2 catch from wave-paranoia.
- `lib/payments/config.ts:40` — `siteUrl.startsWith('http://localhost')` — same bug pattern as origin.ts; drives 3DS / payment redirects.
- `lib/security/request.ts:26-27` — explicitly adds `http://localhost:3000` + `http://127.0.0.1:3000` to allowed-browser-origins (dev convenience; production-safe since the policy reads `paymentConfig.siteUrl` which fails-fast on localhost in prod).

**Disposition (refactor)**: extract `lib/security/local-host.ts::{isLiteralLoopbackHostname, isLoopbackOriginHostname, isLoopbackOriginUrl}` — TWO-helper split per §"Two-helper split" below. Refactor `lib/db/pool.ts:119-120` + `lib/api/cron-auth.ts:26` to import `isLiteralLoopbackHostname` (STRICT — exposes both raw and bracketed IPv6, no behaviour change vs. existing). New `lib/api/origin.ts` adopts `isLoopbackOriginUrl` (WIDE). `lib/payments/config.ts` adopts `isLoopbackOriginUrl` (WIDE) for the prod fail-fast gate.

**`*.localhost` rationale (round-2 BLOCKER 2)**: per RFC 6761 §6.3, `.localhost` is reserved and OS resolvers SHOULD resolve `*.localhost` to loopback. Browsers do; Linux/macOS `getaddrinfo` does. A `NEXT_PUBLIC_SITE_URL=https://tenant.localhost:3000` would point at the local box. We treat `*.localhost` as loopback (reject in prod fail-fast). **`*.local` stays NOT treated as loopback** — that was the Codex-removed pattern for mDNS attack surface.

**Two-helper split (round-3 BLOCKER 3 closure)**: incompatible trust boundaries cannot share one classifier.
- **`isLiteralLoopbackHostname(host)`** — only `localhost`, `127.0.0.1`, `::1`, `[::1]`. NO `*.localhost`, NO `0.0.0.0`. For Host-header auth gates where the gate is "request actually came from this server" (cron-auth) and Postgres TLS detection (db/pool — Postgres URL parses `0.0.0.0` differently anyway).
- **`isLoopbackOriginUrl(url)` / `isLoopbackOriginHostname(host)`** — the wider set including `*.localhost`, `0.0.0.0`. For validating "this URL is not a real production target" — `NEXT_PUBLIC_SITE_URL` validation (origin helper + payment config).

Rationale for the cron-auth split: `lib/api/cron-auth.ts:53-66` uses Host as a SECURITY boundary — non-loopback Host returns 404 BEFORE bearer-secret check. If we accepted `Host: tenant.localhost:3000` or `Host: 0.0.0.0:3000`, an external caller could bypass the 404 path and reach the bearer-secret-check path (degrading defense-in-depth even though bearer would still gate them). Keep strict literal-only there.

Rationale for the db/pool split: Postgres TLS detection is a "this is a local Postgres so TLS gate doesn't apply" decision. `0.0.0.0` for a Postgres host would be unusual (means "any IP"), so we don't gain by including it. Keep strict literal-only there too.

### NEXT_PUBLIC_SITE_URL consumers (production fail-fast surface)

```bash
rg -nl --type ts 'NEXT_PUBLIC_SITE_URL|paymentConfig\.siteUrl' lib app
```

Hits:
- `lib/payments/config.ts:11-43` — parses env, validates origin, fails-fast on `http://localhost` prefix in prod CloudPayments mode. Source of `paymentConfig.siteUrl` for all consumers below.
- `lib/api/origin.ts` (parent epic) — env-first, request.url fallback. Money-critical via charge-token termUrl + auth-critical via calendar callback redirect.
- 15+ downstream consumers via `paymentConfig.siteUrl`: email dispatch, payment redirects, 3DS callback, teacher invites, learner reminders, etc.

**Disposition**: tighten `lib/payments/config.ts` fail-fast to additionally require `https:` protocol in prod CloudPayments mode (round-2 BLOCKER 3). `lib/api/origin.ts` adopts the same protocol check via shared helper — bad env in prod fails-closed (throws), not silently degrades to request.url proxy-localhost.

### Doc surfaces describing loopback policy

```bash
rg -n '\\*\\.local|localhost.*loopback|loopback.*localhost' SECURITY.md ARCHITECTURE.md docs README.md
```

Hits:
- `SECURITY.md:36` — "`lib/db/pool.ts` auto-detects `localhost` / `127.0.0.1` / `::1` / `*.local` as no-TLS" — **stale** (code dropped `*.local`).
- `ARCHITECTURE.md:172` — "`resolveSslConfig(url, env)` which auto-detects `localhost` / `127.0.0.1` / `::1` / `*.local` as no-TLS" — same stale claim.

**Disposition**: update both docs to match the actual code policy (literal loopback only, no `*.local`).

## Findings to close

### BLOCKER 1 — steady-state timezone-NULL race after trigger removal

Wave-paranoia output:
> `PATCH /api/account/profile` блокирует `timezone=null` только когда интеграция уже active|degraded, а callback проверяет timezone до обмена токена и потом безусловно активирует интеграцию. Сценарий "callback стартовал с timezone set, параллельный PATCH успел очистить timezone до upsert" оставляет `account_profiles.timezone = NULL` при `sync_state='active'`; это steady-state breach, не только deploy-window.

Cited:
- `app/api/account/profile/route.ts:132` — guard fires only when integration already active|degraded.
- `app/api/teacher/calendar/google/callback/route.ts:145` — timezone check at top, then `upsertGoogleIntegration` unconditionally activates.
- `lib/calendar/integrations.ts:181` — `upsertGoogleIntegration(reason: 'initial_connect')` sets `sync_state='active'`.

This is the deferred DB-trigger pair from the parent epic. With the parent app code now baseline on prod (deployed 2026-06-05), the rolling-deploy race that justified deferring the triggers no longer applies. Ship the triggers now.

### WARN 2 — `resolveCanonicalOrigin` accepts non-`http://localhost` localhost-like origins

Wave-paranoia output:
> Helper отвергает только `http://localhost...`, но принимает `https://localhost:3000` и любой другой local-like origin, после чего этот origin используется и в calendar callback, и в money path `threeDs.termUrl`.

Cited:
- `lib/api/origin.ts:16` — `startsWith('http://localhost')` check is too narrow.

Bad envs to reject: `https://localhost:*`, `http://127.0.0.1:*`, `http://[::1]:*`, `http://0.0.0.0:*`, any `*.localhost`. Use URL parsing on hostname, not string prefix.

### WARN 3 — Tests / docs claim coverage that doesn't exist

Wave-paranoia output:
> e2e всё ещё проверяет только `200 + pathname`. `google-routes` не покрывает `timezone=null`, потому что `makeTeacher()` всегда seeding'ит `Europe/Moscow`. Два unit-suite комментария ссылаются на несуществующий `calendar-page-timezone-gate.test.tsx`.

Cited:
- `tests/e2e/product-flows-authenticated.spec.ts:125-136` — no banner assertion.
- `tests/integration/calendar/google-routes.test.ts:50,79,149` — `makeTeacher` hardcodes Moscow.
- `tests/teacher-cabinet-polish/calendar-page-gated-intro.test.tsx:67` + `calendar-page-state-matrix.test.tsx:54` — comments cite a missing file.

### INFO 4 — docker socket permission (Codex local env)

Not actionable from repo side. Note for the brain.

## Scope

### A. DB-level defense-in-depth triggers (BLOCKER 1 closure + round-2 BLOCKER 1 TOCTOU closure)

1. Migration `migrations/0107_calendar_require_timezone_triggers.sql`:
   ```sql
   -- Replacement timezone-required triggers, originally planned for mig
   -- 0106 but deferred to a follow-up PR to avoid rolling-deploy race.
   -- Parent epic (calendar-onboarding-cleanup, PR #537) shipped 2026-06-05
   -- and is now baseline on prod. App-layer gates have been live for >24h
   -- so OLD binary is gone. Safe to add the triggers now.
   --
   -- Round-2 BLOCKER 1 closure: TAKE EXCLUSIVE LOCKS on both tables
   -- BEFORE the preflight scan AND before CREATE TRIGGER. Otherwise a
   -- concurrent callback + PATCH could race between the preflight and
   -- the trigger going live — creating an active|degraded + NULL row
   -- that the trigger does not retro-validate. EXCLUSIVE allows reads
   -- but blocks writes — that's what we need for the validation window.
   -- The script runs inside scripts/migrate.mjs's `begin..commit` tx
   -- (lib/db/pool.ts:75-90), so the locks are released on commit.
   lock table account_profiles in exclusive mode;
   lock table teacher_calendar_integrations in exclusive mode;

   -- Preflight: surface any grandfathered (active|degraded with NULL or
   -- missing profile.timezone) rows BEFORE the trigger refuses future
   -- writes. Abort the migration if any exist so operator can manually
   -- resolve. healthy prod should have 0 such rows.
   do $$
   declare
     grandfathered_count int;
   begin
     select count(*) into grandfathered_count
       from teacher_calendar_integrations tci
       left join account_profiles ap on ap.account_id = tci.account_id
      where tci.sync_state in ('active', 'degraded')
        and (ap.account_id is null or ap.timezone is null);
     if grandfathered_count > 0 then
       raise exception
         '[mig 0107] PREFLIGHT FAIL: % active|degraded integrations have missing profile or NULL profile.timezone. Manual operator action: set the teacher''s profile.timezone OR downgrade integration to ''disconnected'' before re-running.',
         grandfathered_count
         using errcode = 'data_exception';
     end if;
   end $$;

   -- Trigger A: refuse INSERT/UPDATE into active|degraded when
   -- profile.timezone is NULL.
   create or replace function teacher_calendar_integrations_require_timezone()
   returns trigger language plpgsql as $$
   declare
     acc_tz text;
   begin
     -- Round-3 BLOCKER 2 closure: re-check on EVERY active|degraded write.
     -- Round-9 BLOCKER 1 closure: take per-account advisory lock BEFORE
     -- the cross-table SELECT, so concurrent transactions for the SAME
     -- account_id serialize. Without this, under READ COMMITTED two
     -- concurrent writers (PATCH clearing timezone + callback inserting
     -- active integration) can each pass their gate against a stale
     -- snapshot of the other table and commit into the
     -- active|degraded + timezone=NULL state.
     -- Pattern mirrors lib/auth/accounts.ts:412 + lib/payments/
     -- cloudpayments-route.ts:266 (tx-scoped advisory lock per entity).
     if new.sync_state not in ('active', 'degraded') then
       return new;
     end if;
     perform pg_advisory_xact_lock(hashtextextended('tz_invariant:' || new.account_id::text, 0));
     select timezone into acc_tz
       from account_profiles
      where account_id = new.account_id;
     if acc_tz is null then
       raise exception
         'teacher_calendar_integrations: timezone must be set before activating Google Calendar (account_id=%)',
         new.account_id
         using errcode = 'check_violation';
     end if;
     return new;
   end $$;
   drop trigger if exists teacher_calendar_integrations_require_timezone_trg
     on teacher_calendar_integrations;
   create trigger teacher_calendar_integrations_require_timezone_trg
     before insert or update on teacher_calendar_integrations
     for each row
     execute function teacher_calendar_integrations_require_timezone();

   -- Trigger B: refuse to leave an active|degraded integration with a
   -- missing or NULL profile.timezone via UPDATE, INSERT, or DELETE.
   -- Round-5 WARN 2 closure: extended beyond UPDATE-clear-to-null:
   --   - INSERT path: upsertAccountProfile(account_id, {/* no tz */})
   --     creates a row with timezone=NULL. If a teacher already has an
   --     active integration but no profile row, that write would let
   --     the orphan state persist. Reject.
   --   - DELETE path: removing the profile row while an active|degraded
   --     integration exists creates the same orphan state. Reject.
   create or replace function account_profiles_timezone_required_when_integration_active()
   returns trigger language plpgsql as $$
   declare
     has_active boolean;
     check_account_id uuid;
   begin
     -- Identify the account we're guarding. DELETE has OLD; INSERT has
     -- NEW; UPDATE has both.
     if tg_op = 'DELETE' then
       check_account_id := old.account_id;
     else
       check_account_id := new.account_id;
     end if;

     -- Round-9 BLOCKER 1: per-account advisory lock to serialize against
     -- concurrent teacher_calendar_integrations writes that might be
     -- inserting an active row while we're clearing/deleting timezone.
     -- Same lock key as the sibling trigger so both writers contend.
     perform pg_advisory_xact_lock(hashtextextended('tz_invariant:' || check_account_id::text, 0));

     -- Fast path for non-clearing UPDATE: only fire when transitioning
     -- to NULL (UPDATE) or inserting NULL (INSERT).
     if tg_op = 'UPDATE' then
       if not (new.timezone is null and old.timezone is not null) then
         return new;
       end if;
     elsif tg_op = 'INSERT' then
       if new.timezone is not null then
         return new;
       end if;
     end if;
     -- DELETE always proceeds to the check (any deletion of a profile
     -- with an active integration is bad).

     select exists (
       select 1 from teacher_calendar_integrations
        where account_id = check_account_id
          and sync_state in ('active', 'degraded')
     ) into has_active;

     if has_active then
       raise exception
         'account_profiles: cannot % timezone while teacher_calendar_integrations is active (account_id=%)',
         case tg_op
           when 'INSERT' then 'create row with NULL'
           when 'UPDATE' then 'clear'
           when 'DELETE' then 'remove (which orphans the integration''s)'
         end,
         check_account_id
         using errcode = 'check_violation';
     end if;

     if tg_op = 'DELETE' then return old; else return new; end if;
   end $$;
   drop trigger if exists account_profiles_timezone_required_when_integration_active_trg
     on account_profiles;
   create trigger account_profiles_timezone_required_when_integration_active_trg
     before insert or update or delete on account_profiles
     for each row
     execute function account_profiles_timezone_required_when_integration_active();
   ```

2. App-layer race insurance (TOCTOU between gate-check and upsert):
   - `app/api/teacher/calendar/google/callback/route.ts` — wrap `upsertGoogleIntegration(...)` in try/catch; on PostgreSQL error code `23514` with the trigger's error message, return `redirectToSettings(origin, { error: 'timezone_required' })`. Narrow error-message match so unrelated check_violations from other tables don't get re-classified.
   - `app/api/account/profile/route.ts` — wrap `upsertAccountProfile(...)` in try/catch; on `23514` with the trigger's message, return 409 `timezone_required_while_calendar_connected`. Same narrow match.

3. ARCHITECTURE.md update — flip mig 0043 entry to say "Originally MSK-only; superseded by 0106 (drop) + 0107 (replacement)" and add new 0107 row.

3a. Doc sweep (round-2 WARN 5 + round-6 WARN 4 closure — extend to all four affected docs):
   - `SECURITY.md:36` — currently says "`lib/db/pool.ts` auto-detects `localhost` / `127.0.0.1` / `::1` / `*.local` as no-TLS". Update: drop `*.local` (code already dropped it per Codex audit; the doc is stale). Reword to point at the new shared helper.
   - `ARCHITECTURE.md:172` — same `*.local` reference. Drop. Mention the new `lib/security/local-host.ts` as the single source of truth.
   - `README.md:90-92` (round-6 WARN 4) — verify `NEXT_PUBLIC_SITE_URL` guidance is consistent with the new prod contract (https-only + non-loopback + provider-agnostic). Update if stale.
   - `PAYMENTS_SETUP.md:26-27` (round-6 WARN 4) — same `NEXT_PUBLIC_SITE_URL` guidance update. Project rule: `lib/payments/*` changes are unfinished without `PAYMENTS_SETUP.md`.
   - All four surfaces: add a one-sentence note that `*.localhost` IS loopback per RFC 6761 and is now tightened on `NEXT_PUBLIC_SITE_URL` validation paths (origin helper + payment config).

3b. Stale comment sweep (round-8 WARN 3 closure):
   - `tests/payments/allocations-validation.test.ts:3-4` references `tests/integration/payments/allocations.test.ts` (stale plural). Repo layout is `tests/integration/payment/...` (singular). Update the comment.
   - `rg -n "tests/integration/payments/" tests` to find any other stale plural references; update each.

### B. Consolidate localhost classifier + tighten origin/payments (WARN 2 + WARN 5 closure)

Round-2 found that the same local-host bug lives in `lib/payments/config.ts:11-43` (drives the 3DS callback, payment redirects, auth redirects, and `lib/security/request.ts` allowed-origins), AND that two adjacent classifiers already exist:
- `lib/db/pool.ts:103-120` — `host === 'localhost' || host === '127.0.0.1' || host === '::1'` (after stripping IPv6 brackets).
- `lib/api/cron-auth.ts:26` — `LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])`.

Plan: single source of truth.

1. Create `lib/security/local-host.ts` with TWO classifiers (round-3 BLOCKER 3 closure — incompatible trust boundaries can't share one helper):
   ```ts
   // Loopback classifiers shared across:
   //   - lib/db/pool.ts (TLS strictness gate)       → STRICT
   //   - lib/api/cron-auth.ts (host-header gate)    → STRICT
   //   - lib/api/origin.ts (URL validation)         → WIDE
   //   - lib/payments/config.ts (siteUrl validation) → WIDE
   //
   // STRICT = literal loopback only.
   //   - localhost, 127.0.0.1, ::1, [::1]
   //   - For surfaces where "request came from this box" is the gate.
   //   - Excludes *.localhost (would let `Host: tenant.localhost:3000`
   //     bypass the auth path).
   //   - Excludes 0.0.0.0 (means "any IP" in client context — not a
   //     real loopback signal there).
   //
   // WIDE = strict + (*.localhost per RFC 6761) + 0.0.0.0.
   //   - For surfaces validating "this URL is not a real production
   //     target" — rejecting bad NEXT_PUBLIC_SITE_URL.
   //   - `*.localhost` resolves to loopback per RFC 6761 §6.3 on all
   //     mainstream OS resolvers; a `https://tenant.localhost:3000`
   //     siteUrl is equivalent to `https://localhost:3000`.
   //   - `0.0.0.0` would point at the local box too in URL context.
   //
   // NEVER include `*.local` in either — Codex audit found attacker-
   // controlled mDNS (`db.attacker.local`) bypasses production TLS.

   const LITERAL_LOOPBACK_HOSTNAMES = new Set<string>([
     'localhost',
     '127.0.0.1',
     '::1',
     '[::1]',
   ])

   export function isLiteralLoopbackHostname(
     hostname: string | null | undefined,
   ): boolean {
     if (!hostname) return false
     const lower = hostname.toLowerCase()
     if (LITERAL_LOOPBACK_HOSTNAMES.has(lower)) return true
     if (lower.startsWith('[') && lower.endsWith(']')) {
       if (LITERAL_LOOPBACK_HOSTNAMES.has(lower.slice(1, -1))) return true
     }
     return false
   }

   export function isLoopbackOriginHostname(
     hostname: string | null | undefined,
   ): boolean {
     if (!hostname) return false
     const lower = hostname.toLowerCase()
     if (isLiteralLoopbackHostname(lower)) return true
     if (lower === '0.0.0.0') return true
     if (lower.endsWith('.localhost')) return true
     return false
   }

   export function isLoopbackOriginUrl(url: string | URL): boolean {
     try {
       const u = typeof url === 'string' ? new URL(url) : url
       return isLoopbackOriginHostname(u.hostname)
     } catch {
       return false
     }
   }
   ```

2. Refactor existing classifiers (round-3 BLOCKER 3 closure):
   - `lib/db/pool.ts:119-120` — replace inline check with `isLiteralLoopbackHostname(host)`. STRICT — Postgres TLS gate stays narrow.
   - `lib/api/cron-auth.ts:26` — delete local `LOOPBACK_HOSTNAMES`, use `isLiteralLoopbackHostname`. STRICT — host-header auth boundary.
   - `scripts/_pg-ssl.mjs:1-10,34-38` (round-3 WARN 5 closure) — `.mjs` cannot import `@/lib/*`. Mirror the strict classifier inline + pin via a drift test that asserts the two implementations agree on the literal-loopback set (pattern from `scripts/lib/timezone.mjs` ↔ `lib/auth/timezones.ts` mirror).

3. Tighten `lib/api/origin.ts` (round-2 BLOCKER 3 closure: prod https-only + WARN 4 closure: fail-closed when env is broken in prod + round-3 BLOCKER 1 closure: fail-closed on UNSET env too + round-3 WARN 4 closure: env read at call time):
   ```ts
   import { isLoopbackOriginUrl } from '@/lib/security/local-host'

   // Read NODE_ENV at CALL time, not module load. Lets vi.stubEnv flip
   // prod-mode in static-import test suites without vi.resetModules.
   function isProductionEnv(): boolean {
     return process.env.NODE_ENV === 'production'
   }

   export function resolveCanonicalOrigin(request: Request): string {
     const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.trim()
     const prod = isProductionEnv()

     // Production fail-closed contract: env MUST be set, https, non-
     // loopback. Any failure throws so the route handler surfaces 500
     // instead of generating a redirect Location with proxy-localhost
     // (the upstream socket origin behind nginx) or an attacker-
     // controlled origin from a malformed env.
     if (prod) {
       if (!fromEnv) {
         throw new Error(
           'resolveCanonicalOrigin: NEXT_PUBLIC_SITE_URL must be set in production.',
         )
       }
       let parsed: URL
       try {
         parsed = new URL(fromEnv)
       } catch {
         throw new Error(
           'resolveCanonicalOrigin: NEXT_PUBLIC_SITE_URL must be a valid URL in production.',
         )
       }
       if (parsed.protocol !== 'https:') {
         throw new Error(
           'resolveCanonicalOrigin: NEXT_PUBLIC_SITE_URL must use https:// in production.',
         )
       }
       if (isLoopbackOriginUrl(parsed)) {
         throw new Error(
           'resolveCanonicalOrigin: NEXT_PUBLIC_SITE_URL must not be a loopback hostname in production.',
         )
       }
       return parsed.origin
     }

     // Dev: accept http(s) non-loopback env if set; otherwise fall back
     // to request.url so localhost dev works without env.
     if (fromEnv) {
       try {
         const parsed = new URL(fromEnv)
         if ((parsed.protocol === 'http:' || parsed.protocol === 'https:')
             && !isLoopbackOriginUrl(parsed)) {
           return parsed.origin
         }
       } catch {
         // malformed dev env — fall through
       }
     }
     try {
       return new URL(request.url).origin
     } catch {
       return 'http://localhost:3000'
     }
   }
   ```
   **Bad-env contract (round-3 BLOCKER 1)**: in production, ANY problem with the env (UNSET, malformed, http, loopback) throws — NEVER falls back to `request.url`. Calendar callback gets 500 + Sentry breadcrumb instead of generating a Location header pointing at the upstream socket. Charge-token termUrl errors out before bank handoff. Fail-closed beats silent breakage.

4. Tighten `lib/payments/config.ts` (round-2 BLOCKER 2 — payment-redirect/3DS/auth-redirect/allowed-origins surface; round-2 BLOCKER 3 — https in prod; **round-4 BLOCKER 1 — provider-AGNOSTIC, not just CloudPayments**):
   ```ts
   import { isLoopbackOriginUrl } from '@/lib/security/local-host'
   // …

   function parseSiteUrlValidated(value: string | undefined, env: NodeJS.ProcessEnv) {
     const fallback = 'http://localhost:3000'
     const candidate = value && value.trim() ? value.trim() : fallback

     try {
       const parsed = new URL(candidate)
       if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
         throw new Error('protocol must be http(s)')
       }
       return parsed.origin
     } catch {
       return fallback
     }
   }

   const siteUrl = parseSiteUrlValidated(process.env.NEXT_PUBLIC_SITE_URL, process.env)

   // Round-4 BLOCKER 1: the guard runs in ALL provider modes (cloudpayments,
   // mock, future) whenever NODE_ENV=production. paymentConfig.siteUrl is
   // also consumed by lib/security/request.ts (allowed-browser-origins) and
   // lib/email/* (verification + reset + invite links) — those surfaces
   // exist regardless of payment provider, so a `https://localhost` siteUrl
   // would taint auth/email regardless of PAYMENTS_PROVIDER value.
   if (isProd) {
     let parsed: URL
     try {
       parsed = new URL(siteUrl)
     } catch {
       throw new Error(
         'NEXT_PUBLIC_SITE_URL must be a valid URL in production.',
       )
     }
     if (parsed.protocol !== 'https:') {
       throw new Error(
         'NEXT_PUBLIC_SITE_URL must use https:// (not http://) in production.',
       )
     }
     if (isLoopbackOriginUrl(parsed)) {
       throw new Error(
         'NEXT_PUBLIC_SITE_URL must be a non-loopback hostname (not localhost / 127.0.0.1 / *.localhost / ::1 / 0.0.0.0) in production.',
       )
     }
   }
   ```
   Replaces the existing single `siteUrl.startsWith('http://localhost')` + provider-gated check at line 40-43 with provider-agnostic invariants. Error messages differentiate so ops can debug the exact misconfiguration.

5. Tests for `lib/security/local-host.ts`:
   - New `tests/security/local-host.test.ts` (unit, no env):
     - `isLiteralLoopbackHostname` (STRICT) accepts `localhost`, `127.0.0.1`, `::1`, `[::1]`. Rejects `0.0.0.0`, `foo.localhost`, `tenant.localhost`, `levelchannel.ru`, `db.attacker.local`, `localhost.attacker.com`, empty/null.
     - `isLoopbackOriginHostname` (WIDE) accepts all of the strict set PLUS `0.0.0.0`, `foo.localhost`, `tenant.localhost`. Rejects `levelchannel.ru`, `db.attacker.local`, `localhost.attacker.com`, empty/null.
     - `isLoopbackOriginUrl` does the same as `isLoopbackOriginHostname` on parsed URLs.

6. Tests (extend `tests/api/origin-helper.test.ts`):
   - dev mode: rejects `https://localhost`, `http://127.0.0.1:3000`, `http://[::1]:3000`, `http://0.0.0.0:3000`, `https://tenant.localhost:3000` — falls back to request.url.
   - dev mode: accepts `https://levelchannel.ru` (sanity).
   - prod mode (NODE_ENV=production): THROWS on `http://levelchannel.ru` (not https), `https://localhost`, `https://tenant.localhost`, malformed env.
   - prod mode: returns `https://levelchannel.ru` on `https://levelchannel.ru`.

7. New test `tests/integration/payment/config-validation.test.ts`:
   - Uses dynamic `vi.stubEnv` + `vi.resetModules` per `tests/integration/saas-pivot/security-high-closures.test.ts:152-194` pattern.
   - **CloudPayments matrix** (`NODE_ENV=production` + `PAYMENTS_PROVIDER=cloudpayments`):
     - `NEXT_PUBLIC_SITE_URL=https://localhost:3000` → throws (loopback).
     - `NEXT_PUBLIC_SITE_URL=https://tenant.localhost:3000` → throws (RFC 6761).
     - `NEXT_PUBLIC_SITE_URL=https://127.0.0.1` → throws.
     - `NEXT_PUBLIC_SITE_URL=https://[::1]` → throws.
     - `NEXT_PUBLIC_SITE_URL=https://0.0.0.0` → throws.
     - `NEXT_PUBLIC_SITE_URL=http://levelchannel.ru` → throws (round-2 BLOCKER 3: http rejected).
     - `NEXT_PUBLIC_SITE_URL=` (unset) → throws (fallback resolves to localhost).
     - `NEXT_PUBLIC_SITE_URL=https://levelchannel.ru` → re-import succeeds.
   - **Mock-provider matrix** (round-5 WARN 3 closure — provider-agnostic guard pinning, `NODE_ENV=production` + `PAYMENTS_PROVIDER=mock`):
     - `NEXT_PUBLIC_SITE_URL=https://localhost` → throws (proves guard fires regardless of provider).
     - `NEXT_PUBLIC_SITE_URL=http://levelchannel.ru` → throws (http rejected in prod regardless of provider).
     - `NEXT_PUBLIC_SITE_URL=https://levelchannel.ru` → succeeds.
   - **Dev mode** (NODE_ENV=development):
     - All values that previously threw in prod no longer throw — dev-mode flexibility preserved.

### B.5. Tighten Google ingress `redirect_uri` (round-4 BLOCKER 2 + round-5 BLOCKER 1 closure — exact contract, not just https+non-loopback)

`POST /api/teacher/calendar/google/start` builds the consent URL with `config.redirectUrl` from `getGoogleCalendarOauthConfig()`. That value becomes Google's `redirect_uri` query (`lib/calendar/google/oauth.ts:48,70`). Also reused in `lib/calendar/channel-renewer.ts:152` for webhook receiver. So `redirectUrl` has THREE constraints, not just protocol+hostname:
1. Same origin as `NEXT_PUBLIC_SITE_URL` — otherwise Google can land the teacher anywhere.
2. Exact path `/api/teacher/calendar/google/callback` — otherwise the wrong route handler runs.
3. https + non-loopback in prod (subsumed by #1 if NEXT_PUBLIC_SITE_URL is correctly hardened in §4).

Today `lib/calendar/google/config.ts:77-84` only checks `/^https?:\/\//`.

Plan: extend with the exact contract.
```ts
// In lib/calendar/google/config.ts after the existing http(s) check:
const EXPECTED_REDIRECT_PATH = '/api/teacher/calendar/google/callback'

let parsedRedirect: URL
try {
  parsedRedirect = new URL(redirectUrl)
} catch {
  throw new Error(
    `GOOGLE_CALENDAR_REDIRECT_URL must be a valid URL. Got: ${redirectUrl}`,
  )
}

if (parsedRedirect.pathname !== EXPECTED_REDIRECT_PATH) {
  throw new Error(
    `GOOGLE_CALENDAR_REDIRECT_URL must end with path ${EXPECTED_REDIRECT_PATH}. Got pathname: ${parsedRedirect.pathname}`,
  )
}

if (env.NODE_ENV === 'production') {
  if (parsedRedirect.protocol !== 'https:') {
    throw new Error(
      `GOOGLE_CALENDAR_REDIRECT_URL must use https:// in production. Got: ${redirectUrl}`,
    )
  }
  if (isLoopbackOriginUrl(parsedRedirect)) {
    throw new Error(
      `GOOGLE_CALENDAR_REDIRECT_URL must not be a loopback hostname in production. Got: ${redirectUrl}`,
    )
  }
  // Same-origin invariant (round-5 BLOCKER 1 + round-6 BLOCKER 1):
  // redirectUrl.origin MUST match NEXT_PUBLIC_SITE_URL.origin.
  // NEXT_PUBLIC_SITE_URL itself must be SET and valid in prod —
  // don't silently skip the origin check on empty/malformed env
  // (would leave attacker.example as a possible redirect).
  const expectedSiteUrl = (env.NEXT_PUBLIC_SITE_URL ?? '').trim()
  if (!expectedSiteUrl) {
    throw new Error(
      'GOOGLE_CALENDAR_REDIRECT_URL same-origin check requires NEXT_PUBLIC_SITE_URL to be set in production.',
    )
  }
  let expectedOrigin: string
  try {
    expectedOrigin = new URL(expectedSiteUrl).origin
  } catch {
    throw new Error(
      'GOOGLE_CALENDAR_REDIRECT_URL same-origin check requires NEXT_PUBLIC_SITE_URL to be a valid URL in production.',
    )
  }
  if (parsedRedirect.origin !== expectedOrigin) {
    throw new Error(
      `GOOGLE_CALENDAR_REDIRECT_URL must have the same origin as NEXT_PUBLIC_SITE_URL in production. ` +
        `Redirect origin: ${parsedRedirect.origin}; site origin: ${expectedOrigin}.`,
    )
  }
}
```

Tests: extend `tests/calendar/google-config.test.ts` (or whichever suite owns config validation):
- ANY env: `redirectUrl=https://levelchannel.ru/wrong-path` → throws (wrong path).
- ANY env: `redirectUrl=not a url` → throws.
- prod + `redirectUrl=http://levelchannel.ru/api/teacher/calendar/google/callback` → throws (not https).
- prod + `redirectUrl=https://localhost/api/teacher/calendar/google/callback` → throws (loopback).
- prod + `redirectUrl=https://tenant.localhost/api/teacher/calendar/google/callback` → throws (RFC 6761 loopback).
- prod + NEXT_PUBLIC_SITE_URL=`https://levelchannel.ru` + `redirectUrl=https://attacker.example/api/teacher/calendar/google/callback` → throws (origin mismatch, round-5 BLOCKER 1).
- prod + NEXT_PUBLIC_SITE_URL=`https://levelchannel.ru` + `redirectUrl=https://levelchannel.ru/api/teacher/calendar/google/callback` → succeeds.
- non-prod + http(s) + correct path → succeeds (today's dev behaviour preserved).

### B.6. Callback top-level safety wrapper (round-6 WARN 2 closure)

`resolveCanonicalOrigin(request)` now throws in prod on bad/missing env (round-3 BLOCKER 1 / WARN 4). The current callback calls it on line 60 BEFORE the first try/catch — so the new fail-closed branch leaks as a raw 500 instead of redirecting to settings with the error code.

Wrap the entire callback body in a top-level try/catch that:
- Catches any throw from `resolveCanonicalOrigin` (NEXT_PUBLIC_SITE_URL missing / malformed / loopback in prod).
- Logs the error to Sentry (already imported elsewhere in the codebase).
- Returns a plain `new NextResponse('Internal Server Error', { status: 500 })` — we can't redirect because we don't HAVE an origin. The teacher's browser shows the generic Next error page (better than a Location pointing at localhost).

```ts
// app/api/teacher/calendar/google/callback/route.ts
export async function GET(request: Request) {
  let origin: string
  try {
    origin = resolveCanonicalOrigin(request)
  } catch (err) {
    console.error('[calendar/oauth] resolveCanonicalOrigin failed:', err)
    // No origin → cannot redirect anywhere meaningful. Generic 500.
    return new NextResponse(
      'Calendar OAuth callback unavailable. Operator action required.',
      { status: 500 },
    )
  }
  // ... existing body unchanged from here.
}
```

Test:
- `tests/integration/calendar/oauth-callback-origin.test.ts` extends to cover the prod-env-missing-NEXT_PUBLIC_SITE_URL case → callback returns 500 (NOT a redirect to localhost or wherever).

### C. Close test/doc drift (WARN 3 + WARN 4 + INFO 6 closure)

1. Create the missing `tests/teacher-cabinet-polish/calendar-page-timezone-gate.test.tsx` jsdom test:
   - SSR page with `getAccountProfile` returning **profile row exists, timezone=null** + `configReady=true` + `integration=null` → renders `data-testid="teacher-calendar-timezone-gate"`.
   - SSR page with `getAccountProfile` returning **null (no profile row)** + `configReady=true` + `integration=null` → renders banner too (covers round-1 INFO 6: both shapes are gate-eligible).
   - Same but `configReady=false` → does NOT render gate (banner suppressed under "Скоро будет").
   - Same but `integration.syncState='active'` → does NOT render gate (already connected).
   - SSR page with `?error=timezone_required` → renders localized Russian message (NOT raw literal).

2. `tests/integration/calendar/google-routes.test.ts::makeTeacher()`:
   - Change signature: `timezone?: string | null` (default keeps `'Europe/Moscow'`).
   - When `timezone === null`, skip the `upsertAccountProfile` call entirely → no profile row.
   - **Two new tests** (round-1 INFO 6 coverage of both shapes):
     - POST `/start` with **no profile row** → 422 `timezone_required`.
     - POST `/start` with **profile row exists, timezone explicitly null** → 422 `timezone_required`. (Use the integration suite's direct `upsertAccountProfile({ displayName: 'X', timezone: null })`.)

3. Call-site test for origin helper (round-1 WARN 4: MANDATORY, NOT optional):
   - `tests/integration/calendar/oauth-callback-origin.test.ts` — new file using dynamic re-import pattern from `tests/integration/saas-pivot/security-high-closures.test.ts:152-194`. Asserts callback `Location` header origin matches stubbed `NEXT_PUBLIC_SITE_URL` (not request's `http://localhost`).
   - `tests/integration/payment/charge-token-termurl-origin.test.ts` — MANDATORY. Money-critical: production behind nginx with broken env had a real bank-redirect-to-localhost bug. Uses the same `vi.stubEnv` + `vi.resetModules` + dynamic re-import pattern. Asserts `body.threeDs.termUrl.startsWith('https://levelchannel.ru/api/payments/3ds-callback')` under stubbed env. Fixture for `requires_3ds` path: mock `chargeWithSavedCard` to return `{ kind: 'requires_3ds', order: {...}, threeDs: {...} }`.

4. **23514 catch-path route-level tests** (round-1 WARN 3 + round-4 WARN 3 closure — MANDATORY route-level evidence, NOT just DB trigger evidence):
   - `tests/integration/account/profile.test.ts` — extend with TWO REQUIRED route-level tests:
     - **PATCH race test**: register + login + profile w/ Moscow → INSERT integration row directly (sync_state='active') via raw SQL bypassing the route helpers. PATCH `/api/account/profile { timezone: null }` should hit the app-layer guard and return 409 `timezone_required_while_calendar_connected`. (Tests the primary guard.)
     - **PATCH 23514 race-with-guard-bypass test**: same setup, but the bypass uses `vi.spyOn(getGoogleIntegrationMeta).mockResolvedValueOnce(null)` to simulate the app-layer guard missing (TOCTOU race where integration was created between check and upsert). PATCH `/api/account/profile { timezone: null }` should bottom out on the DB trigger → catch maps `23514` (with message-prefix narrow-match) → returns 409 with the same `timezone_required_while_calendar_connected` code (NOT generic 500). This is the actual proof the catch path works.
   - `tests/integration/calendar/google-routes.test.ts` — extend with ONE REQUIRED route-level test (round-7 BLOCKER 2 closure — use spy-implementation seam to simulate the race deterministically):
     - **Callback race test**: teacher with profile timezone='Moscow', integration not yet created. Use `vi.spyOn(profilesModule, 'getAccountProfile').mockImplementationOnce(async (id) => { const snapshot = await origGetAccountProfile(id); await pool.query('UPDATE account_profiles SET timezone=NULL WHERE account_id=$1', [id]); return snapshot; })`. The mock returns the pre-mutation snapshot (so the route's gate sees Moscow and proceeds) BUT mutates the DB to NULL before returning. Then the callback proceeds to `upsertGoogleIntegration` → DB trigger fires `23514` → callback's try/catch maps it → response is 302 to `/teacher/settings/calendar?error=timezone_required` (NOT 500). This is the actual race the trigger pair closes.
   - Catch contract for BOTH route tests: narrow match on PG error code `23514` AND error-message prefix (`'teacher_calendar_integrations: timezone must be set'` for callback, `'account_profiles: cannot clear timezone'` for PATCH). Other 23514 sources MUST propagate as 500 unchanged.
   - **Narrow-match contract proven via unit-level catch logic (round-7 BLOCKER 1 closure — route-level negative test is not feasibly reachable):**
     - Round 7 catch: app validation rejects `locale='xx'` and `displayName` length before DB. Direct-SQL setup raises 23514 OUTSIDE the route catch. Neither path actually exercises the catch's discriminator at route level.
     - Pragmatic closure: extract BOTH narrow-match catches into named helpers in `lib/calendar/timezone-trigger-errors.ts` (shared module):
       - `isAccountProfilesClearTimezoneError(err)` — matches `code === '23514' && message.startsWith('account_profiles: cannot clear timezone')`. Used by PATCH /api/account/profile.
       - `isCalendarRequireTimezoneError(err)` — matches `code === '23514' && message.startsWith('teacher_calendar_integrations: timezone must be set')`. Used by callback.
     - Unit-test BOTH helpers directly (round-8 BLOCKER 1 closure — callback discriminator needs its own negative proof too):
       ```ts
       it('isAccountProfilesClearTimezoneError matches the PATCH trigger prefix', () => {
         expect(isAccountProfilesClearTimezoneError({
           code: '23514',
           message: 'account_profiles: cannot clear timezone while ...',
         })).toBe(true)
       })
       it('isAccountProfilesClearTimezoneError rejects unrelated 23514', () => {
         expect(isAccountProfilesClearTimezoneError({
           code: '23514',
           message: 'new row violates check constraint "account_profiles_timezone_iana_check"',
         })).toBe(false)
         expect(isAccountProfilesClearTimezoneError({
           code: '23514',
           message: 'teacher_calendar_integrations: timezone must be set ...',
         })).toBe(false) // Wrong trigger — must not match.
       })
       it('isCalendarRequireTimezoneError matches the callback trigger prefix', () => {
         expect(isCalendarRequireTimezoneError({
           code: '23514',
           message: 'teacher_calendar_integrations: timezone must be set ...',
         })).toBe(true)
       })
       it('isCalendarRequireTimezoneError rejects unrelated 23514', () => {
         expect(isCalendarRequireTimezoneError({
           code: '23514',
           message: 'account_profiles: cannot clear timezone ...',
         })).toBe(false) // Wrong trigger.
         expect(isCalendarRequireTimezoneError({
           code: '23514',
           message: 'new row violates check constraint "tci_status_check"',
         })).toBe(false)
       })
       it('both reject non-23514 errors', () => {
         expect(isAccountProfilesClearTimezoneError({ code: '23505', message: 'duplicate key' })).toBe(false)
         expect(isCalendarRequireTimezoneError({ code: '23505', message: 'duplicate key' })).toBe(false)
       })
       ```
     - Code-review invariant: any change to the catch logic MUST keep the helper as the gatekeeper. Document this in a code comment above the catch block.
     - Document the design decision in the plan: unit-level coverage replaces route-level coverage for this contract because the latter is not reachable without test-only seams that would themselves be unsafe.
   - **No escape hatch.** A DB-only trigger test does NOT count as evidence the route catches and remaps. Round-4 WARN 3: route-level tests are mandatory.

4a. **Direct DB-trigger evidence tests** (round-6 WARN 5 closure — separate from route-level remap tests):
   - New `tests/integration/calendar/trigger-direct-evidence.test.ts`:
     - INSERT teacher_calendar_integrations(sync_state='active') with profile timezone=NULL via raw SQL → expects rejection matching `/teacher_calendar_integrations: timezone must be set/`.
     - UPDATE account_profiles SET timezone=NULL via raw SQL with active integration → expects `/account_profiles: cannot clear timezone/`.
     - INSERT account_profiles with timezone=NULL when active integration exists → expects `/cannot create row with NULL/`.
     - DELETE account_profiles when active integration exists → expects `/cannot remove/`.
   - These pin the trigger pair as the load-bearing defense, independent of route-level remap tests.
   - **Concurrent-write race test (round-9 BLOCKER 1 closure)**: simulate the steady-state race that the advisory lock closes:
     - Setup: profile with timezone='Moscow', no integration row.
     - Open TWO separate `pool.connect()` clients (call them clientA, clientB).
     - Both `BEGIN` their transactions.
     - clientA executes `UPDATE account_profiles SET timezone=NULL WHERE account_id=...`. This fires Trigger B which takes the advisory lock and the SELECT EXISTS on integrations returns false → trigger allows. UPDATE pending, not yet committed.
     - clientB executes `INSERT INTO teacher_calendar_integrations (..., sync_state='active', ...)`. This fires Trigger A which tries `pg_advisory_xact_lock(...)` for the SAME key → BLOCKS waiting on clientA's lock.
     - clientA COMMITs. clientB's trigger unblocks, SELECTs profile.timezone → sees NULL → raises check_violation → clientB ROLLBACK.
     - Assertion: end state is `account_profiles.timezone = NULL`, `teacher_calendar_integrations` row does NOT exist. Proves serialization works.
   - **Reverse-order concurrent-write race test (round-10 WARN 2 closure)**: mirror the previous test with the opposite ordering:
     - clientA INSERTs `teacher_calendar_integrations(sync_state='active')` FIRST (Trigger A acquires lock, sees Moscow → allows). INSERT pending.
     - clientB UPDATEs `account_profiles SET timezone=NULL` (Trigger B tries to acquire SAME lock → blocks).
     - clientA COMMITs (integration='active', profile=Moscow).
     - clientB unblocks, SELECTs integrations → sees active → raises check_violation → clientB ROLLBACK.
     - Assertion: integration row='active', profile.timezone='Moscow' (unchanged). Proves both orderings serialize.

5. e2e:
   - `tests/e2e/product-flows-authenticated.spec.ts:125-136` — extend FLOW-TEACHER-CALENDAR-SETTINGS-001 test to assert gate banner DOM CONDITIONAL on `configReady` (per evals/PRODUCT_FLOWS.md:234). Check for `data-testid="calendar-coming-soon-tile"` first; if present, skip gate assertion (CI without GOOGLE_CALENDAR_* env). Otherwise assert `data-testid="teacher-calendar-timezone-gate"` is present when fixture teacher has no profile row.

6. Remove stale comments from `tests/teacher-cabinet-polish/calendar-page-gated-intro.test.tsx:67` + `calendar-page-state-matrix.test.tsx:54` that reference the missing test file (or keep them now that the file exists).

## Risks

- **R1 — Rolling-deploy ordering for mig 0107.** Parent epic's app code is now baseline. The trigger only fires on INSERT/UPDATE-into-active. The narrow window is a teacher with `timezone IS NULL` who clicks "Connect" on OLD code (impossible — old code 422s) OR whose state transition is in flight during the deploy window (sub-5s atomic restart on single VPS). Risk is negligible — same as parent epic's bounded window argument.
- **R2 — Narrow `23514` catch matching.** If the catch matches too broadly (any check_violation), unrelated CHECK violations (display_name length, locale, mig 0069 IANA, mig 0095 columns) get misreported as `timezone_required`. Mitigate by matching the trigger's literal exception text or using a typed error class. The triggers raise with specific message prefixes ("teacher_calendar_integrations:" and "account_profiles:") — match those.
- **R3 — origin helper backward-compat.** Some test fixture might use `https://localhost` (e.g., test-only setup). Verify no in-repo test relies on the old loose check before tightening.
- **R4 — mig 0107 lock contention (round-2 BLOCKER 1).** EXCLUSIVE locks on both tables block writes until commit. Migration runs on `scripts/migrate.mjs` which uses a single tx; commit completes in milliseconds after CREATE TRIGGER. App-side writes that race the migration will queue (not error) and proceed after commit. Acceptable for the deploy window.
- **R5 — `lib/payments/config.ts` boot break (round-2 BLOCKER 2).** Tightening the production gate means a misconfigured `NEXT_PUBLIC_SITE_URL=https://localhost` in prod CloudPayments mode now boot-fails where before it only failed on `http://localhost`. This IS the desired behaviour (fails fast in prod vs. silently breaks payments). Verify staging env doesn't carry `https://localhost` (it shouldn't — staging uses `https://staging.levelchannel.ru`).
- **R6 — Shared classifier consumers.** Refactoring `lib/db/pool.ts` + `lib/api/cron-auth.ts` to use the shared helper changes their behaviour SLIGHTLY: cron-auth currently includes `'[::1]'` (bracketed) in its set, db/pool strips brackets. Shared helper handles BOTH shapes — verify no test pins the exact set membership.
- **R7 — `*.localhost` tightening introduces breaking change (round-2 BLOCKER 2).** Any in-repo dev fixture or local script that uses `*.localhost` (e.g., `tenant.localhost:3000` for multi-tenant simulation) now gets rejected. Grep `rg '\.localhost' --type ts` before final commit; expected hits should be 0 (none today).
- **R8 — `https:` requirement breaks `http://your-domain` config (round-2 BLOCKER 3).** Production deployments using a plain-http reverse-proxy upstream would boot-fail. LevelChannel prod always sits behind nginx with HTTPS; `NEXT_PUBLIC_SITE_URL=https://levelchannel.ru` is the only valid prod value. Staging uses `https://staging.levelchannel.ru`. CI uses dev-mode (NODE_ENV != 'production'), so unaffected.
- **R9 — Fail-closed in calendar callback (round-2 WARN 4).** `resolveCanonicalOrigin` throws in prod on bad env. The callback's exception handling needs to be checked: today the callback wraps `getGoogleCalendarOauthConfig()` in try/catch but not `resolveCanonicalOrigin`. Add a top-level try/catch around the entire callback that returns a generic 500 with localized error logged to Sentry. (Tracked as part of the implementation step in §A.)
- **R10 — Trigger fires on every active|degraded write (round-3 BLOCKER 2).** Calendar pull/push workers UPDATE `last_pulled_at` / `last_push_at` on each tick — a teacher's active integration may see ~50-100 trigger fires/day. Each adds one extra single-row PK SELECT on `account_profiles` (sub-ms) + one advisory-lock acquire/release. Total added load: <100ms/day per active teacher. Negligible.
- **R15 — Advisory-lock prefix shared with other writers (round-9 BLOCKER 1).** The `tz_invariant:<account_id>` lock key is unique to this invariant. Doesn't collide with the existing advisory locks in `lib/auth/accounts.ts` (which use `account_creation:` and `account_email:` prefixes per the auto-memory `advisory_lock_prefix_unification.md`). Verify by adding a CI grep check on the prefix.
- **R16 — Trigger advisory locks vs. route-level locks.** The trigger takes the advisory lock INSIDE the trigger function, not at the route layer. This means the lock is held for the duration of the trigger's SELECT + INSERT/UPDATE/DELETE. Route handlers don't need to take the lock themselves — defense-in-depth is at DB layer. Tests must exercise the concurrent-write race to prove the lock works.
- **R11 — Two helper-name split (round-3 BLOCKER 3).** Refactoring callers means picking the right helper at each call site. db/pool + cron-auth use STRICT; origin + paymentConfig use WIDE. Easy to mismatch — pin via test that asserts the helper map and via call-site code review.
- **R12 — `scripts/_pg-ssl.mjs` drift (round-3 WARN 5).** `.mjs` cannot import TS. Inline mirror + drift test pinning equality of the literal-loopback sets (pattern from `scripts/lib/timezone.mjs` mirror).
- **R13 — Provider-agnostic paymentConfig guard (round-4 BLOCKER 1).** Tightening the guard to fire on `isProd` regardless of `provider` means `PAYMENTS_PROVIDER=mock` in prod (staging fallback, smoke test boots) now boot-fails with a bad siteUrl where before only CloudPayments did. This IS the desired behaviour — auth/email/origin policy is provider-independent. Verify staging carries `https://staging.levelchannel.ru` (it should). Negligible risk.
- **R14 — Google ingress redirect_uri tightening (round-4 BLOCKER 2).** Production deploy with a misconfigured `GOOGLE_CALENDAR_REDIRECT_URL` (e.g. someone copies dev config to prod) now boot-fails at `getGoogleCalendarOauthConfig()`. Currently the calendar settings page already 500s on a bad config (catches the throw). After this tightening, the page rendering itself still works (catches the throw and shows "Скоро будет"), but the connect button stays disabled. Verify prod env actually has the real production callback URL (it does — PR #535 hotfix set it).

## Migration plan

```
0107_calendar_require_timezone_triggers.sql
```

Reversibility: drop the two functions + triggers. Plan-doc preserves the SQL verbatim for one-line restoration.

## Acceptance

- [ ] mig 0107 deployed; preflight aborts cleanly if any grandfathered rows exist.
- [ ] After deploy: PATCH `/api/account/profile { timezone: null }` while integration active → 409 (app-layer guard fires); same call bypassing app (direct psql) → check_violation. Both pinned by tests.
- [ ] Callback TOCTOU race (gate-check sees timezone set, concurrent PATCH clears it) → callback redirects with `?error=timezone_required` (NOT 500). Tested.
- [ ] `resolveCanonicalOrigin` rejects `https://localhost:3000`, `http://127.0.0.1:3000`, `http://[::1]:3000`. Tested.
- [ ] e2e for FLOW-TEACHER-CALENDAR-SETTINGS-001 asserts gate banner CONDITIONAL on `configReady`.
- [ ] `makeTeacher` in google-routes.test.ts accepts `timezone: null`; new test pins POST /start 422.
- [ ] Missing `calendar-page-timezone-gate.test.tsx` file exists.

## Out of scope

- Multi-tenant timezone runtime refactor (MSK-hardcoded in 4 files) — still tracked as separate epic; this fix-PR only closes wave-paranoia findings.
- Widening the 19-entry IANA allowlist — still owner Option A.
- Docker socket access issue (round-1 INFO 4) — Codex local env, not actionable.
