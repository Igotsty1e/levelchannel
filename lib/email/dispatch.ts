import { sendEmail } from '@/lib/email/client'
import { renderAlreadyRegisteredEmail } from '@/lib/email/templates/already-registered'
import { renderResetEmail } from '@/lib/email/templates/reset'
import { renderVerifyEmail } from '@/lib/email/templates/verify'
import { paymentConfig } from '@/lib/payments/config'

function buildVerifyUrl(token: string): string {
  return `${paymentConfig.siteUrl}/verify?token=${encodeURIComponent(token)}`
}

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
