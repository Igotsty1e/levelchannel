import { sendEmail } from '@/lib/email/client'
import { renderAlreadyRegisteredEmail } from '@/lib/email/templates/already-registered'
import { renderResetEmail } from '@/lib/email/templates/reset'
import { renderVerifyEmail } from '@/lib/email/templates/verify'
import { paymentConfig } from '@/lib/payments/config'

// Verify URL points DIRECTLY at the API handler (`/api/auth/verify`) — the
// handler is a GET click-through that consumes the token and 303-redirects
// the browser to /cabinet or /verify-failed. Email-clickable, no UI page
// required. Phase 2 may introduce a friendlier loader page, but until then
// the API URL is the canonical email destination.
function buildVerifyUrl(token: string): string {
  return `${paymentConfig.siteUrl}/api/auth/verify?token=${encodeURIComponent(token)}`
}

// Reset URL points at the UI form route `/reset` because reset-confirm is
// POST-only (the user must submit a new password). Phase 2 owns the
// `/reset` page; in Phase 1B the click landing is a 404 placeholder until
// the page ships. The token itself is consumed by `POST /api/auth/reset-confirm`.
function buildResetUrl(token: string): string {
  return `${paymentConfig.siteUrl}/reset?token=${encodeURIComponent(token)}`
}

function buildLoginUrl(): string {
  return `${paymentConfig.siteUrl}/login`
}

function buildForgotUrl(): string {
  return `${paymentConfig.siteUrl}/forgot`
}

export async function sendVerifyEmail(to: string, token: string) {
  const tpl = renderVerifyEmail({ verifyUrl: buildVerifyUrl(token) })
  return sendEmail({ to, subject: tpl.subject, html: tpl.html, text: tpl.text })
}

export async function sendResetEmail(to: string, token: string) {
  const tpl = renderResetEmail({ resetUrl: buildResetUrl(token) })
  return sendEmail({ to, subject: tpl.subject, html: tpl.html, text: tpl.text })
}

export async function sendAlreadyRegisteredEmail(to: string) {
  const tpl = renderAlreadyRegisteredEmail({
    loginUrl: buildLoginUrl(),
    resetUrl: buildForgotUrl(),
  })
  return sendEmail({ to, subject: tpl.subject, html: tpl.html, text: tpl.text })
}
