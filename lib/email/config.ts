// Standalone config for the email transport. Lives in lib/email/ so a
// future move to a shared config module is a one-file refactor.
//
// Production assertions at module load (per /plan-eng-review mech-3):
// boot fails when required secrets are absent under NODE_ENV=production.
// Mirrors the pattern in lib/payments/config.ts.
//
// In dev (NODE_ENV !== 'production') a missing RESEND_API_KEY is fine —
// transport falls back to console writer. Missing AUTH_RATE_LIMIT_SECRET
// is fine in dev too — lib/auth/email-hash.ts uses a stable non-secret
// fallback locally.

const isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build'
const isProd = process.env.NODE_ENV === 'production' && !isBuildPhase

// 2026-06-16: shared escape-hatch for the Playwright product-flow CI
// workflow. The workflow spawns `next start` under NODE_ENV=production
// to exercise the real bundle, but does NOT carry real secrets
// (RESEND_API_KEY would let stub calls escape to real Resend). The
// workflow sets LEVELCHANNEL_E2E_ALLOW_HTTP_SITE_URL=1; we reuse the
// same flag here so a single CI-only knob exempts all E2E-specific
// fail-fast validators. Prod env never sets the flag — these
// assertions still bite prod misconfig.
const e2eMode =
  process.env.LEVELCHANNEL_E2E_ALLOW_HTTP_SITE_URL === '1'

if (isProd && !e2eMode && !(process.env.RESEND_API_KEY?.trim())) {
  throw new Error(
    'RESEND_API_KEY is required when NODE_ENV=production. Set it in the production env store.',
  )
}

if (isProd && !e2eMode && !(process.env.AUTH_RATE_LIMIT_SECRET?.trim())) {
  throw new Error(
    'AUTH_RATE_LIMIT_SECRET is required when NODE_ENV=production. Generate 32+ random chars; do not reuse TELEMETRY_HASH_SECRET.',
  )
}

export type EmailConfig = {
  apiKey: string
  from: string
  enabled: boolean
}

export function readEmailConfig(): EmailConfig {
  const apiKey = process.env.RESEND_API_KEY?.trim() || ''
  const from = process.env.EMAIL_FROM?.trim() || 'LevelChannel <onboarding@resend.dev>'
  return {
    apiKey,
    from,
    enabled: apiKey.length > 0,
  }
}
