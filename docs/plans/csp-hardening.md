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

**Scope:** Next.js App Router auto-applies the nonce when it's set on the response. We just need to make sure the response header is set; the framework does the rest. Verify by inspecting the rendered HTML — every inline `<script>` Next.js emits should have `nonce="..."` matching the response.

**Files:**
- `app/layout.tsx` — pass nonce into `<head>` if explicit `<Script>` blocks need it (audit the 2 CloudPayments script tags — they're external URL loads, no nonce needed, but check for completeness)
- `app/pay/page.tsx`, `app/checkout/[tariffSlug]/page.tsx` — verify `<Script>` components inherit the nonce from middleware

**Tests:**
- Snapshot test: rendered HTML has `nonce` attribute on every inline `<script>`
- Manual: load `/`, `/pay`, `/checkout/[slug]` in DevTools and verify no CSP violations in console

**Acceptance:** every inline script in rendered HTML carries the nonce; no console errors; CloudPayments widget initialises on `/pay`.

### PR 3 — drop `script-src 'unsafe-inline'`

**Scope:** edit `next.config.js` CSP policy: `script-src 'self' 'nonce-{NONCE}' https://widget.cloudpayments.ru` (no `'unsafe-inline'`). Drop unused `googletagmanager.com` / `google-analytics.com` from the allowlist if GA is not wired (see inventory above).

**Files:**
- `next.config.js`

**Tests:**
- Existing CI must still pass (build + integration tests + public-surface check)
- Manual smoke: `/`, `/pay`, `/checkout/[slug]`, `/offer`, `/privacy`, `/cabinet/...`, `/admin/...` in real browser; check console for CSP violations
- Manual: trigger a payment on `/pay`; confirm CloudPayments widget loads and processes the test card

**Acceptance:** zero `Refused to execute inline script because it violates the following Content Security Policy directive` errors in console across all surfaces. If any surface fails — rollback PR 3 and add the missing nonce thread to that surface in a follow-up before re-attempting.

### PR 4 — split `style-src` (keep `style-src-attr 'unsafe-inline'`)

**Scope:** add `style-src-attr 'unsafe-inline'` directive. Update `style-src` to no longer cover attribute styles — it now applies only to `<style>` tags and `<link rel="stylesheet">`. Inline `style={...}` attributes continue to work because `style-src-attr` covers them.

**Files:**
- `next.config.js`

**Tests:**
- Visual smoke across surfaces (no layout regressions)
- Console check: zero CSP violations

**Acceptance:** site renders identically; `style-src` no longer needs `'unsafe-inline'` for any real `<style>` tag (we have ~0 of those); `style-src-attr` keeps inline attribute styles working.

### PR 5 — drop dead CSP entries + post-wave docs

**Scope:**
- Drop `googletagmanager.com` / `google-analytics.com` from CSP if GA is still not wired (verify with stakeholder)
- Add `docs/security-csp.md` documenting the final CSP, the nonce flow, and what to check when adding a new external dependency

**Files:**
- `next.config.js`
- `docs/security-csp.md` (new)

**Acceptance:** CSP header contains only directives that are actually load-bearing; `docs/security-csp.md` exists with a runbook entry: "How to add a new external CDN/script source to CSP".

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
