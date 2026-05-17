# AUDIT-SEC-4 — Encrypt `channel_token` at rest

**Scope class:** mini-epic (single-PR; one migration + dual-write + decrypt-aware read + rotation-script update + tests).
**Wave name:** `sec-4-channel-token-encryption`.
**Origin:** audit backlog AUDIT-SEC-4 (2026-05-17). The Google Calendar push-channel verification secret (`channel_token`) is currently stored as plaintext `text` in `teacher_calendar_integrations`. The two sibling secrets on the same row (`access_token_enc`, `refresh_token_enc`) and the calendar event summary on a sibling table (`teacher_external_busy_intervals.summary_encrypted`) are already encrypted under `CALENDAR_ENCRYPTION_KEY` via `pgp_sym_encrypt`. `channel_token` is the only remaining plaintext secret on this surface.

Plan was paranoia-reviewed; round 1 BLOCK identified three real issues (rollout/rollback cliff; guard placement opening the door to orphaned live Google channels; silent-green test surface where fixtures stamp plaintext directly via raw SQL). All three are addressed below.

## 1. Existing surface inventory

Per `~/.claude/COMPANY.md` survey-before-plan rule. Every read/write of `channel_token` in the repo, the schema, and the operator runbook, enumerated before designing the change.

### 1.1 Schema (current)

`migrations/0043_teacher_calendar_integrations.sql:73`:

```sql
channel_token        text         null,
```

Plain `text`, nullable. No index. Default null. Set non-null only by `lib/calendar/channel-renewer.ts:172` when a Google push channel is established. Cleared back to null on every disconnect path and on initial-connect ON CONFLICT (the renewer re-populates after the next pull tick).

### 1.2 Writers (4 sites)

| Site | Operation | Current value written |
|---|---|---|
| `lib/calendar/integrations.ts:174` | `upsertGoogleIntegration` initial_connect INSERT | hardcoded `null` (channel is set later by the renewer) |
| `lib/calendar/integrations.ts:212` | `upsertGoogleIntegration` initial_connect ON CONFLICT | hardcoded `null` (epoch rotation clears the channel triple) |
| `lib/calendar/integrations.ts:347` | `disconnectGoogleIntegration` | hardcoded `null` |
| `lib/calendar/channel-renewer.ts:172` | `setupChannelForIntegration` UPDATE (also the path `renewExpiringChannels` flows through — same function) | non-null random 32-byte base64url string from `mintChannelToken()` |

### 1.3 Readers (3 sites)

| Site | Purpose | What it does with the value |
|---|---|---|
| `app/api/calendar/google/webhook/route.ts:91-108` | Verify incoming Google push has the expected channel token | Constant-time string compare against `X-Goog-Channel-Token` header inside the same `FOR UPDATE` TX that reads `channel_resource_id` + `channel_expires_at`. **The only security-load-bearing read.** |
| `lib/calendar/integrations.ts:93` | Map row → `TeacherCalendarIntegrationRecord` for `getGoogleIntegration` / `getGoogleIntegrationMeta` returns | Returned in the integration record as `channelToken: string \| null`. The two callers of these helpers (`pull-worker`, settings UI) do not actually consume the field. |
| Test fixtures (`tests/integration/calendar/channels.test.ts:318-322` for renewer; `tests/integration/calendar/webhook.test.ts:57-68` for webhook setup helper) | Raw-SQL fixture seed | Both fixtures bypass the dual-write code path. After this wave, fixtures must seed through the production helper OR write both columns. See §5. |

### 1.4 Rotation surface

`scripts/rotate-calendar-encryption.mjs:59-75` (`ROTATION_TARGETS`) currently rotates **three** encrypted columns:

- `teacher_calendar_integrations.access_token_enc`
- `teacher_calendar_integrations.refresh_token_enc`
- `teacher_external_busy_intervals.summary_encrypted`

`SECURITY.md §At-rest encryption — Calendar key rotation` documents these three.

### 1.5 Docs that already enumerate the encrypted-column set

- `ARCHITECTURE.md:204,217,381,404` — recent-migrations / calendar-encryption notes (three-column inventory). Must learn the fourth column.
- `lib/calendar/encryption.ts:7-10` — comment block listing the three columns covered by `CALENDAR_ENCRYPTION_KEY`. Must learn the fourth.
- `SECURITY.md` — three-column rotation runbook; needs fourth column **and** an AUDIT-SEC-4 Phase B subsection with the safety discipline used for the audit-encryption Phase B (`SECURITY.md:203,207,211` shape).
- `ENGINEERING_BACKLOG.md` — has the open AUDIT-SEC-4 row that this plan closes.
- `docs/plans/booking-calendly-style.md` — design-time mention, no runtime impact (no edit needed).

### 1.6 Migration numbering

`migrations/0053_probe_runs.sql` is current head. **Next free number: 0054.**

### 1.7 Encryption-key resolver

`lib/calendar/encryption.ts` — `getCalendarEncryptionKey()` returns `string | null` in dev/test and throws in production when unset. `getCalendarEncryptionKeyOld()` returns `string | null` (null is the normal state). The decrypt-aware read in §4.3 must tolerate a null OLD bind — confirmed: `pgp_sym_decrypt_either` accepts NULL OLD (migration 0027).

## 2. Threat model + value of encrypting this column

Plain prose, not table form — the trade-off is the whole point.

**What `channel_token` defends against:** an attacker who reaches our Google Push endpoint (`/api/calendar/google/webhook`) and tries to forge a push notification with a guessed `X-Goog-Channel-Token` header. The server-side check (`route.ts:108`) is a constant-time compare against the stored value. If an attacker had DB-read access they could trivially forge a valid push today; encrypting the column raises that bar to "DB-read PLUS knowledge of the calendar encryption key".

**What it does NOT defend against:** an attacker with app-process memory access or app-process query rights. Such an attacker can decrypt the column the same way the webhook does. The fix here is a defence-in-depth measure for the specific "stolen DB snapshot / replication leak / backup leak" failure mode — exactly the same failure mode that motivated `access_token_enc` and `refresh_token_enc` in the original BCS-C.3a design.

**Why this is worth doing despite low individual blast radius:** parity with the two sibling secrets on the same row. The single plaintext column is an audit eye-sore and undercuts the at-rest claim in `SECURITY.md`. The marginal cost is one migration + ~20 lines of dual-write + one new rotation target. The marginal benefit is closing the last plaintext-secret hole on the calendar surface.

## 3. Schema design — migration 0054

`migrations/0054_calendar_channel_token_enc.sql` adds a single nullable bytea column and a covering note.

```sql
-- AUDIT-SEC-4 (2026-05-17) — encrypt the Google push channel
-- verification secret at rest. Mirrors the access_token_enc /
-- refresh_token_enc pattern from migration 0043 + the rotation
-- contract from migration 0027 (pgp_sym_decrypt_either).
--
-- Phase A (this migration + the PR that lands it): add nullable
-- channel_token_enc column. App code dual-writes the new column on
-- every channel-token write and reads it preferentially
-- (decrypt-aware) with plaintext channel_token as fallback. No
-- existing rows are touched.
--
-- Phase B (operator, after migration soaks AND the rollback window
-- closed): backfill encrypted column from plaintext for rows that
-- have channel_token set but channel_token_enc null; null out
-- plaintext after success.
-- See SECURITY.md § AUDIT-SEC-4 channel_token migration for the
-- preflight/snapshot/discipline checklist.
--
-- Phase C (next major release): drop the plaintext channel_token
-- column. Not done here.

alter table teacher_calendar_integrations
  add column if not exists channel_token_enc bytea null;
```

No index, no NOT NULL, no default. The plaintext `channel_token` column **stays** for Phase A so a rolling deploy or rollback never strands the webhook readers.

## 4. Application changes

### 4.1 `lib/calendar/integrations.ts` — three sites

The three writers that write plaintext `null` today must also write `channel_token_enc = null`. The fourth writer (the renewer, §4.2) is the one that handles the non-null case.

`integrations.ts:174` (initial_connect INSERT) — add `channel_token_enc` to the column list with `null`.
`integrations.ts:212` (initial_connect ON CONFLICT) — add `channel_token_enc = null` to the SET clause.
`integrations.ts:347` (disconnectGoogleIntegration) — add `channel_token_enc = null` to the SET clause.

`rowToRecord` (line 93) and the row-to-meta paths do not need to surface `channelTokenEnc` on the public record — the encrypted bytea is only ever consumed by the webhook (which reads it via a tailored SELECT, §4.3) and by the rotation script (which reads it directly).

### 4.2 `lib/calendar/channel-renewer.ts` — `setupChannelForIntegration` (the one writer that matters)

**Round-1 BLOCKER #2 + round-2 BLOCKER #1 + round-2 WARN #3 closure.** The function must fail closed BEFORE the external `channels.watch` call on every condition that would prevent the post-watch `UPDATE` from succeeding. Otherwise Google holds a live channel pointing at our webhook that we have no local record of, the webhook silent-drops because no row matches `channel_id`, and the OAuth callback still redirects `connected=1` (the callback treats setup failures as non-fatal, `app/api/teacher/calendar/google/callback/route.ts:163,184`).

Two conditions can prevent the UPDATE from succeeding under this wave:

1. **Encryption key unset.** In production `getCalendarEncryptionKey()` *throws* (it does not return null) — `lib/calendar/encryption.ts:69-75`. A bare `if (!encKey)` after the call is dead code in prod. The guard must use `try/catch` to convert the throw to a structured outcome.
2. **Migration 0054 not yet applied.** During a rolling deploy where the app rolls before the migration runs, the new `channel_token_enc = pgp_sym_encrypt(...)` clause in the UPDATE fails with `42703 column does not exist`. The orphan-channel window is the same — watch is already live.

Correct guard placement: **at the very top of `setupChannelForIntegration`, before `mintChannelToken` and before the `watchChannel` call** — sibling to the existing `getGoogleCalendarOauthConfig` config check. The guard does both checks in one place:

```ts
let encKey: string | null
try {
  encKey = getCalendarEncryptionKey()
} catch (e) {
  return {
    ok: false,
    reason: 'config_missing',
    detail: `CALENDAR_ENCRYPTION_KEY: ${e instanceof Error ? e.message : String(e)}`,
  }
}
if (!encKey) {
  return { ok: false, reason: 'config_missing', detail: 'CALENDAR_ENCRYPTION_KEY unset' }
}
// Schema preflight: refuse if migration 0054 has not landed yet.
// Otherwise watchChannel would succeed and the post-watch UPDATE
// would throw 42703 column-does-not-exist, leaving an orphan live
// Google push channel.
const schemaCheck = await pool.query(
  `select 1
     from information_schema.columns
    where table_name = 'teacher_calendar_integrations'
      and column_name = 'channel_token_enc'
    limit 1`,
)
if (schemaCheck.rows.length === 0) {
  return {
    ok: false,
    reason: 'config_missing',
    detail: 'channel_token_enc column missing — migration 0054 not applied',
  }
}
```

That covers both failure modes BEFORE any external Google call. Production callers (OAuth callback, `renewExpiringChannels` cron path — both flow through the same function) get a structured `config_missing` outcome they already handle.

Renewer path note (round-3 WARN #2 fix): `renewExpiringChannels` does not have its own UPDATE site — it calls `setupChannelForIntegration` directly (`lib/calendar/channel-renewer.ts:279`). The one UPDATE at line 168 inside `setupChannelForIntegration` is the only channel-write site. Patching it once + adding the top-of-function guard covers both the OAuth-callback entry and the cron-renewer entry.

After the guard, the UPDATE at line 168 is rewritten as a dual-write:

```sql
update teacher_calendar_integrations
   set channel_id = $2,
       channel_resource_id = $3,
       channel_token = $4,
       channel_token_enc = pgp_sym_encrypt($4, $6),
       channel_expires_at = $5::timestamptz,
       last_seen_message_number = null,
       updated_at = now()
 where account_id = $1
```

with `$6 = encKey`. Single key, single rotation surface — the same key already encrypts `access_token_enc` / `refresh_token_enc` on the same row.

### 4.3 `app/api/calendar/google/webhook/route.ts` — decrypt-aware read

The `select` at line 91 currently reads `channel_token` (plaintext). Replace with a decrypt-aware projection that prefers the encrypted column and falls back to plaintext for rows written before Phase A landed:

```sql
select account_id,
       coalesce(
         case when channel_token_enc is null then null
              else pgp_sym_decrypt_either(channel_token_enc, $2, $3)
         end,
         channel_token
       ) as channel_token,
       channel_resource_id,
       last_seen_message_number, read_calendar_ids,
       channel_expires_at, sync_state
  from teacher_calendar_integrations
 where channel_id = $1
 for update
```

Bind: `$2 = CALENDAR_ENCRYPTION_KEY` (or `null` if unset in dev/test), `$3 = CALENDAR_ENCRYPTION_KEY_OLD` (may be null). The `pgp_sym_decrypt_either` helper accepts NULL PRIMARY and NULL OLD and returns NULL — the COALESCE then falls through to the plaintext column. Round-1 INFO #10 confirms the helper returns NULL on wrong-key/corrupt-data rather than raising, so this does not introduce a new timing oracle or null-vs-empty issue: the constant-time compare path (`route.ts:108`) already guards on `!expectedToken` before calling `timingSafeEqual`.

Once Phase B completes (plaintext nulled out) the `coalesce` will degrade to the encrypted branch only — no code change needed. Phase C (drop plaintext column) will require removing the `coalesce` fallback **and** the plaintext `channel_token` writes in §4.1.

### 4.4 `scripts/rotate-calendar-encryption.mjs` — one new rotation target

Append to `ROTATION_TARGETS`:

```js
{
  table: 'teacher_calendar_integrations',
  column: 'channel_token_enc',
  ageColumn: 'created_at',
},
```

No other change. The existing batched `pgp_sym_decrypt_either` + `pgp_sym_encrypt` machinery covers it. The wrong-OLD-key abort (script §1 of `scripts/rotate-calendar-encryption.mjs`) protects this column the same way it protects the others: round-1 INFO #9 confirms it tolerates the mid-rollout `channel_token_enc IS NULL` state because the script only counts non-null ciphertext rows.

### 4.5 `SECURITY.md` runbook update

Two edits:

1. **Append `channel_token_enc` to the rotation-targets list** in `§At-rest encryption — Calendar key rotation`.
2. **Add a new subsection `§ AUDIT-SEC-4 channel_token migration`** modelled on the audit-Phase-B template at `SECURITY.md:203,207,211`. Required content:
   - **Phase A** is automatic on deploy (no operator action; the dual-write code path is live as soon as the PR merges).
   - **Phase B preflight (operator):**
     1. Confirm Phase A has been live ≥ 14 days AND no rollback to a pre-Phase-A build is planned within the next 7 days. Phase B is a **one-way door** — pre-Phase-A code does not read `channel_token_enc`, so once plaintext is nulled, rolling back blinds every push notification on those rows. (Closes round-1 BLOCKER #1.)
     2. Confirm `CALENDAR_ENCRYPTION_KEY` is the active key the renewer has been encrypting under (since Phase A landed).
     3. Snapshot the row counts: `select count(*) filter (where channel_token is not null) as plaintext, count(*) filter (where channel_token_enc is not null) as encrypted from teacher_calendar_integrations` — record both numbers in the operator log.
   - **Phase B mechanics — dedicated script.** Round-3 BLOCKER #1 closure: Phase B execution is performed via `scripts/null-plaintext-channel-token.mjs` (new, this PR), modelled on the existing `scripts/null-plaintext-audit-pii.mjs`. The script encapsulates preflight + sample round-trip check + snapshot table + destructive UPDATE + post-verify, all driven by `DATABASE_URL` + `CALENDAR_ENCRYPTION_KEY` env. Operator runs `node scripts/null-plaintext-channel-token.mjs` for the read-only preflight, then `--execute --confirm` to apply.
     - **Why a script and not inline SQL:** `psql` `do $$ ... $$` blocks cannot bind positional parameters, so the encryption key would have to be inlined into the SQL string (leaking via shell history / pg_stat_statements). The script keeps the key in an env var passed only to the pg driver.
     - **Sample roundtrip preflight:** picks ≤3 encrypted rows, decrypts under the current key, and aborts if any decoded value does not exactly equal the row's plaintext `channel_token`. Mirrors `null-plaintext-audit-pii.mjs:194-221`.
     - **Snapshot table:** `teacher_calendar_integrations_pre_sec4_phase_b` (created via `create table ... as select * from teacher_calendar_integrations`). One-query rollback path. Operator drops it manually after ≥7 days of confidence.
     - **Destructive UPDATE:** `update teacher_calendar_integrations set channel_token = null where channel_token is not null and channel_token_enc is not null`. Inside a TX; rollback on any error.
     - **Post-verify:** zero rows remain where `channel_token_enc IS NOT NULL AND channel_token IS NOT NULL`; ≤3 sample rows decrypt cleanly under the current key.

     For reference (and as a regression anchor in case the script's safety machinery is misread), the equivalent inline SQL the script encodes is:
     ```sql
     -- Preflight snapshot (record p0 + e0 in the operator log):
     select
       count(*) filter (where channel_token is not null
                          and channel_token_enc is null)             as p0_plaintext_only,
       count(*) filter (where channel_token is not null
                          and channel_token_enc is not null)         as p0_both,
       count(*) filter (where channel_token is null
                          and channel_token_enc is not null)         as p0_encrypted_only
     from teacher_calendar_integrations;

     begin;

     -- Step 1: backfill encrypted column for plaintext-only rows.
     -- Use FOR UPDATE SKIP LOCKED so the renewer can keep working;
     -- a row the renewer is mid-renewing is skipped here and picked
     -- up by the next Phase B run (or, more commonly, the renewer
     -- itself sets channel_token_enc as part of the dual-write).
     with cand as (
       select account_id from teacher_calendar_integrations
        where channel_token is not null
          and channel_token_enc is null
        for update skip locked
     )
     update teacher_calendar_integrations t
        set channel_token_enc = pgp_sym_encrypt(t.channel_token, $1)
       from cand
      where t.account_id = cand.account_id;
     -- VERIFY: rows updated == preflight p0_plaintext_only (or fewer
     -- if the renewer raced in; difference must equal renewer
     -- activity since snapshot — record in operator log).

     -- Step 2: hard round-trip equality check before destructive
     -- null-out. Aborts the TX if ANY row's ciphertext fails to
     -- decrypt back to the live plaintext.
     do $$
     declare bad int;
     begin
       select count(*) into bad
         from teacher_calendar_integrations
        where channel_token is not null
          and channel_token_enc is not null
          and (
            pgp_sym_decrypt_either(channel_token_enc, $1, null) is null
            or pgp_sym_decrypt_either(channel_token_enc, $1, null)
                 is distinct from channel_token
          );
       if bad > 0 then
         raise exception
           'Phase B verify failed: % rows have channel_token_enc that does not decrypt to channel_token under the supplied key. Refusing to null plaintext. Investigate before retry.',
           bad;
       end if;
     end$$;

     -- Step 3: null plaintext only for rows whose ciphertext has
     -- been independently verified by step 2.
     update teacher_calendar_integrations
        set channel_token = null
      where channel_token is not null
        and channel_token_enc is not null;

     commit;
     ```
   - **Phase B rollback:** before COMMIT, `rollback;` is always safe — the round-trip check raises and rolls back automatically if any row fails. After COMMIT, rollback requires reconstruction from a backup. The two-step shape (backfill → verify → null) is the same discipline as `SECURITY.md:203,207,211`'s audit-Phase-B template. (Closes round-1 WARN #5 + round-2 WARN #4.)
   - **Phase C** — drop plaintext column — deferred to a later PR; called out as "follow-up" in the doc.

## 5. Tests

`tests/integration/calendar/channel-token-encryption.test.ts` (new), 4 cases:

1. **Dual-write produces both columns.** Use the production helper `setupChannelForIntegration` end-to-end (with `fetch` stubbed exactly like `tests/integration/calendar/channels.test.ts` does); assert the row has `channel_token = '<plaintext>'` AND `pgp_sym_decrypt(channel_token_enc, key) = '<plaintext>'`. **Plaintext token is read out of the helper's return value** (it's the same value `mintChannelToken` produced; we capture it via the watch-fetch stub).
2. **Webhook accepts a row written through the dual-write path.** Same setup as case 1, then POST to `/api/calendar/google/webhook` with the matching `X-Goog-Channel-Token`. Expect 200, expect `last_seen_message_number` advanced.
3. **Webhook accepts a row that has ONLY plaintext `channel_token`** (simulating Phase A's "legacy unencrypted rows" case): direct INSERT/UPDATE setting `channel_token = '...', channel_token_enc = null`, then POST webhook with matching header. Expect 200. Pins the `coalesce` fallback.
4. **Webhook accepts a row that has ONLY `channel_token_enc`** (simulating Phase B's "post-backfill" case): direct UPDATE setting `channel_token = null, channel_token_enc = pgp_sym_encrypt('tok', key)`, then POST with matching header. Expect 200. Pins the decrypt-aware branch.

Bonus assertion shared by cases 2-4: writing the WRONG `X-Goog-Channel-Token` value returns silent-OK without advancing `last_seen_message_number` — the same anti-probe contract the existing webhook tests already pin.

**Round-1 BLOCKER #3 + round-2 BLOCKER #2 fix — fixture migration + production-shape assertion.** The existing webhook helper at `tests/integration/calendar/webhook.test.ts:57-68` and the renewer test at `tests/integration/calendar/channels.test.ts:318-322` stamp **only** plaintext `channel_token` via raw SQL, bypassing the dual-write. Simply adding the encrypted column to the seed is necessary but not sufficient — round-2 BLOCKER #2 identified that the renewer happy-path test asserts only on `channel_resource_id`, so a regression where `setupChannelForIntegration` drops the encrypted write would still pass (the seeded stale ciphertext would survive).

Two-part fix in the same wave:

- **Fixture seed migration.** `webhook.test.ts:57-68` adds `channel_token_enc = pgp_sym_encrypt($4, $7)` to the UPDATE (threading the calendar encryption key as a new bind param). `channels.test.ts:318-322` does the same in the renewer-seed UPDATE.
- **Production-shape assertion.** The renewer happy-path test at `channels.test.ts:337-341` currently asserts only `channel_resource_id`. Extend it to also assert that after `renewExpiringChannels`, the row's `pgp_sym_decrypt(channel_token_enc, $key)` decodes to a non-null value AND matches the row's plaintext `channel_token`. That assertion would fail if the renewer regressed to plaintext-only, regardless of the seeded ciphertext. The webhook happy-path test gets the same assertion shape on the round-trip row.

Together these convert the existing tests from "plaintext-only fixture, encrypted-column-broken would still be green" to "fixture matches production shape AND breaking the dual-write breaks the test". (Closes round-1 BLOCKER #3 + WARN #4 + round-2 BLOCKER #2.)

**Round-1 WARN #6 fix — rotation-script test.** Add one case to `tests/integration/calendar/rotate-encryption.test.ts`:

5. **`channel_token_enc` rotates correctly, mixed-rollout state is safe.** Seed three integration rows: row-A has `channel_token_enc = pgp_sym_encrypt('a', OLD)`, row-B has `channel_token_enc = pgp_sym_encrypt('b', PRIMARY)`, row-C has `channel_token_enc IS NULL` AND `channel_token = 'plaintext-c'` (the pre-Phase-B legacy shape). Run rotation. Expect row-A rewritten under PRIMARY, row-B untouched, row-C untouched (the script only rotates non-null encrypted columns). Pins both the new target AND the wrong-OLD-key abort tolerating the mixed-rollout state.

### 5.1 ARCHITECTURE.md + lib/calendar/encryption.ts updates (round-1 WARN #7)

- `ARCHITECTURE.md:204,217,381,404` — bump the calendar-encryption inventory from three columns to four.
- `lib/calendar/encryption.ts:7-10` — bump the comment-block inventory from three columns to four.

Both are doc-only single-line edits. Without them the repo lies about its at-rest surface after the migration lands.

## 6. Failure modes / rollback

Rollback is migration-safe by construction: the new column is nullable and the plaintext column is still present **during Phase A**. Reverting the PR leaves the column populated but unused.

**Once Phase B runs**, rollback to a pre-Phase-A build silently blinds the webhook on every row whose plaintext was nulled. This is called out in §4.5 as a one-way door. The runbook's preflight requires the rollback window to be closed before Phase B.

If the encrypted-column writes fail at runtime (e.g., key unset post-deploy, schema migration not applied), the §4.2 guard at the **top** of `setupChannelForIntegration` fails closed before any Google `channels.watch` call — no orphaned live Google channel, structured `config_missing` outcome surfaced to the OAuth callback / cron tick summary, the existing channel keeps working until expiry, the next renewal cycle retries.

## 7. Out of scope

- Phase B backfill SQL execution (documented in the runbook, not executed in this PR).
- Phase C drop-column migration (deferred).
- Re-encrypting `last_seen_message_number` (not a secret; freely visible in webhook payloads).
- Changing the channel-token entropy / format (currently 32-byte `randomBytes(32).toString('base64url')` from `mintChannelToken`; encryption is orthogonal).

## 8. Acceptance

- Migration 0054 lands.
- `lib/calendar/integrations.ts` three writers updated.
- `lib/calendar/channel-renewer.ts` guard placed at function top + dual-write live.
- Webhook handler reads decrypt-aware.
- Rotation script has 4 targets.
- `SECURITY.md` rotation runbook + AUDIT-SEC-4 Phase B section landed.
- `ARCHITECTURE.md` + `lib/calendar/encryption.ts` inventory bumped to four columns.
- Existing `webhook.test.ts` + `channels.test.ts` fixtures migrated to dual-write.
- `scripts/null-plaintext-channel-token.mjs` script added (R3 BLOCKER #1 closure).
- New `channel-token-encryption.test.ts` (4 cases) green.
- New rotation-script case (channel_token_enc + mixed-rollout) green.
- Full integration suite stays green.
- `npm run build` + typecheck green.
- Plan-mode `/codex-paranoia` SIGN-OFF before code; wave-mode SIGN-OFF before PR.
- PR trailer: `Codex-Paranoia: SIGN-OFF round N/3` (standalone one-PR epic per skill §1.5).
