import { Resend } from 'resend'

import { readEmailConfig } from '@/lib/email/config'

declare global {
  // eslint-disable-next-line no-var
  var __levelchannelResendClient: Resend | undefined
}

export type SendEmailParams = {
  to: string
  subject: string
  html: string
  text: string
}

export type SendEmailResult =
  | { ok: true; transport: 'resend' | 'console' }
  | { ok: false; transport: 'resend' | 'console'; error: string }

function getResend(apiKey: string) {
  if (!global.__levelchannelResendClient) {
    global.__levelchannelResendClient = new Resend(apiKey)
  }
  return global.__levelchannelResendClient
}

// Dev fallback writer. We log enough to copy the verify / reset link out
// of the terminal during local testing, but never print the body of a
// random transactional email by default — keep the secrets minimal.
function logToConsole(params: SendEmailParams) {
  console.log('[email:console]', {
    to: params.to,
    subject: params.subject,
    text: params.text,
  })
}

export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const config = readEmailConfig()

  if (!config.enabled) {
    logToConsole(params)
    return { ok: true, transport: 'console' }
  }

  try {
    const resend = getResend(config.apiKey)
    const result = await resend.emails.send({
      from: config.from,
      to: [params.to],
      subject: params.subject,
      html: params.html,
      text: params.text,
    })

    if (result.error) {
      return { ok: false, transport: 'resend', error: result.error.message }
    }

    return { ok: true, transport: 'resend' }
  } catch (error) {
    return {
      ok: false,
      transport: 'resend',
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
