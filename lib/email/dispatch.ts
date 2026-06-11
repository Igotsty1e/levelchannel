import { sendEmail } from '@/lib/email/client'
import {
  renderSbpClaimEmail,
  type SbpClaimEmailParams,
} from '@/lib/email/sbp-claim-template'
import { renderAlreadyRegisteredEmail } from '@/lib/email/templates/already-registered'
import {
  renderLearnerDirectAssignDigestEmail,
  type LearnerDirectAssignDigestParams,
} from '@/lib/email/templates/learner-direct-assign-digest'
import {
  renderLearnerDirectAssignNoticeEmail,
  type LearnerDirectAssignNoticeParams,
} from '@/lib/email/templates/learner-direct-assign-notice'
import {
  renderLearnerLessonReminderEmail,
  type LearnerLessonReminderParams,
} from '@/lib/email/templates/learner-lesson-reminder'
import {
  renderOperatorPackageGrantFailureEmail,
  type OperatorPackageGrantFailureParams,
} from '@/lib/email/templates/operator-package-grant-failure'
import {
  renderOperatorPaymentFailureEmail,
  type OperatorPaymentFailureParams,
} from '@/lib/email/templates/operator-payment-failure'
import {
  renderOperatorPaymentNotifyEmail,
  type OperatorPaymentNotifyParams,
} from '@/lib/email/templates/operator-payment-notify'
import { renderPasswordChangedEmail } from '@/lib/email/templates/password-changed'
import { renderResetEmail } from '@/lib/email/templates/reset'
import { renderVerifyEmail } from '@/lib/email/templates/verify'
import { paymentConfig } from '@/lib/payments/config'

// Verify URL points DIRECTLY at the API handler (`/api/auth/verify`) — the
// handler is a GET click-through that consumes the token and 303-redirects
// the browser to /cabinet or /verify-failed. Email-clickable, POST-only flow
// not needed because the API URL is itself a redirect, so no loader UI is
// required.
function buildVerifyUrl(token: string): string {
  return `${paymentConfig.siteUrl}/api/auth/verify?token=${encodeURIComponent(token)}`
}

// Reset URL points at the UI form route `/reset` (`app/reset/page.tsx`)
// because reset-confirm is POST-only — the user must submit a new
// password. The token itself is consumed by
// `POST /api/auth/reset-confirm`.
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

/**
 * Fire-and-forget security notification after a successful in-cabinet
 * password change. Caller wraps in try/catch — Resend outage MUST NOT
 * fail the password-change route.
 */
export async function sendPasswordChangedEmail(
  to: string,
  meta: { ipPrefix: string | null; uaSummary: string | null; changedAtIso: string },
) {
  const tpl = renderPasswordChangedEmail({
    ipPrefix: meta.ipPrefix,
    uaSummary: meta.uaSummary,
    changedAtIso: meta.changedAtIso,
    forgotUrl: buildForgotUrl(),
  })
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

// teacher-payments-sbp-self-service: учитель узнаёт о новой SBP-заявке.
// Best-effort: вызывающий код оборачивает в try/catch — отказ email-
// провайдера не должен ломать создание claim.
export async function sendSbpClaimNotificationToTeacher(
  to: string,
  params: Omit<SbpClaimEmailParams, 'cabinetUrl'> & { cabinetUrl?: string },
) {
  const tpl = renderSbpClaimEmail({
    ...params,
    cabinetUrl: params.cabinetUrl ?? `${paymentConfig.siteUrl}/teacher/payments`,
  })
  return sendEmail({ to, subject: tpl.subject, html: tpl.html, text: tpl.text })
}

// BCS-DEF-4 (2026-05-19) — learner lesson reminder dispatch. Used
// only by scripts/learner-reminder-dispatch.mjs (the cron-driven
// scheduler), but lives here for two reasons:
//   1. Symmetry with the rest of the transactional senders so the
//      "what emails can leave this app?" question has one answer.
//   2. Tests can mock `sendEmail` once and cover every sender.
//
// Caller passes the rendered cabinet URL already (template doesn't
// know paymentConfig); the dispatch wrapper just injects siteUrl on
// behalf of the .mjs caller which is outside the @/ alias surface.
export async function sendLearnerLessonReminderEmail(
  to: string,
  params: Omit<LearnerLessonReminderParams, 'cabinetUrl'> & {
    cabinetUrl?: string
  },
) {
  const tpl = renderLearnerLessonReminderEmail({
    ...params,
    cabinetUrl: params.cabinetUrl ?? `${paymentConfig.siteUrl}/cabinet`,
  })
  return sendEmail({ to, subject: tpl.subject, html: tpl.html, text: tpl.text })
}

// teacher-direct-assign (Задача 2.2, Sub-PR B, 2026-06-11).
// Учитель назначил конкретное занятие конкретному ученику —
// notification at booking-time. Best-effort: caller wraps in try/catch
// (Resend outage не должна блокировать создание slot'а).
export async function sendLearnerDirectAssignNoticeEmail(
  to: string,
  params: Omit<LearnerDirectAssignNoticeParams, 'cabinetUrl'> & {
    cabinetUrl?: string
  },
) {
  const tpl = renderLearnerDirectAssignNoticeEmail({
    ...params,
    cabinetUrl: params.cabinetUrl ?? `${paymentConfig.siteUrl}/cabinet`,
  })
  return sendEmail({ to, subject: tpl.subject, html: tpl.html, text: tpl.text })
}

// teacher-no-slots-mode (Задача 2.1, Sub-PR C, 2026-06-11).
// Batched notification — собирает все занятия, назначенные учителем за
// последний час, в одно письмо. Cron `learner-direct-assign-digest.mjs`
// собирает pending rows и вызывает this.
export async function sendLearnerDirectAssignDigestEmail(
  to: string,
  params: Omit<LearnerDirectAssignDigestParams, 'cabinetUrl'> & {
    cabinetUrl?: string
  },
) {
  const tpl = renderLearnerDirectAssignDigestEmail({
    ...params,
    cabinetUrl: params.cabinetUrl ?? `${paymentConfig.siteUrl}/cabinet`,
  })
  return sendEmail({ to, subject: tpl.subject, html: tpl.html, text: tpl.text })
}

// Wave 15 — package-grant failure dispatch. Fires from
// processPackageGrant on every semantic-failure reason (eight as
// of PKG-ADMIN-GRANT 2026-05-16, last added:
// already_owns_active_package). Best-effort; silent skip when
// OPERATOR_NOTIFY_EMAIL is empty; never blocks the webhook ack.
export async function sendOperatorPackageGrantFailureNotification(
  params: Omit<OperatorPackageGrantFailureParams, 'siteUrl'>,
) {
  const to = process.env.OPERATOR_NOTIFY_EMAIL?.trim() || ''
  if (!to) {
    return { ok: false as const, reason: 'no_recipient' as const }
  }
  const tpl = renderOperatorPackageGrantFailureEmail({
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
