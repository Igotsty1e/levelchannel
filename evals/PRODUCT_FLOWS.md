# Product-Flow Evals Registry

> Source-of-truth for the highest-risk product/user flows that AI agents and humans must not break.
> Companion file: [`URL_REDIRECT_CONTRACT.md`](URL_REDIRECT_CONTRACT.md) — route × role × redirect.
> This file is flow-oriented; the contract file is route-oriented.

**Audit cadence:** review on every plan-doc that touches routes / role gates /
cabinet / teacher / admin / booking / packages / payment / calendar settings.

## How to read

Each flow row carries:

- **Flow ID** — `FLOW-{AREA}-{NAME}-{NNN}`; stable across edits.
- **Area** — public / learner / teacher / admin / auth / payment / calendar.
- **Starting URL** — what the user types or clicks first.
- **Expected final URL** — where they end up after navigation + redirects.
- **Allowed redirects** — intermediate hops permitted (302/307/replace).
- **Forbidden redirects** — hops that constitute a regression.
- **Required UI anchors** — substring(s) that must appear in rendered HTML to confirm the page is the right one. Substrings, not full snapshots.
- **Forbidden UI anchors** — placeholders / wrong copy / wrong role labels that must not appear (unless explicitly state-conditional).
- **Role required** — anon / learner / teacher (+ verified) / admin.
- **Risk** — Low / Medium / High / Critical.
- **Automation status** — none / manual / unit / integration / e2e / post-deploy-smoke.
- **Notes** — known ambiguities, state-conditional placeholders, TODOs.

---

## A. Public / legal

### FLOW-PUBLIC-HOME-001

- **Area:** public
- **Starting URL:** `/`
- **Expected final URL:** `/` (no redirect — public Anastasia homepage; restored 2026-05-28 in commit `648868b`)
- **Allowed redirects:** none
- **Forbidden redirects:** `/cabinet`, `/login`, `/saas`, `/teacher`
- **Required UI anchors:** at least one of: `LevelChannel`, `<h1`, branded landing copy
- **Forbidden UI anchors:** `Скоро будет`, `Coming soon`, `TODO`, `Placeholder`
- **Role required:** anon
- **Risk:** **High** (recent regression — landing previously redirected to authenticated surface)
- **Automation status:** **e2e** (`tests/e2e/product-flows.spec.ts`)
- **Notes:** Source of truth: `app/page.tsx` renders `HomePageClient` directly; no auth check. If a future change adds a redirect here, update this flow first and explain why.

### FLOW-PUBLIC-OFFER-001

- **Area:** public / legal
- **Starting URL:** `/offer`
- **Expected final URL:** `/offer`
- **Allowed redirects:** none
- **Forbidden redirects:** `/cabinet`, `/login`
- **Required UI anchors:** offer-related copy (substring `оферт`)
- **Forbidden UI anchors:** `Скоро будет`, `TODO`
- **Role required:** anon
- **Risk:** Medium (legal surface; visible to anonymous visitors before registration)
- **Automation status:** **e2e**

### FLOW-PUBLIC-PRIVACY-001

- **Area:** public / legal
- **Starting URL:** `/privacy`
- **Expected final URL:** `/privacy`
- **Allowed redirects:** none
- **Forbidden redirects:** `/cabinet`, `/login`
- **Required UI anchors:** privacy-related copy (substring `персональн` or `privacy`)
- **Forbidden UI anchors:** `Скоро будет`
- **Role required:** anon
- **Risk:** Medium
- **Automation status:** **e2e**

### FLOW-PUBLIC-SAAS-OFFER-001

- **Area:** public / saas
- **Starting URL:** `/saas/offer`
- **Expected final URL:** `/saas/offer`
- **Allowed redirects:** none
- **Forbidden redirects:** `/login`
- **Required UI anchors:** SaaS-offer Russian heading text
- **Forbidden UI anchors:** `Скоро будет` unless legal version is placeholder (`v0-placeholder-*`)
- **Role required:** anon
- **Risk:** Medium
- **Automation status:** **none** (manual; legal-pipeline already audits this surface)
- **Notes:** Page is state-aware — when `live.versionLabel.startsWith('v0-placeholder-')` the registration banner shows placeholder copy. That's intentional, not a bug.

## B. Auth

### FLOW-AUTH-LOGIN-001

- **Area:** auth
- **Starting URL:** `/login`
- **Expected final URL:** `/login`
- **Allowed redirects:** none for anonymous
- **Forbidden redirects:** `/cabinet`, `/admin`
- **Required UI anchors:** input field for email
- **Forbidden UI anchors:** `Скоро будет`
- **Role required:** anon
- **Risk:** Critical
- **Automation status:** **e2e**

### FLOW-AUTH-REGISTER-001

- **Area:** auth
- **Starting URL:** `/register`
- **Expected final URL:** `/register`
- **Allowed redirects:** none for anonymous
- **Forbidden redirects:** `/cabinet`, `/login`
- **Required UI anchors:** input field for email
- **Forbidden UI anchors:** `Скоро будет`
- **Role required:** anon
- **Risk:** Critical
- **Automation status:** **e2e**

## C. Learner cabinet

### FLOW-CABINET-ANON-REDIRECT-001

- **Area:** learner / auth gate
- **Starting URL:** `/cabinet`
- **Expected final URL:** `/login` (after server-side redirect)
- **Allowed redirects:** `/login`
- **Forbidden redirects:** `/admin`, `/teacher`, `/register`
- **Required UI anchors:** login form (substring email input attribute or label)
- **Forbidden UI anchors:** authenticated cabinet content
- **Role required:** anon
- **Risk:** **Critical** (auth boundary)
- **Automation status:** **e2e**

### FLOW-LEARNER-CABINET-001

- **Area:** learner
- **Starting URL:** `/cabinet`
- **Expected final URL:** `/cabinet` (renders learner UI)
- **Allowed redirects:** none for authenticated learner
- **Forbidden redirects:** `/login`, `/admin`, `/teacher`
- **Required UI anchors:** `Кабинет`, learner-only sections
- **Forbidden UI anchors:** `Скоро будет`, admin-only labels
- **Role required:** learner (student role OR no role = default learner)
- **Risk:** Critical
- **Automation status:** **e2e** (`tests/e2e/product-flows-authenticated.spec.ts`)

### FLOW-LEARNER-BOOK-001

- **Area:** learner / booking
- **Starting URL:** `/cabinet/book`
- **Expected final URL:** `/cabinet/book` (or `/cabinet/book/[ymd]` after day pick)
- **Allowed redirects:** none for authenticated learner
- **Forbidden redirects:** `/login`
- **Required UI anchors:** booking-related Russian copy
- **Forbidden UI anchors:** hardcoded lesson name (`Занятие по английскому`), hardcoded duration (`50 мин`) — see content-style §forbidden
- **Role required:** learner
- **Risk:** Critical (money path entry)
- **Automation status:** **e2e** (`tests/e2e/product-flows-authenticated.spec.ts`) + content-style guard

### FLOW-LEARNER-PACKAGES-001

- **Area:** learner / payment
- **Starting URL:** `/cabinet/packages`
- **Expected final URL:** `/cabinet/packages`
- **Allowed redirects:** none for authenticated learner
- **Forbidden redirects:** `/login`
- **Required UI anchors:** packages list heading
- **Forbidden UI anchors:** test-package legacy names (`Тестовый пакет`) outside operator scope, `Скоро будет`
- **Role required:** learner
- **Risk:** **Critical** (money UI; teacher-scoping incident Bug #2 codified)
- **Automation status:** **e2e** (`tests/e2e/product-flows-authenticated.spec.ts`) + **integration** (`tests/integration/billing/bug-2-packages-teacher-scope.test.ts` covers teacher-scoping invariant)

### FLOW-CABINET-CALENDAR-SETTINGS-001

- **Area:** learner / calendar
- **Starting URL:** `/cabinet/settings/calendar`
- **Expected final URL:** `/cabinet/settings/calendar` (for verified learner / hybrid student+teacher)
- **Allowed redirects:** `/login` (anon), `/admin` (admin), `/teacher/settings/calendar` (teacher-only — resolved R-AMBIG-1 on 2026-06-03)
- **Forbidden redirects:** none beyond the above
- **Required UI anchors:** calendar settings heading
- **Forbidden UI anchors:** `Скоро будет` (this surface uses state-aware copy per `derivePullStatus` / `derivePushStatus`)
- **Role required:** learner / hybrid
- **Risk:** Medium
- **Automation status:** **none**
- **Notes:** Teacher-only redirect target is `/teacher/settings/calendar` (analogous surface). See URL_REDIRECT_CONTRACT.md note for R-AMBIG-1 resolution history.

## D. Teacher cabinet

### FLOW-TEACHER-ANON-REDIRECT-001

- **Area:** teacher / auth gate
- **Starting URL:** `/teacher`
- **Expected final URL:** `/login`
- **Allowed redirects:** `/login`
- **Forbidden redirects:** `/admin`, `/cabinet`, `/register`
- **Required UI anchors:** login form
- **Forbidden UI anchors:** teacher dashboard content
- **Role required:** anon
- **Risk:** Critical
- **Automation status:** **e2e**

### FLOW-TEACHER-CABINET-001

- **Area:** teacher
- **Starting URL:** `/teacher`
- **Expected final URL:** `/teacher`
- **Allowed redirects:** none for verified teacher
- **Forbidden redirects:** `/cabinet`, `/login`, `/admin`
- **Required UI anchors:** teacher-cabinet heading
- **Forbidden UI anchors:** `Скоро будет`, learner-only labels
- **Role required:** teacher (+ verified)
- **Risk:** High
- **Automation status:** **e2e** (`tests/e2e/product-flows-authenticated.spec.ts`)

### FLOW-TEACHER-PAYMENTS-001

- **Area:** teacher / payment
- **Starting URL:** `/teacher/lessons?kind=payments`
- **Expected final URL:** `/teacher/lessons?kind=payments`
- **Allowed redirects:** none for verified teacher
- **Forbidden redirects:** `/login`, `/cabinet`, `/teacher` без kind, `?kind=` со значением вне `lessons|deals|payments`
- **Required UI anchors:** `Оплаты`, `Должны оплатить`, `Ждут (` (substring до счётчика), `История (`, `Скачать CSV`
- **Forbidden UI anchors:** `booked`, `completed`, `no_show_learner`, `cancelled` (DB-slug leak — content-style §4 violation); `Скоро будет`, `TODO`
- **Role required:** teacher (+ verified + current SaaS-offer consent)
- **Risk:** **High** (payment surface; учительский журнал оплат)
- **Automation status:** **e2e** (`tests/e2e/teacher-payments.spec.ts`)
- **Notes:** Counts в tab anchors (`Ждут (N)`, `История (N)`) state-conditional — assert только substring `Ждут (` / `История (`, не точное число. qa-fixture seed: 1 unpaid learner (Дима Лебедев), 0 pending claims, 0 expiring packages.

### FLOW-TEACHER-UNVERIFIED-CABINET-001

- **Area:** teacher / verify-email
- **Starting URL:** `/teacher` (unverified teacher-only account)
- **Expected final URL:** `/cabinet`
- **Allowed redirects:** `/teacher` → `/cabinet` (single hop; verify-email banner reachable)
- **Forbidden redirects:** `/cabinet` → `/teacher` for unverified teacher-only (would create redirect loop with /teacher/layout's redirect)
- **Required UI anchors:** verify-email banner on `/cabinet`
- **Forbidden UI anchors:** redirect loop (browser would show ERR_TOO_MANY_REDIRECTS)
- **Role required:** teacher (NOT verified)
- **Risk:** Medium (was producing ERR_TOO_MANY_REDIRECTS before onboarding Sub-PR A landed)
- **Automation status:** integration test (`tests/integration/onboarding/dismiss-hint.test.ts` shares the auth setup; dedicated redirect-loop test in same suite)
- **Source of truth:** `app/cabinet/page.tsx:98` — `if (isTeacher && !isStudent && account.emailVerifiedAt !== null) redirect('/teacher')`. The `emailVerifiedAt !== null` guard is the loop-break.

### FLOW-TEACHER-CALENDAR-SETTINGS-001

- **Area:** teacher / calendar
- **Starting URL:** `/teacher/settings/calendar`
- **Expected final URL:** `/teacher/settings/calendar`
- **Allowed redirects:** `/login` (anon), `/admin/slots` (admin), `/cabinet` (non-teacher)
- **Forbidden redirects:** none beyond auth ladder
- **Required UI anchors:** calendar connection card markup (visible heading or `data-testid="calendar-coming-soon-tile"` when state is `!configReady`). When the teacher's `account_profiles.timezone IS NULL` AND `configReady=true` AND the integration is NOT connected, the surface also renders `data-testid="teacher-calendar-timezone-gate"` ABOVE the connect card (calendar-onboarding-cleanup, 2026-06-05).
- **Forbidden UI anchors:** `Скоро будет` IS allowed on this surface because it's a state-aware placeholder when the 4 required env vars are unset or malformed: `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, `GOOGLE_CALENDAR_REDIRECT_URL`, `GOOGLE_OAUTH_STATE_SECRET`. **This is an explicit exception** — flagged via inline `content-style-allow` comment in `connect-card.tsx`. Plain content-style guard would otherwise flag it.
- **Role required:** teacher
- **Risk:** **High** (prod environment-variable drift can leave the feature looking unshipped)
- **Automation status:** **e2e** (`tests/e2e/product-flows-authenticated.spec.ts`; asserts URL + 200 only — content stays state-aware). Banner-presence assertion is CONDITIONAL on `configReady` — when the page shows `data-testid="calendar-coming-soon-tile"` (CI without GOOGLE_CALENDAR_* env), the gate banner is suppressed by design. e2e tests skip banner assertion in that branch.
- **Notes:** When ALL 4 env vars are set AND validated (`lib/calendar/google/config.ts` rejects malformed redirect URLs and short state secrets), the tile flips to the connect card with no second deploy. Setting only 3 of 4 (e.g. forgetting `GOOGLE_OAUTH_STATE_SECRET`) keeps the placeholder visible. Track env presence via `scripts/check-env-contract.mjs`. Timezone gate is enforced at three layers (SSR page banner + `POST /api/teacher/calendar/google/start` 422 + callback redirect with `?error=timezone_required`) — per `docs/plans/calendar-onboarding-cleanup-2026-06-05.md`.

## E. Admin

### FLOW-ADMIN-GATED-ANON-REDIRECT-001

- **Area:** admin / auth gate
- **Starting URL:** `/admin/dashboard`
- **Expected final URL:** `/admin/login`
- **Allowed redirects:** `/admin/login`
- **Forbidden redirects:** `/cabinet`, `/login`
- **Required UI anchors:** admin login form
- **Forbidden UI anchors:** admin dashboard content
- **Role required:** anon
- **Risk:** **Critical**
- **Automation status:** **e2e**
- **Notes:** Unlike `/cabinet`, anonymous admin access lands on the dedicated admin login surface. Don't conflate the two.

### FLOW-ADMIN-LOGIN-001

- **Area:** admin / auth
- **Starting URL:** `/admin/login`
- **Expected final URL:** `/admin/login`
- **Allowed redirects:** none for anon
- **Forbidden redirects:** `/login`, `/cabinet`, `/admin`
- **Required UI anchors:** email + password input
- **Forbidden UI anchors:** `Скоро будет`, register link
- **Role required:** anon
- **Risk:** High
- **Automation status:** **e2e**

### FLOW-ADMIN-DASHBOARD-001

- **Area:** admin
- **Starting URL:** `/admin/dashboard`
- **Expected final URL:** `/admin/dashboard`
- **Allowed redirects:** none for authenticated admin
- **Forbidden redirects:** `/cabinet`, `/login`
- **Required UI anchors:** admin dashboard heading
- **Forbidden UI anchors:** `Скоро будет`, `TODO`
- **Role required:** admin
- **Risk:** High
- **Automation status:** **e2e** (`tests/e2e/product-flows-authenticated.spec.ts`)

## F. Payment / package UX

### FLOW-PAY-PUBLIC-001

- **Area:** payment
- **Starting URL:** `/pay`
- **Expected final URL:** `/pay`
- **Allowed redirects:** none
- **Forbidden redirects:** none expected
- **Required UI anchors:** payment-related Russian copy
- **Forbidden UI anchors:** `Скоро будет`, `Webhook`, `Реконсилиация`
- **Role required:** anon (the page itself is anonymous; CloudPayments widget loads after)
- **Risk:** High (CSP / external script surface)
- **Automation status:** **e2e** + post-deploy-smoke CSP-nonce check

### FLOW-THANK-YOU-001

- **Area:** payment
- **Starting URL:** `/thank-you`
- **Expected final URL:** `/thank-you`
- **Allowed redirects:** none
- **Forbidden redirects:** `/login`, `/cabinet` (this is a redirect target after successful payment, both anon and authenticated)
- **Required UI anchors:** confirmation copy
- **Forbidden UI anchors:** `Скоро будет`, `TODO`
- **Role required:** anon-or-authenticated (gateless landing for return URL)
- **Risk:** Medium
- **Automation status:** **e2e** + post-deploy-smoke

## G. Authenticated-flow fixture (2026-06-03)

A session-cookie test fixture against a seeded Postgres now lives at
`tests/e2e/seed.mjs` + `tests/e2e/product-flows-authenticated.spec.ts`.

How it works:

1. `npm run check:e2e-fixtures` brings up `docker-compose.test.yml` postgres,
   applies migrations, runs the seed script. Seed inserts three accounts
   (`e2e-fixture-learner@example.com`, `…-teacher@example.com`,
   `…-admin@example.com`) — verified emails, role grants, and mints a
   session cookie for each. Cookies + accountIds land in
   `tests/e2e/.fixtures.json` (gitignored).
2. The Playwright suite reads the fixture file, injects the cookie via
   `context.addCookies()`, and asserts SSR redirect / render contract.
3. Suite skips cleanly when `tests/e2e/.fixtures.json` is absent — local
   developers without Docker get the public/anon suite only.

Promoted from "postponed" to **e2e** automated:

- FLOW-LEARNER-CABINET-001
- FLOW-LEARNER-BOOK-001
- FLOW-LEARNER-PACKAGES-001
- FLOW-TEACHER-CABINET-001
- FLOW-TEACHER-CALENDAR-SETTINGS-001 (URL + 200 only — copy stays state-aware)
- FLOW-ADMIN-DASHBOARD-001

Plus one contract-locking test for R-AMBIG-1 (teacher-only redirect to
`/teacher/settings/calendar`).

## H. Resolved ambiguities

| Tag | Where | Resolution |
|---|---|---|
| `R-AMBIG-1` | `/cabinet/settings/calendar` with teacher-only role | **Resolved 2026-06-03**: redirect to `/teacher/settings/calendar` (analogous surface). See URL_REDIRECT_CONTRACT.md. |
