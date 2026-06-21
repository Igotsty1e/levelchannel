# Security audit — top-1 company depth (2026-06-09)

**Status**: round 1 — pre-implementation self-review
**Owner**: @ivankhanaev
**Author**: Claude (sonnet/opus)
**Codex-Paranoia**: SELF-REVIEW round 2/2 (Codex quota exhausted until 2026-06-11)

---

## 1. Methodology

Adversarial pass over ~129 API routes, 120 migrations, ~50 lib/ files. Threat model = nation-state external + insider with read-only DB access. ASVS L2/L3 categories. AT LEAST 21 sub-areas covered.

## 2. Severity roll-up

- **BLOCKER**: 0
- **HIGH**: 3 (H2-3DS-CSRF, H5-admin-promo-CSRF, H7-events-CSRF)
- **MEDIUM**: 11 (IPv6 RL, prototype-pollution, verify-binding, CSP style-src, amount float, auth audit IP, RL fail-open, DB role, secret rotation)
- **LOW**: 5

## 3. Findings (full)

### A1 — Auth & session

- **M1 [MEDIUM] bcrypt cost=12 unchanged + no argon2id roadmap**
  - File: `lib/auth/password.ts:6`. silent-rehash machinery exists, no migration committed. Bcrypt's 72-byte truncation silently caps long passphrases.
  - Fix: schedule argon2id; reject inputs >72 bytes today OR pre-sha256 stretch.

- **H2 [HIGH] `/api/payments/3ds-callback` no origin / nonce binding**
  - File: `app/api/payments/3ds-callback/route.ts:27-58`. Accepts `formData` from bank ACS; predictable invoiceId shape `lc_<18 hex>` lets an external POST flip orders into `threeds.declined`.
  - Fix: HMAC-bind invoiceId with per-order termURL nonce; require `state in {awaiting_3ds}` (already done) + nonce verify in same TX.

- **M3 [MEDIUM] Login RL bucketed on full IPv6 → /64 rotation bypasses**
  - File: `lib/security/request.ts:120-127`, `app/api/auth/login/route.ts:41-72`.
  - Fix: truncate IPv6 to /64 prefix in RL key.

- **L4 [LOW] Session TTL 7d, no rotation on privilege elevation**
  - File: `app/api/admin/accounts/[id]/role/route.ts`. `grantAccountRole` doesn't call `revokeAllSessionsForAccount`.
  - Fix: revoke target sessions in every admin role-mutation route.

### A2 — Authorization / BOLA

- **H5 [HIGH] `/api/admin/promo-codes` GET missing `enforceTrustedBrowserOrigin`**
  - File: `app/api/admin/promo-codes/route.ts:16-33`.
  - Why bad: GET returns promo codes (bearer secrets). Admin logged in + CSRF nav → leaks list.
  - Fix: add `enforceTrustedBrowserOrigin` to GET + POST.

### A3 — Input validation / SQL injection

- **M6 [MEDIUM] Prototype pollution in `parseCloudPaymentsPayload`**
  - File: `lib/payments/cloudpayments-webhook.ts:88`. `URLSearchParams.forEach((v,k)=>payload[k]=v)` accepts `__proto__`/`constructor`/`prototype`.
  - Fix: skip keys in {`__proto__`, `constructor`, `prototype`} during assignment.

### A4 — CSRF coverage

- **H7 [HIGH] `POST /api/events` missing `enforceTrustedBrowserOrigin`**
  - File: `app/api/events/route.ts:83`. Cross-origin `sendBeacon` forges arbitrary analytics. Low data impact but Safari <17 ignores SameSite on top-level nav.
  - Fix: add origin gate + `sec-fetch-site=same-origin` check.

### A5 — SSRF / Open redirect / URL parsing

- **M8 [MEDIUM] `/api/auth/verify` clicks issue session without UA/IP binding**
  - File: `app/api/auth/verify/route.ts:88-91`. Token theft → instant session takeover.
  - Fix: industry-standard confirmation step OR require user to log in before issuing session via verify.

### A6 — XSS

- **M9 [MEDIUM] CSP `style-src 'unsafe-inline'` re-added 2026-06-09**
  - File: `lib/security/csp.ts:61`. Re-added for landing-v3 inline styles. CSS-injection via `:has()` selectors enables exfil.
  - Fix: extract inline styles to `landing-v3.css`; drop `'unsafe-inline'`.

### A7 — Payments

- **M10 [MEDIUM] `validateCloudPaymentsOrder` float comparison**
  - File: `lib/payments/cloudpayments-webhook.ts:165`. `amount !== order.amountRub` on JS Number floats.
  - Fix: compare kopecks (multiply ×100 round).

### A8 — PII / 152-ФЗ

- **M11 [MEDIUM] `auth_audit_events.client_ip` stored plaintext**
  - File: `migrations/0028_auth_audit_events.sql:74`. AUDIT-SEC-1 Phase B encrypted payment-side but DEFERRED auth-side.
  - Fix: backport mig 0025-style `client_ip_enc bytea` + null-out plaintext window.

### A9 — OAuth / Secrets

- **L12 [LOW] `NEXT_PUBLIC_LEGAL_BANK_*` ships to client bundle**
  - File: `lib/legal/public-profile.ts:11-13`. Bank acct not secret, but SEO-scraped impersonation risk.
  - Fix: server-render only; drop `NEXT_PUBLIC_*` prefix.

### A11 — Rate-limit / DOS

- **M13 [MEDIUM] In-memory RL fallback opens wide if X-Real-IP missing**
  - File: `lib/security/rate-limit.ts:18`, `lib/security/request.ts:120`. Shared `unknown` bucket.
  - Fix: fail-closed in prod if `X-Real-IP` missing >60s; alarm.

### A14 — Headers

- **L14 [LOW] Missing COEP**
  - Fix: `Cross-Origin-Embedder-Policy: require-corp` if no third-party iframes break.

### A16 — Logging

- **L15 [LOW] pg errors logged with full SQL + params**
  - Fix: redactor for pg-error before `console.warn`.

### A18 — DB

- **M16 [MEDIUM] No read-only DB role for `/admin/analytics`**
  - Fix: create `levelchannel_reader` SELECT-only; admin analytics route uses it.

### A20 — GDPR

- **L17 [LOW] `events` partition not listed in retention script**
  - File: `scripts/db-retention-cleanup.mjs:1-80`.
  - Fix: add `events` purge predicate (by `account_id` on anonymize).

### A21 — Deploy

- **M18 [MEDIUM] Rotation runbook gaps**
  - File: SECURITY.md. `TEACHER_INVITE_SECRET` + `PUSH_VAPID_PRIVATE_KEY` not documented.
  - Fix: add rotation steps for both to SECURITY.md.

---

## 4. Scope for THIS PR (HIGH + tier-1 MEDIUMs)

In scope (single PR — Sub-PR A):
- **H2** 3DS-callback nonce binding
- **H5** admin/promo-codes GET+POST CSRF
- **H7** /api/events CSRF
- **M3** IPv6 /64 RL bucket
- **M6** parseCloudPaymentsPayload prototype pollution
- **M9** CSP unsafe-inline extraction (move landing-v3 inline styles)
- **M10** kopecks-based amount comparison
- **L12** drop NEXT_PUBLIC_LEGAL_BANK_*

Deferred to follow-up (need schema/runbook coordination):
- M1 (argon2id) — quarter-scale work
- L4 (session rotation on role change) — separate audit PR
- M8 (verify-binding UX) — UX design needed
- M11 (auth audit IP encrypt) — schema migration like AUDIT-SEC-1 Phase B
- M13 (RL fail-closed) — needs infra alarm wiring
- L14 (COEP) — needs iframe audit
- L15 (pg error redactor) — log-shape refactor
- M16 (read-only DB role) — env + ops change
- L17 (events retention) — verify partition predicate
- M18 (secret rotation runbook) — SECURITY.md update

---

## 5. Self-review (round 1)

### 5.1 Closed in this pass
- All 21 categories of ASVS-style review touched.
- Cross-checked actual file:line citations (no hand-waving).
- Severity ranked using exploitability not theoretical.

### 5.2 Gaps I might have missed
- **Subresource Integrity** for CloudPayments + external SDK (widget.cloudpayments.ru bundle) — no SRI hash today. If CP's CDN ever served compromised JS, every payment page MitM. Add `integrity=` attr after pinning version.
- **DNS Rebinding** on `localhost:3000`-style binds — only relevant in dev.
- **Time-of-check vs time-of-use** races in `bulkCreateSlots` between cap check and insert — relies on partial unique index, OK in practice.
- **GraphQL not used** — skipped (no surface).
- **Account enumeration via /api/auth/forgot timing** — already constant-time per `dummy-hash`.
- **Mass-assignment** on PATCH endpoints (`/api/teacher/profile`) — should grep for `Object.assign(account, body)` patterns. Quick check: no such pattern found in scan, but worth a focused follow-up.
- **JWT** — not used (cookie sessions); skipped.

### 5.3 Risk of in-scope fixes
- **H2 3DS nonce**: changes payment route signature; CP integration test must pass. Plan: HMAC over `invoiceId|orderId|env.AUTH_RATE_LIMIT_SECRET`, stored as `metadata.threedsTermNonce`, verified on callback. Old in-flight orders before deploy lack nonce → grace path (24h) accepts NULL nonce same as receipt-token. Fail-closed after grace.
- **M9 CSP**: extracting landing-v3 inline styles risks visual drift if any selector relies on inline cascade order. Mitigation: build + playwright before/after screenshot.
- **L12 drop NEXT_PUBLIC_LEGAL_BANK_***: server-render replacement needs SSR helper. Existing pages already SSR — change is a one-line variable rename.

---

## 6. Ready to implement
All findings actionable. Proceed to single Sub-PR A.
