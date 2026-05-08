# Wave 11 — CSP unsafe-inline refactor

**Status:** plan, not started.
**Tracking issue:** [#88](https://github.com/Igotsty1e/levelchannel/issues/88).
**Severity:** LOW (Codex Wave 8 #2).
**Estimate:** 3–5 PRs across 2–3 working sessions.
**Owner:** Ivan + Claude.

## Why this exists

`next.config.js` Content-Security-Policy currently allows:

```
script-src 'self' 'unsafe-inline' https://widget.cloudpayments.ru ...
style-src  'self' 'unsafe-inline' https://fonts.googleapis.com
```

`'unsafe-inline'` defeats most of CSP's value as an XSS mitigation: any successful injection (reflected, stored, DOM-based) executes as if it were trusted. The whole point of CSP for a public payment site is to make XSS unexploitable even when one slips past input sanitisation.

This is LOW severity in Codex's audit because:
- The app has no user-generated HTML rendering paths
- No comment / forum / messaging surfaces
- No `dangerouslySetInnerHTML` in source (verified 2026-05-08)

But it is real **defense-in-depth** debt — every future feature that touches user-controlled rendering inherits a weaker baseline. Closing it now while the surface is small is cheaper than chasing it later.

## Current-state inventory (2026-05-08)

### Inline scripts in source
- **0** `dangerouslySetInnerHTML` usages across `app/`, `components/`
- **0** raw `<script>` tags
- **2** `next/script` with **external URLs** (CloudPayments widget on `/pay` and `/checkout/[tariffSlug]`) — these don't need `'unsafe-inline'`, they ride the URL allowlist
- **0** GA / GTM bootstrap script loads (`gtag` is referenced in `home-page-client.tsx:19-20` defensively, but the loader is never injected — dead allowlist entry in CSP)

### Where Next.js itself injects inline scripts
Next.js App Router emits these inline `<script>` blocks during SSR:
- Hydration / RSC payload bootstrapping
- Route-prefetch hints
- Runtime config (e.g. `__NEXT_DATA__`)
- Self-hosting font CSS (since Next 13)

These cannot be moved to external files — they're per-render and embed values from the server. **They're the actual reason `'unsafe-inline'` is currently in CSP.**

The standard fix: nonce-based CSP. A per-request random nonce is generated in middleware, threaded into the CSP header, and stamped onto every inline `<script>` Next.js emits. Browser only executes scripts that carry the nonce. Inline injections from an attacker have no nonce → blocked.

### Inline styles
Inline `style={...}` in JSX is **DOM attribute styling**, not `<style>` tags. CSP's `style-src` `'unsafe-inline'` covers both, but the `style=` attribute path has its own directive — **`style-src-attr`** — which can stay `'unsafe-inline'` while `style-src` (which controls real `<style>` and `<link>`) tightens.

Top inline-style files:
| File | `style={...}` usages |
|---|---|
| `components/home/home-page-client.tsx` | 97 |
| `app/offer/page.tsx` | 74 |
| `app/admin/(gated)/slots/slots-manager.tsx` | 56 |
| `components/payments/pricing-section.tsx` | 54 |
| Total across repo | ~700+ |

Mass refactor of inline styles to CSS Modules is **out of scope for this wave**. We split the `style-src` directive instead.

### External script/style/font sources currently allowed
| Source | Used by | Keep? |
|---|---|---|
| `https://widget.cloudpayments.ru` | Payment widget on `/pay`, `/checkout/[tariffSlug]` | Yes — load via `next/script` |
| `https://*.cloudpayments.ru` | Widget assets (CSS, fonts within widget iframe) | Yes |
| `https://www.googletagmanager.com` | GA loader (declared in CSP, never actually injected) | **Drop** unless GA is wired in this wave |
| `https://www.google-analytics.com` | GA pings | Drop with the above |
| `https://fonts.googleapis.com` | Google Fonts CSS | Replaced with `next/font` self-hosting? (verify) |
| `https://fonts.gstatic.com` | Google Fonts files | Same as above |
| `https://*.ingest.de.sentry.io` | Sentry browser SDK ingest | Yes |
| `https://*.ingest.sentry.io` | Sentry fallback ingest | Yes |

## Strategy decision

### Option A — Nonce-based CSP via middleware (recommended)

```
script-src 'self' 'nonce-{NONCE}' https://widget.cloudpayments.ru
style-src  'self' https://fonts.googleapis.com 'nonce-{NONCE}'
style-src-attr 'unsafe-inline'
```

- Adds `middleware.ts` that generates a 16-byte base64 nonce per request
- Threads the nonce into `headers()` via `next/headers` so route handlers can read it
- Next.js App Router has first-class nonce support: when a `nonce` is set in the response headers, the framework stamps it onto every inline `<script>` it emits (`Next 14+`)
- `style-src-attr` keeps `'unsafe-inline'` for `style={...}` attributes — no mass refactor needed
- Real `<style>` tags (rare in this codebase) get the nonce too

**Cost:** 2–3 PRs.
**Risk:** middleware runs on every request — adds latency (~1 ms for the nonce gen + header setup). Acceptable for a low-QPS site.

### Option B — Move all inline scripts to external `/public/*.js` + CSS Modules for styles

- Drop `'unsafe-inline'` for both `script-src` and `style-src` entirely
- Rewrite all 700+ inline-style usages into CSS Modules / globals.css
- Externalise any inline JS (already minimal in our case)

**Cost:** 8–15 PRs.
**Risk:** massive UI churn; high regression risk for visual layout; doesn't actually buy more security than Option A given the inline scripts that remain are all Next.js-generated and CAN be nonce-protected.

### Option C — Hybrid (nonce for scripts, drop unsafe-inline for `style-src` only via partial refactor)

Pick the few files responsible for the bulk of inline styles (4 files = ~280 / ~700 usages) and refactor them, leave the rest with `style-src-attr 'unsafe-inline'`.

**Cost:** 4–6 PRs.
**Risk:** medium. Buys little extra over Option A because `style-src-attr` is the directive that actually matters for inline style attributes and IT stays `'unsafe-inline'` either way.

### Decision: **Option A**

Option A delivers ~95% of the security gain (XSS blocked because injected scripts have no nonce) at ~25% of the code churn. Option B's extra 5% gain costs 3–5× more work and visual regression risk on a site that already has zero user-controlled HTML rendering paths.

## Sequence of PRs

Each PR is independently mergeable and reversible.

### PR 1 — middleware + nonce generation

**Scope:** add `middleware.ts` that generates a per-request nonce, sets it on response headers via `x-nonce`, makes it available to route handlers via `headers().get('x-nonce')`.

**Files:**
- `middleware.ts` (new)
- `lib/security/csp.ts` (new) — single source of truth for the policy template

**Tests:**
- Unit test: `lib/security/csp.ts` template assembles correctly with a given nonce
- Integration test: `curl -I /` shows a fresh nonce per request and the value matches what's in the CSP header

**Acceptance:** site loads identically; CSP header now contains a nonce value, but `'unsafe-inline'` is still present (we don't remove it yet — that's PR 3).

### PR 2 — wire the nonce through inline script paths

**Status (2026-05-08, post-PR-1 prod verification): BLOCKED upstream.**

Empirical finding after PR 1 deployed (commit 5fff471): Next.js 16.2.4 with Turbopack production builds does **NOT** auto-stamp `nonce` on framework-emitted RSC hydration payload scripts (the `<script>self.__next_f.push(...)</script>` blocks). The middleware correctly sets:
- `x-nonce` request header — verified, fresh value per request
- `Content-Security-Policy` request header — verified
- `Content-Security-Policy` response header — verified, browser sees it
- 3 different nonces across 3 sequential `curl -I` calls — middleware IS regenerating

But the rendered HTML of `/` shows 5 inline `<script>` blocks (RSC payloads), all without `nonce` attribute. PR 1 contract holds (`'unsafe-inline'` still in policy, no behavior change), but PR 3 cannot proceed: dropping `'unsafe-inline'` from `script-src` would block hydration on every page.

**Possible paths forward (in order of likely effort):**

1. **Manual nonce threading via `headers().get('x-nonce')` in `app/layout.tsx` + every page that emits a `<Script>`.** The Next.js docs example for App Router. Audit every page; pass `nonce` prop to every `<Script>`. Does NOT solve the RSC-payload case because those scripts are emitted by the framework runtime, not by user code.

2. **Pin `unsafe-hashes` for the small set of RSC payload scripts.** Compute SHA-256 of every framework inline script and add `'sha256-X'` to `script-src`. Content-dependent; would need to be regenerated on every build.

3. **Use `'strict-dynamic'` + nonce.** Once a nonce'd script loads, all its descendants are trusted. Only works if the inline RSC payloads are LOADED by a nonce'd script — they're not, they're directly inline. Likely doesn't help here.

4. **Switch from Turbopack production builds to webpack.** Next 16 still supports webpack via `next build --no-turbo` (or `experimental.turbopack: false`). Webpack codepath may auto-stamp where Turbopack doesn't.

5. **Wait for upstream fix.** File / find a Next.js GitHub issue, monitor.

**Recommended:** option 4 next session — quickest signal on whether this is Turbopack-specific or Next-16-wide. If webpack auto-stamps, we just disable Turbopack for prod builds (with a perf trade-off to evaluate); if webpack also doesn't, this is upstream and we go option 5 (wait) + option 1 (manual threading where it does help, e.g. our own `<Script>` tags for CloudPayments).

**Files (when we resume):**
- `app/layout.tsx` — `import { headers } from 'next/headers'; const nonce = headers().get('x-nonce') ?? undefined;` — pass to children needing it
- `app/pay/page.tsx`, `app/checkout/[tariffSlug]/page.tsx` — `<Script nonce={nonce} ... />` for CloudPayments widget
- Snapshot test of rendered HTML asserting nonce presence

**Tracking:** new issue — see ENGINEERING_BACKLOG.md Wave 11 entry.

### PR 3 — drop `script-src 'unsafe-inline'`

**Blocked on PR 2 (auto-stamp finding).** Cannot ship until inline RSC payload scripts carry the nonce. See PR 2 status above.

**Scope (when unblocked):** edit `lib/security/csp.ts` to remove `'unsafe-inline'` from `script-src`. Drop unused `googletagmanager.com` / `google-analytics.com` from the allowlist if GA is not wired (per Open Question #1, currently deferred).

**Files:**
- `next.config.js`

**Tests:**
- Existing CI must still pass (build + integration tests + public-surface check)
- Manual smoke: `/`, `/pay`, `/checkout/[slug]`, `/offer`, `/privacy`, `/cabinet/...`, `/admin/...` in real browser; check console for CSP violations
- Manual: trigger a payment on `/pay`; confirm CloudPayments widget loads and processes the test card

**Acceptance:** zero `Refused to execute inline script because it violates the following Content Security Policy directive` errors in console across all surfaces. If any surface fails — rollback PR 3 and add the missing nonce thread to that surface in a follow-up before re-attempting.

### PR 4 — split `style-src` (shipped 2026-05-09)

**Scope (delivered):** `style-src` no longer carries `'unsafe-inline'` (or any nonce — there was nothing to stamp it onto, see surface inventory below). Added `style-src-attr 'unsafe-inline'` covering inline JSX `style={...}` attributes which compile to DOM `style="..."`. Combined with PR 5 surface-scope into the same commit because the two tasks were strictly coupled.

**What changed in `lib/security/csp.ts`:**
- `style-src 'self' 'unsafe-inline' 'nonce-X' https://fonts.googleapis.com` → `style-src 'self'`
- New directive: `style-src-attr 'unsafe-inline'`
- `font-src 'self' https://fonts.gstatic.com` → `font-src 'self'`

**Why the nonce was dropped from `style-src`:** rendered HTML on prod showed 0 inline `<style>` blocks (Next.js extracts to external `.css`). The nonce in `style-src` would only be relevant if there were `<style>` blocks to stamp; there are none, so it was redundant.

**Why fonts hosts dropped:** verified 2026-05-08 / 09 that `next/font/google` (used in `app/layout.tsx`) self-hosts the Inter font binaries since Next 13+. Zero references to `fonts.googleapis.com` / `fonts.gstatic.com` in rendered HTML. Allowlist was dead.

**Tests:** `tests/security/csp.test.ts` extended to assert: (a) `style-src` does NOT contain `'unsafe-inline'`, (b) `style-src-attr 'unsafe-inline'` is present, (c) Google Fonts entries are gone. 10/10 pass.

### PR 5 — drop dead CSP entries + post-wave docs (partial — folded into PR 4)

**What landed in PR 4:** dead Google Fonts allowlist entries (`fonts.googleapis.com`, `fonts.gstatic.com`) dropped from `style-src` and `font-src`.

**What remains for a separate PR (when GA decision lands):** `googletagmanager.com` / `google-analytics.com` allowlist entries. Per Open Question #1, GA wiring decision is **deferred** (option C, 2026-05-08): keep entries in CSP until explicit decision. When the decision lands either:
- **Wire GA in** — add the loader script via `next/script` strategy, no CSP change needed
- **Decide GA never** — drop the two allowlist entries from `script-src` and `connect-src`

**Documentation runbook (`docs/security-csp.md`):** deferred to when PR 3 unblocks (see PR 2 § 5 paths). Without PR 3 the runbook would have to document a partially-strict CSP, which is awkward; better to write it once after PR 3 ships.

## Testing strategy

### Per-PR
- All existing CI gates green: `npm run build`, `npm run test:integration`, `Verify Legal-Pipeline-Verified trailer`, `public-surface check`
- Snapshot tests for HTML rendering with nonce
- Console check on each merged PR via real browser pre-merge

### Wave-level
- Manual visual + functional QA on:
  1. `/` (landing, scroll, gtag check)
  2. `/pay` (CloudPayments widget loads + initialises)
  3. `/checkout/[slug]` (same widget)
  4. `/offer`, `/privacy`, `/consent/personal-data` (legal text rendering)
  5. `/cabinet`, `/admin/...` (gated routes)
  6. End-to-end test purchase via mock card (CloudPayments test mode)
- Sentry browser SDK still posts events (intentionally fire a `Sentry.captureMessage("csp-test")` in dev and verify it lands)
- All 8 CSP-protected pages load with zero `Refused to execute` console errors

## Rollback plan

Each PR is independently revertable. If PR 3 ("drop `'unsafe-inline'` for scripts") breaks something we missed, revert via `gh pr revert <num>`; site goes back to permissive CSP within one autodeploy cycle (~2 min). Backups of `next.config.js` per-PR via git history are sufficient.

If we get partway through and hit unforeseen complexity (e.g. a Next.js framework change that doesn't auto-thread the nonce on all inline scripts), the partial state is still better than today: nonce + `'unsafe-inline'` is no worse than today, and we can ship Option C (split `style-src` only) as a partial close.

## Out of scope

- Refactor of `style={...}` to CSS Modules — separate wave if ever wanted
- Subresource Integrity (`integrity`) attributes for the CloudPayments widget — separate wave
- `Permissions-Policy` / `Cross-Origin-Embedder-Policy` review — already documented in the `next.config.js` headers block, separately auditable
- HSTS preload submission — already shipped in PR #80

## Open questions

1. **GA status** — is `https://www.googletagmanager.com` ever going to be wired in? If yes, where (which page, which strategy)? If no, PR 5 drops the entry.
2. **next/font self-hosting** — verify that `https://fonts.googleapis.com` / `gstatic.com` are still load-bearing. If we've migrated all fonts to `next/font` self-hosted, those entries can also drop.
3. **Sentry tunnel** — `next.config.js` has a comment about tunnelling SDK requests through `/monitoring`. If we ever turn that on, we can drop the direct Sentry ingest entries from `connect-src`.

## Related

- Issue #88 — tracking
- Codex Wave 8 #2 — original finding
- `next.config.js` — current policy
- `instrumentation-client.ts` — Sentry browser SDK init (sensitive to CSP changes)
