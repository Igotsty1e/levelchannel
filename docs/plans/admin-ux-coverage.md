# BCS-ADMIN-UX — admin tooling coverage review

**Status:** SHIPPED 2026-05-15…2026-05-20 — discovery roadmap implicitly closed through downstream waves. BCS-DEF-1 conflict-alerts (PR #316), BCS-DEF-1-TG Telegram fan-out (PR #386), BCS-DEF-2 conflict-feed dashboard (PR #389), BCS-DEF-3 zoomUrl on slots (PR #281), BCS-DEF-4 learner reminders (PR #392), BCS-DEF-4-TG learner Telegram (PR #405), BCS-DEF-5 daily teacher digest (PR #393), BCS-DEF-5-TG digest Telegram (PR #407), BCS-DEF-7 synctoken pull (PRs #352 + #390), POLICY-KNOBS env-tunable cancel window (PR #270), ALERTS-EDITOR Sub-PRs A/B/C (epic close PR #276), PKG-RECON paid_not_granted UI (PR #226), PKG-LEARNER-BUY `/cabinet/packages` (PR #240). Operator no longer needs SSH or raw SQL to run platform — discovery delivered. Plan-doc retained as historical inventory.
**Trigger:** Product owner observed during 2026-05-15 session that the package catalog has no end-user-visible purchase or operator-sale UI, and asked: *«добавь себе в БКЛ дополнительный Round … для анализа клиентского опыта и понимания того, какие инструменты настройки нам нужно добавить в админку»*.

## 1. Goal

Catalogue every **operator-tunable knob** and every **operator workflow** that today lives only in code, `.env`, or raw SQL, and produce a prioritised admin-UI roadmap that lets the operator run the platform from `/admin` without SSH or git access. The findings here feed back into BCS-DEF-1/2/3/4/5 sequencing: any feature whose configuration requires SSH to tune is incomplete until its `/admin` surface exists.

## 2. Current /admin surface (baseline)

Per `app/admin/(gated)/layout.tsx:73-81`, the navigation surface is:

| Tab | Surface | Status |
|---|---|---|
| Дашборд | `/admin` | exists |
| Аккаунты | `/admin/accounts` + `/admin/accounts/[id]` | exists |
| Тарифы | `/admin/pricing` (BUG-3 closed; duration + Order + delete + tooltip) | exists |
| Пакеты | `/admin/packages` (CRUD, create + soft-archive, economic fields immutable post-purchase per 0033 trigger) | exists |
| Слоты | `/admin/slots` (bulk preview + commit, lifecycle marks) | exists |
| Платежи | `/admin/payments` + `/admin/payments/[invoiceId]` | exists |
| Возвраты | `/admin/refunds` (BUG-6 closed; business-language copy) | exists |
| Задолженности | `/admin/debt-summary` | exists |
| Документы | `/admin/legal` | exists |

**Surface that does NOT exist today** (none of the below have an admin or learner UI):

- Grant-a-package-to-a-learner workflow (operator-driven "sell")
- Learner-facing package catalog + buy flow (the only entry today is the deep-linked `/api/checkout/package/<slug>` API)
- Conflict-feed dashboard (BCS-DEF-2 — planned)
- Alert recipients / thresholds editor
- Calendar cron cadence editor
- Reminder cadence + channel master switch (BCS-DEF-4/5 prereq)

## 3. Operator-tunable settings hiding outside /admin today

### 3.1 Email alert recipients + thresholds

| Knob | Current location | Why operator wants it in /admin |
|---|---|---|
| `ALERT_EMAIL_TO` | `$ENV_FILE` on the VPS (operator must SSH to change) | Rotating ops on-call email — should not require root |
| `OPERATOR_NOTIFY_EMAIL` | same | Same |
| `CALENDAR_PATHOLOGY_THRESHOLD=3` | `scripts/calendar-pathology-alert.mjs:47` (envvar override) | Tuning false-positive rate without redeploy |
| `CALENDAR_PATHOLOGY_REPORT_LIMIT=10` | same:50 | Same |
| `CALENDAR_PATHOLOGY_DEDUP_WINDOW_MS=24h` | same:53 | Same |
| `AUTH_FLOW_WINDOW_MINUTES=60` | `scripts/auth-flow-alert.mjs:60` | Slow-brute-force-detection sensitivity |
| `AUTH_FLOW_MAX_PER_IP=50` | same:61 | Same |
| `AUTH_FLOW_MAX_PER_EMAIL_HASH=20` | same:62 | Same |
| `AUTH_FLOW_DEDUP_WINDOW_MS=4h` | same:70 | Email-noise control |
| Webhook flow alert: same shape | `scripts/webhook-flow-alert.mjs` | Same |

### 3.2 Calendar cron cadences

| Knob | Current location | Why operator wants it in /admin |
|---|---|---|
| pull cadence `*:*:05` | `scripts/systemd/levelchannel-calendar-pull.timer` | Adjust without root + daemon-reload |
| push cadence `*:*:25` | `…-push.timer` | Same |
| intents cadence `*:00/5:35` | `…-intents.timer` | Same |
| renew-channels `03:00 UTC daily` | `…-renew-channels.timer` | Same |
| revive-blocked `*:13:00` hourly | `…-revive-blocked.timer` | Same |
| reconcile `02:30 UTC daily` | `…-reconcile.timer` | Same — but **invariant**: must NOT be more frequent than daily (plan §6 #3, would false-trigger F9‴ pathology counter) |

**Note:** these are SYSTEM-level timers; an `/admin` UI here would be a generator that PROPOSES a unit-file diff and emits an operator-facing `systemctl restart` instruction. NOT a live-edit surface — runtime systemd manipulation from a web app is out of scope.

### 3.3 Scheduling business rules

| Knob | Current location | Operator-tunable? |
|---|---|---|
| MSK business band 06:00–22:00 | migration 0031 CHECK constraint | NO — system invariant, schema-level. Documented as such. |
| 24h cancel window | `lib/scheduling/slots/canLearnerCancel` (default 24, env-tunable via `LEARNER_CANCEL_WINDOW_HOURS` since POLICY-KNOBS 2026-05-17) | Env-tunable today; /admin UI editor deferred to ALERTS-EDITOR follow-up |
| Slot duration 30/45/60/90 default options | `lib/pricing/tariffs.ts` DurationSelect | Already operator-tunable via Тарифы admin |
| Refund grace window | `lib/billing/refund-attempts.ts` / `lib/billing/reversals.ts` (NB: `lib/billing/refunds.ts` does not exist — Codex #10) | Should be in /admin (currently constant). Refund domain re-walk pending per §10.2. |

### 3.4 Reminder cadences (BCS-DEF-4/5 prereq)

When BCS-DEF-4/5 lands, the reminder windows (60/30/10 min) and channel master switch (email/telegram/push) MUST be operator-editable from `/admin`. Hardcoding them is the wrong shape — every operator runs a different SLA.

### 3.5 Conflict alert thresholds (BCS-DEF-1 prereq)

BCS-DEF-1 contract today: alert operator + teacher on unresolved conflict >2h. Threshold (2h), retry cadence, escalation rules all need to be operator-editable from `/admin`.

## 4. Learner-facing surfaces that need build-out

### 4.1 Package purchase flow (HIGH priority — observed gap)

| Surface | Status | Notes |
|---|---|---|
| `/api/account/packages` (own active list) | exists | Cabinet reads + renders |
| `/api/checkout/package/<slug>` (purchase init) | exists | Server-side flow correct |
| Cabinet "Активные пакеты" section | exists | Read-only |
| **Cabinet "Купить пакет" listing** | **MISSING** | No learner-facing catalog page |
| **Cabinet "Купить" CTA per package** | **MISSING** | No buy button |
| `/pay` or landing-side package tiles | **MISSING** | Currently `/pay` is free-amount only; `/checkout/<tariffSlug>` is single-tariff-bound |

**Proposed minimum:** new `/cabinet/packages` page listing active `lesson_packages` (where `is_active=true`) with a "Купить" button per row that POSTs `/api/checkout/package/<slug>` and forwards to the resulting CloudPayments widget intent — same shape as `/checkout/<tariffSlug>/checkout-form.tsx`.

### 4.2 Package balance + history (already present, partial)

Cabinet's "Активные пакеты" section (`app/cabinet/billing-sections.tsx:88`) reads `/api/account/packages` and renders the active list. Good. **Gap:** no "transaction history" view (how many lessons consumed when, by which slot). Lower priority than #4.1.

## 5. Admin-side surfaces that need build-out

### 5.1 Grant-a-package-to-a-learner (HIGH — observed gap)

Today the operator cannot manually grant a package without manipulating raw SQL. Workflow: operator agrees with learner on a payment outside the platform (bank transfer, cash) and wants to mark the package as granted.

**Schema constraint that shapes the design** (`migrations/0033_billing_packages_and_postpaid.sql:68-90`):
- `package_purchases.payment_order_id` is `NOT NULL UNIQUE` and FK-references `payment_orders.invoice_id`.
- This means we CANNOT just insert a `package_purchases` row with `payment_order_id = null` for an operator-grant flow. The DB enforces "every purchase has a paid order behind it."

**Two design options:**

- **Option A — synthetic payment_orders row.** Operator-grant flow creates a `payment_orders` row with `provider='manual_grant'` (new value) or `provider='operator'`, `status='paid'`, `amount = package.amount_kopecks` (no operator-supplied amount — pulled from the catalog), then inserts the `package_purchases` linked to it. Audit trail naturally appears in `/admin/payments` (existing surface). Refund flow already handles arbitrary providers. **Recommended.**
- **Option B — schema change to make payment_order_id nullable.** Drops the invariant; weakens "every purchase has a paid order" guarantee; adds a NULL branch to every consumer of `package_purchases`. Rejected.

**Proposed (Option A):** on `/admin/accounts/[id]`, add a "Выдать пакет" panel. Selector for `lesson_packages` (active only, `is_active=true`), required comment field (audit), "Выдать" button → POST `/api/admin/accounts/[id]/grant-package` →
1. Begin TX
2. Insert `payment_orders` row: `invoice_id = lc_manual_<random16>`, `provider='manual'`, `status='paid'`, `amount_kopecks` pulled from `lesson_packages.amount_kopecks` (NOT operator-supplied), `customer_email = learner.email`, `metadata.grantedByAccountId = adminId`, `metadata.grantReason = comment`, `paid_at = now()`.
3. Insert `package_purchases` row linked to the synthetic invoice, snapshotting title / duration / count / amount from `lesson_packages`.
4. `recordPaymentAuditEvent` with `kind='package.granted_by_operator'`, operator id, reason text, learner id.
5. Commit.

Refund flow uses the existing `/admin/refunds` machinery (already supports arbitrary providers; the `provider='manual'` path skips the CloudPayments call cleanly).

**Price-fixing prevention:** the API MUST NOT accept an operator-supplied amount. The amount is pulled server-side from `lesson_packages` by `package_id`. Operator can pick WHICH package; cannot decide its price.

### 5.2 Alert recipients + thresholds editor

`/admin/settings/alerts` (new). One row per known alert kind (calendar-pathology / auth-flow / webhook-flow / reminder-cadences / conflict-alerts). Editor for recipients (email list) + thresholds (window, max-per-bucket, dedup window). Persists to a new `operator_settings` table keyed by setting-name. Alert scripts read from DB on every run (no env-var override for these knobs — operator UI owns it).

### 5.3 Conflict feed dashboard (BCS-DEF-2)

Already planned. Surfaces `lesson_slots WHERE external_conflict_at IS NOT NULL` in the last 30 days with the 4 resolution actions (dismiss / delete-external / cancel / move) directly inline.

### 5.4 Reminder cadence + channel switch editor (BCS-DEF-4/5 prereq)

`/admin/settings/reminders`. Per learner-type / teacher-type, configure: enabled channels (email / telegram / push), windows (60/30/10 min). Per-user override surface in cabinet for learners + teachers comes later.

## 6. Prioritised roadmap

| Priority | Item | Rationale |
|---|---|---|
| P0 | §4.1 — Learner-facing package buy flow | Observed product-owner pain ("как пакет купить") |
| P0 | §5.1 — Admin grant-a-package | Same observation (operator-side "продать"); unlocks revenue not run through CloudPayments |
| P1 | §5.2 — Alert recipients + thresholds editor | Required to ship BCS-DEF-1 and BCS-DEF-4/5 properly |
| P1 | §5.3 — Conflict feed dashboard (BCS-DEF-2) | Already on backlog; operator UX critical post-OP-ROLLOUT |
| P2 | §5.4 — Reminder cadence editor (BCS-DEF-4/5 prereq) | Blocks feature shipping |
| P2 | §3.3 — 24h cancel window + refund grace in /admin | Currently hardcoded; tunable becomes operator-policy |
| P3 | §4.2 — Package consumption history view | Nice-to-have; current "active list" covers MVP |
| P3 | §3.2 — Calendar cron cadence proposal generator | Low frequency need; SSH-edit fine for now |

## 7. Implementation sequencing (proposed)

1. **Wave PKG-1** — §4.1 + §5.1 together (shared `package_purchases` insertion logic + new admin/cabinet routes). Closes the most-visible product gap. ~600 LOC + tests, single PR.
2. **Wave SETTINGS-1** — §5.2 alone (new `operator_settings` table + admin editor + alert-script refactor to read from DB). ~500 LOC, single PR. Prereq for SETTINGS-2+3.
3. **Wave CONFLICT-FEED** — §5.3 (BCS-DEF-2 implementation, was already planned). Now unblocked by SETTINGS-1.
4. **Wave REMINDERS** — §5.4 editor + then BCS-DEF-4/5 reminder implementation. Two PRs: schema/admin first, worker second.
5. **Wave POLICY-KNOBS** — §3.3 (24h window + refund grace as operator-tunable). Small.

Each wave runs the full epic-level paranoia contract (plan + wave checkpoints).

## 8. Codex adversarial review

Before any of waves 1-5 above start coding, this discovery doc is to be reviewed by Codex in `/codex` consultation mode (NOT full paranoia — this is a planning artefact, not a wave plan). Ask Codex specifically:

- What operator workflows did this list miss?
- Are P0/P1 priorities right for a single-operator MVP?
- Any latent invariant the proposed `operator_settings` table would break?
- Cross-cutting concerns (auth, audit, rate-limit) on the new `/admin/accounts/[id]/grant-package` action?

Codex output is appended to this doc as §9 before the first implementation PR opens.

## 9. Codex consultation findings (2026-05-15)

Codex `/codex` consultation returned 10 substantive findings. Verbatim:

> **Top-2:** вы недооценили не editor thresholds, а repair/reconciliation вокруг package entitlements; и оба предложения, `operator_settings` и synthetic manual `payment_orders`, в текущем виде конфликтуют с уже существующими runtime-инвариантами.

1. **`provider='manual'` is NOT additive.** `lib/payments/types.ts:1` declares `mock | cloudpayments` only; `lib/payments/store-postgres.ts:72` maps any unknown provider to `mock`. Plus `payment_orders.receipt` + `receipt_email` are `NOT NULL` per `migrations/0001_payment_orders.sql:5`. The synthetic-order plan would silently degrade type contract + violate NOT NULLs.

2. **`/admin/payments` is NOT a natural audit trail for manual grants yet.** `app/admin/(gated)/payments/[invoiceId]/page.tsx:25,87` renders `lesson_slot` allocations human-readably but `package` allocations fall back to a raw UUID. Going manual-grants through `payment_orders` requires the payment detail page to be package-aware FIRST.

3. **The missed operator workflow is NOT package buy/sell — it's `paid_not_granted` reconciliation.** A `paid` order without `package_purchases` already exists as a state (blocks account deletion via `lib/billing/deletion-guard.ts:23`); `lib/billing/package-grant.ts:11,265` has fail-closed branches that only write audit/email. Operator has NO UI to "re-run grant / attach to correct account / refund / mark resolved." Adding a new sell-flow on top of this hole is layering on a broken foundation.

4. **Priority order should be: P0 grant/reconcile entitlement, P1 learner buy CTA, P2 alert-threshold editor.** Thresholds have SSH+env workaround today; entitlement repair has only raw SQL.

5. **`operator_settings` as a generic key-value table breaks config contract if DB-only.** All three probes (`scripts/calendar-pathology-alert.mjs:47`, `auth-flow-alert.mjs:60`, `webhook-flow-alert.mjs:60`) read env directly on every run. DB-only with no env fallback loses bootstrap/recovery path and changes fail mode from "defaults work" to "broken DB row breaks the probe."

6. **Hot-reload latent invariant.** Per-run env reads in systemd probes already gives effective hot-reload (next tick sees new value). Real danger is when long-lived app/worker code reads settings — must NOT memoize on module scope, else `/admin` updates won't reach runtime until restart.

7. **`/admin/accounts/[id]/grant-package` needs MORE than admin auth + RL.** Double-click creates two synthetic orders + two grants. Requires: idempotency key, confirm-step UI, target-state policy (block on `purged` / `scheduled_purge` / `disabled` accounts). Existing admin mutators (e.g. `app/api/admin/accounts/[id]/postpaid/route.ts:25`) follow `origin + requireAdminRole + RL` shape — grant-package must match + add idempotency.

8. **Price-fixing freeze must be wider than just `amount`.** Server-authoritative pull MUST cover `amount`, `duration`, `count`, `title`, `expiry policy`, AND a decision on whether granting an `is_active=false` package is allowed. Mirror the same trust boundary as `app/api/checkout/package/[slug]/route.ts:24`.

9. **Observability around alerts is the missing piece — before editor.** Probes have dedup state files + "would have alerted" branches + journald-only failure modes (`calendar-pathology-alert.mjs:117`, `auth-flow-alert.mjs:178`, `webhook-flow-alert.mjs:128`). MVP `/admin/settings/alerts` surface should be: last-run, last-alert, effective-thresholds, dry-run test-send — NOT an immediate full editor.

10. **Inventory drift in §3.3.** Doc references `lib/billing/refunds.ts` which doesn't exist. Actual refund domain is across `app/api/admin/refunds*.ts`, `lib/billing/reversals.ts`, `lib/billing/refund-attempts.ts`, `lib/billing/refund-reconcile.ts`. Re-walk inventory from code SoT before prioritising knobs — some "missing admin UX" items may be false positives.

## 10. Revised plan (post-Codex)

### 10.1 New priority order

| Priority | Item | Rationale |
|---|---|---|
| **P0** | ~~**Wave PKG-RECON**~~ — **SHIPPED 2026-05-15/16** (PRs #227, #232-#236). `/admin/reconciliation/package-grants` reconciliation UI for `paid_not_granted` orders. Three operator actions (retry-grant, attach-account, mark-resolved). Codex #3+#4 closed. |
| **P1** | ~~**Wave PKG-LEARNER-BUY**~~ — **SHIPPED 2026-05-16** (PRs #237 plan, #238 LBL.0, #239 LBL.1, #240 LBL.2 epic-close). `/cabinet/packages` page + buy CTA. Server-side amount/duration/count/title/expiry from catalog (no operator-supplied amount). User-observed product-owner gap closed. |
| **P2** | **Wave PKG-ADMIN-GRANT** — operator-driven grant flow. **Re-scoped to NOT use synthetic `payment_orders` row.** New design: extend `package_purchases` with `granted_by_operator_id` nullable column + relax `payment_order_id` NOT NULL OR introduce a `manual_grants` sibling table. Decision deferred to wave-plan time + Codex paranoia. Server-authoritative on amount/duration/count/title/expiry/active-status per Codex #8. Idempotency key + confirm step + target-state policy per Codex #7. |
| **P2** | **Wave ALERTS-OBS** — `/admin/settings/alerts` read-only surface: last-run, last-alert, effective-thresholds, dry-run test-send. NO editor yet. Reads from probes' existing dedup state files + journald + new lightweight observability emit on each run. |
| **P3** | ~~**Wave ALERTS-EDITOR**~~ — **SHIPPED 2026-05-18.** Sub-PR A #272 (foundation), Sub-PR B #273 (probe migration), Sub-PR C this PR (editor UI + POST/DELETE routes). `operator_settings` table with DB→env→default chain, INSERT-only audit log via DB trigger, optimistic concurrency on writes. 10 tunable knobs across 3 probes; `ALERT_EMAIL_TO` stays env-only per security review. |
| **P3** | **Wave CONFLICT-FEED** (BCS-DEF-2) — depends on alert-observability shape landing first. |
| **P3** | **Wave REMINDERS** — as before, sequenced after alert framework. ~~**Wave POLICY-KNOBS**~~ — **PARTIALLY SHIPPED 2026-05-17** as env-tunable (`LEARNER_CANCEL_WINDOW_HOURS`, default 24, clamp [0..720]). Full /admin UI editor still deferred to ALERTS-EDITOR follow-up. See `docs/plans/policy-knobs.md` + `SECURITY.md` Phase B section pattern. |

### 10.2 Concrete sub-tasks before PKG-RECON wave starts

- Re-walk refund domain code (Codex #10): `app/api/admin/refunds*.ts`, `lib/billing/reversals.ts`, `lib/billing/refund-attempts.ts`, `lib/billing/refund-reconcile.ts`. Update §3.3 of this doc with accurate citations.
- Read `lib/billing/package-grant.ts` end-to-end to understand the fail-closed branches that need UI exposure (Codex #3 cites lines 11 + 265).
- Read `lib/billing/deletion-guard.ts:23` to enumerate which `paid_not_granted` states are blocked from cleanup today (Codex #3).
- Audit `/admin/payments/[invoiceId]` package-rendering gap (Codex #2) — needs to be fixed alongside or before PKG-RECON ships, since reconciliation logs route through `payment_orders`.

### 10.3 Open design decisions deferred to wave-plan time

- Manual-grant data shape: extend `package_purchases.granted_by_operator_id` vs sibling `manual_grants` table vs synthesize `payment_orders` with proper provider/receipt fields. Each has different invariant cost. Pick at wave-plan time, codex-paranoia-reviewed.
- Alert observability surface: probe write-on-every-run vs central `alert_runs` table.
- Long-lived-app-code settings consumer: per-request read vs short-TTL cache. Memoization rule needs a written contract before any consumer goes to DB-backed settings.
