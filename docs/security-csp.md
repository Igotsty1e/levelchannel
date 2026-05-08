# Content-Security-Policy runbook

**Source of truth:** `lib/security/csp.ts` (`assembleCsp`).
**Per-request injection point:** `proxy.ts`.
**Activation trigger:** `app/layout.tsx` reads `headers().get('x-nonce')`.
**Wave history:** Wave 11 (closed 2026-05-09) — see `docs/plans/csp-hardening.md` for the full rollout.

This document describes the current CSP, why each directive is shaped the way it is, and the change-management discipline for adding a new external source.

## Current policy

Per-request, with a fresh nonce each render:

```
default-src 'self';
base-uri 'self';
object-src 'none';
frame-ancestors 'none';
form-action 'self' https://t.me https://*.t.me;
script-src 'self' 'nonce-{NONCE}' https://widget.cloudpayments.ru
                                  https://www.googletagmanager.com
                                  https://www.google-analytics.com;
style-src 'self';
style-src-attr 'unsafe-inline';
font-src 'self';
img-src 'self' data: https://*.cloudpayments.ru;
connect-src 'self' https://api.cloudpayments.ru https://widget.cloudpayments.ru
                   https://*.cloudpayments.ru
                   https://www.google-analytics.com https://region1.google-analytics.com
                   https://*.ingest.de.sentry.io https://*.ingest.sentry.io;
frame-src 'self' https://widget.cloudpayments.ru https://*.cloudpayments.ru;
worker-src 'self' blob:
```

### Single `'unsafe-inline'` left, by design

`style-src-attr 'unsafe-inline'` is the only `'unsafe-inline'` in the policy. It covers ~700+ inline JSX `style={...}` attributes which compile to DOM `style="..."` HTML attributes. Tightening this would require a full CSS-Modules / Tailwind refactor — separate wave with UX/visual regression budget. The other directives (`script-src`, `style-src`) are fully strict.

## Nonce flow

1. `proxy.ts` runs on every browser-facing request matched by its config.
2. `generateNonce()` returns a fresh base64-encoded random UUID (24 chars).
3. The nonce is mirrored into:
   - The **request** headers as `x-nonce` (so Server Components can read it via `next/headers`)
   - The **request** headers as `Content-Security-Policy` (so Next.js's framework knows the policy in effect)
   - The **response** `Content-Security-Policy` header (so the browser enforces it)
4. `app/layout.tsx` calls `(await headers()).get('x-nonce')`. The READ itself is the load-bearing side-effect:
   - It puts the layout (and hence every page) into dynamic-render mode (`ƒ` in build output)
   - It activates Next.js's auto-stamping of `nonce=` on every framework-emitted inline `<script>` (RSC hydration payloads, Next bootstrap)
5. Browser receives:
   - HTML with `<script nonce="X">...</script>` for every framework-emitted script
   - CSP header listing the same `'nonce-X'`
   - Any inline `<script>` lacking the matching nonce is refused

Without step 4, Next.js emits inline scripts WITHOUT `nonce=` — the browser then refuses them and the page breaks. This was the symptom that gated Wave 11 PR 3 for ~24 hours; see closed upstream [vercel/next.js#43743](https://github.com/vercel/next.js/issues/43743) for the resolution that pointed at the `headers()` trigger.

## Directive-by-directive rationale

| Directive | Why this shape |
|---|---|
| `default-src 'self'` | Fall-back for anything not separately directived. Only same-origin. |
| `base-uri 'self'` | Stops `<base href>` injection redirecting all relative URLs. |
| `object-src 'none'` | No `<object>`, `<embed>`, `<applet>`. We don't use them. |
| `frame-ancestors 'none'` | Site cannot be iframed. Equivalent to `X-Frame-Options: DENY`. |
| `form-action 'self' https://t.me https://*.t.me` | Forms can submit to LevelChannel itself or to Telegram (the operator's tg.me link is the contact CTA). |
| `script-src 'self' 'nonce-X' widget.cloudpayments.ru googletagmanager.com google-analytics.com` | Same-origin scripts + per-request nonced inline + 3 specific external loaders. **No** `'unsafe-inline'`, **no** `'unsafe-eval'`. |
| `style-src 'self'` | Same-origin stylesheet `<link>` and `<style>` blocks. **Strict.** |
| `style-src-attr 'unsafe-inline'` | Permits inline `style="..."` HTML attributes. The only `'unsafe-inline'` in the policy. |
| `font-src 'self'` | Fonts come from `next/font` (self-hosted). No external CDN. |
| `img-src 'self' data: https://*.cloudpayments.ru` | Same-origin + data-URLs (icons baked into JSX) + CloudPayments widget assets. |
| `connect-src ...` | XHR / fetch / WebSocket / EventSource. Allows our own origin, the CloudPayments API tier, GA pings, Sentry direct ingest (no tunneling — see Open Question #3 in the plan). |
| `frame-src 'self' widget.cloudpayments.ru *.cloudpayments.ru` | Permits the CloudPayments payment iframe. |
| `worker-src 'self' blob:` | Web Workers can be same-origin or `blob:`. Several libs spawn Workers from blob URLs at runtime. |

## Change management — how to add a new external source

When you add a third-party script / stylesheet / fetch / iframe target, **AND** in the same PR update the relevant directive in `lib/security/csp.ts`. The unit-test suite (`tests/security/csp.test.ts`) pins specific allowlist entries — adding a new one requires a test update in the same PR, which forces the change to be visible in code review.

### Concrete recipe

1. **Identify the resource type:**
   - JS loader / inline JS → `script-src`
   - External CSS file → `style-src`
   - HTML attribute style — already covered, no change
   - XHR / fetch / WebSocket / SSE target → `connect-src`
   - Iframe target → `frame-src`
   - Image source → `img-src`
   - Font file → `font-src`

2. **Add the host to the right directive in `lib/security/csp.ts`.** Use the most specific host you can (`https://api.example.com`, not `https://*.example.com`). Wildcard subdomains are acceptable when the vendor genuinely uses many subdomains for sharding — e.g. CloudPayments uses `*.cloudpayments.ru` for widget assets distributed across CDN edges.

3. **Add a unit test.** `tests/security/csp.test.ts` already has `it('preserves the existing CloudPayments + Sentry + GA allowlists')` — extend it to assert the new entry is present.

4. **Verify locally.** `npm run build` then load the page in a real browser, open DevTools console. CSP violations show as `Refused to ... because it violates the following Content Security Policy directive ...` — those are the spec failure mode. If you see them, your directive is missing the new host.

5. **Verify on prod after autodeploy.** `curl -I https://levelchannel.ru/ | grep -i csp` confirms the CSP header is what you expect.

### What NOT to do

- Don't add `'unsafe-inline'` back. The whole point of Wave 11 was removing it. If you have a "must-have" inline script, use the existing nonce mechanism: read `headers().get('x-nonce')` in your component, pass it to `<Script nonce={nonce} ...>`. The framework's auto-stamp covers framework-emitted scripts; user-written `<Script>` tags need the explicit prop.
- Don't add `'unsafe-eval'`. Several libraries (older Sentry SDK, some bundlers) historically required it; modern versions don't. If you hit a violation, file an issue against the library; don't loosen the policy.
- Don't add `'self'` to `frame-ancestors` thinking it lets your own pages iframe each other. We don't iframe our own pages and don't intend to start.
- Don't add the same host to multiple directives reflexively. A vendor's iframe widget needs `frame-src`; their JS loader needs `script-src`; their AJAX endpoint needs `connect-src`. Add only what's actually used.

## Trade-off — dynamic rendering

After Wave 11 PR 1.2 (#99), every page renders dynamically (`ƒ` icon for all routes in `npm run build` output). This is the inherent cost of per-request nonce CSP — a static page can't carry a per-request nonce by definition.

For LevelChannel's QPS (~10 page views / hour at peak), this adds ~50ms per render and is acceptable. If we ever scale up, options:

- Cache the static parts via Vercel's `unstable_cache` or HTTP `Cache-Control: public, s-maxage=...` (the nonce'd shell stays per-request; the data layer caches)
- Switch to hash-based CSP for static pages and reserve nonces for dynamic ones (complex; not urgent at our scale)
- Layer a CDN that respects per-page caching directives

Don't reach for these speculatively. The current setup is fine.

## Diagnostic recipes

### CSP not being set at all

Check `proxy.ts` is matching the route. The matcher excludes `/api/*`, `/_next/static/*`, `/_next/image/*`, and common static asset extensions. If your new route doesn't get CSP, look at the matcher first.

### Inline scripts blocked unexpectedly

1. Verify `app/layout.tsx` still calls `headers().get('x-nonce')`. If someone removed this, all inline scripts lose their nonce and the policy refuses them.
2. Verify the layout is `async` (it must be — `headers()` is async since Next.js 16).
3. `curl https://levelchannel.ru/ | grep -oE '<script[^>]*>' | grep -v src= | head -3` — should show 5 inline scripts each with a `nonce=` attribute. If they're bare, the trigger isn't firing.

### Console violations after adding a new dependency

Means the new dependency loads from a host not in the allowlist. Read the violation message — the URL it's trying to load is named — and add it to the right directive per the change-management recipe above.

## References

- `lib/security/csp.ts` — policy template
- `proxy.ts` — per-request middleware
- `app/layout.tsx` — `headers()` trigger
- `tests/security/csp.test.ts` — pinned contracts
- `docs/plans/csp-hardening.md` — Wave 11 plan with PR-by-PR rationale
- Closed upstream: [vercel/next.js#43743](https://github.com/vercel/next.js/issues/43743) (the issue whose resolution unblocked us)
- [MDN CSP reference](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy)
