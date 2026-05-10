# Engineering Backlog

Concrete engineering task queue. This file describes what still needs
to be implemented, not the current actual state of production.

If a task already works in code or on the server, it does not belong
here.

## Lesson learned — 2026-05-07 — close the smoke blind spot

`/api/health` instantiates its own ad-hoc `Pool` (see
`app/api/health/route.ts:44`). It does NOT exercise the shared
`getDbPool()` factory in `lib/db/pool.ts` that production routes
(cabinet, admin, slots, payments) actually use. Wave 1.1's overzealous
"refuse localhost in prod" throw fired only on the shared path; the
health probe came back green from its private pool, so post-deploy
smoke claimed everything was OK while every authenticated route was
500-ing.

Concrete follow-ups (open queue):

- ~~**Health probe should exercise the shared pool too.**~~
  **Closed 2026-05-07.** `app/api/health/route.ts` now calls
  `getDbPool()` and races a `select 1` against a 2 s timeout. A
  future regression in `resolveSslConfig` / env handling fires on
  the health probe and stops the deploy. The 2 s race preserves the
  bounded latency the old ad-hoc Pool got from `connectionTimeoutMillis`.
- **Deploy-time smoke runner.** Add a `scripts/post-deploy-smoke.sh`
  (or a workflow step) that hits 5–8 routes the operator cares about:
  `/api/health`, `/api/auth/me` (anon → expect 401), `/login`,
  `/cabinet` (anon → expect 307), `/admin/login`, `/admin/slots`
  (anon → expect 307), `/checkout/<some-tariff-slug>` (200), and
  asserts each returns the expected status. Fail loudly, don't just
  log. Wired into the autodeploy script so a 500-ing prod doesn't
  ship silently.
- ~~**CI integration tests.**~~
  **Closed 2026-05-07.** `.github/workflows/integration-tests.yml`
  runs `npm run test:integration` on every PR and every push to main.
  The Wave 1 + Wave 2 integration tests (webhook dedup, audit
  encryption, learner-archetype gate) and all auth/payment/scheduling
  integration tests are now blocking — a regression caught by a real-
  Postgres test fails CI before merge.

## Today — 2026-05-07 — after 18:06 UTC

### Re-run Codex adversarial review after usage-cap reset

The first attempt at the Codex adversarial review against PRs #45–#52
hit the per-account daily cap mid-prompt (`/tmp/codex-review.jsonl`
line 4: `You've hit your usage limit. ... try again at 6:06 PM`).
A manual self-review was done in the same session and produced 8
findings, of which fixes #1, #5, #7, #8 will land before this entry
fires (see PRs / commits chained off `ab6ac07`).

After 18:06 UTC re-run codex against the **updated** codebase:

```bash
cat /tmp/codex-review-prompt.md | \
  /Applications/Codex.app/Contents/Resources/codex exec \
    --skip-git-repo-check --json \
    | tee /tmp/codex-review-2.jsonl
```

Compare codex findings against the self-review:

- Anything codex finds that the self-review missed → file as new
  backlog entry, severity-rate, schedule.
- Anything codex confirms the self-review caught → close the loop in
  this backlog entry with a note.
- Anything codex marks as "blocked" that the self-review flagged as
  active → re-examine; one of us is wrong.

This is the loop-closure for "second mind" — the self-review has a
known conflict-of-interest (the same agent that wrote the code is
reviewing it). Codex's independent run is the validation step.

## TOMORROW — 2026-05-08 — verify and execute

### Wave 2.1 Phase B — null out plaintext PII in `payment_audit_events`

**This is the destructive completion of Wave 2.1 (encryption-at-rest).
After 24h+ of real prod traffic on the dual-write path it should be
the first thing checked next morning.**

Wave 2.1 (PR #45 squash `a094337`, shipped 2026-05-07) added
`customer_email_enc` + `client_ip_enc` bytea columns and started
dual-writing them via pgcrypto. The plaintext columns are still
populated for safe rollback during the migration window. Real
security gain (DB-dump leak useless without the key) only kicks in
once plaintext is wiped.

Pre-flight checks (must all pass before running the destructive UPDATE):

- [ ] At least 24 hours have elapsed since the Wave 2.1 deploy.
- [ ] `/api/health` reports the post-Wave SHA + `database: ok`.
- [ ] No `[audit]` warns in `journalctl -u levelchannel` over the last
      24h (an `AUDIT_ENCRYPTION_KEY` mismatch / missing key surfaces
      there).
- [ ] Re-run the verification probe and confirm zero plaintext-only
      rows AND non-zero `_enc` populated rows:

      ```sql
      select
        count(*) filter (where customer_email is not null and customer_email_enc is null) as plaintext_only_email,
        count(*) filter (where client_ip is not null and client_ip_enc is null)         as plaintext_only_ip,
        count(*) filter (where customer_email_enc is not null)                          as encrypted_email_rows,
        count(*) filter (where client_ip_enc is not null)                               as encrypted_ip_rows
      from payment_audit_events;
      ```

      Expect `plaintext_only_*` = 0 and `encrypted_*_rows` ≥ 18 (the
      backfilled count from 2026-05-07; should grow with every new
      audit event since).

- [ ] Sample roundtrip: pick three rows by hand and confirm
      `pgp_sym_decrypt(customer_email_enc, '<key>') = customer_email`.
      If any row mismatches, STOP and investigate before the
      destructive step.

- [ ] Snapshot the table before the destructive UPDATE so a rollback
      is one query away:

      ```sql
      create table payment_audit_events_pre_phase_b as
        select * from payment_audit_events;
      ```

      Drop the snapshot only after Phase B has been in prod for ≥7 days
      with no rollback need.

Destructive step (run inside a transaction, eyes on the dashboard):

```sql
begin;
update payment_audit_events
   set customer_email = null,
       client_ip      = null
 where customer_email_enc is not null
    or client_ip_enc       is not null;
-- expect a row count matching the backfilled set + new rows since.
-- if the count looks wrong, ROLLBACK; do not COMMIT.
commit;
```

Post-flight:

- [ ] `/api/admin/payments/[invoiceId]` still renders audit events
      with `customer_email` populated (reads now exclusively go
      through `pgp_sym_decrypt`).
- [ ] `/api/health` still reports `database: ok`.
- [ ] Write one smoke audit event post-update (e.g. by issuing a
      throwaway `POST /api/payments` on the mock backend) and confirm
      the new row has `customer_email IS NULL` and
      `customer_email_enc IS NOT NULL`.

Phase C (drop the now-empty plaintext columns) goes into a separate
backlog entry **once Phase B has been in prod ≥30 days with no
rollback need**. Do not chain Phase B + Phase C in the same window.

## Wave 3 — security hardening, deferred from 2026-05-07 self-review

Two findings from the self-adversarial review that ARE real but are
medium-effort design work — not safe to chain onto the in-flight
security batch. Schedule for a dedicated wave with planning + tests.

### #3 — webhook handler concurrency (LOW severity, intentional simplification)

**Closed 2026-05-07** in PR #60. `lib/payments/cloudpayments-route.ts:processSerialized` wraps lookup → handler → record on a sticky pool client inside one transaction with `pg_advisory_xact_lock(hashtext("cp:<kind>:<txId>"))`. Concurrent retries serialise: first acquires lock, runs handler, records, commits (lock auto-released); second waits at lock, then post-lock re-check finds the cached row and short-circuits.

Edge case handled: if `recordWebhookDeliveryClient` throws AFTER the handler ran (e.g. Postgres outage mid-INSERT), the path swallows the record error and returns the handler outcome directly — does NOT fall through to the legacy pipeline (which would re-run the handler and duplicate side effects). Pre-handler errors fall through to the legacy non-dedup path.

The handler's own DB writes (`markOrderPaid`, audit, allocation) happen on different pool connections — they're NOT inside the lock-holding transaction. The lock just serialises "who runs the pipeline"; per-op atomicity stays at the data layer.

3 unit tests pin the new pool.connect / BEGIN / advisory lock / COMMIT / release flow. 1 integration test (real Postgres) fires two concurrent `payHandler` requests with the same TxId in `Promise.all` and asserts: handler runs once, exactly one response carries `Webhook-Replay: true`, exactly one `webhook_deliveries` row exists, exactly one `webhook.pay.processed` audit row exists.

### #4 — `AUDIT_ENCRYPTION_KEY` rotation story (MEDIUM severity)

**Closed 2026-05-07** in PR #59 (`<TBD>`). Migration 0027 + `lib/audit/encryption.ts` `getAuditEncryptionKeyOld()` + `scripts/rotate-audit-encryption.mjs` ship the dual-key (PRIMARY + OLD) flow. Reader uses `pgp_sym_decrypt_either` SQL helper (PL/pgSQL with EXCEPTION block) — primary tried first, OLD as fallback during the rotation window. Operator runbook in `SECURITY.md § At-rest encryption — Key rotation`.

5 unit tests pin the OLD-key resolver. 4 integration tests pin the SQL contract: helper returns NULL on both-keys-wrong (no throw), the rotation flow round-trips a row from OLD to NEW with no plaintext touch, the predicate-guarded UPDATE is idempotent (already-PRIMARY rows are skipped), the reader logs warn on invalid OLD without crashing.

## Wave 8 — Codex infra audit, 2026-05-08

Six findings against the live infra surface. Four closed (PR #80 + #82); two stay open as documented design / multi-day refactors.

### #1 MEDIUM — uptime-probe.yml leaked raw prod failure body to PUBLIC issues (closed PR #80)
Probe wrote up to 1500 chars of raw response body into GitHub issues. Repo is public; 5xx HTML / stack traces / upstream errors landed publicly. Fixed: hash body in bash, surface only sha256-prefix + length to issue.

### #2 MEDIUM-LOW — CSP unsafe-inline (Wave 11 CLOSED 2026-05-09 — full nonce-based CSP)
**Status:** closed via PRs #91/#92/#94/#95/#99/#100. Final CSP shape: both `script-src` and `style-src` are strict (`'self'` + nonce only, no `'unsafe-inline'`); `style-src-attr 'unsafe-inline'` covers ~700+ inline JSX `style={...}` attrs. Dead `fonts.googleapis.com`/`fonts.gstatic.com` allowlist entries dropped. The unblocking trick (per closed upstream vercel/next.js#43743): a Server Component must read `headers().get('x-nonce')` to put the page into dynamic-render mode, which activates Next.js's auto-stamping of `nonce=` on framework-emitted RSC hydration payload scripts. Reading `headers()` in `app/layout.tsx` does this; all pages now render dynamically (acceptable trade for our QPS). Verified live on prod: 5 inline RSC scripts on `/` all carry the response nonce; browser would refuse any injected inline script lacking it. Issue [#88](https://github.com/Igotsty1e/levelchannel/issues/88) closed.

### #3 LOW-MEDIUM — `/api/health` fingerprinting (closed PR #80)
Anonymous now sees `{status, version}` only. Detailed shape requires `X-Health-Detail` header matching `HEALTH_DETAIL_SECRET` env. Operator must set the secret (repo + prod env) for the uptime probe to get the full shape.

### #4 LOW — `X-Powered-By: Next.js` (closed PR #80)
`poweredByHeader: false` in next.config.js. nginx Server banner (`nginx/1.24.0 Ubuntu`) is operator-side: add `server_tokens off;` in `/etc/nginx/nginx.conf` http block + reload nginx.

### #5 LOW — GitHub Actions pinning (closed PR #80)
All 6 workflow files; `actions/checkout@v4` / `setup-node@v4` / `github-script@v7` pinned to commit SHAs. Comments retain the tag for diffing future updates.

### #6 LOW — systemd unit sandboxing (closed: 14 directives active, MDWE permanently incompatible with V8)

**Repo state (2026-05-09):** all 5 maintenance units (4 originals + new auth-flow-alert from Wave 5) carry 13 sandboxing directives:

- `NoNewPrivileges`
- `PrivateTmp`
- `ProtectSystem=strict`
- `ProtectHome`
- `ProtectKernelTunables` / `ProtectKernelModules` / `ProtectKernelLogs`
- `ProtectControlGroups`
- `RestrictSUIDSGID`
- `RestrictNamespaces`
- `RestrictRealtime`
- `LockPersonality`
- `SystemCallArchitectures=native`
- `SystemCallFilter=@system-service pkey_alloc pkey_mprotect pkey_free` + the `~@privileged @resources @debug @mount @cpu-emulation @obsolete` exclude

**Only 1 directive from the original PR #82 sandbox set is permanently absent: `MemoryDenyWriteExecute=true`.** V8 JIT requires writable+executable memory pages; MDWE blocks `mprotect(PROT_EXEC)` and kills Node. This is documented in `man systemd.exec` as incompatible with any JIT runtime.

**SystemCallFilter restored 2026-05-09 (closes Issue #86):** the syscall that ate Node was `pkey_alloc` (#330 on x86_64). V8 in Node 20 calls `pkey_alloc` / `pkey_mprotect` / `pkey_free` to set up Memory Protection Keys (Intel MPK / PKU) — a JIT-cache-hardening feature. Ubuntu's systemd 255 `@system-service` group does NOT include the pkey family, so vanilla `@system-service` killed V8 startup with SIGSYS (status 31). The fix is a single `SystemCallFilter=` line that adds the three pkey calls explicitly to the allowlist.

**Diagnostic procedure documented inline in `levelchannel-stale-orders.service`** so the next agent (or me, in 6 months) can repeat it for any future syscall addition. Briefly: `systemd-run` transient unit with the exact filter set, run the failing target, then `journalctl -k --since '1 minute ago' | grep audit | grep syscall` decodes the syscall number via the Linux x86_64 syscall table.

**Live-prod incident archive (2026-05-08):** PRs #82, #84 — both deployed and reverted in <2 min each due to the same SIGSYS class (later proved to be pkey_alloc). PR #85 shipped a 12-directive set without MDWE / SystemCallFilter as the pragmatic interim. PR #94 renamed the convention. PR #95 tightened style-src in CSP. Auth-flow-alert (#96) shipped on the same 12-directive interim profile; PR for the 13-directive restore (this) updates all 5 units. Total prod-degraded window: ~3 min combined.

## Wave 9 — Codex governance audit, 2026-05-08

Four findings against repo settings. All closed, but some via repo-admin actions (gh API), not git commits.

### #1 MEDIUM — branch protection too weak (closed via gh API)
Required checks expanded from `[npm run build, Verify Legal-Pipeline-Verified trailer]` to all 4: also `npm run test:integration` + `public-surface`. `strict: true` (PR must be up-to-date with main). `allow_force_pushes: false`, `allow_deletions: false`, `required_conversation_resolution: true`. Self-approval (require_approving_review_count > 0) NOT enabled — would block every solo-author PR. Reopen when teammate joins.

### #2 MEDIUM-LOW — no CODEOWNERS (closed PR #81)
`.github/CODEOWNERS` added. All security-sensitive paths owned by @Igotsty1e. Documents the trust surface map. `require_code_owner_reviews` stays false until a teammate joins.

### #3 MEDIUM-LOW — GitHub Advanced Security disabled (closed via gh API)
Enabled: `secret_scanning`, `secret_scanning_push_protection`, `dependabot_security_updates`. Two paid GHAS features stayed disabled (validity checks, non-provider patterns) — not available on public-repo free tier without an org.

### #4 LOW-MEDIUM — security workflows advisory not enforcing (implicitly closed by #1)
Branch protection now requires the integration suite + public-surface check, so they're enforcing not advisory. Same fix as #1.

## Wave 12 — Billing wave (prepay + postpay), 2026-05-10

7 PRs merged on main on 2026-05-10 after 9-round Codex paranoia loop. Migrations 0032 (legal-versioning sister wave), 0033 (billing schema), 0034 (audit enum widening). Feature flag `BILLING_WAVE_ACTIVE=false` on prod by default — flip after the operator runs the legal-rf cascade on PR 5's oferta draft (done; QA verdict GO 2026-05-10). Implementation log: `docs/plans/prepay-postpay-billing.md` v9 (915 lines, Codex SIGN-OFF). Cross-project retro: `~/Obsidian/Brain/wiki/synthesis/billing-wave-execution-2026-05-10.md`.

### Open follow-ups (non-blocking for flip)

- **BookConfirmModal billing-preview banner.** When a learner is about to book a packaged slot, render a one-line banner inside the existing confirm modal: «Будет списано 1 занятие из пакета "X" (осталось N)» if `BILLING_WAVE_ACTIVE` and the learner has an active package matching the slot duration; «Постоплата: счёт будет выставлен после занятия» if `postpaid_allowed=true`; «Слот по тарифу X ₽» as the existing single-payment fallback. Source: `derivePackageRemaining` + `accountHasPostpaidAllowed` + `slot.tariff_id` lookup. ~3-4h. The current modal already shows the price and does not lie, but it does not preview which billing path will fire — first-time pakage users will be confused.

- **`/api/admin/packages` PATCH (edit existing catalog rows).** Today `POST /api/admin/packages` creates rows; the `lesson_packages_amount_immutable` DB trigger refuses any UPDATE that touches `amount_kopecks`, `lesson_count`, or `lesson_duration_minutes` (intentional — protects already-purchased packages). Open work: a PATCH endpoint that allows editing only the metadata fields (`title`, `is_active`) plus a soft-delete via `is_active=false`. The hot-purchase contract stays intact because the trigger refuses the monetary fields by design. ~1-2h.

- **Refund-flow Phase 7.** The `slotIsPaidByAllocations` SUM CASE filter is already wired for the future `payment_allocation_reversals` join; today refunds happen out-of-band via the CloudPayments dashboard and the operator manually flips `payment_orders.status='refunded'`. Phase 7 ships when refund volume justifies a clean flow: new table `payment_allocation_reversals` (allocation_id, refunded_at, refunded_kopecks, reason), an admin endpoint that books the reversal AND restores the package consumption (if the underlying allocation was a package consumption), and a cabinet-side surface that surfaces refund-pending state. The `package_consumptions.restored_at` column already exists for this; the wiring is what's missing.

- **Email notifications for package grant outcomes.** `package.grant.failed` and `package.grant.succeeded` audit events fire today with the 7 enumerated semantic reasons (`amount_mismatch`, `email_mismatch`, `account_not_found`, `package_not_found`, `package_inactive`, `cross_account_attempt`, `idempotent_replay`). No operator notification fires on `failed` — they live in the audit log only. Add a Resend dispatch sibling to `sendOperatorPaymentFailureNotification` that fires on `package.grant.failed` (reason ≠ `idempotent_replay`); silent skip when `OPERATOR_NOTIFY_EMAIL` is empty. Same best-effort pattern (try/catch around dispatch). ~30 min.

- **Legal-versioning admin UI + public history surface.** Migration 0032 ships `legal_document_versions` with v1 seed rows for `terms`, `privacy`, `consent`. `getCurrentLegalVersion()` resolves "what's live"; `account_consents.legal_document_version_id` pins which version a consent was given against. Today there's NO admin UI to publish v2 (would need to be done via direct SQL) and NO public surface for users to read the historical text they consented to. Open work: (a) `/admin/legal/versions` list + create-new-version form + activate flow (only one row per slug can be `is_active=true`); (b) public `/offer/v/[id]` / `/privacy/v/[id]` / `/consent/personal-data/v/[id]` rendering the historical body. ~1-2 days. Blocking: would need a markdown-renderer dependency choice (or store as HTML and trust the editor).

- **Full-body markdown backfill for legal versions.** The v1 seed in migration 0032 stores a placeholder body string ("См. /offer текущая версия"). Real bodies live as JSX in `app/offer/page.tsx` / `app/privacy/page.tsx` / `app/consent/personal-data/page.tsx`. Backfill should extract the JSX text into markdown, store in `legal_document_versions.body_markdown`, and have the public pages render from the row at request time. Ties into the previous item — do them in the same wave. ~half a day.

- **Monthly billing aggregator (admin debt summary).** `listAccountPostpaidDebt` returns per-account unpaid postpaid lessons. The admin page renders this per-account but there's no aggregate view ("показать всех клиентов с долгом > X ₽" / "выгрузить в CSV"). For early postpay rollout (admin grants postpay manually to known-good clients), the per-account view is enough. Add when postpay scales beyond ~10 accounts.

- **Per-PR Codex adversarial code review (skipped this wave).** Wave A calendar wave did per-PR Codex review; this wave deferred that to a single end-of-wave sweep (still open). Run `cat /tmp/billing-wave-review-prompt.md | /Applications/Codex.app/Contents/Resources/codex exec --skip-git-repo-check --json | tee /tmp/billing-wave-review.jsonl` with the prompt covering PRs #117–#123 against the design doc invariants. Risk: a code-level bug not caught by 9 rounds of design-doc paranoia + 229/229 integration tests would need a follow-up PR. Mitigation: DB triggers + atomic SQL + the dual-source ownership check make egregious bugs hard. Calendar trigger: ≈2026-05-13 (3-day soak buffer).

## Wave 10 — Codex legal/compliance audit, 2026-05-08

Four findings against public legal surface. One closed in code (#5); three need operator/lawyer involvement.

### #1 HIGH — RKN personal-data operator notification (filed by IP 2026-05-08, awaiting registry number for citation)
**Status:** filed by Ivan on 2026-05-08. **Remaining work:** when РКН confirms registration, capture (a) date of registry inclusion, (b) operator's registry number (номер в реестре операторов ПДн). Add a one-line citation to `app/privacy/page.tsx` §1 («Оператор включён в реестр операторов, осуществляющих обработку персональных данных, № {N} от {дата}, под номером {N}»). Single-file ~3-line PR, low risk, no need for a fresh legal-rf cascade — narrow attributive update like Wave 10 #2.

### #2 HIGH — IP disclosure missing required fields (closed PR #87)
**Status:** closed 2026-05-08. **What landed:** 3 new env-driven fields (`NEXT_PUBLIC_LEGAL_OPERATOR_OGRN`, `NEXT_PUBLIC_LEGAL_OPERATOR_REG_AUTHORITY`, `NEXT_PUBLIC_LEGAL_OPERATOR_CLAIMS_ADDRESS`) wired into 4 public surfaces: `app/offer/page.tsx` §11 grid, `app/privacy/page.tsx` §1 + claims-mail line, `app/consent/personal-data/page.tsx` §1 + claims-mail line, `components/home/home-page-client.tsx` footer. Routed through `legal-rf-router` (2026-05-08): narrow attributive disclosure addition per ст. 9 ЗоЗПП + 152-ФЗ ст. 5 ч. 4. Verified live on prod after autodeploy. Backlog: Wave 10 #2b — рассмотреть отдельный почтовый адрес для претензий взамен домашнего, если возрастёт нагрузка от B2C-обращений.

### #3 HIGH — refund/cancellation terms too aggressive (closed PR ?)
**Status:** closed 2026-05-08. **What landed:** rewrite of `app/offer/page.tsx` §5 and §8. Removed null-and-void provisions per ст. 16 ЗоЗПП («занятие считается проведённым, оплата не возвращается» при late-cancel). Replaced with ст. 32-compliant wording: (a) completed lesson — non-refundable, (b) ≥24h cancel — credit forward or §8 refund, (c) late-cancel <24h — Исполнитель holds price as «согласованный сторонами размер фактически понесённых расходов» (defensive drafting per legal-rf-qa) with explicit safe-harbours (illness with med doc, force majeure, slot resold), (d) Исполнитель-side cancel — full refund within 10 days. Refund formula for packages: oplata ÷ N − used lessons − late-cancel withholdings. Cited ст. 32 + ст. 31 ЗоЗПП. Routed through full pipeline: `legal-rf-router → legal-rf-private-client → legal-rf-qa (2026-05-08)`. QA flagged 2 critical issues (wrong norm citation ст. 22 → ст. 31; ambiguous «согласованная цена» — fixed via explicit formula). Verified live on prod after autodeploy.

### #5 MEDIUM — CloudPayments script global load (closed PR #80)
Was loaded from `app/layout.tsx` on every page. Moved to `/pay` and `/checkout/[tariffSlug]` only.

## Wave 7 — Codex pass on Wave-6.1-Phase-1.5 surface, 2026-05-08

Codex left a fresh handoff in `~/.team/activity.jsonl` on 2026-05-08 04:13Z. Five findings against the post-Phase-1.5 state. Four closed; one remains as a documented design decision rather than a code fix.

### #1 HIGH — slot payment-binding bypass (closed PR #78)

`/api/payments` accepted any UUID as `slotId`. Webhook on `pay` bound the invoice via `payment_allocations` without checking ownership / tariff / amount. Bypass: a learner could pay 1₽ with another learner's slotId and operator UI would show their invoice attached to a slot they didn't own.

**Closed:** `lib/payments/slot-binding.ts` — request-time gate (session + ownership + status='booked' + tariff match within 1-kopeck tolerance). Anonymous callers can't pass slotId.

### #1b HIGH defence-in-depth — webhook-side allocation guard (closing here)

The PR #78 fix gates the request path. The webhook is a different trust boundary (HMAC, no session) — a future regression that re-introduces an unguarded path to set `order.metadata.slotId` would still produce poisoned allocations. So before `recordAllocation`, the webhook handler now looks up the customer's account by email and re-runs `validatePaymentSlotBinding`. On mismatch: skip the insert + log loud warning (does NOT block the webhook ack — order stays paid, allocation just doesn't land).

### #2 MEDIUM — `/api/slots/available` filter override + DTO leak (closed PR #78)

Authenticated learner could pass `?teacher=<uuid>` to override their assigned-teacher filter, AND received the full LessonSlot DTO with `teacher_email` + internal account IDs.

**Closed:** session forces `teacherFilter = session.account.assignedTeacherId`; both anon + authed learner project to public DTO via `toPublicSlot`.

### #3 MEDIUM-LOW — teacher-role enforcement on slot/account assignments (closing here)

`assigned_teacher_id` and `slot.teacher_account_id` were not validated against the actual `teacher` role — admin route shape-checked the UUID and trusted whatever was passed.

**Closed:**
  - `lib/auth/accounts.ts:setAssignedTeacher` throws `AssignedTeacherRoleError` when target lacks the `teacher` role; `app/api/admin/accounts/[id]/teacher/route.ts` returns 400 with a translated message.
  - `lib/scheduling/slots.ts:createSlot` and `bulkCreateSlots` throw `SlotTeacherRoleError`; both admin routes return 400.
  - The data-layer `bookSlot` self-booking invariant (Codex #5 from 2026-05-07) is preserved as a final defence.

### #4 LOW — rate-limit PG-fallback debt (documented, not closed in code)

`lib/security/rate-limit.ts` falls back to in-memory buckets when `takePostgresBucket` fails. Memory buckets don't share state across processes, so:

  - **Single-instance** (today): fail-open on PG outage = app keeps working with per-process rate limiting. Acceptable trade-off — losing rate limits during a PG outage is preferable to 503-ing every request.
  - **Multi-instance** (future): an attacker who can specifically take down Postgres bypasses the global per-IP cap because each app process has its own counter. Mitigation: nginx `limit_req` (already configured) is the last line. Real fix would require a process-shared cache (Redis) — out of scope until multi-instance becomes the deploy shape.

This was reviewed and the current fail-open behaviour was retained as the right policy for the current deploy topology. No code change in this batch. Re-open the question when the deploy topology changes (multi-instance, Render, k8s, etc.).

## Wave 6 — Codex pass on older app surface, 2026-05-07

Codex adversarial review of the OLDER surface (out of scope for the earlier review which covered only the recent security batch). Six findings; one CRITICAL closed in PR #63, four still open below, one duplicate of Wave 4 #4b (XFF). For each: severity, bypass shape, file:line, fix sketch. Schedule per severity; #3 + #5 are both 1-2h fixes worth picking off next.

### #3 HIGH — learner can cancel a terminal slot or skip the 24h rule on a race boundary (closed PR #64)

**Status:** closed 2026-05-07. **What landed:** new `cancelLearnerSlot` in `lib/scheduling/slots.ts:943` folds ownership + `status='booked'` + `start_at - now() >= interval '24 hours'` into a single atomic UPDATE WHERE clause. Route `app/api/slots/[id]/cancel/route.ts:31` delegates and disambiguates verdict (`not_found` / `not_owner` / `already_terminal` / `too_late_to_cancel`) by re-reading the row only when 0 rows updated — the disambiguation is for UX, the authoritative decision lives in the UPDATE. Tests: `tests/scheduling/cancel-route-disambiguation.test.ts` covers all 4 verdicts; `tests/integration/scheduling/lifecycle.test.ts` covers the 24h boundary live against Postgres.

### #4 HIGH — `invoiceId` is treated as a capability-secret (Phase 2 closed PR #77; Phase 3 time-based follow-up)

**Status:** Phase 1 + 1.5 + 2 closed; Phase 3 deferred until Phase 2 has soaked 7+ days.

**What landed (PR #77, 2026-05-07):**
- Migration 0030 — `payment_orders.receipt_token_hash` (nullable, partial unique index).
- `createOrder` mints 32-byte token (`crypto.randomBytes(32).toString('base64url')`), stores sha256 hash, returns plain token in the `POST /api/payments` response.
- Gate `lib/payments/receipt-token-gate.ts:evaluateReceiptGate` — accepts `?token=<plain>` query param or `X-Receipt-Token` header, hashes presented value, compares with `crypto.timingSafeEqual` against the stored hash. 24h legacy-grace window for pre-wave NULL-token rows.
- Wired into all 3 capability routes: `app/api/payments/[invoiceId]/route.ts:46`, `app/api/payments/[invoiceId]/cancel/route.ts`, `app/api/payments/[invoiceId]/stream/route.ts`.
- UI threading: `components/payments/pricing-section.tsx` (redirect carries `?token=<encoded>`, poll/SSE/cancel send `X-Receipt-Token`); `app/thank-you/page.tsx` reads the URL token once, keeps it in component state for subsequent fetches.
- Tests: `tests/payments/receipt-token-gate.test.ts` covers the four reject reasons + happy path; integration suite asserts the redirect-with-token works AND that curl-without-token on an aged order returns 401.

**Phase 3 — drop legacy grace window (open).** When Phase 2 has been in prod for ≥7 days without a rollback need, drop the 24h `LEGACY_GRACE_MS` branch in `evaluateReceiptGate`. Pre-wave orders become unreachable via these routes (intentional end-state — operators have audit-log access, customers got their receipt email). One-line code change + drop the legacy test case. Calendar trigger: ≈2026-05-15.

### #5 MEDIUM — self-booking not enforced at the data layer (closed PRs #65 + #79)

**Status:** closed. **What landed:**
- **PR #65** — DB invariant: `bookSlot()` UPDATE adds `and teacher_account_id <> $2` in the WHERE (`lib/scheduling/slots.ts:861`). Post-update sniff distinguishes `self_booking_blocked` so the route returns a clean 400 instead of a generic conflict.
- **PR #79** — Role enforcement at the admin route layer: `setAssignedTeacher` (`lib/auth/accounts.ts`) throws `AssignedTeacherRoleError` when the target lacks the `teacher` role; `createSlot` / `bulkCreateSlots` (`lib/scheduling/slots.ts`) throw `SlotTeacherRoleError` when the target isn't a teacher; the corresponding admin routes return 400 with translated messages.
- All 3 layers from the original Codex fix sketch landed; the DB invariant is the last line.

## Wave 5 — auth observability

### Auth audit log + slow-brute-force alerting (Phase 1 + 2 shipped earlier; Phase 3 shipping now)

**Status:** Phase 1 (schema) + Phase 2 (recorder + 6 routes wired) shipped before this session — verified by reading the live code. Phase 3 (alerting) shipping now.

**What's already in code (pre-this-session):**
- Migration `0028_auth_audit_events.sql` — separate table from `payment_audit_events` (domain separation rationale documented in the migration header). Indexes for `(email_hash, time)`, `(client_ip, time)`, `(event_type, time)`, `(account_id, time)`.
- `lib/audit/auth-events.ts` — recorder, sibling of `lib/audit/payment-events.ts`. Best-effort, swallows failures so auth flow is never blocked by an audit-table outage.
- 6 routes wired: `login`, `register`, `reset-request`, `reset-confirm`, `verify`, `logout`. Failed login attempts record `ip` + `userAgent` + email-hash (HMAC-SHA256 keyed by `AUTH_RATE_LIMIT_SECRET`) — never raw email, per privacy carve-out in the migration header.
- Retention: 180 days, folded into the existing daily `scripts/db-retention-cleanup.mjs` cleanup.
- Unit tests: `tests/audit/auth-events.test.ts`.

**What ships now (Phase 3):**
- `scripts/auth-flow-alert.mjs` — sibling of `scripts/webhook-flow-alert.mjs`. Aggregates `auth.login.failed` rows in the last 60 min, alerts when any IP exceeds 50 failures or any email_hash exceeds 20 failures.
- `scripts/systemd/levelchannel-auth-flow-alert.{service,timer}` — every 30 min, offset 7 min from boot to stagger DB load with the webhook-flow alert (which fires at 5 min).
- Unit tests for `decideVerdict`: `tests/audit/auth-flow-alert.test.ts` (6/6 pass).
- Sandboxing: 12-directive set per Wave 11 confirmed-compatible profile.

**Operator-side activation (post-merge):** scp the new unit + timer to `/etc/systemd/system/`, `daemon-reload`, `enable --now levelchannel-auth-flow-alert.timer`. Same pattern as the webhook-flow alert.

## Wave 4 — security hardening from Codex review 2026-05-07

Codex adversarial pass after the Wave 3 batch landed found six real issues my self-review missed (0/6 catch-rate vs 6/6 Codex). Five of the six were closed in the same-day PR (`.local` mDNS TLS bypass, audit-encryption scripts bypassing the TLS gate, rotate-script wrong-OLD-key false-success, missing-TransactionId webhook replay, `pool.connect()` no acquisition timeout, anonymous slot DTO leak). One stays open here because it needs operator-side coordination, not just a code change:

### #4b — `getClientIp()` trusts raw `x-forwarded-for` first hop (closed — code + nginx prereq verified 2026-05-09)

**Status:** closed. Code-side fix landed in an earlier commit; today's audit verified the nginx prerequisite is in place.

**What's in code (`lib/security/request.ts:33-63`):** `getClientIp` now reads only `x-real-ip` (or `cf-connecting-ip` as secondary if Cloudflare is ever placed in front; today there isn't one). `x-forwarded-for` parsing dropped entirely. Inline comment documents the rationale: nginx's `proxy_set_header X-Real-IP $remote_addr` always **overwrites** whatever the client sent (because `proxy_set_header` is overwriting, unlike `$proxy_add_x_forwarded_for` which appends).

**What's on nginx (verified 2026-05-09 via `grep proxy_set_header /etc/nginx/sites-available/levelchannel`):**
```
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```
The `X-Real-IP` value the app sees is bound to the actual TCP-connected address, not anything the client controls. The XFF chain still appends but the app no longer consumes it.

**Net:** per-IP rate-limit buckets (auth, webhooks) are now keyed by the real socket IP. Per-XFF-rotation bypass closed.

## Cabinet expansion (next phases)

Guest checkout is not touched: subsequent phases are additive.

Already closed and not in the backlog:

- Phase 0 stabilization
- Phase 1A auth foundation
- Phase 1B auth API routes
- Phase 2 auth UI
- Phase 3 profiles + admin pricing — **closed 2026-05-04**. Migrations 0017 / 0018 / 0019. Cabinet got profile editor, consent withdrawal, and 30-day-grace account deletion. Operator-side admin surface at `/admin` (dashboard, accounts list / detail, pricing CRUD) gated by `requireAdminRole`. Bootstrap via `scripts/grant-admin.mjs`. The retention cleanup job picks up rows where `scheduled_purge_at <= now()` and anonymizes them. Public `/pay` left free-amount in this wave; catalog wiring is in this same backlog under "Cabinet Phase 6 deferments". See `docs/plans/phase-3-profiles-admin-pricing.md`.
- Phase 4 scheduling — **closed 2026-05-04**. Migration 0020 (`lesson_slots`). Operator-managed slot model with one row per concrete `start_at`. Admin surface at `/admin/slots` covers single-slot create + bulk recurring with weekday/weeks/skip-dates preview-deselect-commit + per-row cancel/delete + book-as-operator. Cabinet «Мои уроки» + «Записаться» sections in `/cabinet`. Booking gated by `requireAuthenticatedAndVerified` (D2). Atomic UPDATE-with-`status='open'` re-assert prevents concurrent-book races (loser → 409). Per-row `events JSONB` event log; no separate audit table. Payment-free in this wave (Phase 6 wires payment); 24-hour cancellation rule deferred to Phase 5. See `docs/plans/phase-4-scheduling.md`.
- Phase 5 lesson lifecycle + 24h rule — **closed 2026-05-04**. Migration 0021 extended the `lesson_slots.status` enum with `completed`, `no_show_learner`, `no_show_teacher` and added a nullable `marked_at` column. Learner cancel route now refuses with 403 + `error: 'too_late_to_cancel'` when `start_at - now() < 24h`; admin / operator routes bypass the gate (override). New `POST /api/admin/slots/[id]/mark` lets the operator stamp lifecycle on past-booked rows. New daily systemd timer `levelchannel-auto-complete-slots` (03:30 UTC) flips still-`booked` rows whose `start_at + duration_minutes` has elapsed to `completed`. Cabinet UI splits «Мои уроки» into Предстоящие / Прошедшие and shows the lifecycle status. Admin `/admin/slots` rows get «Прошёл» / «Не пришёл (учащийся)» / «Не пришёл (учитель)» buttons on past-booked rows; status filter gains «проведённые» / «не пришли». See `docs/plans/phase-5-lifecycle-24h-rule.md`.
- Phase 6 cabinet payment (tariff-bound checkout) — **closed 2026-05-04**. Migration 0022 added `payment_allocations` (kind enum starts with `lesson_slot`, forward-compatible with packages later) and a nullable `lesson_slots.tariff_id` FK to `pricing_tariffs`. New public surface `/checkout/[tariffSlug]` runs in parallel with the existing `/pay` (free-amount) — `/pay` stays bit-for-bit unchanged. Optional `?slot=<uuid>` binds the resulting paid invoice to a `lesson_slot` via `payment_allocations` written from the CloudPayments `webhook.pay.processed` handler. Cabinet «Мои уроки» surfaces «оплатить XXXX ₽» / «оплачено» pills next to booked future slots whose `tariff_id` is non-null. Admin `/admin/slots` create + bulk forms get an optional «Тариф» dropdown; the slot list shows the bound tariff slug + amount. Refund / credit on cancellation is **deliberately parked**: a learner cancelling a paid booking leaves `payment_orders` + `payment_allocations` rows in place; operator handles refund manually via the CloudPayments dashboard for now, until refund volume justifies a clean refund flow (Phase 7). Saved-card 1-click checkout still scoped to free-amount `/pay`. See `docs/plans/phase-6-cabinet-payment.md`.

Open high-level queue:

- ~~**Calendar / grid UI for slots**~~: **Wave A shipped 2026-05-08** (read-only contract). PR1 #106 backend (migration 0031 + `/api/slots/calendar` endpoint + 3 CHECK constraints + role-precedence DTO union), PR2 #107 component skeleton (`<SlotCalendar />` + Grid/Toolbar/MobileFallback/SlotBlock), PR3 #108 operator surface (calendar tab in `/admin/slots` + `<SlotCancelModal>`), PR4 #109 teacher surface (`/teacher` full-week + cabinet 3-slot preview). Plan: `docs/plans/calendar-ui.md`. **Wave A leftovers (open):** PR3b — drag-paint + drag-move on operator calendar (deferred to keep PR3 momentum; ~4-6h). **Wave B (open, future):** learner-side calendar picker against `/api/slots/calendar` with the redacted DTO branches (`booked-other`, `past-redacted`). **Wave C (open, future):** teacher self-create (mutating endpoints + UI; needs design doc first per the existing rule).
- Phase 7 (when needed): refund / credit on cancellation; sunset `/pay` free-amount → tariff picker once the new flow is proven

Before starting any of these, write a fresh in-repo design doc. Code,
owner docs, and git history beat old chat outputs.

## P0

### Production reliability

- ~~wire up uptime / failure alerting on the app~~: **closed 2026-04-29**. GitHub Actions cron `*/5 *` pings `/api/health` and opens / closes an issue tagged `uptime-incident`. Runbook: `OPERATIONS.md §9`. Detection latency ~5–15 min (cron + GH Actions schedule jitter). For sub-minute precision, layer in BetterStack / Healthchecks.io.
- ~~add failure alerting on the **webhook contour** (CloudPayments check / pay / fail)~~: **shipped 2026-04-29 (workflow side; activation requires server-side patch)**. `scripts/webhook-flow-alert.mjs` plus systemd unit / timer (`scripts/systemd/`); every 30 minutes it reads `payment_audit_events` over the last hour and emails via Resend when `(paid + fail) / created < 0.3` with ≥5 created orders. Activation lives in the private operations runbook. Details: `OPERATIONS.md`.
- ~~signal failed git-based deploy or stuck `levelchannel-autodeploy.timer`~~: **shipped 2026-04-29 (workflow side; activation requires server-side patch)**. `.github/workflows/deploy-freshness.yml` compares `main` SHA with `version` from `/api/health` every 30 minutes; opens / closes a `deploy-stale` issue. Activation lives in the private operations runbook. Details: `OPERATIONS.md`.

### Security and payment safety

- ~~move the app-level rate limiter into a shared backend store for a multi-instance future~~: **closed 2026-05-04**. Migration 0016 added `rate_limit_buckets` (bucket_key PK, count, reset_at). `lib/security/rate-limit.ts` rewritten to a Postgres-backed atomic upsert with an in-memory fallback when `DATABASE_URL` is unset or transiently unreachable (warn-and-fall-through, nginx `limit_req` is the last line either way). `enforceRateLimit` is now async; the 21 call sites in `app/api/**` were updated. Cleanup folded into the existing daily systemd timer (`scripts/db-retention-cleanup.mjs`, rows with `reset_at < now() - 1h`). Covered by an in-memory unit suite plus a real-Postgres integration suite under `tests/integration/security/rate-limit.test.ts`.
- ~~add a separate audit log for critical payment transitions~~: **closed 2026-04-29**. Migration 0012 plus `lib/audit/payment-events.ts`; 10 final-state events written from 7 route handlers (`order.created` / `cancelled`, `mock.confirmed`, `webhook.pay.processed`, `webhook.fail.received`, `charge_token.succeeded` / `requires_3ds` / `declined`, `threeds.callback.received` / `confirmed` / `declined`). Best-effort recorder, retention 3 years, full PII under 152-FZ legitimate interest. Docs: `ARCHITECTURE.md` Audit log section, `SECURITY.md` Audit log section, `OPERATIONS.md §5` psql queries.
- ~~add pre-validation phases to audit~~: **closed 2026-04-29**. Migration 0014 plus `lib/payments/cloudpayments-route.ts` refactor; the wrapper now takes `kind: 'check'|'pay'|'fail'` and writes phase-0 (`webhook.<kind>.received`) after parse and phase-1 (`webhook.<kind>.declined` / `webhook.pay.validation_failed`) on validation failure. The old `webhook.fail.received` (semantically a finalize event) was renamed to `webhook.fail.processed`; live data was migrated in the same transaction.
- ~~add `charge_token.attempted`~~: **NOT planned**. `chargeWithSavedCard` creates `invoice_id` inside the function; an `attempted` event has no clean attach point (FK constraint to payment_orders). The outcome events (`succeeded` / `requires_3ds` / `declined`) cover the lifecycle.
- **`charge_token.error` (deferred)**: the sync-error path needs the `chargeWithSavedCard` return type to surface `invoice_id` even on throw. The route's catch currently sends `console.warn` to journald (see `app/api/payments/charge-token/route.ts`). Close it when a real incident with lost context shows up.
- ~~consolidate domain-specific Postgres pools into a shared `lib/db/pool.ts`~~: **closed 2026-04-29**. `lib/db/pool.ts`: `getDbPool()` (throws on missing `DATABASE_URL`) plus `getDbPoolOrNull()` (silent, for audit best-effort). All 5 domain getters (payments / auth / idempotency / telemetry / audit) delegate to the shared singleton; public API at call sites is unchanged. Connection footprint: 5×10=50 max before, `DATABASE_POOL_MAX` (default 10) now.
- ~~set up cron pruning for `payment_audit_events`~~: **shipped 2026-04-29 (workflow side; activation requires SSH)**. `scripts/db-retention-cleanup.mjs` plus systemd unit / timer (04:30 daily) deletes `payment_audit_events > 3 years` and expired rows from `account_sessions` / `email_verifications` / `password_resets` / `idempotency_records`. Activation details live in the private operations runbook.

## P1

### Payment domain

- ~~move from a polling-only model to a more reliable way to deliver the final status to the client~~: **shipped 2026-05-04**. SSE endpoint `/api/payments/[invoiceId]/stream` (`app/api/payments/[invoiceId]/stream/route.ts`) backed by an in-process `lib/payments/status-bus.ts` (Node `EventEmitter`). `markOrderPaid` / `markOrderFailed` / `markOrderCancelled` emit only on real transitions (the existing `payment.paid_duplicate` / `fail_duplicate` / `cancel_duplicate` event names short-circuit the emit). Browser `EventSource` in `components/payments/pricing-section.tsx` plus a slow 10-second poll as belt-and-suspenders fallback for ad-blockers / corporate proxies that strip `text/event-stream`. Heartbeat `:hb` every 25 s, hard cap 5 min per connection (EventSource auto-reconnects). `X-Accel-Buffering: no` so nginx flushes byte-by-byte. Multi-instance future: swap the bus for a PG `LISTEN/NOTIFY` wrapper without touching the route shape.
- ~~add lifecycle cleanup for old pending orders~~: **shipped 2026-05-04 (workflow side; activation requires server-side patch)**. `scripts/cancel-stale-orders.mjs` plus systemd unit / timer (`scripts/systemd/`); hourly at minute 7 it finds rows with `status='pending'` and `created_at < now() - <threshold>` (default 60 min, floor 30 min via `STALE_ORDER_THRESHOLD_MINUTES`), runs a per-row tx that flips status to `cancelled`, appends a `payment.cancelled` event with reason `stale_pending_timeout`, and writes a matching `order.cancelled` audit row with `actor='system'`. 4 integration tests cover stale cancel / fresh skip / terminal-status untouched / threshold-floor. Activation lives in the private operations runbook.
- ~~decide whether client-visible reconciliation or an operator-side payment list is needed~~: **operator list shipped 2026-05-04**. `/admin/payments` (paginated list with status/email filters) + `/admin/payments/[invoiceId]` (detail with order, payment_audit_events trail, payment_allocations + linked lesson_slots, internal events log). Driven by `lib/payments/admin-list.ts:listPaymentOrdersForAdmin`. Client-visible reconciliation deferred — the SSE push (`/api/payments/[invoiceId]/stream`) already covers learner-visible payment status; further reconciliation surfaces wait until a real workflow needs them.

### Observability

- ~~per-event operator notifications for payment failures~~: **shipped 2026-05-04**. `lib/email/templates/operator-payment-failure.ts` + `sendOperatorPaymentFailureNotification` in `lib/email/dispatch.ts`. Wired into the two terminal-failure surfaces: CloudPayments Fail webhook (`app/api/payments/webhooks/cloudpayments/fail/route.ts`) and 3DS callback decline (`app/api/payments/3ds-callback/route.ts`). Best-effort (try/catch around the dispatch call) so a Resend outage cannot block the webhook ack or the user redirect. Silent skip when `OPERATOR_NOTIFY_EMAIL` is empty. Validation failures and Check-phase declines are deliberately NOT notified (suspicious-but-not-terminal; covered by the audit log + the aggregate webhook-flow alert). Template covered by 5 unit tests.
- ~~hook up error tracking~~: **closed 2026-04-29**. Sentry @sentry/nextjs v10 plus `instrumentation.ts` (Node / Edge), `instrumentation-client.ts` (browser), `app/global-error.tsx`. Project: `mastery-zs/levelchannel`. End-to-end smoke event passed. Production activation lives in the private operations runbook.
- add operator signals for payment failures and webhook failures

### Auth and consent

- ~~add password hash versioning plus a `needsRehash()` path for future cost / algorithm changes~~: **closed 2026-04-29**. `passwordNeedsRehash()` in `lib/auth/password.ts` parses the cost from the bcrypt prefix; the login route silently re-hashes after `verifyPassword` and calls `setAccountPassword`. Best-effort (warn, continue on DB error). Covered by unit and integration tests. Future migration to argon2id: update the regex at the same time as introducing the new hasher, otherwise every login will rehash every time.
- ~~add cleanup for expired `account_sessions`~~: **shipped 2026-04-29**. Folded into `scripts/db-retention-cleanup.mjs` (above).
- ~~add common-password rejection~~: **closed 2026-04-29**. Local denylist in `lib/auth/common-passwords.ts` (~100 top breaches), normalizes case and whitespace; `validatePasswordPolicy` returns `too_common`. HIBP k-anonymity API stays as a future extension if needed.

### Cabinet Phase 6 deferments (parked here so they don't get forgotten)

- ~~wire `/pay` to the pricing catalog~~: **partially shipped 2026-05-04** as `/checkout/[tariffSlug]` running in parallel with `/pay`. The free-amount `/pay` stays untouched. Decision on whether to fold `/pay` into a tariff picker (or keep both indefinitely) deferred until the new flow has soak time.
- **collect `phone_e164` on the profile** if and when an operator workflow actually needs to call or Telegram a learner. Until then we don't widen the PD surface.

## P2

### Product and operator tooling

- add a proper operator-side payment list instead of manual DB / file inspection
- add payment funnel telemetry useful for decisions
- ~~add operator email notification for a successful payment~~: **closed 2026-04-29**. Inline in the pay-webhook handler after `markOrderPaid` plus audit. Renders via `lib/email/templates/operator-payment-notify.ts`, dispatched via `sendOperatorPaymentNotification()`. Best-effort (try / catch plus warn). Production activation lives in the private operations runbook. Silent no-op when unset.
- Telegram notification: separate wave if email turns out to be insufficient (needs bot token plus parse_mode reasoning; do it when a real need appears).
- ~~add `POST /api/auth/resend-verify` plus UI button~~: **closed 2026-04-29**. Endpoint in `app/api/auth/resend-verify/route.ts` (authenticated, idempotent, rate-limited 10/min/IP plus 3/hour/account); UI button in `app/cabinet/resend-verify-button.tsx` replaced the Phase 2 hack of linking to `/forgot`.
- ~~add a consent withdrawal model for `account_consents`~~: **closed 2026-04-29**. Migration 0013 added a `revoked_at` column plus partial index `account_consents_active_idx` (where `revoked_at IS NULL`). Store ops in `lib/auth/consents.ts`: `withdrawConsent()` (stamps the latest unrevoked row), `getActiveConsent()` (returns the latest non-revoked). UI / API endpoint goes with Phase 3 admin / cabinet. Covered by 5 integration tests. Implements 152-FZ art.9 §5.
- add a separate `accepted_at`-covering index for `account_consents` if consent-history becomes a real hot path

### DX and quality

- ~~assemble a security regression checklist for releases~~: **closed 2026-04-29**. `docs/security-regression-checklist.md`: 9 sections (code-review gates, tests must be green, auth invariants matrix cross-ref, payment + webhook invariants, audit log invariants, observability, legal scope, post-merge smoke, quarterly drill). First scheduled drill: 2026-07-29.
- ~~widen integration coverage for payment routes~~: **closed 2026-04-29**. `tests/integration/payment/payment-routes.test.ts` covers `POST /api/payments` (create plus amount / consent rejection plus idempotency replay), cancel (success plus 404 plus 400 malformed id), mock-confirm. Each test asserts DB state plus audit event shape. All against a real Docker Postgres in mock-payment mode (via `TEST_INTEGRATION=1`, which makes setup-env switch provider / storage / allowMockConfirm). Webhook handlers: in the next item.
- ~~add an integration test for webhook handlers (HMAC verify path)~~: **closed 2026-04-29**. `tests/integration/payment/webhooks.test.ts` plus helper `tests/integration/payment/sign.ts`. 4 tests: Pay valid → paid plus received / processed audit; HMAC mismatch → 401, no audit; Pay amount-mismatch → received plus validation_failed; Fail valid → failed plus received / processed audit. Order seeding goes through a direct INSERT (not through `createPayment`) because in integration mode the provider is mock and webhook validation requires `provider='cloudpayments'`.
- ~~parameterize the Docker integration stack for parallel CI~~: **closed 2026-04-29**. `docker-compose.test.yml` now reads `LC_TEST_DB_NAMESPACE` (default `default`) and `LC_TEST_DB_PORT` (default 54329) from env. `scripts/test-integration.sh` derives namespace plus port from `LC_TEST_PARALLEL_ID` (sha256 → 8-char suffix plus port window 54330..54429), plus a unique `COMPOSE_PROJECT_NAME`. Single-developer flow stays byte-equal historical defaults; parallel shards / runners no longer fight over the port / container.
- ~~add an integration test for login with an unverified email (Phase 1B D4)~~: **closed 2026-04-29**. `tests/integration/auth/login.test.ts` now contains the test `allows login when email is not yet verified`: registers, asserts `emailVerifiedAt` is null, login returns 200 plus session cookie plus body with `emailVerifiedAt: null`.
- add a real-time signal for `/verify-pending`, only if users actually need it

## Not now

- do not bloat the cabinet beyond auth and payment-adjacent scenarios without a direct business need
- do not collect more personal data at checkout
- do not complicate the payment form without a direct business need

## P3 — security maturity (revisit when scale or fundraise demands)

Captured 2026-05-09 after the two-day security sprint (Waves 5/8/9/10/11 + Issues #86/#88) closed everything that was technically actionable. The items below are **structural / process** gaps. They don't represent vulnerabilities — they represent missing layers that a bigger company / a regulated audit / a Stripe-grade due-diligence would expect. Investing in them on the current QPS (~10 page views / hour, ~50 payments / month) is overkill; they belong in P3 until scale or a fundraise demands them.

### Staging environment
**Trigger:** the next time we hit a prod-only failure (we had 2 on 2026-05-08). **Cost:** ~$5/mo for a second small VPS + automation to mirror migrations. **Value:** every "deploy then discover it doesn't work on this kernel/Node/systemd combo" cycle becomes a non-event. Today we mitigate via fast rollback + post-deploy smoke; staging eliminates the rollback window entirely.

### Cloudflare (or equivalent) in front
**Trigger:** first sustained traffic spike that the single nginx layer can't absorb, OR first DDoS attempt. **Cost:** $0 (free tier) - $20/mo (Pro). **Value:** L4/L7 DDoS protection, edge caching, country-blocking, WAF rules. Trade-off: another vendor in the data path, CSP `connect-src` may need tuning.

### Backup-restore drill
**Trigger:** quarterly. **Cost:** 2-3 hours each time. **Value:** confirms the backups in the private runbook are actually restorable end-to-end. Today: backups exist, but "can we restore them" is untested. Add a calendared item ("first Friday of each quarter") + checklist in the private operations runbook.

### Formal threat model
**Trigger:** before next material code-architecture change OR before a regulatory audit / fundraise DD. **Cost:** 1-2 day exercise (STRIDE per surface, attack-tree per asset). **Value:** moves SECURITY.md from "list of controls we have" to "controls we have mapped to specific attacker goals" — exposes blind spots that ad-hoc reviews miss. Output: `docs/security-threat-model.md`.

### External pen-test
**Trigger:** before a fundraise where due-diligence will demand it, OR after a material expansion of the attack surface (new payment flow, new auth method, public API). **Cost:** $3K-$8K from a Russian-market pen-test vendor. **Value:** independent third party tries to break things; produces a report we can hand to investors / regulators. Codex + self-review are good but not equivalent.

### `security.txt` + responsible-disclosure policy
**Trigger:** as soon as anyone external (researcher, customer) asks "where do I report a vulnerability." **Cost:** ~30 min of writing + DNS/file. **Value:** formal channel that doesn't end up in support@. Spec: https://securitytxt.org. Place at `/.well-known/security.txt`. Should also document scope, expected response time, what's in/out (e.g. social-engineering excluded).

### SBOM + supply-chain provenance
**Trigger:** SOC 2 / regulatory audit, OR after a notable npm-supply-chain incident. **Cost:** 1-2 days of tooling integration (`syft` for SBOM, `cosign` for signed builds, npm provenance flag). **Value:** a real answer to "what's in your build, can you prove it." Today: `package-lock.json` + `npm audit`. That's a baseline, not a chain of custody.

### HA / multi-instance / failover
**Trigger:** sustained traffic that justifies horizontal scaling, OR business-continuity SLA commitment. **Cost:** order-of-magnitude infra cost (load balancer, second app server, PG read replica or failover, shared session store, multi-instance rate-limit), plus rewriting `lib/security/rate-limit.ts` in-memory fallback path (currently OK because there IS no second instance — but multi-instance + memory fallback = bypassable per-IP cap, called out in Wave 7 #4). **Value:** the prod VPS can fail / be reimaged / be redeployed without user-visible downtime.

### Other deferred items (cross-reference)

- **Wave 6 #4 Phase 3** — calendar trigger ≈2026-05-15: drop the 24h legacy grace window in `evaluateReceiptGate`. One-line code change once the soak window passes.
- **Wave 10 #1 finishing touch** — when РКН confirms registration, paste the registry number + filing date into `app/privacy/page.tsx` §1 (3-line attributive PR).
- **Wave 10 #2b** — physical PO box / virtual office for the IP claims address (currently the IP's residential address from EGRIP is used). Privacy upside; not a regulatory blocker.
- **GA wiring decision** — Open Question #1 from Wave 11 plan (deferred 2026-05-08): drop GA/GTM allowlist entries from CSP, OR actually wire GA. Current: dead allowlist entries kept "just in case."
