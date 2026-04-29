// Browser-side Sentry init. Next.js auto-loads this top-level file in
// the client bundle (Next 15+). Empty NEXT_PUBLIC_SENTRY_DSN means the
// SDK is a no-op — exactly the behaviour we want in dev.
//
// We use a SEPARATE DSN env var name (NEXT_PUBLIC_SENTRY_DSN) so the
// build pipeline can decide whether to expose Sentry to the browser
// without forcing the server-side SENTRY_DSN to be public-prefixed.

import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
  environment: process.env.NODE_ENV,
  release: process.env.NEXT_PUBLIC_GIT_SHA || undefined,
  // No replay integration — privacy concern (we serve checkout) and
  // it doubles the SDK weight. Easy to turn on later if needed.
})

// Required export for Next.js to track router transitions in
// performance traces. Empty when client SDK is a no-op.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
