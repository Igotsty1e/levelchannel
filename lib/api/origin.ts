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

export function resolveCanonicalOrigin(request: Request): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  if (fromEnv) {
    try {
      const parsed = new URL(fromEnv)
      if (
        (parsed.protocol === 'http:' || parsed.protocol === 'https:')
        && !parsed.origin.startsWith('http://localhost')
      ) {
        return parsed.origin
      }
    } catch {
      // malformed env value — fall through
    }
  }
  try {
    return new URL(request.url).origin
  } catch {
    return 'http://localhost:3000'
  }
}
