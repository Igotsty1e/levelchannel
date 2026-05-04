import { sendEmail } from '@/lib/email/client'
import { renderAlreadyRegisteredEmail } from '@/lib/email/templates/already-registered'
import {
  renderOperatorPaymentFailureEmail,
  type OperatorPaymentFailureParams,
} from '@/lib/email/templates/operator-payment-failure'
import {
  renderOperatorPaymentNotifyEmail,
  type OperatorPaymentNotifyParams,
} from '@/lib/email/templates/operator-payment-notify'
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

// Operator-facing payment notification. Best-effort: caller wraps in
// try/catch so a Resend outage cannot block the webhook acknowledgment
// to CloudPayments. `OPERATOR_NOTIFY_EMAIL` controls the destination;
// when empty, we silently no-op (returns an `ok: false` shape so the
// caller sees the skip but doesn't have to handle a thrown error).
export async function sendOperatorPaymentNotification(
  params: Omit<OperatorPaymentNotifyParams, 'siteUrl'>,
) {
  const to = process.env.OPERATOR_NOTIFY_EMAIL?.trim() || ''
  if (!to) {
    return { ok: false as const, reason: 'no_recipient' as const }
  }
  const tpl = renderOperatorPaymentNotifyEmail({
    ...params,
    siteUrl: paymentConfig.siteUrl,
  })
  const result = await sendEmail({
    to,
    subject: tpl.subject,
    html: tpl.html,
    text: tpl.text,
  })
  return { ...result, recipient: to } as const
}

// Per-event failure notification. Symmetric with the success path —
// best-effort, silent skip when OPERATOR_NOTIFY_EMAIL is empty. Wired
// into terminal failure paths only (Fail webhook + 3DS decline); the
// aggregate webhook-flow alert keeps watching low-ratio trends.
export async function sendOperatorPaymentFailureNotification(
  params: Omit<OperatorPaymentFailureParams, 'siteUrl'>,
) {
  const to = process.env.OPERATOR_NOTIFY_EMAIL?.trim() || ''
  if (!to) {
    return { ok: false as const, reason: 'no_recipient' as const }
  }
  const tpl = renderOperatorPaymentFailureEmail({
    ...params,
    siteUrl: paymentConfig.siteUrl,
  })
  const result = await sendEmail({
    to,
    subject: tpl.subject,
    html: tpl.html,
    text: tpl.text,
  })
  return { ...result, recipient: to } as const
}
