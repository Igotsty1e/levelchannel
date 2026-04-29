import { sendEmail } from '@/lib/email/client'
import { renderResetEmail } from '@/lib/email/templates/reset'
import { renderVerifyEmail } from '@/lib/email/templates/verify'
import { paymentConfig } from '@/lib/payments/config'

function buildVerifyUrl(token: string): string {
  return `${paymentConfig.siteUrl}/verify?token=${encodeURIComponent(token)}`
}

function buildResetUrl(token: string): string {
  return `${paymentConfig.siteUrl}/reset?token=${encodeURIComponent(token)}`
}

export async function sendVerifyEmail(to: string, token: string) {
  const tpl = renderVerifyEmail({ verifyUrl: buildVerifyUrl(token) })
  return sendEmail({ to, subject: tpl.subject, html: tpl.html, text: tpl.text })
}

export async function sendResetEmail(to: string, token: string) {
  const tpl = renderResetEmail({ resetUrl: buildResetUrl(token) })
  return sendEmail({ to, subject: tpl.subject, html: tpl.html, text: tpl.text })
}
