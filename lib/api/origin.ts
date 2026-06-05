// Standalone canonical-origin helper for API handlers that build
// absolute URLs (OAuth callback redirects, 3DS termURL, etc.).
//
// Behind a reverse proxy (nginx → Next), `new URL(request.url).origin`
// returns the upstream socket origin (`http://localhost:3000`), NOT the
// public origin. Using that for a Location header or a third-party
// termURL silently breaks the user-facing flow (ERR_SSL_PROTOCOL_ERROR
// on redirect; bank → localhost on 3DS return).
//
// Intentionally does NOT depend on `paymentConfig.siteUrl` — pulling
// `lib/payments/config.ts` in would bring its CloudPayments fail-fast
// boot guards into the calendar codepath. Calendar OAuth must stay
// independent of payment-env-validation.
//
// Production fail-closed contract: env MUST be set, https, non-loopback.
// Any failure throws so the route handler surfaces 500 instead of
// generating a redirect Location with proxy-localhost or an attacker-
// controlled origin from a malformed env.
//
// Plan: docs/plans/calendar-onboarding-followup-2026-06-06.md

import { isLoopbackOriginUrl } from '@/lib/security/local-host'

// Read NODE_ENV at CALL time, not module load. Lets vi.stubEnv flip
// prod-mode in static-import test suites without vi.resetModules.
function isProductionEnv(): boolean {
  return process.env.NODE_ENV === 'production'
}

export function resolveCanonicalOrigin(request: Request): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  const prod = isProductionEnv()

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

  // Dev: accept http(s) non-loopback env if set; otherwise fall back to
  // request.url so localhost dev works without env.
  if (fromEnv) {
    try {
      const parsed = new URL(fromEnv)
      if (
        (parsed.protocol === 'http:' || parsed.protocol === 'https:')
        && !isLoopbackOriginUrl(parsed)
      ) {
        return parsed.origin
      }
    } catch {
      // malformed dev env — fall through to request fallback
    }
  }
  try {
    return new URL(request.url).origin
  } catch {
    return 'http://localhost:3000'
  }
}
