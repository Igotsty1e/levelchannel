// Next.js calls `register()` once per Node/Edge runtime instance at boot.
// We dispatch to the right Sentry init for the runtime so the same file
// covers both API routes (Node) and middleware/edge (Edge).
//
// SENTRY_DSN comes from /etc/levelchannel.env in production. Missing
// DSN in dev → SDK becomes a no-op, which is what we want.
//
// `onRequestError` is the standard Next.js 16 hook for surfacing
// otherwise-uncaught errors from server components / route handlers.

import type * as Sentry from '@sentry/nextjs'

let _captureRequestError: typeof Sentry.captureRequestError | undefined

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const sentry = await import('@sentry/nextjs')
    sentry.init({
      dsn: process.env.SENTRY_DSN,
      // Conservative defaults for a low-volume site. We care about
      // errors first, performance traces second; bumping later is
      // cheaper than scrubbing PII out of a flood of traces today.
      tracesSampleRate: 0.1,
      // Don't ship secrets in breadcrumbs. The default integrations
      // already redact common auth headers; this stays the safer side.
      sendDefaultPii: false,
      environment: process.env.NODE_ENV,
      release: process.env.GIT_SHA || undefined,
    })
    _captureRequestError = sentry.captureRequestError
  } else if (process.env.NEXT_RUNTIME === 'edge') {
    const sentry = await import('@sentry/nextjs')
    sentry.init({
      dsn: process.env.SENTRY_DSN,
      tracesSampleRate: 0.1,
      sendDefaultPii: false,
      environment: process.env.NODE_ENV,
      release: process.env.GIT_SHA || undefined,
    })
    _captureRequestError = sentry.captureRequestError
  }
}

// Required export for Next.js server-component / route-handler error
// reporting. Wraps Sentry's helper so the import path stays in this
// file only — call sites don't need to know.
export const onRequestError: NonNullable<typeof Sentry.captureRequestError> = (
  ...args
) => _captureRequestError?.(...args)
